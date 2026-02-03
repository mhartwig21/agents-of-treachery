/**
 * GameStore - Event-sourced, immutable game state management.
 *
 * The store is the single source of truth for game state. All state changes
 * happen through events, enabling full replay and rollback capability.
 *
 * Key principles:
 * - State is immutable: all methods return new state
 * - Event sourcing: state can be reconstructed from events
 * - Single store: no parallel state in other systems
 */

import type {
  GameState,
  Power,
  Unit,
  Order,
  Season,
  Phase,
  RetreatOrder,
  BuildOrder,
  Coast,
} from '../engine/types';
import { POWERS } from '../engine/types';
import type {
  GameEvent,
  GameCreatedEvent,
  OrdersSubmittedEvent,
  MovementResolvedEvent,
  RetreatsSubmittedEvent,
  RetreatsResolvedEvent,
  BuildsSubmittedEvent,
  BuildsResolvedEvent,
  SupplyCentersCapturedEvent,
  PhaseAdvancedEvent,
  GameEndedEvent,
  MessageSentEvent,
} from './events';
import { createEventBase } from './events';

/**
 * Snapshot of store state at a point in time.
 */
export interface StoreSnapshot {
  gameId: string;
  version: number;
  state: GameState;
  events: GameEvent[];
  messages: MessageRecord[];
}

/**
 * A message record with full context.
 */
export interface MessageRecord {
  id: string;
  channelId: string;
  sender: Power;
  content: string;
  year: number;
  season: Season;
  phase: Phase;
  timestamp: Date;
}

/**
 * Callback for store state changes.
 */
export type StoreSubscriber = (snapshot: StoreSnapshot) => void;

/**
 * The central game store implementing event sourcing.
 */
export class GameStore {
  private gameId: string;
  private version: number = 0;
  private state: GameState;
  private events: GameEvent[] = [];
  private messages: MessageRecord[] = [];
  private subscribers: StoreSubscriber[] = [];

  constructor(gameId: string) {
    this.gameId = gameId;
    this.state = this.createEmptyState();
  }

  /**
   * Create an empty game state.
   */
  private createEmptyState(): GameState {
    return {
      year: 1901,
      season: 'SPRING',
      phase: 'DIPLOMACY',
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: new Map(),
      pendingRetreats: [],
      pendingBuilds: new Map(),
    };
  }

  /**
   * Initialize the game with starting units and supply centers.
   * Returns the created event.
   */
  initializeGame(units: Unit[], supplyCenters: Map<string, Power>): GameCreatedEvent {
    const scRecord: Record<string, Power> = {};
    supplyCenters.forEach((power, territory) => {
      scRecord[territory] = power;
    });

    const event: GameCreatedEvent = {
      ...createEventBase(this.gameId),
      type: 'GAME_CREATED',
      payload: {
        initialUnits: units.map(u => ({ ...u })),
        supplyCenters: scRecord,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Submit orders for a power.
   */
  submitOrders(power: Power, orders: Order[], year: number, season: Season): OrdersSubmittedEvent {
    const event: OrdersSubmittedEvent = {
      ...createEventBase(this.gameId),
      type: 'ORDERS_SUBMITTED',
      payload: {
        power,
        orders: orders.map(o => ({ ...o })),
        year,
        season,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Resolve movement phase.
   */
  resolveMovement(
    year: number,
    season: Season,
    results: Array<{ order: Order; success: boolean; reason?: string }>,
    unitMoves: Array<{ power: Power; from: string; to: string; coast?: string }>,
    dislodged: Array<{ unit: Unit; dislodgedFrom: string; retreatOptions: string[] }>
  ): MovementResolvedEvent {
    const event: MovementResolvedEvent = {
      ...createEventBase(this.gameId),
      type: 'MOVEMENT_RESOLVED',
      payload: {
        year,
        season,
        results: results.map(r => ({ ...r, order: { ...r.order } })),
        unitMoves: unitMoves.map(m => ({ ...m })),
        dislodged: dislodged.map(d => ({
          unit: { ...d.unit },
          dislodgedFrom: d.dislodgedFrom,
          retreatOptions: [...d.retreatOptions],
        })),
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Submit retreats for a power.
   */
  submitRetreats(power: Power, retreats: RetreatOrder[], year: number, season: Season): RetreatsSubmittedEvent {
    const event: RetreatsSubmittedEvent = {
      ...createEventBase(this.gameId),
      type: 'RETREATS_SUBMITTED',
      payload: {
        power,
        retreats: retreats.map(r => ({ ...r })),
        year,
        season,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Resolve retreat phase.
   */
  resolveRetreats(
    year: number,
    season: Season,
    retreatResults: Array<{ unit: Unit; destination: string | null; success: boolean }>
  ): RetreatsResolvedEvent {
    const event: RetreatsResolvedEvent = {
      ...createEventBase(this.gameId),
      type: 'RETREATS_RESOLVED',
      payload: {
        year,
        season,
        retreatResults: retreatResults.map(r => ({
          unit: { ...r.unit },
          destination: r.destination,
          success: r.success,
        })),
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Submit builds for a power.
   */
  submitBuilds(power: Power, builds: BuildOrder[], year: number): BuildsSubmittedEvent {
    const event: BuildsSubmittedEvent = {
      ...createEventBase(this.gameId),
      type: 'BUILDS_SUBMITTED',
      payload: {
        power,
        builds: builds.map(b => ({ ...b })),
        year,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Resolve build phase.
   */
  resolveBuilds(
    year: number,
    unitsBuilt: Array<{ power: Power; province: string; unitType: 'ARMY' | 'FLEET'; coast?: string }>,
    unitsDisbanded: Array<{ power: Power; province: string }>
  ): BuildsResolvedEvent {
    const event: BuildsResolvedEvent = {
      ...createEventBase(this.gameId),
      type: 'BUILDS_RESOLVED',
      payload: {
        year,
        unitsBuilt: unitsBuilt.map(b => ({ ...b })),
        unitsDisbanded: unitsDisbanded.map(d => ({ ...d })),
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Record supply center captures.
   */
  captureSupplyCenters(
    year: number,
    season: Season,
    changes: Array<{ territory: string; from: Power | null; to: Power }>
  ): SupplyCentersCapturedEvent {
    const event: SupplyCentersCapturedEvent = {
      ...createEventBase(this.gameId),
      type: 'SUPPLY_CENTERS_CAPTURED',
      payload: {
        year,
        season,
        changes: changes.map(c => ({ ...c })),
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Advance the game phase.
   */
  advancePhase(
    fromYear: number,
    fromSeason: Season,
    fromPhase: Phase,
    toYear: number,
    toSeason: Season,
    toPhase: Phase
  ): PhaseAdvancedEvent {
    const event: PhaseAdvancedEvent = {
      ...createEventBase(this.gameId),
      type: 'PHASE_ADVANCED',
      payload: {
        fromYear,
        fromSeason,
        fromPhase,
        toYear,
        toSeason,
        toPhase,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * End the game.
   */
  endGame(winner: Power | undefined, draw: boolean, finalYear: number): GameEndedEvent {
    const supplyCenterCounts: Record<Power, number> = {} as Record<Power, number>;
    for (const power of POWERS) {
      supplyCenterCounts[power] = 0;
    }
    this.state.supplyCenters.forEach((power) => {
      supplyCenterCounts[power]++;
    });

    const event: GameEndedEvent = {
      ...createEventBase(this.gameId),
      type: 'GAME_ENDED',
      payload: {
        winner,
        draw,
        finalYear,
        supplyCenterCounts,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Record a message sent.
   */
  recordMessage(
    messageId: string,
    channelId: string,
    sender: Power,
    content: string
  ): MessageSentEvent {
    const event: MessageSentEvent = {
      ...createEventBase(this.gameId),
      type: 'MESSAGE_SENT',
      payload: {
        messageId,
        channelId,
        sender,
        content,
        year: this.state.year,
        season: this.state.season,
        phase: this.state.phase,
      },
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Apply an event to update state (internal).
   */
  private applyEvent(event: GameEvent): void {
    this.events.push(event);
    this.version++;
    this.state = this.reduceState(this.state, event);
    this.notifySubscribers();
  }

  /**
   * Reduce state based on an event (pure function).
   */
  private reduceState(state: GameState, event: GameEvent): GameState {
    switch (event.type) {
      case 'GAME_CREATED': {
        const supplyCenters = new Map<string, Power>();
        for (const [territory, power] of Object.entries(event.payload.supplyCenters)) {
          supplyCenters.set(territory, power);
        }
        return {
          ...state,
          units: event.payload.initialUnits.map(u => ({ ...u })),
          supplyCenters,
        };
      }

      case 'ORDERS_SUBMITTED': {
        const orders = new Map(state.orders);
        orders.set(event.payload.power, event.payload.orders);
        return { ...state, orders };
      }

      case 'MOVEMENT_RESOLVED': {
        // Apply unit moves
        let units = state.units.map(u => ({ ...u }));
        for (const move of event.payload.unitMoves) {
          const unit = units.find(u => u.province === move.from && u.power === move.power);
          if (unit) {
            unit.province = move.to;
            if (move.coast) {
              unit.coast = move.coast as Coast;
            } else {
              delete unit.coast;
            }
          }
        }

        // Remove dislodged units from main list
        const dislodgedProvinces = new Set(event.payload.dislodged.map(d => d.unit.province));
        units = units.filter(u => !dislodgedProvinces.has(u.province));

        // Set up retreat options
        const retreats = new Map<string, string[]>();
        const pendingRetreats: Unit[] = [];
        for (const d of event.payload.dislodged) {
          retreats.set(d.unit.province, d.retreatOptions);
          pendingRetreats.push({ ...d.unit });
        }

        return {
          ...state,
          units,
          orders: new Map(),
          retreats,
          pendingRetreats,
        };
      }

      case 'RETREATS_SUBMITTED': {
        const retreats = new Map(state.retreats);
        for (const retreat of event.payload.retreats) {
          const key = `${event.payload.power}:${retreat.unit}`;
          retreats.set(key, retreat.destination ? [retreat.destination] : []);
        }
        return { ...state, retreats };
      }

      case 'RETREATS_RESOLVED': {
        let units = [...state.units];
        for (const result of event.payload.retreatResults) {
          if (result.success && result.destination) {
            units.push({
              ...result.unit,
              province: result.destination,
            });
          }
          // If !success or !destination, unit is disbanded (not added)
        }
        return {
          ...state,
          units,
          retreats: new Map(),
          pendingRetreats: [],
        };
      }

      case 'BUILDS_SUBMITTED': {
        const orders = new Map(state.orders);
        // Store builds in orders (matching existing behavior)
        orders.set(event.payload.power, event.payload.builds as unknown as Order[]);
        return { ...state, orders };
      }

      case 'BUILDS_RESOLVED': {
        let units = [...state.units];

        // Add built units
        for (const build of event.payload.unitsBuilt) {
          units.push({
            type: build.unitType,
            power: build.power,
            province: build.province,
            coast: build.coast as Coast | undefined,
          });
        }

        // Remove disbanded units
        for (const disband of event.payload.unitsDisbanded) {
          const idx = units.findIndex(u => u.province === disband.province && u.power === disband.power);
          if (idx >= 0) {
            units = [...units.slice(0, idx), ...units.slice(idx + 1)];
          }
        }

        return {
          ...state,
          units,
          orders: new Map(),
          pendingBuilds: new Map(),
        };
      }

      case 'SUPPLY_CENTERS_CAPTURED': {
        const supplyCenters = new Map(state.supplyCenters);
        for (const change of event.payload.changes) {
          supplyCenters.set(change.territory, change.to);
        }
        return { ...state, supplyCenters };
      }

      case 'PHASE_ADVANCED': {
        return {
          ...state,
          year: event.payload.toYear,
          season: event.payload.toSeason,
          phase: event.payload.toPhase,
        };
      }

      case 'GAME_ENDED': {
        return {
          ...state,
          winner: event.payload.winner,
          draw: event.payload.draw,
        };
      }

      case 'MESSAGE_SENT': {
        // Messages are tracked separately, not in GameState
        this.messages.push({
          id: event.payload.messageId,
          channelId: event.payload.channelId,
          sender: event.payload.sender,
          content: event.payload.content,
          year: event.payload.year,
          season: event.payload.season,
          phase: event.payload.phase,
          timestamp: event.timestamp,
        });
        return state;
      }

      default:
        return state;
    }
  }

  /**
   * Get the current game state (immutable snapshot).
   * Returns a clone to prevent external mutation.
   */
  getState(): Readonly<GameState> {
    return this.cloneState(this.state);
  }

  /**
   * Get a full snapshot of the store.
   */
  getSnapshot(): StoreSnapshot {
    return {
      gameId: this.gameId,
      version: this.version,
      state: this.cloneState(this.state),
      events: [...this.events],
      messages: [...this.messages],
    };
  }

  /**
   * Get all events.
   */
  getEvents(): readonly GameEvent[] {
    return this.events;
  }

  /**
   * Get all messages.
   */
  getMessages(): readonly MessageRecord[] {
    return this.messages;
  }

  /**
   * Get messages for a specific turn.
   */
  getMessagesForTurn(year: number, season: Season): MessageRecord[] {
    return this.messages.filter(m => m.year === year && m.season === season);
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: StoreSubscriber): () => void {
    this.subscribers.push(callback);
    return () => {
      const idx = this.subscribers.indexOf(callback);
      if (idx >= 0) {
        this.subscribers.splice(idx, 1);
      }
    };
  }

  /**
   * Notify all subscribers of state change.
   */
  private notifySubscribers(): void {
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch (error) {
        console.error('Error in store subscriber:', error);
      }
    }
  }

  /**
   * Replay events to rebuild state (for debugging/testing).
   */
  replayEvents(events: GameEvent[]): void {
    this.state = this.createEmptyState();
    this.events = [];
    this.messages = [];
    this.version = 0;

    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Get state at a specific version (by replaying events).
   */
  getStateAtVersion(version: number): GameState | null {
    if (version < 0 || version > this.events.length) {
      return null;
    }

    let state = this.createEmptyState();
    for (let i = 0; i < version; i++) {
      state = this.reduceState(state, this.events[i]);
    }
    return state;
  }

  /**
   * Clone game state for safe external use.
   */
  private cloneState(state: GameState): GameState {
    return {
      year: state.year,
      season: state.season,
      phase: state.phase,
      units: state.units.map(u => ({ ...u })),
      supplyCenters: new Map(state.supplyCenters),
      orders: new Map([...state.orders].map(([k, v]) => [k, [...v]])),
      retreats: new Map([...state.retreats].map(([k, v]) => [k, [...v]])),
      pendingRetreats: state.pendingRetreats.map(u => ({ ...u })),
      pendingBuilds: new Map(state.pendingBuilds),
      winner: state.winner,
      draw: state.draw,
    };
  }
}
