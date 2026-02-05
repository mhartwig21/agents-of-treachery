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
  COORDINATED_STAB: -12,
  CONVOY_BETRAYAL: -9,
} as const;

/**
 * Types of betrayal that can be detected.
 */
export type BetrayalType =
  | 'CLASSIC_STAB'      // Supported last turn, attacked this turn
  | 'BROKEN_PROMISE'    // Agreed to support in press, then didn't
  | 'COORDINATED_STAB'  // Multiple powers attack former ally simultaneously
  | 'CONVOY_BETRAYAL';  // Promised convoy, intentionally failed

/**
 * Detailed information about a detected betrayal.
 */
export interface BetrayalInfo {
  /** Unique ID for this betrayal */
  id: string;
  /** Type of betrayal pattern */
  type: BetrayalType;
  /** Power who committed the betrayal */
  betrayer: Power;
  /** Power who was betrayed */
  victim: Power;
  /** Turn when betrayal occurred */
  turn: { year: number; season: 'SPRING' | 'FALL' };
  /** All participating betrayers (for coordinated stabs) */
  participants?: Power[];
  /** Evidence supporting the betrayal detection */
  evidence: BetrayalEvidence[];
  /** Severity score (higher = more egregious) */
  severity: number;
}

/**
 * Evidence for a betrayal.
 */
export interface BetrayalEvidence {
  /** Turn when the evidence occurred */
  turn: { year: number; season: 'SPRING' | 'FALL' };
  /** Description of what happened */
  description: string;
  /** Type of action */
  actionType: 'support' | 'attack' | 'convoy' | 'message';
}

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
  /** Detailed betrayal records */
  betrayals: BetrayalInfo[];
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

  /** Counter for generating unique betrayal IDs */
  private betrayalIdCounter = 0;

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
          betrayals: [],
        });
      }
    }
  }

  /**
   * Generates a unique betrayal ID.
   */
  private generateBetrayalId(): string {
    return `betrayal-${++this.betrayalIdCounter}`;
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

    // Track betrayal with detailed info
    if (type === 'SUPPORT_THEN_STAB' || type === 'BROKEN_PROMISE_ATTACK' ||
        type === 'COORDINATED_STAB' || type === 'CONVOY_BETRAYAL') {
      state.betrayalDetected = true;
      state.betrayalTurn = { ...this.currentTurn };

      // Record detailed betrayal info
      const betrayalType = this.mapActionToBetrayal(type);
      const betrayalInfo: BetrayalInfo = {
        id: this.generateBetrayalId(),
        type: betrayalType,
        betrayer: actor,
        victim: target,
        turn: { ...this.currentTurn },
        evidence: [{
          turn: { ...this.currentTurn },
          description,
          actionType: type === 'CONVOY_BETRAYAL' ? 'convoy' : 'attack',
        }],
        severity: Math.abs(points),
      };

      state.betrayals.push(betrayalInfo);
    }
  }

  /**
   * Maps action type to betrayal type.
   */
  private mapActionToBetrayal(type: keyof typeof RELATIONSHIP_POINTS): BetrayalType {
    switch (type) {
      case 'SUPPORT_THEN_STAB':
        return 'CLASSIC_STAB';
      case 'BROKEN_PROMISE_ATTACK':
        return 'BROKEN_PROMISE';
      case 'COORDINATED_STAB':
        return 'COORDINATED_STAB';
      case 'CONVOY_BETRAYAL':
        return 'CONVOY_BETRAYAL';
      default:
        return 'CLASSIC_STAB';
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

    // Also check for coordinated stabs
    this.analyzeCoordinatedStabs(results, unitsByProvince);
  }

  /**
   * Analyzes for coordinated stabs (multiple powers attacking same former ally).
   */
  private analyzeCoordinatedStabs(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    // Track attacks per victim this turn
    const attacksPerVictim = new Map<Power, Set<Power>>();

    for (const { order } of results) {
      if (order.type !== 'MOVE') continue;

      const moveOrder = order as MoveOrder;
      const attacker = unitsByProvince.get(moveOrder.unit);
      const defender = unitsByProvince.get(moveOrder.destination);

      if (!attacker || !defender || attacker === defender) continue;

      if (!attacksPerVictim.has(defender)) {
        attacksPerVictim.set(defender, new Set());
      }
      attacksPerVictim.get(defender)!.add(attacker);
    }

    // Check for coordinated attacks on former allies
    for (const [victim, attackers] of attacksPerVictim) {
      if (attackers.size < 2) continue; // Need multiple attackers

      // Check if any attackers had positive relationships with victim
      const formerAllies: Power[] = [];
      for (const attacker of attackers) {
        const rel = this.getRelationship(attacker, victim);
        // Consider them a former ally if they had positive interactions recently
        const hadSupport = rel.recentActions.some(
          e => e.type === 'DIRECT_SUPPORT' && e.actor === attacker
        );
        if (hadSupport || rel.score > 5) {
          formerAllies.push(attacker);
        }
      }

      // If multiple former allies are now attacking together, it's a coordinated stab
      if (formerAllies.length >= 2) {
        for (const betrayer of formerAllies) {
          // Record the coordinated stab
          const key = getPairKey(betrayer, victim);
          const state = this.relationships.get(key);
          if (state) {
            const coordStab: BetrayalInfo = {
              id: this.generateBetrayalId(),
              type: 'COORDINATED_STAB',
              betrayer,
              victim,
              turn: { ...this.currentTurn },
              participants: formerAllies,
              evidence: [{
                turn: { ...this.currentTurn },
                description: `${formerAllies.join(', ')} coordinated attack on ${victim}`,
                actionType: 'attack',
              }],
              severity: 12,
            };
            state.betrayals.push(coordStab);
            state.betrayalDetected = true;
            state.betrayalTurn = { ...this.currentTurn };
            state.rawPoints += RELATIONSHIP_POINTS.COORDINATED_STAB;
          }
        }
      }
    }
  }

  /**
   * Analyzes for convoy betrayals (promised convoy that failed intentionally).
   */
  analyzeConvoyBetrayals(
    results: MovementResolvedEvent['payload']['results'],
    unitsByProvince: Map<string, Power>
  ): void {
    // Find failed convoys
    for (const { order, success } of results) {
      if (order.type !== 'CONVOY') continue;

      const convoyOrder = order as ConvoyOrder;
      const convoyer = unitsByProvince.get(convoyOrder.unit);
      const convoyed = unitsByProvince.get(convoyOrder.convoyedUnit);

      if (!convoyer || !convoyed || convoyer === convoyed) continue;

      // If convoy failed and the convoyer's fleet is still there (not dislodged),
      // it might be intentional
      if (!success) {
        // Check if convoyer was dislodged - if not, it's suspicious
        const isDislodged = results.some(
          r => r.order.unit === convoyOrder.unit && !r.success &&
               r.order.type === 'CONVOY'
        );

        // Check if there was previous cooperation (they had a positive relationship)
        const rel = this.getRelationship(convoyer, convoyed);
        const hadCooperation = rel.recentActions.some(
          e => e.type === 'DIRECT_SUPPORT' || e.type === 'SUCCESSFUL_CONVOY'
        );

        if (!isDislodged && hadCooperation) {
          this.recordAction(
            'CONVOY_BETRAYAL',
            convoyer,
            convoyed,
            `${convoyer} failed to convoy ${convoyed}'s army (potential betrayal)`
          );
        }
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
   * Gets all detected betrayals (basic format for backwards compatibility).
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

      // Find the betrayal event to determine who betrayed whom
      const betrayalEvent = state.events.find(
        e => e.type === 'SUPPORT_THEN_STAB' || e.type === 'BROKEN_PROMISE_ATTACK' ||
             e.type === 'COORDINATED_STAB' || e.type === 'CONVOY_BETRAYAL'
      );

      if (betrayalEvent) {
        betrayals.push({
          betrayer: betrayalEvent.actor,
          victim: betrayalEvent.target,
          turn: state.betrayalTurn,
          events: state.events.filter(
            e => e.type === 'SUPPORT_THEN_STAB' || e.type === 'BROKEN_PROMISE_ATTACK' ||
                 e.type === 'COORDINATED_STAB' || e.type === 'CONVOY_BETRAYAL'
          ),
        });
      }
    }

    return betrayals;
  }

  /**
   * Gets all detected betrayals with full detail.
   */
  getAllBetrayalDetails(): BetrayalInfo[] {
    const allBetrayals: BetrayalInfo[] = [];

    for (const state of this.relationships.values()) {
      allBetrayals.push(...state.betrayals);
    }

    // Sort by turn (most recent first) then severity
    return allBetrayals.sort((a, b) => {
      const turnDiff = (b.turn.year * 2 + (b.turn.season === 'FALL' ? 1 : 0)) -
                       (a.turn.year * 2 + (a.turn.season === 'FALL' ? 1 : 0));
      if (turnDiff !== 0) return turnDiff;
      return b.severity - a.severity;
    });
  }

  /**
   * Gets betrayals involving a specific power.
   */
  getBetrayalsForPower(power: Power): {
    asBetrayer: BetrayalInfo[];
    asVictim: BetrayalInfo[];
  } {
    const allBetrayals = this.getAllBetrayalDetails();
    return {
      asBetrayer: allBetrayals.filter(b => b.betrayer === power),
      asVictim: allBetrayals.filter(b => b.victim === power),
    };
  }

  /**
   * Gets the most recent betrayal between two powers.
   */
  getMostRecentBetrayal(p1: Power, p2: Power): BetrayalInfo | null {
    const key = getPairKey(p1, p2);
    const state = this.relationships.get(key);
    if (!state || state.betrayals.length === 0) return null;
    return state.betrayals[state.betrayals.length - 1];
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
          betrayals: [],
        });
      }
    }

    this.betrayalIdCounter = 0;
  }
}

/**
 * Creates a new ActionRelationshipEngine instance.
 */
export function createRelationshipEngine(): ActionRelationshipEngine {
  return new ActionRelationshipEngine();
}
