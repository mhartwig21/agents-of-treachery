/**
 * Test fixtures for MSW mocks.
 *
 * Provides realistic game data for testing components and integration scenarios.
 */

import type { GameHistory, GameSnapshot } from '../spectator/types';
import type { GameState } from '../types/game';
import type { Message } from '../press/types';
import type { ServerMessage } from '../server/game-server';

/**
 * Initial game state for Spring 1901.
 */
export const INITIAL_GAME_STATE: GameState = {
  phase: 'spring',
  year: 1901,
  units: [
    // England
    { type: 'fleet', power: 'england', territory: 'lon' },
    { type: 'fleet', power: 'england', territory: 'edi' },
    { type: 'army', power: 'england', territory: 'lvp' },
    // France
    { type: 'fleet', power: 'france', territory: 'bre' },
    { type: 'army', power: 'france', territory: 'par' },
    { type: 'army', power: 'france', territory: 'mar' },
    // Germany
    { type: 'fleet', power: 'germany', territory: 'kie' },
    { type: 'army', power: 'germany', territory: 'ber' },
    { type: 'army', power: 'germany', territory: 'mun' },
    // Italy
    { type: 'fleet', power: 'italy', territory: 'nap' },
    { type: 'army', power: 'italy', territory: 'rom' },
    { type: 'army', power: 'italy', territory: 'ven' },
    // Austria
    { type: 'fleet', power: 'austria', territory: 'tri' },
    { type: 'army', power: 'austria', territory: 'vie' },
    { type: 'army', power: 'austria', territory: 'bud' },
    // Russia
    { type: 'fleet', power: 'russia', territory: 'stp' },
    { type: 'fleet', power: 'russia', territory: 'sev' },
    { type: 'army', power: 'russia', territory: 'mos' },
    { type: 'army', power: 'russia', territory: 'war' },
    // Turkey
    { type: 'fleet', power: 'turkey', territory: 'ank' },
    { type: 'army', power: 'turkey', territory: 'con' },
    { type: 'army', power: 'turkey', territory: 'smy' },
  ],
  orders: [],
  supplyCenters: {
    // England
    lon: 'england', edi: 'england', lvp: 'england',
    // France
    bre: 'france', par: 'france', mar: 'france',
    // Germany
    kie: 'germany', ber: 'germany', mun: 'germany',
    // Italy
    nap: 'italy', rom: 'italy', ven: 'italy',
    // Austria
    tri: 'austria', vie: 'austria', bud: 'austria',
    // Russia
    stp: 'russia', sev: 'russia', mos: 'russia', war: 'russia',
    // Turkey
    ank: 'turkey', con: 'turkey', smy: 'turkey',
    // Neutral
    nwy: undefined, swe: undefined, den: undefined, hol: undefined, bel: undefined,
    spa: undefined, por: undefined, tun: undefined, ser: undefined, bul: undefined,
    rum: undefined, gre: undefined,
  },
};

/**
 * Sample press message for testing.
 */
export function createTestMessage(overrides?: Partial<Message>): Message {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    channelId: 'bilateral:ENGLAND:FRANCE',
    sender: 'ENGLAND' as unknown as Message['sender'],
    content: 'I propose we form an alliance against Germany.',
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Sample game snapshot for testing.
 */
export function createTestSnapshot(overrides?: Partial<GameSnapshot>): GameSnapshot {
  return {
    id: '1901-SPRING-DIPLOMACY',
    year: 1901,
    season: 'SPRING',
    phase: 'DIPLOMACY',
    gameState: INITIAL_GAME_STATE,
    orders: [],
    messages: [],
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Sample game history for testing.
 */
export function createTestGame(overrides?: Partial<GameHistory>): GameHistory {
  const now = new Date();
  return {
    gameId: `game-${Date.now()}`,
    name: 'Test Game',
    status: 'active',
    snapshots: [createTestSnapshot()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Creates a series of snapshots representing game progression.
 */
export function createGameProgression(turns: number = 3): GameSnapshot[] {
  const snapshots: GameSnapshot[] = [];
  let year = 1901;
  const seasons: Array<'SPRING' | 'FALL'> = ['SPRING', 'FALL'];

  for (let i = 0; i < turns; i++) {
    const season = seasons[i % 2];
    if (i > 0 && i % 2 === 0) year++;

    snapshots.push(createTestSnapshot({
      id: `${year}-${season}-DIPLOMACY`,
      year,
      season,
      phase: 'DIPLOMACY',
      timestamp: new Date(Date.now() + i * 60000),
    }));
  }

  return snapshots;
}

/**
 * Creates a completed game for testing.
 */
export function createCompletedGame(): GameHistory {
  return createTestGame({
    gameId: 'game-completed-1',
    name: 'Completed Test Game',
    status: 'completed',
    winner: 'france',
    snapshots: createGameProgression(10),
  });
}

/**
 * Factory for creating ServerMessage payloads.
 */
export const ServerMessages = {
  gameList(games: GameHistory[] = []): ServerMessage {
    return { type: 'GAME_LIST', games };
  },

  gameCreated(game: GameHistory): ServerMessage {
    return { type: 'GAME_CREATED', game };
  },

  gameUpdated(gameId: string, updates: Partial<GameHistory>): ServerMessage {
    return { type: 'GAME_UPDATED', gameId, updates };
  },

  snapshotAdded(gameId: string, snapshot: GameSnapshot): ServerMessage {
    return { type: 'SNAPSHOT_ADDED', gameId, snapshot };
  },

  gameEnded(gameId: string, winner?: string, draw?: boolean): ServerMessage {
    return { type: 'GAME_ENDED', gameId, winner, draw };
  },

  error(message: string): ServerMessage {
    return { type: 'ERROR', message };
  },
};

/**
 * Sample diplomatic messages for various scenarios.
 */
export const SAMPLE_MESSAGES = {
  alliance: createTestMessage({
    content: 'I propose we form an alliance against Germany. Together we can divide the Low Countries.',
    metadata: { intent: 'PROPOSAL' },
  }),
  acceptance: createTestMessage({
    channelId: 'bilateral:FRANCE:ENGLAND',
    sender: 'FRANCE' as unknown as Message['sender'],
    content: 'I accept your proposal. Let us coordinate our moves.',
    metadata: { intent: 'ACCEPTANCE' },
  }),
  threat: createTestMessage({
    channelId: 'bilateral:GERMANY:FRANCE',
    sender: 'GERMANY' as unknown as Message['sender'],
    content: 'Your forces near Belgium concern me. This is your only warning.',
    metadata: { intent: 'THREAT' },
  }),
  information: createTestMessage({
    channelId: 'bilateral:RUSSIA:ENGLAND',
    sender: 'RUSSIA' as unknown as Message['sender'],
    content: 'I have learned that Germany is planning to move against Denmark.',
    metadata: { intent: 'INFORMATION' },
  }),
};
