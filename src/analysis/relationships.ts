/**
 * Action-Based Relationship Inference Engine.
 *
 * Analyzes game orders and results to infer relationships between powers.
 * Tracks alliances, hostilities, and betrayals based on observable actions.
 */

import type { Power, Order, SupportOrder, ConvoyOrder, MoveOrder, Unit } from '../engine/types';
import { POWERS } from '../engine/types';
import type { MovementResolvedEvent, SupplyCentersCapturedEvent, OrdersSubmittedEvent } from '../store/events';

/**
 * Point values for relationship-affecting actions.
 */
const RELATIONSHIP_POINTS = {
  // Positive signals
  DIRECT_SUPPORT: 3,
  SUCCESSFUL_CONVOY: 2,
  NO_ATTACK_WHEN_ADJACENT: 1,
  COORDINATED_ATTACK: 2,

  // Negative signals
  ATTACK: -3,
  SUCCESSFUL_CAPTURE: -5,
  CUT_SUPPORT: -2,
  BLOCKED_MOVE: -1,

  // Betrayal signals (strongest)
  SUPPORT_THEN_STAB: -10,
  BROKEN_PROMISE_ATTACK: -8,
} as const;

/**
 * Decay factor per turn for relationship scores.
 * Recent actions are weighted more heavily.
 */
const DECAY_FACTOR = 0.85;

/**
 * An action event that affected a relationship.
 */
export interface ActionEvent {
  /** Turn when the action occurred */
  year: number;
  season: 'SPRING' | 'FALL';
  /** Type of action */
  type: keyof typeof RELATIONSHIP_POINTS;
  /** Power that took the action */
  actor: Power;
  /** Power affected by the action */
  target: Power;
  /** Point value assigned */
  points: number;
  /** Description of what happened */
  description: string;
}

/**
 * Relationship between two powers.
 */
export interface PowerPairRelationship {
  /** First power (alphabetically first) */
  power1: Power;
  /** Second power */
  power2: Power;
  /** Current relationship score (-100 to +100) */
  score: number;
  /** Relationship status based on score */
  status: 'ally' | 'enemy' | 'neutral';
  /** Recent action events affecting this relationship */
  recentActions: ActionEvent[];
  /** Whether a betrayal has been detected */
  betrayalDetected: boolean;
  /** Turn when betrayal was detected (if any) */
  betrayalTurn?: { year: number; season: 'SPRING' | 'FALL' };
}

/**
 * Result of getRelationship query.
 */
export interface RelationshipResult {
  /** Current relationship score (-100 to +100) */
  score: number;
  /** Relationship status based on score */
  status: 'ally' | 'enemy' | 'neutral';
  /** Recent action events affecting this relationship */
  recentActions: ActionEvent[];
  /** Whether a betrayal has been detected */
  betrayalDetected: boolean;
}

/**
 * Internal state for tracking relationships.
 */
interface RelationshipState {
  /** Raw accumulated points (before decay) */
  rawPoints: number;
  /** List of all action events */
  events: ActionEvent[];
  /** Whether betrayal detected */
  betrayalDetected: boolean;
  /** Turn when betrayal was detected */
  betrayalTurn?: { year: number; season: 'SPRING' | 'FALL' };
}

/**
 * Order info enriched with owner power.
 */
interface EnrichedOrder {
  order: Order;
  power: Power;
}

/**
 * Gets a canonical key for a power pair (alphabetically sorted).
 */
function getPairKey(p1: Power, p2: Power): string {
  return [p1, p2].sort().join('-');
}

/**
 * Determines relationship status from score.
 */
function scoreToStatus(score: number): 'ally' | 'enemy' | 'neutral' {
  if (score >= 10) return 'ally';
  if (score <= -10) return 'enemy';
  return 'neutral';
}

/**
 * Clamps a score to the valid range.
 */
function clampScore(score: number): number {
  return Math.max(-100, Math.min(100, score));
}

/**
 * Action-based relationship inference engine.
 *
 * Tracks relationships between powers based on observable game actions:
 * - Supports and convoys increase trust
 * - Attacks and captures decrease trust
 * - Betrayals (support then stab) are tracked specially
 *
 * Scores decay over time to prioritize recent actions.
 */
export class ActionRelationshipEngine {
  private relationships: Map<string, RelationshipState> = new Map();
  private currentTurn: { year: number; season: 'SPRING' | 'FALL' } = { year: 1901, season: 'SPRING' };
  private lastTurnOrders: Map<string, EnrichedOrder[]> = new Map();
  private unitOwners: Map<string, Power> = new Map();

  /**
   * Creates a new relationship engine.
   */
  constructor() {
    // Initialize all power pairs with neutral relationships
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const key = getPairKey(POWERS[i], POWERS[j]);
        this.relationships.set(key, {
          rawPoints: 0,
          events: [],
          betrayalDetected: false,
        });
      }
    }
  }

  /**
   * Updates unit ownership map from a list of units.
   */
  updateUnitOwners(units: Unit[]): void {
    this.unitOwners.clear();
    for (const unit of units) {
      this.unitOwners.set(unit.province, unit.power);
    }
  }

  /**
   * Gets the power that owns a unit at a province.
   */
  private getUnitOwner(province: string): Power | undefined {
    return this.unitOwners.get(province);
  }

  /**
   * Records an action event between two powers.
   */
  private recordAction(
    type: keyof typeof RELATIONSHIP_POINTS,
    actor: Power,
    target: Power,
    description: string
  ): void {
    if (actor === target) return;

    const key = getPairKey(actor, target);
    const state = this.relationships.get(key);
    if (!state) return;

    const points = RELATIONSHIP_POINTS[type];
    const event: ActionEvent = {
      year: this.currentTurn.year,
      season: this.currentTurn.season,
      type,
      actor,
      target,
      points,
      description,
    };

    state.rawPoints += points;
    state.events.push(event);

    // Track betrayal
    if (type === 'SUPPORT_THEN_STAB' || type === 'BROKEN_PROMISE_ATTACK') {
      state.betrayalDetected = true;
      state.betrayalTurn = { ...this.currentTurn };
    }
  }

  /**
   * Applies time decay to all relationship scores.
   * Called at the start of each new turn.
   */
  private applyDecay(): void {
    for (const state of this.relationships.values()) {
      state.rawPoints *= DECAY_FACTOR;
    }
  }

  /**
   * Processes orders submitted for a turn.
   * Used to track what was ordered for later analysis.
   */
  processOrdersSubmitted(event: OrdersSubmittedEvent): void {
    const { power, orders, year, season } = event.payload;

    // Check if this is a new turn
    if (year !== this.currentTurn.year || season !== this.currentTurn.season) {
      // Apply decay and store last turn's orders
      if (this.currentTurn.year !== 1901 || this.currentTurn.season !== 'SPRING') {
        this.applyDecay();
      }
      this.lastTurnOrders = new Map(this.lastTurnOrders);
      this.currentTurn = { year, season: season as 'SPRING' | 'FALL' };
    }

    // Store orders for this power
    const enriched = orders.map(order => ({ order, power }));
    const existing = this.lastTurnOrders.get(`${year}-${season}`) || [];
    this.lastTurnOrders.set(`${year}-${season}`, [...existing, ...enriched]);
  }

  /**
   * Processes a turn's orders and results to extract relationship signals.
   */
  processTurn(
    orders: Order[],
    results: MovementResolvedEvent,
    captures: SupplyCentersCapturedEvent | null,
    unitsByProvince: Map<string, Power>
  ): void {
    const { year, season, results: resolutions, dislodged } = results.payload;

    // Update turn tracking
    if (year !== this.currentTurn.year || season !== this.currentTurn.season) {
      this.applyDecay();
      this.currentTurn = { year, season: season as 'SPRING' | 'FALL' };
    }

    // Build order lookup by unit province
    const orderByUnit = new Map<string, { order: Order; power: Power }>();
    for (const resolution of resolutions) {
      const power = unitsByProvince.get(resolution.order.unit);
      if (power) {
        orderByUnit.set(resolution.order.unit, { order: resolution.order, power });
      }
    }

    // Analyze supports
    this.analyzeSupports(resolutions, unitsByProvince);

    // Analyze convoys
    this.analyzeConvoys(resolutions, unitsByProvince);

    // Analyze attacks (moves into other powers' territories)
    this.analyzeAttacks(resolutions, unitsByProvince);

    // Analyze cut supports
    this.analyzeCutSupports(resolutions, unitsByProvince);

    // Analyze captures
    if (captures) {
      this.analyzeCaptures(captures);
    }

    // Analyze betrayals (support then stab)
    this.analyzeBetrayals(resolutions, unitsByProvince);

    // Track units for next turn
    this.unitOwners = new Map(unitsByProvince);
  }

  /**
   * Analyzes support orders for positive relationship signals.
   */
  private analyzeSupports(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    for (const { order, success } of results) {
      if (order.type !== 'SUPPORT') continue;

      const supportOrder = order as SupportOrder;
      const supporter = unitsByProvince.get(supportOrder.unit);
      const supported = unitsByProvince.get(supportOrder.supportedUnit);

      if (!supporter || !supported) continue;
      if (supporter === supported) continue; // Self-support doesn't count

      if (success) {
        this.recordAction(
          'DIRECT_SUPPORT',
          supporter,
          supported,
          `${supporter} supported ${supported}'s unit at ${supportOrder.supportedUnit}`
        );
      }
    }
  }

  /**
   * Analyzes convoy orders for positive relationship signals.
   */
  private analyzeConvoys(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    for (const { order, success } of results) {
      if (order.type !== 'CONVOY') continue;

      const convoyOrder = order as ConvoyOrder;
      const convoyer = unitsByProvince.get(convoyOrder.unit);
      const convoyed = unitsByProvince.get(convoyOrder.convoyedUnit);

      if (!convoyer || !convoyed) continue;
      if (convoyer === convoyed) continue;

      if (success) {
        this.recordAction(
          'SUCCESSFUL_CONVOY',
          convoyer,
          convoyed,
          `${convoyer} convoyed ${convoyed}'s army to ${convoyOrder.destination}`
        );
      }
    }
  }

  /**
   * Analyzes move orders for attack signals.
   */
  private analyzeAttacks(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    for (const { order, success } of results) {
      if (order.type !== 'MOVE') continue;

      const moveOrder = order as MoveOrder;
      const attacker = unitsByProvince.get(moveOrder.unit);
      const defender = unitsByProvince.get(moveOrder.destination);

      if (!attacker) continue;

      // Moving into enemy-occupied territory is an attack
      if (defender && defender !== attacker) {
        this.recordAction(
          'ATTACK',
          attacker,
          defender,
          `${attacker} attacked ${defender}'s position at ${moveOrder.destination}`
        );

        // If the move bounced, it's a blocked move
        if (!success) {
          this.recordAction(
            'BLOCKED_MOVE',
            defender,
            attacker,
            `${defender} blocked ${attacker}'s move to ${moveOrder.destination}`
          );
        }
      }
    }
  }

  /**
   * Analyzes orders that cut support.
   */
  private analyzeCutSupports(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    // Build a map of supporting units
    const supportingUnits = new Set<string>();
    for (const { order } of results) {
      if (order.type === 'SUPPORT') {
        supportingUnits.add(order.unit);
      }
    }

    // Find moves that targeted supporting units and cut the support
    for (const { order, success: moveSuccess } of results) {
      if (order.type !== 'MOVE') continue;

      const moveOrder = order as MoveOrder;
      if (!supportingUnits.has(moveOrder.destination)) continue;

      // Check if the support was cut (the supporting order failed)
      const supportResult = results.find(r =>
        r.order.type === 'SUPPORT' && r.order.unit === moveOrder.destination
      );

      if (supportResult && !supportResult.success) {
        const cutter = unitsByProvince.get(moveOrder.unit);
        const supportOwner = unitsByProvince.get(moveOrder.destination);

        if (cutter && supportOwner && cutter !== supportOwner) {
          this.recordAction(
            'CUT_SUPPORT',
            cutter,
            supportOwner,
            `${cutter} cut ${supportOwner}'s support at ${moveOrder.destination}`
          );
        }
      }
    }
  }

  /**
   * Analyzes supply center captures.
   */
  private analyzeCaptures(event: SupplyCentersCapturedEvent): void {
    for (const change of event.payload.changes) {
      if (change.from && change.from !== change.to) {
        this.recordAction(
          'SUCCESSFUL_CAPTURE',
          change.to,
          change.from,
          `${change.to} captured ${change.territory} from ${change.from}`
        );
      }
    }
  }

  /**
   * Analyzes for betrayal patterns (support then stab).
   */
  private analyzeBetrayals(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    // Get last turn's supports
    const lastTurnKey = this.getPreviousTurnKey();
    const lastTurnOrders = this.lastTurnOrders.get(lastTurnKey) || [];

    const lastTurnSupports = new Map<string, Set<Power>>();
    for (const { order, power } of lastTurnOrders) {
      if (order.type === 'SUPPORT') {
        const supportOrder = order as SupportOrder;
        const supported = this.unitOwners.get(supportOrder.supportedUnit);
        if (supported && supported !== power) {
          const key = getPairKey(power, supported);
          if (!lastTurnSupports.has(key)) {
            lastTurnSupports.set(key, new Set());
          }
          lastTurnSupports.get(key)!.add(power);
        }
      }
    }

    // Check if any power that supported another last turn is now attacking them
    for (const { order } of results) {
      if (order.type !== 'MOVE') continue;

      const moveOrder = order as MoveOrder;
      const attacker = unitsByProvince.get(moveOrder.unit);
      const defender = unitsByProvince.get(moveOrder.destination);

      if (!attacker || !defender || attacker === defender) continue;

      const key = getPairKey(attacker, defender);
      const supporters = lastTurnSupports.get(key);

      if (supporters && supporters.has(attacker)) {
        this.recordAction(
          'SUPPORT_THEN_STAB',
          attacker,
          defender,
          `${attacker} supported ${defender} last turn but attacked this turn (BETRAYAL)`
        );
      }
    }
  }

  /**
   * Gets the key for the previous turn.
   */
  private getPreviousTurnKey(): string {
    if (this.currentTurn.season === 'FALL') {
      return `${this.currentTurn.year}-SPRING`;
    } else {
      return `${this.currentTurn.year - 1}-FALL`;
    }
  }

  /**
   * Gets the current relationship between two powers.
   */
  getRelationship(p1: Power, p2: Power): RelationshipResult {
    const key = getPairKey(p1, p2);
    const state = this.relationships.get(key);

    if (!state) {
      return {
        score: 0,
        status: 'neutral',
        recentActions: [],
        betrayalDetected: false,
      };
    }

    const score = clampScore(Math.round(state.rawPoints));
    const recentActions = state.events.slice(-10); // Last 10 events

    return {
      score,
      status: scoreToStatus(score),
      recentActions,
      betrayalDetected: state.betrayalDetected,
    };
  }

  /**
   * Gets all pairwise relationships.
   */
  getAllRelationships(): PowerPairRelationship[] {
    const result: PowerPairRelationship[] = [];

    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const p1 = POWERS[i];
        const p2 = POWERS[j];
        const key = getPairKey(p1, p2);
        const state = this.relationships.get(key);

        if (!state) continue;

        const score = clampScore(Math.round(state.rawPoints));
        const recentActions = state.events.slice(-10);

        result.push({
          power1: p1,
          power2: p2,
          score,
          status: scoreToStatus(score),
          recentActions,
          betrayalDetected: state.betrayalDetected,
          betrayalTurn: state.betrayalTurn,
        });
      }
    }

    return result;
  }

  /**
   * Gets relationships for a specific power.
   */
  getRelationshipsForPower(power: Power): Array<{
    otherPower: Power;
    score: number;
    status: 'ally' | 'enemy' | 'neutral';
    betrayalDetected: boolean;
  }> {
    const result: Array<{
      otherPower: Power;
      score: number;
      status: 'ally' | 'enemy' | 'neutral';
      betrayalDetected: boolean;
    }> = [];

    for (const other of POWERS) {
      if (other === power) continue;

      const rel = this.getRelationship(power, other);
      result.push({
        otherPower: other,
        score: rel.score,
        status: rel.status,
        betrayalDetected: rel.betrayalDetected,
      });
    }

    return result.sort((a, b) => b.score - a.score);
  }

  /**
   * Gets all detected betrayals.
   */
  getBetrayals(): Array<{
    betrayer: Power;
    victim: Power;
    turn: { year: number; season: 'SPRING' | 'FALL' };
    events: ActionEvent[];
  }> {
    const betrayals: Array<{
      betrayer: Power;
      victim: Power;
      turn: { year: number; season: 'SPRING' | 'FALL' };
      events: ActionEvent[];
    }> = [];

    for (const [key, state] of this.relationships) {
      if (!state.betrayalDetected || !state.betrayalTurn) continue;

      const [p1, p2] = key.split('-') as [Power, Power];

      // Find the betrayal event to determine who betrayed whom
      const betrayalEvent = state.events.find(
        e => e.type === 'SUPPORT_THEN_STAB' || e.type === 'BROKEN_PROMISE_ATTACK'
      );

      if (betrayalEvent) {
        betrayals.push({
          betrayer: betrayalEvent.actor,
          victim: betrayalEvent.target,
          turn: state.betrayalTurn,
          events: state.events.filter(
            e => e.type === 'SUPPORT_THEN_STAB' || e.type === 'BROKEN_PROMISE_ATTACK'
          ),
        });
      }
    }

    return betrayals;
  }

  /**
   * Resets the engine to initial state.
   */
  reset(): void {
    this.relationships.clear();
    this.lastTurnOrders.clear();
    this.unitOwners.clear();
    this.currentTurn = { year: 1901, season: 'SPRING' };

    // Reinitialize all power pairs
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const key = getPairKey(POWERS[i], POWERS[j]);
        this.relationships.set(key, {
          rawPoints: 0,
          events: [],
          betrayalDetected: false,
        });
      }
    }
  }
}

/**
 * Creates a new ActionRelationshipEngine instance.
 */
export function createRelationshipEngine(): ActionRelationshipEngine {
  return new ActionRelationshipEngine();
}
