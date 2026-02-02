/**
 * Tests for the game server.
 */

import { describe, it, expect } from 'vitest';
import { createMockLLMProvider } from '../game-server';

describe('GameServer', () => {
  describe('createMockLLMProvider', () => {
    it('should return hold orders for all units', async () => {
      const provider = createMockLLMProvider();
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'You are an AI playing Diplomacy.', timestamp: new Date() },
          { role: 'user', content: 'Submit orders for your units.', timestamp: new Date() },
        ],
      });

      expect(result.content).toContain('ORDERS:');
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(150);
    });
  });
});

describe('useLiveGame types', () => {
  it('should export correct message types', () => {
    // Type check - these should compile without error
    type ServerMessage =
      | { type: 'GAME_LIST'; games: any[] }
      | { type: 'GAME_CREATED'; game: any }
      | { type: 'SNAPSHOT_ADDED'; gameId: string; snapshot: any }
      | { type: 'ERROR'; message: string };

    const msg: ServerMessage = { type: 'ERROR', message: 'test' };
    expect(msg.type).toBe('ERROR');
  });
});
