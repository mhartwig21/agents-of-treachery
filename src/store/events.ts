/**
 * Event types for game state event sourcing.
 *
 * All state changes are represented as events. The current state
 * can be reconstructed by replaying events from the beginning.
 */

import type { Power, Order, RetreatOrder, BuildOrder, Season, Phase, Unit } from '../engine/types';

/**
 * Base interface for all game events.
 */
export interface GameEventBase {
  id: string;
  timestamp: Date;
  gameId: string;
}

/**
 * Game was created with initial state.
 */
export interface GameCreatedEvent extends GameEventBase {
  type: 'GAME_CREATED';
  payload: {
    initialUnits: Unit[];
    supplyCenters: Record<string, Power>;
  };
}

/**
 * A power submitted movement orders.
 */
export interface OrdersSubmittedEvent extends GameEventBase {
  type: 'ORDERS_SUBMITTED';
  payload: {
    power: Power;
    orders: Order[];
    year: number;
    season: Season;
  };
}

/**
 * Movement phase was resolved.
 */
export interface MovementResolvedEvent extends GameEventBase {
  type: 'MOVEMENT_RESOLVED';
  payload: {
    year: number;
    season: Season;
    results: Array<{
      order: Order;
      success: boolean;
      reason?: string;
    }>;
    unitMoves: Array<{
      power: Power;
      from: string;
      to: string;
      coast?: string;
    }>;
    dislodged: Array<{
      unit: Unit;
      dislodgedFrom: string;
      retreatOptions: string[];
    }>;
  };
}

/**
 * A power submitted retreat orders.
 */
export interface RetreatsSubmittedEvent extends GameEventBase {
  type: 'RETREATS_SUBMITTED';
  payload: {
    power: Power;
    retreats: RetreatOrder[];
    year: number;
    season: Season;
  };
}

/**
 * Retreat phase was resolved.
 */
export interface RetreatsResolvedEvent extends GameEventBase {
  type: 'RETREATS_RESOLVED';
  payload: {
    year: number;
    season: Season;
    retreatResults: Array<{
      unit: Unit;
      destination: string | null; // null = disbanded
      success: boolean;
    }>;
  };
}

/**
 * A power submitted build orders.
 */
export interface BuildsSubmittedEvent extends GameEventBase {
  type: 'BUILDS_SUBMITTED';
  payload: {
    power: Power;
    builds: BuildOrder[];
    year: number;
  };
}

/**
 * Build phase was resolved.
 */
export interface BuildsResolvedEvent extends GameEventBase {
  type: 'BUILDS_RESOLVED';
  payload: {
    year: number;
    unitsBuilt: Array<{
      power: Power;
      province: string;
      unitType: 'ARMY' | 'FLEET';
      coast?: string;
    }>;
    unitsDisbanded: Array<{
      power: Power;
      province: string;
    }>;
  };
}

/**
 * Supply center ownership changed.
 */
export interface SupplyCentersCapturedEvent extends GameEventBase {
  type: 'SUPPLY_CENTERS_CAPTURED';
  payload: {
    year: number;
    season: Season;
    changes: Array<{
      territory: string;
      from: Power | null;
      to: Power;
    }>;
  };
}

/**
 * Phase advanced to next.
 */
export interface PhaseAdvancedEvent extends GameEventBase {
  type: 'PHASE_ADVANCED';
  payload: {
    fromYear: number;
    fromSeason: Season;
    fromPhase: Phase;
    toYear: number;
    toSeason: Season;
    toPhase: Phase;
  };
}

/**
 * Game ended with winner or draw.
 */
export interface GameEndedEvent extends GameEventBase {
  type: 'GAME_ENDED';
  payload: {
    winner?: Power;
    draw: boolean;
    finalYear: number;
    supplyCenterCounts: Record<Power, number>;
  };
}

/**
 * A press message was sent.
 */
export interface MessageSentEvent extends GameEventBase {
  type: 'MESSAGE_SENT';
  payload: {
    messageId: string;
    channelId: string;
    sender: Power;
    content: string;
    year: number;
    season: Season;
    phase: Phase;
  };
}

/**
 * Union type of all game events.
 */
export type GameEvent =
  | GameCreatedEvent
  | OrdersSubmittedEvent
  | MovementResolvedEvent
  | RetreatsSubmittedEvent
  | RetreatsResolvedEvent
  | BuildsSubmittedEvent
  | BuildsResolvedEvent
  | SupplyCentersCapturedEvent
  | PhaseAdvancedEvent
  | GameEndedEvent
  | MessageSentEvent;

/**
 * Generate a unique event ID.
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a base event with common fields.
 */
export function createEventBase(gameId: string): GameEventBase {
  return {
    id: generateEventId(),
    timestamp: new Date(),
    gameId,
  };
}
