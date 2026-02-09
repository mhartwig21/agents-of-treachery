/**
 * Tests for session.ts — Agent session management.
 *
 * Covers: AgentSessionManager, createTestSessionManager, MockLLMProvider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { POWERS } from '../../engine/types';
import {
  AgentSessionManager,
  createTestSessionManager,
  MockLLMProvider,
  summarizeEvictedMessages,
} from '../session';
import type { ConversationMessage } from '../types';

describe('AgentSessionManager', () => {
  let manager: AgentSessionManager;
  let mockLLM: MockLLMProvider;

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    manager = createTestSessionManager('test-game', mockLLM);
  });

  describe('createSession', () => {
    it('should create a session for a power', async () => {
      const session = await manager.createSession({ power: 'ENGLAND' });

      expect(session.power).toBe('ENGLAND');
      expect(session.id).toBeTruthy();
      expect(session.isActive).toBe(true);
      expect(session.conversationHistory).toHaveLength(0);
      expect(session.memory).toBeDefined();
    });

    it('should assign default personality if none provided', async () => {
      const session = await manager.createSession({ power: 'FRANCE' });
      expect(session.config.personality).toBeDefined();
      expect(session.config.personality!.cooperativeness).toBeDefined();
    });

    it('should use custom personality when provided', async () => {
      const session = await manager.createSession({
        power: 'GERMANY',
        personality: {
          cooperativeness: 0.1,
          aggression: 0.9,
          patience: 0.2,
          trustworthiness: 0.3,
          paranoia: 0.8,
          deceptiveness: 0.7,
        },
      });
      expect(session.config.personality!.aggression).toBe(0.9);
    });

    it('should generate unique session IDs', async () => {
      const s1 = await manager.createSession({ power: 'ENGLAND' });
      // Create a new manager to get a different session
      const m2 = createTestSessionManager('test-game-2', mockLLM);
      const s2 = await m2.createSession({ power: 'ENGLAND' });
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('createAllSessions', () => {
    it('should create sessions for all 7 powers', async () => {
      const sessions = await manager.createAllSessions();
      expect(sessions.size).toBe(7);
      for (const power of POWERS) {
        expect(sessions.has(power)).toBe(true);
      }
    });

    it('should apply custom configs per power', async () => {
      const sessions = await manager.createAllSessions({
        ENGLAND: { model: 'gpt-4o' },
        FRANCE: { model: 'claude-3-opus' },
      });

      expect(sessions.get('ENGLAND')!.config.model).toBe('gpt-4o');
      expect(sessions.get('FRANCE')!.config.model).toBe('claude-3-opus');
    });
  });

  describe('getSession', () => {
    it('should return session after creation', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      const session = manager.getSession('ENGLAND');
      expect(session).toBeDefined();
      expect(session!.power).toBe('ENGLAND');
    });

    it('should return undefined for non-existent session', () => {
      expect(manager.getSession('TURKEY')).toBeUndefined();
    });
  });

  describe('getAllSessions', () => {
    it('should return only active sessions', async () => {
      await manager.createAllSessions();
      manager.deactivateSession('ITALY');

      const active = manager.getAllSessions();
      expect(active).toHaveLength(6);
      expect(active.find(s => s.power === 'ITALY')).toBeUndefined();
    });
  });

  describe('addMessage', () => {
    it('should add a message to session history', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.addMessage('ENGLAND', { role: 'user', content: 'Hello' });

      const session = manager.getSession('ENGLAND')!;
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0].content).toBe('Hello');
      expect(session.conversationHistory[0].timestamp).toBeInstanceOf(Date);
    });

    it('should update lastActiveAt on message', async () => {
      const session = await manager.createSession({ power: 'ENGLAND' });
      const before = session.lastActiveAt;

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));
      manager.addMessage('ENGLAND', { role: 'user', content: 'Test' });

      expect(session.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should apply sliding window to bound history', async () => {
      const mgr = createTestSessionManager('test', mockLLM, 6);
      await mgr.createSession({ power: 'ENGLAND' });

      // Add more messages than the window size
      for (let i = 0; i < 10; i++) {
        mgr.addMessage('ENGLAND', { role: 'user', content: `Message ${i}` });
      }

      const session = mgr.getSession('ENGLAND')!;
      expect(session.conversationHistory.length).toBeLessThanOrEqual(6);
      // Should keep the most recent messages
      const last = session.conversationHistory[session.conversationHistory.length - 1];
      expect(last.content).toBe('Message 9');
    });

    it('should preserve system message in sliding window', async () => {
      const mgr = createTestSessionManager('test', mockLLM, 6);
      await mgr.createSession({ power: 'ENGLAND' });

      // Add system message first
      mgr.addMessage('ENGLAND', { role: 'system', content: 'You are England' });

      // Add many user messages to trigger window
      for (let i = 0; i < 10; i++) {
        mgr.addMessage('ENGLAND', { role: 'user', content: `Message ${i}` });
      }

      const session = mgr.getSession('ENGLAND')!;
      // System message should be preserved
      expect(session.conversationHistory[0].role).toBe('system');
      expect(session.conversationHistory[0].content).toBe('You are England');
      // Total should be within window
      expect(session.conversationHistory.length).toBeLessThanOrEqual(6);
    });

    it('should inject summary message when evicting messages', async () => {
      const mgr = createTestSessionManager('test', mockLLM, 6);
      await mgr.createSession({ power: 'ENGLAND' });

      mgr.addMessage('ENGLAND', { role: 'system', content: 'You are England' });

      // Add messages with recognizable content
      for (let i = 0; i < 10; i++) {
        mgr.addMessage('ENGLAND', { role: 'user', content: `Y:1901 S:SPRING P:MOVEMENT turn ${i}` });
        mgr.addMessage('ENGLAND', { role: 'assistant', content: `ORDERS:\nA PAR HOLD\nDIPLOMACY:\nSEND FRANCE: "Hello round ${i}"` });
      }

      const session = mgr.getSession('ENGLAND')!;
      // Should have: system + summary + recent messages
      expect(session.conversationHistory.length).toBeLessThanOrEqual(6);
      expect(session.conversationHistory[0].role).toBe('system');
      // Second message should be the summary
      expect(session.conversationHistory[1].content).toContain('[CONVERSATION SUMMARY]');
      expect(session.conversationHistory[1].content).toContain('Orders:');
    });

    it('should not affect non-existent sessions', () => {
      // Should not throw
      manager.addMessage('TURKEY', { role: 'user', content: 'Hello' });
    });
  });

  describe('clearHistory', () => {
    it('should clear conversation history', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.addMessage('ENGLAND', { role: 'user', content: 'Hello' });
      manager.addMessage('ENGLAND', { role: 'assistant', content: 'Hi' });

      manager.clearHistory('ENGLAND', false);

      const session = manager.getSession('ENGLAND')!;
      expect(session.conversationHistory).toHaveLength(0);
    });

    it('should keep system message by default', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.addMessage('ENGLAND', { role: 'system', content: 'You are England' });
      manager.addMessage('ENGLAND', { role: 'user', content: 'Hello' });

      manager.clearHistory('ENGLAND');

      const session = manager.getSession('ENGLAND')!;
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0].role).toBe('system');
    });
  });

  describe('deactivateSession / reactivateSession', () => {
    it('should deactivate a session', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.deactivateSession('ENGLAND');

      expect(manager.getSession('ENGLAND')!.isActive).toBe(false);
    });

    it('should reactivate a session', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.deactivateSession('ENGLAND');
      manager.reactivateSession('ENGLAND');

      expect(manager.getSession('ENGLAND')!.isActive).toBe(true);
    });
  });

  describe('destroySession', () => {
    it('should remove session completely', async () => {
      await manager.createSession({ power: 'ENGLAND' });
      manager.destroySession('ENGLAND');

      expect(manager.getSession('ENGLAND')).toBeUndefined();
    });
  });

  describe('destroyAll', () => {
    it('should remove all sessions', async () => {
      await manager.createAllSessions();
      manager.destroyAll();

      expect(manager.getAllSessions()).toHaveLength(0);
      for (const power of POWERS) {
        expect(manager.getSession(power)).toBeUndefined();
      }
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await manager.createAllSessions();
      manager.addMessage('ENGLAND', { role: 'user', content: 'Hello' });
      manager.addMessage('ENGLAND', { role: 'assistant', content: 'Hi' });
      manager.deactivateSession('ITALY');

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(7);
      expect(stats.activeSessions).toBe(6);
      expect(stats.totalMessages).toBe(2);
      expect(stats.sessionsByPower.ENGLAND.messageCount).toBe(2);
      expect(stats.sessionsByPower.ITALY.isActive).toBe(false);
    });
  });

  describe('getGameId', () => {
    it('should return the game ID', () => {
      expect(manager.getGameId()).toBe('test-game');
    });
  });

  describe('getLLMProvider', () => {
    it('should return the LLM provider', () => {
      expect(manager.getLLMProvider()).toBe(mockLLM);
    });
  });
});

describe('MockLLMProvider', () => {
  it('should return default response when no responses configured', async () => {
    const mock = new MockLLMProvider();
    const result = await mock.complete({ messages: [] });
    expect(result.content).toContain('ORDERS');
    expect(result.content).toContain('DIPLOMACY');
  });

  it('should cycle through configured responses', async () => {
    const mock = new MockLLMProvider(['Response 1', 'Response 2']);
    const r1 = await mock.complete({ messages: [] });
    const r2 = await mock.complete({ messages: [] });
    const r3 = await mock.complete({ messages: [] });

    expect(r1.content).toBe('Response 1');
    expect(r2.content).toBe('Response 2');
    expect(r3.content).toBe('Response 1'); // Cycles back
  });

  it('should track calls', async () => {
    const mock = new MockLLMProvider(['test']);
    const messages = [{ role: 'user' as const, content: 'Hello', timestamp: new Date() }];

    await mock.complete({ messages });

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages).toBe(messages);
  });

  it('should reset state', async () => {
    const mock = new MockLLMProvider(['R1', 'R2']);
    await mock.complete({ messages: [] });
    await mock.complete({ messages: [] });

    mock.reset();

    expect(mock.calls).toHaveLength(0);
    const result = await mock.complete({ messages: [] });
    expect(result.content).toBe('R1'); // Back to first response
  });

  it('should allow adding responses after construction', async () => {
    const mock = new MockLLMProvider();
    mock.addResponse('Added response');
    const result = await mock.complete({ messages: [] });
    expect(result.content).toBe('Added response');
  });

  it('should return usage stats', async () => {
    const mock = new MockLLMProvider();
    const result = await mock.complete({ messages: [] });
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens).toBeGreaterThan(0);
    expect(result.usage!.outputTokens).toBeGreaterThan(0);
  });
});

describe('summarizeEvictedMessages', () => {
  function makeMsg(role: 'user' | 'assistant', content: string): ConversationMessage {
    return { role, content, timestamp: new Date() };
  }

  it('should extract orders from assistant responses', () => {
    const messages = [
      makeMsg('user', 'Y:1901 S:SPRING P:MOVEMENT'),
      makeMsg('assistant', 'ORDERS:\nA PAR -> BUR\nF BRE -> ENG\nA MAR HOLD'),
    ];
    const summary = summarizeEvictedMessages(messages);
    expect(summary).toContain('[CONVERSATION SUMMARY]');
    expect(summary).toContain('Orders:');
    expect(summary).toContain('A PAR -> BUR');
  });

  it('should extract diplomacy sends', () => {
    const messages = [
      makeMsg('assistant', 'DIPLOMACY:\nSEND FRANCE: "Let us ally"\nSEND GERMANY: "Stay out of Belgium"'),
    ];
    const summary = summarizeEvictedMessages(messages);
    expect(summary).toContain('Diplomacy:');
    expect(summary).toContain('SEND FRANCE');
  });

  it('should extract game state context from user messages', () => {
    const messages = [
      makeMsg('user', 'Y:1902 S:FALL P:DIPLOMACY some context here'),
    ];
    const summary = summarizeEvictedMessages(messages);
    expect(summary).toContain('Turn: 1902 FALL DIPLOMACY');
  });

  it('should merge with previous summary', () => {
    const messages = [
      makeMsg('assistant', 'ORDERS:\nA PAR HOLD'),
    ];
    const summary = summarizeEvictedMessages(messages, 'Earlier: gained Belgium in 1901');
    expect(summary).toContain('Earlier: gained Belgium in 1901');
    expect(summary).toContain('Orders:');
  });

  it('should cap summary length at ~2000 chars', () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(makeMsg('user', `Y:${1901 + i} S:SPRING P:MOVEMENT long context ${'x'.repeat(100)}`));
      messages.push(makeMsg('assistant', `ANALYSIS: Very detailed analysis ${'y'.repeat(200)}\nORDERS:\nA PAR -> BUR\nDIPLOMACY:\nSEND FRANCE: "Message ${i} with lots of detail ${'z'.repeat(100)}"`));
    }
    const summary = summarizeEvictedMessages(messages);
    expect(summary.length).toBeLessThanOrEqual(2000);
  });

  it('should return summary prefix even with empty messages', () => {
    const summary = summarizeEvictedMessages([]);
    expect(summary).toContain('[CONVERSATION SUMMARY]');
  });
});
