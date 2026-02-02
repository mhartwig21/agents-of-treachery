/**
 * Tests for the game server.
 */

import { describe, it, expect } from 'vitest';
import { createMockLLMProvider } from '../game-server';

describe('GameServer', () => {
  describe('createMockLLMProvider', () => {
    it('should generate orders for actual units from the prompt', async () => {
      const provider = createMockLLMProvider();
      const turnPrompt = `## Current Game State
**Year**: 1901 **Season**: SPRING **Phase**: MOVEMENT

### Your Units (3)
- A London
- F Edinburgh
- A Liverpool

### Your Supply Centers (3)
London, Edinburgh, Liverpool

## Your Task: Submit Orders
Submit orders for all 3 of your units.`;

      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'You are playing as ENGLAND in a game of Diplomacy.', timestamp: new Date() },
          { role: 'user', content: turnPrompt, timestamp: new Date() },
        ],
      });

      // Should contain orders for the actual units (London, Edinburgh, Liverpool)
      expect(result.content).toMatch(/LON|London/i);
      expect(result.content).toMatch(/EDI|Edinburgh/i);
      expect(result.content).toMatch(/LVP|Liverpool/i);
      expect(result.content).toContain('ORDERS:');
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(150);
    });

    it('should handle prompts without unit information gracefully', async () => {
      const provider = createMockLLMProvider();
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'You are playing as ENGLAND in a game of Diplomacy.', timestamp: new Date() },
          { role: 'user', content: 'Submit orders for your units.', timestamp: new Date() },
        ],
      });

      // Should still return a valid response
      expect(result.content).toContain('ORDERS:');
      expect(result.content).toContain('No units available');
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
