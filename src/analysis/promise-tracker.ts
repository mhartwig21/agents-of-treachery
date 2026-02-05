/**
 * Promise Tracker and Action Reconciler.
 *
 * Extracts promises from press messages, tracks them across turns,
 * and compares promised actions against actual orders to detect
 * promise-keeping vs promise-breaking behavior.
 */

import type { Power, Order, Season } from '../engine/types';
import type { Message } from '../press/types';

/**
 * A promise extracted from a press message.
 */
export interface ExtractedPromise {
  /** Unique ID for this promise */
  id: string;
  /** Power that made the promise */
  promiser: Power;
  /** Power the promise was made to */
  promisee: Power;
  /** Year the promise was made */
  year: number;
  /** Season the promise was made */
  season: Season;
  /** The raw message content */
  messageContent: string;
  /** Extracted promise type */
  type: PromiseType;
  /** Territory or unit referenced (if applicable) */
  territory?: string;
  /** Target power referenced (if applicable) */
  targetPower?: Power;
  /** Expected action type */
  expectedAction?: 'SUPPORT' | 'MOVE' | 'HOLD' | 'ATTACK' | 'NOT_ATTACK' | 'CONVOY';
}

/**
 * Types of promises that can be made in diplomatic communication.
 */
export type PromiseType =
  | 'SUPPORT' // "I will support your move"
  | 'NON_AGGRESSION' // "I won't attack you"
  | 'COORDINATION' // "Let's work together against X"
  | 'TERRITORY_DEAL' // "I'll take X, you take Y"
  | 'ALLIANCE_PROPOSAL' // General alliance
  | 'INFORMATION_SHARING'; // "I'll tell you what France does"

/**
 * Result of reconciling promises against actual orders.
 */
export interface PromiseReconciliation {
  /** The original promise */
  promise: ExtractedPromise;
  /** Whether the promise was kept */
  kept: boolean;
  /** Evidence for the determination */
  evidence: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Actual orders that relate to this promise */
  relatedOrders: Order[];
}

/**
 * Memory update generated from promise reconciliation.
 */
export interface PromiseMemoryUpdate {
  /** Power receiving this memory update */
  power: Power;
  /** Power the memory is about */
  aboutPower: Power;
  /** Trust delta (-1 to 1) */
  trustDelta: number;
  /** Human-readable memory prompt */
  memoryPrompt: string;
  /** Event type for memory system */
  eventType: 'PROMISE_KEPT' | 'PROMISE_BROKEN' | 'BETRAYAL';
  /** Year this occurred */
  year: number;
  /** Season this occurred */
  season: Season;
}

/**
 * Keywords and patterns for detecting promise types.
 */
const PROMISE_PATTERNS: Record<PromiseType, RegExp[]> = {
  SUPPORT: [
    /\bsupport\b.*\b(your|you)\b/i,
    /\bhelp\b.*\b(your|you)\b/i,
    /\bback\b.*\b(your|you|up)\b/i,
    /\bassist\b/i,
  ],
  NON_AGGRESSION: [
    /\bwon'?t\b.*\battack\b/i,
    /\bnot\b.*\battack\b/i,
    /\bno\b.*\baggression\b/i,
    /\bpeace\b/i,
    /\bnon-?aggression\b/i,
    /\bleave\b.*\balone\b/i,
    /\bstay\b.*\baway\b/i,
  ],
  COORDINATION: [
    /\btogether\b.*\bagainst\b/i,
    /\bcoordinate\b/i,
    /\bjoin\b.*\bagainst\b/i,
    /\bally\b.*\bagainst\b/i,
    /\bfight\b.*\btogether\b/i,
  ],
  TERRITORY_DEAL: [
    /\byou\b.*\btake\b.*\bi\b.*\btake\b/i,
    /\bi\b.*\btake\b.*\byou\b.*\btake\b/i,
    /\bsplit\b/i,
    /\bdivide\b/i,
    /\byours\b.*\bmine\b/i,
  ],
  ALLIANCE_PROPOSAL: [
    /\balliance\b/i,
    /\bally\b/i,
    /\bpartner\b/i,
    /\bwork\s+together\b/i,
    /\bfriends\b/i,
  ],
  INFORMATION_SHARING: [
    /\btell\b.*\bwhat\b/i,
    /\bshare\b.*\binformation\b/i,
    /\blet\b.*\bknow\b/i,
    /\binform\b/i,
  ],
};

/**
 * Territories that might be mentioned in promises.
 */
const TERRITORY_PATTERN = /\b(BEL|HOL|BUR|MUN|RUH|PIE|TYR|BOH|SIL|GAL|BUD|VIE|TRI|VEN|SER|RUM|BUL|GRE|CON|ANK|SMY|ARM|SEV|WAR|MOS|STP|FIN|SWE|NOR|DEN|KIE|BER|PRU|LVN|EDI|LVP|LON|YOR|WAL|CLY|NAF|TUN|POR|SPA|MAR|GAS|BRE|PAR|PIC)\b/gi;

/**
 * Extracts a unique ID for a promise.
 */
function generatePromiseId(): string {
  return `promise_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Extracts promises from a single press message.
 */
export function extractPromisesFromMessage(
  message: Message,
  recipient: Power
): ExtractedPromise[] {
  const promises: ExtractedPromise[] = [];
  const content = message.content;

  // Check each promise pattern
  for (const [type, patterns] of Object.entries(PROMISE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        // Extract any territories mentioned
        const territoryMatches = content.match(TERRITORY_PATTERN);
        const territory = territoryMatches?.[0]?.toUpperCase();

        promises.push({
          id: generatePromiseId(),
          promiser: message.sender,
          promisee: recipient,
          year: 0, // Will be set by caller with context
          season: 'SPRING', // Will be set by caller
          messageContent: content,
          type: type as PromiseType,
          territory,
          expectedAction: mapPromiseTypeToAction(type as PromiseType),
        });

        // Only count one promise per message per type
        break;
      }
    }
  }

  // Also check message intent metadata
  if (message.metadata?.intent === 'PROPOSAL') {
    // If it's a proposal and we didn't detect a specific promise type,
    // treat it as an alliance proposal
    if (promises.length === 0) {
      promises.push({
        id: generatePromiseId(),
        promiser: message.sender,
        promisee: recipient,
        year: 0,
        season: 'SPRING',
        messageContent: content,
        type: 'ALLIANCE_PROPOSAL',
      });
    }
  }

  return promises;
}

/**
 * Maps a promise type to an expected action type.
 */
function mapPromiseTypeToAction(
  type: PromiseType
): ExtractedPromise['expectedAction'] | undefined {
  switch (type) {
    case 'SUPPORT':
      return 'SUPPORT';
    case 'NON_AGGRESSION':
      return 'NOT_ATTACK';
    case 'COORDINATION':
      return 'ATTACK';
    default:
      return undefined;
  }
}

/**
 * Extracts all promises from a set of messages in a turn.
 */
export function extractPromisesFromTurn(
  messages: Message[],
  year: number,
  season: Season
): ExtractedPromise[] {
  const allPromises: ExtractedPromise[] = [];

  for (const message of messages) {
    // We need to know the recipient - for bilateral channels, it's the other participant
    // For now, we'll extract the recipient from the channel ID if bilateral
    const channelId = message.channelId;
    if (channelId.startsWith('bilateral:')) {
      const [, power1, power2] = channelId.split(':');
      const recipient = message.sender === power1 ? power2 : power1;
      const promises = extractPromisesFromMessage(
        message,
        recipient as Power
      );

      // Set the context
      for (const promise of promises) {
        promise.year = year;
        promise.season = season;
      }

      allPromises.push(...promises);
    }
  }

  return allPromises;
}

/**
 * Checks if an order is an attack on a specific power.
 */
function isAttackOnPower(
  order: Order,
  targetPower: Power,
  unitOwners: Map<string, Power>
): boolean {
  if (order.type !== 'MOVE') return false;
  const destination = (order as any).destination;
  const targetOwner = unitOwners.get(destination);
  return targetOwner === targetPower;
}

/**
 * Checks if an order is a support for a specific power's unit.
 */
function isSupportForPower(
  order: Order,
  targetPower: Power,
  unitOwners: Map<string, Power>
): boolean {
  if (order.type !== 'SUPPORT') return false;
  const supportedUnit = (order as any).supportedUnit;
  const supportedOwner = unitOwners.get(supportedUnit);
  return supportedOwner === targetPower;
}

/**
 * Reconciles a single promise against the actual orders submitted.
 */
export function reconcilePromise(
  promise: ExtractedPromise,
  orders: Map<Power, Order[]>,
  unitOwners: Map<string, Power>
): PromiseReconciliation {
  const promiserOrders = orders.get(promise.promiser) || [];

  switch (promise.type) {
    case 'SUPPORT': {
      // Check if they actually supported the promisee's units
      const supportOrders = promiserOrders.filter((o) =>
        isSupportForPower(o, promise.promisee, unitOwners)
      );
      const kept = supportOrders.length > 0;
      return {
        promise,
        kept,
        evidence: kept
          ? `Gave support to ${promise.promisee}'s units`
          : `No support orders for ${promise.promisee}`,
        confidence: 0.8,
        relatedOrders: supportOrders,
      };
    }

    case 'NON_AGGRESSION': {
      // Check if they attacked the promisee
      const attackOrders = promiserOrders.filter((o) =>
        isAttackOnPower(o, promise.promisee, unitOwners)
      );
      const kept = attackOrders.length === 0;
      return {
        promise,
        kept,
        evidence: kept
          ? `Did not attack ${promise.promisee}`
          : `Attacked ${promise.promisee}'s territory`,
        confidence: 0.9,
        relatedOrders: attackOrders,
      };
    }

    case 'COORDINATION': {
      // Check if they attacked the target power (if specified)
      if (promise.targetPower) {
        const attackOrders = promiserOrders.filter((o) =>
          isAttackOnPower(o, promise.targetPower!, unitOwners)
        );
        const kept = attackOrders.length > 0;
        return {
          promise,
          kept,
          evidence: kept
            ? `Attacked ${promise.targetPower} as coordinated`
            : `Did not attack ${promise.targetPower}`,
          confidence: 0.6,
          relatedOrders: attackOrders,
        };
      }
      // If no target specified, we can't verify
      return {
        promise,
        kept: true,
        evidence: 'Unable to verify coordination without specific target',
        confidence: 0.3,
        relatedOrders: [],
      };
    }

    case 'TERRITORY_DEAL': {
      // Check if they moved into territories claimed by promisee
      if (promise.territory) {
        const moveToTerritory = promiserOrders.filter(
          (o) => o.type === 'MOVE' && (o as any).destination === promise.territory
        );
        // If they moved to a territory that was supposed to go to promisee, that's breaking the deal
        const kept = moveToTerritory.length === 0;
        return {
          promise,
          kept,
          evidence: kept
            ? `Did not move to claimed territory ${promise.territory}`
            : `Moved to ${promise.territory} despite deal`,
          confidence: 0.7,
          relatedOrders: moveToTerritory,
        };
      }
      return {
        promise,
        kept: true,
        evidence: 'Unable to verify territory deal without specific territory',
        confidence: 0.3,
        relatedOrders: [],
      };
    }

    default:
      // For alliance proposals and information sharing, we can't easily verify
      return {
        promise,
        kept: true,
        evidence: 'Promise type not verifiable through orders',
        confidence: 0.2,
        relatedOrders: [],
      };
  }
}

/**
 * Reconciles all promises against orders and generates memory updates.
 */
export function reconcileAllPromises(
  promises: ExtractedPromise[],
  orders: Map<Power, Order[]>,
  unitOwners: Map<string, Power>,
  year: number,
  season: Season
): PromiseMemoryUpdate[] {
  const updates: PromiseMemoryUpdate[] = [];

  for (const promise of promises) {
    const reconciliation = reconcilePromise(promise, orders, unitOwners);

    // Only generate updates for high-confidence reconciliations
    if (reconciliation.confidence < 0.5) continue;

    if (reconciliation.kept) {
      // Promise was kept - positive trust update
      updates.push({
        power: promise.promisee,
        aboutPower: promise.promiser,
        trustDelta: 0.1,
        memoryPrompt: `${promise.promiser} kept their promise: ${reconciliation.evidence}`,
        eventType: 'PROMISE_KEPT',
        year,
        season,
      });
    } else {
      // Promise was broken - negative trust update
      const isBetray = promise.type === 'NON_AGGRESSION';
      updates.push({
        power: promise.promisee,
        aboutPower: promise.promiser,
        trustDelta: isBetray ? -0.3 : -0.15,
        memoryPrompt: `${promise.promiser} broke their promise: ${reconciliation.evidence}. They said: "${promise.messageContent.slice(0, 100)}..."`,
        eventType: isBetray ? 'BETRAYAL' : 'PROMISE_BROKEN',
        year,
        season,
      });
    }
  }

  return updates;
}

/**
 * Generates a summary of promise activity for agent prompts.
 */
export function generatePromiseSummary(
  updates: PromiseMemoryUpdate[],
  forPower: Power
): string {
  const relevantUpdates = updates.filter((u) => u.power === forPower);

  if (relevantUpdates.length === 0) {
    return '';
  }

  const lines: string[] = ['--- PROMISE RECONCILIATION ---'];

  for (const update of relevantUpdates) {
    if (update.eventType === 'PROMISE_KEPT') {
      lines.push(`✓ ${update.memoryPrompt}`);
    } else if (update.eventType === 'BETRAYAL') {
      lines.push(`✗✗ BETRAYAL: ${update.memoryPrompt}`);
    } else {
      lines.push(`✗ ${update.memoryPrompt}`);
    }
  }

  return lines.join('\n');
}

/**
 * Tracks promises across turns.
 */
export class PromiseTracker {
  private promisesByTurn: Map<string, ExtractedPromise[]> = new Map();
  private reconciliations: Map<string, PromiseReconciliation[]> = new Map();

  /**
   * Records promises from a turn's press messages.
   */
  recordTurnPromises(
    messages: Message[],
    year: number,
    season: Season
  ): ExtractedPromise[] {
    const turnKey = `${year}-${season}`;
    const promises = extractPromisesFromTurn(messages, year, season);
    this.promisesByTurn.set(turnKey, promises);
    return promises;
  }

  /**
   * Reconciles promises from a previous turn against orders.
   */
  reconcileTurn(
    year: number,
    season: Season,
    orders: Map<Power, Order[]>,
    unitOwners: Map<string, Power>
  ): PromiseMemoryUpdate[] {
    // Look for promises made last turn
    const prevTurnKey = this.getPreviousTurnKey(year, season);
    const promises = this.promisesByTurn.get(prevTurnKey) || [];

    if (promises.length === 0) {
      return [];
    }

    // Reconcile each promise
    const reconciliations: PromiseReconciliation[] = [];
    for (const promise of promises) {
      reconciliations.push(reconcilePromise(promise, orders, unitOwners));
    }

    this.reconciliations.set(prevTurnKey, reconciliations);

    // Generate memory updates
    return reconcileAllPromises(promises, orders, unitOwners, year, season);
  }

  /**
   * Gets the key for the previous turn.
   */
  private getPreviousTurnKey(year: number, season: Season): string {
    if (season === 'FALL') {
      return `${year}-SPRING`;
    } else {
      return `${year - 1}-FALL`;
    }
  }

  /**
   * Gets all promises made to a specific power.
   */
  getPromisesTo(power: Power): ExtractedPromise[] {
    const allPromises: ExtractedPromise[] = [];
    for (const promises of this.promisesByTurn.values()) {
      allPromises.push(...promises.filter((p) => p.promisee === power));
    }
    return allPromises;
  }

  /**
   * Gets all promises made by a specific power.
   */
  getPromisesBy(power: Power): ExtractedPromise[] {
    const allPromises: ExtractedPromise[] = [];
    for (const promises of this.promisesByTurn.values()) {
      allPromises.push(...promises.filter((p) => p.promiser === power));
    }
    return allPromises;
  }

  /**
   * Clears all tracked data.
   */
  clear(): void {
    this.promisesByTurn.clear();
    this.reconciliations.clear();
  }
}

/**
 * Creates a new PromiseTracker instance.
 */
export function createPromiseTracker(): PromiseTracker {
  return new PromiseTracker();
}
