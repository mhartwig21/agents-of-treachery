/**
 * Trust Tracker - "Say vs Do" Analysis Engine.
 *
 * Compares what powers say in press messages to what they actually do.
 * Tracks promises made in diplomatic communication and compares them
 * to actual game orders to calculate trust scores.
 */

import type { Power, Order, MoveOrder } from '../engine/types';
import { POWERS } from '../engine/types';
import type { Message } from '../press/types';
import type { OrdersSubmittedEvent } from '../store/events';

/**
 * A promise extracted from a press message.
 */
export interface Promise {
  /** Unique ID for this promise */
  id: string;
  /** Message ID this promise was extracted from */
  messageId: string;
  /** Power that made the promise */
  promisor: Power;
  /** Power the promise was made to */
  promisee: Power;
  /** Type of promise */
  type: PromiseType;
  /** Territory involved (if applicable) */
  territory?: string;
  /** Target power (e.g., for coordinated attacks) */
  targetPower?: Power;
  /** Turn the promise was made */
  turn: { year: number; season: 'SPRING' | 'FALL' };
  /** Turn the promise should be evaluated */
  evaluationTurn?: { year: number; season: 'SPRING' | 'FALL' };
  /** Whether the promise has been evaluated */
  evaluated: boolean;
  /** Whether the promise was kept (null if not yet evaluated) */
  kept: boolean | null;
  /** Description of the promise */
  description: string;
}

/**
 * Types of promises that can be tracked.
 */
export type PromiseType =
  | 'SUPPORT'           // Promised to support another power's unit
  | 'NON_AGGRESSION'    // Promised not to attack
  | 'DMZ'               // Agreed to keep a territory demilitarized
  | 'COORDINATED_MOVE'  // Agreed to move together against a target
  | 'RETREAT'           // Promised to retreat from a territory
  | 'BUILD_LIMIT'       // Promised to limit builds
  | 'ALLIANCE';         // General alliance commitment

/**
 * Trust metrics for a specific power.
 */
export interface TrustMetrics {
  power: Power;
  /** Total promises made to other powers */
  promisesMade: number;
  /** Promises that were kept */
  promisesKept: number;
  /** Promises that were broken */
  promisesBroken: number;
  /** Trust score (0-100, percentage of kept promises) */
  trustScore: number;
  /** Trend in trust score */
  trend: 'improving' | 'declining' | 'stable';
  /** Recent promises (for display) */
  recentPromises: Promise[];
}

/**
 * Trust relationship between two specific powers.
 */
export interface PairwiseTrust {
  /** Power A */
  power1: Power;
  /** Power B */
  power2: Power;
  /** Promises power1 made to power2 */
  promisesFromP1: number;
  /** Promises power1 kept to power2 */
  keptByP1: number;
  /** Promises power2 made to power1 */
  promisesFromP2: number;
  /** Promises power2 kept to power1 */
  keptByP2: number;
  /** Overall trust score between them */
  mutualTrustScore: number;
  /** Notable broken promises */
  brokenPromises: Promise[];
}

/**
 * Keywords that suggest different promise types.
 */
const PROMISE_KEYWORDS: Record<PromiseType, string[]> = {
  SUPPORT: ['support', 'help', 'assist', 'back you', 'support your'],
  NON_AGGRESSION: ['won\'t attack', 'will not attack', 'no attack', 'peace', 'non-aggression', 'not move against'],
  DMZ: ['dmz', 'demilitarized', 'neutral zone', 'stay out of', 'neither of us'],
  COORDINATED_MOVE: ['together', 'coordinate', 'joint attack', 'both move', 'work together against'],
  RETREAT: ['retreat', 'pull back', 'withdraw', 'leave'],
  BUILD_LIMIT: ['won\'t build', 'limit builds', 'no builds'],
  ALLIANCE: ['alliance', 'ally', 'allies', 'partner', 'work together'],
};

/**
 * Territory name patterns for extraction.
 */
const TERRITORY_PATTERNS = [
  // Common abbreviations
  /\b(MUN|BER|KIE|BUR|PAR|BRE|MAR|ROM|VEN|NAP|TRI|VIE|BUD|GAL|WAR|MOS|SEV|ANK|CON|SMY)\b/gi,
  // Full names
  /\b(Munich|Berlin|Kiel|Burgundy|Paris|Brest|Marseilles|Rome|Venice|Naples|Trieste|Vienna|Budapest|Galicia|Warsaw|Moscow|Sevastopol|Ankara|Constantinople|Smyrna)\b/gi,
  // Sea zones
  /\b(North Sea|Baltic|Black Sea|Mediterranean|Adriatic|Aegean|English Channel)\b/gi,
];

/**
 * Generates a unique promise ID.
 */
function generatePromiseId(): string {
  return `prom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extracts mentioned territories from text.
 */
function extractTerritories(text: string): string[] {
  const territories: string[] = [];
  for (const pattern of TERRITORY_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      territories.push(...matches.map(m => m.toUpperCase()));
    }
  }
  return [...new Set(territories)];
}

/**
 * Gets a canonical key for a power pair (alphabetically sorted).
 */
function getPairKey(p1: Power, p2: Power): string {
  return [p1, p2].sort().join('-');
}

/**
 * Trust Tracker Engine.
 *
 * Tracks promises made in diplomatic messages and evaluates them
 * against actual game orders to calculate trust scores.
 */
export class TrustTracker {
  private promises: Map<string, Promise> = new Map();
  private promisesByPair: Map<string, Promise[]> = new Map();
  private currentTurn: { year: number; season: 'SPRING' | 'FALL' } = { year: 1901, season: 'SPRING' };
  private orderHistory: Map<string, OrdersSubmittedEvent[]> = new Map();
  private trustHistory: Map<Power, number[]> = new Map();

  constructor() {
    // Initialize tracking structures for all power pairs
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const key = getPairKey(POWERS[i], POWERS[j]);
        this.promisesByPair.set(key, []);
      }
    }

    // Initialize trust history for all powers
    for (const power of POWERS) {
      this.trustHistory.set(power, []);
    }
  }

  /**
   * Processes a press message to extract promises.
   */
  processMessage(message: Message, gameContext: { year: number; season: 'SPRING' | 'FALL' }): Promise[] {
    const extracted: Promise[] = [];

    // Only process messages with diplomatic intent
    const intent = message.metadata?.intent;
    if (!intent || !['PROPOSAL', 'ACCEPTANCE'].includes(intent)) {
      return extracted;
    }

    // Determine the promisee from the channel
    // Bilateral channel format: "bilateral:POWER1:POWER2"
    const channelParts = message.channelId.split(':');
    if (channelParts.length < 3 || channelParts[0] !== 'bilateral') {
      return extracted; // Only track bilateral promises for now
    }

    const participants = [channelParts[1], channelParts[2]] as Power[];
    const promisee = participants.find(p => p !== message.sender);
    if (!promisee) return extracted;

    const content = message.content.toLowerCase();
    const territories = extractTerritories(message.content);

    // Check for each promise type
    for (const [type, keywords] of Object.entries(PROMISE_KEYWORDS) as [PromiseType, string[]][]) {
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          const promise: Promise = {
            id: generatePromiseId(),
            messageId: message.id,
            promisor: message.sender,
            promisee,
            type,
            territory: territories[0], // First mentioned territory
            turn: gameContext,
            evaluationTurn: this.getNextTurn(gameContext),
            evaluated: false,
            kept: null,
            description: this.describePromise(type, message.sender, promisee, territories[0]),
          };

          extracted.push(promise);
          this.addPromise(promise);
          break; // One promise per type per message
        }
      }
    }

    return extracted;
  }

  /**
   * Adds a promise to tracking.
   */
  private addPromise(promise: Promise): void {
    this.promises.set(promise.id, promise);

    const key = getPairKey(promise.promisor, promise.promisee);
    const pairPromises = this.promisesByPair.get(key) || [];
    pairPromises.push(promise);
    this.promisesByPair.set(key, pairPromises);
  }

  /**
   * Gets the next movement turn for evaluation.
   */
  private getNextTurn(current: { year: number; season: 'SPRING' | 'FALL' }): { year: number; season: 'SPRING' | 'FALL' } {
    if (current.season === 'SPRING') {
      return { year: current.year, season: 'FALL' };
    }
    return { year: current.year + 1, season: 'SPRING' };
  }

  /**
   * Creates a human-readable description of a promise.
   */
  private describePromise(type: PromiseType, promisor: Power, promisee: Power, territory?: string): string {
    const terr = territory ? ` at ${territory}` : '';
    switch (type) {
      case 'SUPPORT':
        return `${promisor} promised to support ${promisee}${terr}`;
      case 'NON_AGGRESSION':
        return `${promisor} promised not to attack ${promisee}${terr}`;
      case 'DMZ':
        return `${promisor} agreed to DMZ${terr} with ${promisee}`;
      case 'COORDINATED_MOVE':
        return `${promisor} agreed to coordinate with ${promisee}${terr}`;
      case 'RETREAT':
        return `${promisor} promised to retreat${terr}`;
      case 'BUILD_LIMIT':
        return `${promisor} promised to limit builds`;
      case 'ALLIANCE':
        return `${promisor} proposed alliance with ${promisee}`;
    }
  }

  /**
   * Processes submitted orders to evaluate promises.
   */
  processOrders(event: OrdersSubmittedEvent): void {
    const { power, orders, year, season } = event.payload;
    const turnKey = `${year}-${season}`;

    // Store orders for analysis
    const turnOrders = this.orderHistory.get(turnKey) || [];
    turnOrders.push(event);
    this.orderHistory.set(turnKey, turnOrders);

    // Update current turn
    this.currentTurn = { year, season: season as 'SPRING' | 'FALL' };

    // Evaluate promises that are due this turn
    const duePromises = Array.from(this.promises.values()).filter(
      p => !p.evaluated &&
           p.evaluationTurn &&
           p.evaluationTurn.year === year &&
           p.evaluationTurn.season === season &&
           p.promisor === power
    );

    for (const promise of duePromises) {
      this.evaluatePromise(promise, orders);
    }
  }

  /**
   * Evaluates whether a promise was kept based on orders.
   */
  private evaluatePromise(promise: Promise, orders: Order[]): void {
    let kept = false;

    switch (promise.type) {
      case 'SUPPORT':
        // Check if any support order benefits the promisee
        kept = orders.some(order => {
          if (order.type === 'SUPPORT') {
            // Would need unit ownership to fully verify, but presence of support is positive signal
            // Future: check if (order as SupportOrder).supportedUnit belongs to promisee
            return true; // Simplified: any support counts
          }
          return false;
        });
        break;

      case 'NON_AGGRESSION':
        // Check that no moves target the promisee's territory
        // Simplified: check that no aggressive moves were made
        kept = !orders.some(order => {
          if (order.type === 'MOVE') {
            const moveOrder = order as MoveOrder;
            // Would need unit positions to verify target ownership
            // For now, check if moving to promised territory
            if (promise.territory && moveOrder.destination.toUpperCase() === promise.territory) {
              return true; // Moving to promised territory = broken
            }
          }
          return false;
        });
        break;

      case 'DMZ':
        // Check that no units moved into the DMZ territory
        kept = !orders.some(order => {
          if (order.type === 'MOVE') {
            const moveOrder = order as MoveOrder;
            return promise.territory && moveOrder.destination.toUpperCase() === promise.territory;
          }
          return false;
        });
        break;

      case 'COORDINATED_MOVE':
        // Simplified: assume kept if any move was made
        kept = orders.some(order => order.type === 'MOVE');
        break;

      case 'RETREAT':
        // Check if unit left the promised territory
        kept = !orders.some(order => order.unit.toUpperCase() === promise.territory);
        break;

      case 'BUILD_LIMIT':
      case 'ALLIANCE':
        // These are harder to verify, default to kept
        kept = true;
        break;
    }

    promise.evaluated = true;
    promise.kept = kept;
  }

  /**
   * Gets trust metrics for a specific power.
   */
  getTrustMetrics(power: Power): TrustMetrics {
    const promises = Array.from(this.promises.values()).filter(p => p.promisor === power);
    const evaluated = promises.filter(p => p.evaluated);
    const kept = evaluated.filter(p => p.kept === true);
    const broken = evaluated.filter(p => p.kept === false);

    const trustScore = evaluated.length > 0
      ? Math.round((kept.length / evaluated.length) * 100)
      : 100; // Default to trusted if no data

    // Calculate trend from history
    const history = this.trustHistory.get(power) || [];
    history.push(trustScore);
    this.trustHistory.set(power, history.slice(-10)); // Keep last 10

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (history.length >= 3) {
      const recent = history.slice(-3);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const older = history.slice(-6, -3);
      if (older.length >= 3) {
        const oldAvg = older.reduce((a, b) => a + b, 0) / older.length;
        if (avg > oldAvg + 5) trend = 'improving';
        else if (avg < oldAvg - 5) trend = 'declining';
      }
    }

    return {
      power,
      promisesMade: promises.length,
      promisesKept: kept.length,
      promisesBroken: broken.length,
      trustScore,
      trend,
      recentPromises: promises.slice(-5),
    };
  }

  /**
   * Gets trust metrics between two specific powers.
   */
  getPairwiseTrust(p1: Power, p2: Power): PairwiseTrust {
    const key = getPairKey(p1, p2);
    const pairPromises = this.promisesByPair.get(key) || [];

    const fromP1 = pairPromises.filter(p => p.promisor === p1);
    const fromP2 = pairPromises.filter(p => p.promisor === p2);

    const keptByP1 = fromP1.filter(p => p.evaluated && p.kept === true).length;
    const keptByP2 = fromP2.filter(p => p.evaluated && p.kept === true).length;

    const evaluatedFromP1 = fromP1.filter(p => p.evaluated).length;
    const evaluatedFromP2 = fromP2.filter(p => p.evaluated).length;

    const totalEvaluated = evaluatedFromP1 + evaluatedFromP2;
    const totalKept = keptByP1 + keptByP2;

    const mutualTrustScore = totalEvaluated > 0
      ? Math.round((totalKept / totalEvaluated) * 100)
      : 100;

    const brokenPromises = pairPromises.filter(p => p.evaluated && p.kept === false);

    return {
      power1: p1,
      power2: p2,
      promisesFromP1: fromP1.length,
      keptByP1,
      promisesFromP2: fromP2.length,
      keptByP2,
      mutualTrustScore,
      brokenPromises,
    };
  }

  /**
   * Gets all trust metrics for all powers.
   */
  getAllTrustMetrics(): TrustMetrics[] {
    return POWERS.map(power => this.getTrustMetrics(power));
  }

  /**
   * Gets a trust indicator level for display.
   */
  getTrustIndicator(power: Power): 'high' | 'medium' | 'low' | 'unknown' {
    const metrics = this.getTrustMetrics(power);

    if (metrics.promisesMade === 0) return 'unknown';
    if (metrics.trustScore >= 70) return 'high';
    if (metrics.trustScore >= 40) return 'medium';
    return 'low';
  }

  /**
   * Gets a tooltip description for a power's trust level.
   */
  getTrustTooltip(power: Power): string {
    const metrics = this.getTrustMetrics(power);

    if (metrics.promisesMade === 0) {
      return `${power}: No promises tracked yet`;
    }

    const evaluated = metrics.promisesKept + metrics.promisesBroken;
    if (evaluated === 0) {
      return `${power}: ${metrics.promisesMade} promises made, pending evaluation`;
    }

    return `${power}: ${metrics.trustScore}% reliable (${metrics.promisesKept}/${evaluated} promises kept)`;
  }

  /**
   * Gets broken promises between two powers for display.
   */
  getBrokenPromisesSummary(p1: Power, p2: Power): string | null {
    const trust = this.getPairwiseTrust(p1, p2);
    if (trust.brokenPromises.length === 0) return null;

    return `Broke ${trust.brokenPromises.length} promise${trust.brokenPromises.length > 1 ? 's' : ''}`;
  }

  /**
   * Gets the current game turn being tracked.
   */
  getCurrentTurn(): { year: number; season: 'SPRING' | 'FALL' } {
    return { ...this.currentTurn };
  }

  /**
   * Resets the tracker to initial state.
   */
  reset(): void {
    this.promises.clear();
    this.orderHistory.clear();
    this.currentTurn = { year: 1901, season: 'SPRING' };

    // Reinitialize pair tracking
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const key = getPairKey(POWERS[i], POWERS[j]);
        this.promisesByPair.set(key, []);
      }
    }

    // Reset history
    for (const power of POWERS) {
      this.trustHistory.set(power, []);
    }
  }
}

/**
 * Creates a new TrustTracker instance.
 */
export function createTrustTracker(): TrustTracker {
  return new TrustTracker();
}
