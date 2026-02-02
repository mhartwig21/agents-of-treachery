import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialMemory,
  updateTrust,
  recordEvent,
  addCommitment,
  fulfillCommitment,
  breakCommitment,
  addStrategicNote,
  serializeMemory,
  deserializeMemory,
  InMemoryStore,
  MemoryManager,
} from '../memory';
import {
  normalizeProvince,
  parseCoast,
  parseOrderLine,
  parseRetreatLine,
  parseBuildLine,
  parseDiplomacyLine,
  parseAgentResponse,
  extractDiplomacySection,
  validateOrders,
  fillDefaultOrders,
} from '../order-parser';
import {
  createAgentGameView,
  createStrategicSummary,
  getProvinceName,
} from '../game-view';
import {
  AgentSessionManager,
  MockLLMProvider,
  createTestSessionManager,
} from '../session';
import { createInitialState } from '../../engine/game';
import type { Order } from '../../engine/types';

describe('Memory System', () => {
  describe('createInitialMemory', () => {
    it('creates memory with correct power', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      expect(memory.power).toBe('ENGLAND');
      expect(memory.gameId).toBe('game-1');
    });

    it('initializes neutral trust levels for all other powers', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      expect(memory.trustLevels.get('FRANCE')).toBe(0);
      expect(memory.trustLevels.get('GERMANY')).toBe(0);
      expect(memory.trustLevels.has('ENGLAND')).toBe(false);
    });

    it('initializes empty relationships', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      expect(memory.relationships.size).toBe(6); // 7 powers - 1 (self)
      expect(memory.relationships.get('FRANCE')?.isAlly).toBe(false);
      expect(memory.relationships.get('FRANCE')?.isEnemy).toBe(false);
    });
  });

  describe('updateTrust', () => {
    it('increases trust', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 0.3, 1901, 'SPRING');
      expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
    });

    it('decreases trust', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'GERMANY', -0.5, 1901, 'SPRING');
      expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(-0.5);
    });

    it('clamps trust to [-1, 1]', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 2.0, 1901, 'SPRING');
      expect(memory.trustLevels.get('FRANCE')).toBe(1);
      updateTrust(memory, 'GERMANY', -3.0, 1901, 'SPRING');
      expect(memory.trustLevels.get('GERMANY')).toBe(-1);
    });

    it('updates ally status when trust is high', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 0.6, 1901, 'SPRING');
      expect(memory.relationships.get('FRANCE')?.isAlly).toBe(true);
      expect(memory.currentAllies).toContain('FRANCE');
    });

    it('updates enemy status when trust is low', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'GERMANY', -0.6, 1901, 'SPRING');
      expect(memory.relationships.get('GERMANY')?.isEnemy).toBe(true);
      expect(memory.currentEnemies).toContain('GERMANY');
    });
  });

  describe('recordEvent', () => {
    it('adds event to memory', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      recordEvent(memory, {
        year: 1901,
        season: 'SPRING',
        type: 'ALLIANCE_FORMED',
        powers: ['ENGLAND', 'FRANCE'],
        description: 'Anglo-French alliance formed',
      }, 0.2);

      expect(memory.events.length).toBe(1);
      expect(memory.events[0].type).toBe('ALLIANCE_FORMED');
    });

    it('applies trust impact', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      recordEvent(memory, {
        year: 1901,
        season: 'SPRING',
        type: 'BETRAYAL',
        powers: ['GERMANY'],
        description: 'Germany attacked us',
      }, -0.5);

      expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(-0.5);
    });
  });

  describe('commitments', () => {
    it('adds commitment', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      const commitment = addCommitment(memory, {
        year: 1901,
        season: 'SPRING',
        fromPower: 'ENGLAND',
        toPower: 'FRANCE',
        description: 'Support into Belgium',
      });

      expect(commitment.id).toBeDefined();
      expect(memory.activeCommitments.length).toBe(1);
    });

    it('fulfills commitment and increases trust', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      const commitment = addCommitment(memory, {
        year: 1901,
        season: 'SPRING',
        fromPower: 'ENGLAND',
        toPower: 'FRANCE',
        description: 'Support into Belgium',
      });

      fulfillCommitment(memory, commitment.id, 1901, 'FALL');
      expect(commitment.fulfilled).toBe(true);
      expect(memory.trustLevels.get('FRANCE')! > 0).toBe(true);
    });

    it('breaking commitment decreases trust', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      const commitment = addCommitment(memory, {
        year: 1901,
        season: 'SPRING',
        fromPower: 'ENGLAND',
        toPower: 'FRANCE',
        description: 'Support into Belgium',
      });

      breakCommitment(memory, commitment.id, 1901, 'FALL');
      expect(commitment.broken).toBe(true);
      expect(memory.trustLevels.get('FRANCE')! < 0).toBe(true);
    });
  });

  describe('serialization', () => {
    it('serializes and deserializes memory', () => {
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');
      addStrategicNote(memory, {
        year: 1901,
        season: 'SPRING',
        subject: 'France',
        content: 'Seems friendly',
        priority: 'MEDIUM',
      });

      const json = serializeMemory(memory);
      const restored = deserializeMemory(json);

      expect(restored.power).toBe('ENGLAND');
      expect(restored.trustLevels.get('FRANCE')).toBeCloseTo(0.5);
      expect(restored.strategicNotes.length).toBe(1);
    });
  });
});

describe('Memory Store', () => {
  describe('InMemoryStore', () => {
    it('saves and loads memory', async () => {
      const store = new InMemoryStore();
      const memory = createInitialMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');

      await store.save(memory);
      const loaded = await store.load('ENGLAND', 'game-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.trustLevels.get('FRANCE')).toBeCloseTo(0.5);
    });

    it('returns null for non-existent memory', async () => {
      const store = new InMemoryStore();
      const loaded = await store.load('ENGLAND', 'nonexistent');
      expect(loaded).toBeNull();
    });

    it('checks existence correctly', async () => {
      const store = new InMemoryStore();
      const memory = createInitialMemory('ENGLAND', 'game-1');
      await store.save(memory);

      expect(await store.exists('ENGLAND', 'game-1')).toBe(true);
      expect(await store.exists('FRANCE', 'game-1')).toBe(false);
    });
  });

  describe('MemoryManager', () => {
    it('gets or creates memory', async () => {
      const store = new InMemoryStore();
      const manager = new MemoryManager(store);

      const memory = await manager.getMemory('ENGLAND', 'game-1');
      expect(memory.power).toBe('ENGLAND');
    });

    it('caches memory', async () => {
      const store = new InMemoryStore();
      const manager = new MemoryManager(store);

      const memory1 = await manager.getMemory('ENGLAND', 'game-1');
      const memory2 = await manager.getMemory('ENGLAND', 'game-1');

      expect(memory1).toBe(memory2); // Same reference
    });

    it('saves memory to store', async () => {
      const store = new InMemoryStore();
      const manager = new MemoryManager(store);

      const memory = await manager.getMemory('ENGLAND', 'game-1');
      updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');
      await manager.saveMemory(memory);

      const loaded = await store.load('ENGLAND', 'game-1');
      expect(loaded!.trustLevels.get('FRANCE')).toBeCloseTo(0.5);
    });
  });
});

describe('Order Parser', () => {
  describe('normalizeProvince', () => {
    it('normalizes full names', () => {
      expect(normalizeProvince('London')).toBe('LON');
      expect(normalizeProvince('paris')).toBe('PAR');
      expect(normalizeProvince('ST. PETERSBURG')).toBe('STP');
    });

    it('accepts abbreviations', () => {
      expect(normalizeProvince('LON')).toBe('LON');
      expect(normalizeProvince('par')).toBe('PAR');
    });

    it('returns null for unknown provinces', () => {
      expect(normalizeProvince('Atlantis')).toBeNull();
    });
  });

  describe('parseCoast', () => {
    it('parses coast names', () => {
      expect(parseCoast('north')).toBe('NORTH');
      expect(parseCoast('SOUTH')).toBe('SOUTH');
      expect(parseCoast('nc')).toBe('NORTH');
      expect(parseCoast('sc')).toBe('SOUTH');
    });
  });

  describe('parseOrderLine', () => {
    it('parses HOLD orders', () => {
      const result = parseOrderLine('A London HOLD');
      expect(result.order).toEqual({ type: 'HOLD', unit: 'LON' });
    });

    it('parses MOVE orders', () => {
      const result = parseOrderLine('A Paris -> Burgundy');
      expect(result.order).toEqual({
        type: 'MOVE',
        unit: 'PAR',
        destination: 'BUR',
      });
    });

    it('parses MOVE with coast', () => {
      const result = parseOrderLine('F MAO -> Spain (south)');
      expect(result.order).toEqual({
        type: 'MOVE',
        unit: 'MAO',
        destination: 'SPA',
        destinationCoast: 'SOUTH',
      });
    });

    it('parses MOVE via convoy', () => {
      const result = parseOrderLine('A London -> Norway VIA CONVOY');
      expect(result.order).toEqual({
        type: 'MOVE',
        unit: 'LON',
        destination: 'NWY',
        viaConvoy: true,
      });
    });

    it('parses SUPPORT HOLD', () => {
      const result = parseOrderLine('A Munich SUPPORT A Berlin');
      expect(result.order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BER',
      });
    });

    it('parses SUPPORT MOVE', () => {
      const result = parseOrderLine('A Munich SUPPORT A Berlin -> Silesia');
      expect(result.order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BER',
        destination: 'SIL',
      });
    });

    it('parses CONVOY', () => {
      const result = parseOrderLine('F North Sea CONVOY A London -> Norway');
      expect(result.order).toEqual({
        type: 'CONVOY',
        unit: 'NTH',
        convoyedUnit: 'LON',
        destination: 'NWY',
      });
    });
  });

  describe('parseRetreatLine', () => {
    it('parses retreat order', () => {
      const result = parseRetreatLine('A Munich -> Bohemia');
      expect(result.order).toEqual({
        unit: 'MUN',
        destination: 'BOH',
      });
    });

    it('parses disband order', () => {
      const result = parseRetreatLine('A Munich DISBAND');
      expect(result.order).toEqual({ unit: 'MUN' });
    });
  });

  describe('parseBuildLine', () => {
    it('parses build army', () => {
      const result = parseBuildLine('BUILD A Paris');
      expect(result.order).toEqual({
        type: 'BUILD',
        province: 'PAR',
        unitType: 'ARMY',
      });
    });

    it('parses build fleet', () => {
      const result = parseBuildLine('BUILD F London');
      expect(result.order).toEqual({
        type: 'BUILD',
        province: 'LON',
        unitType: 'FLEET',
      });
    });

    it('parses build fleet with coast', () => {
      const result = parseBuildLine('BUILD F St. Petersburg (north)');
      expect(result.order).toEqual({
        type: 'BUILD',
        province: 'STP',
        unitType: 'FLEET',
        coast: 'NORTH',
      });
    });

    it('parses disband', () => {
      const result = parseBuildLine('DISBAND A Munich');
      expect(result.order).toEqual({
        type: 'DISBAND',
        province: 'MUN',
      });
    });
  });

  describe('parseAgentResponse', () => {
    it('extracts orders from response', () => {
      const response = `
REASONING: I need to defend my home centers.

ORDERS:
A London HOLD
F Edinburgh -> North Sea
A Liverpool -> Wales
      `;

      const result = parseAgentResponse(response);
      expect(result.orders.length).toBe(3);
      expect(result.errors.length).toBe(0);
    });

    it('extracts retreats', () => {
      const response = `
RETREATS:
A Munich -> Bohemia
F North Sea DISBAND
      `;

      const result = parseAgentResponse(response);
      expect(result.retreatOrders.length).toBe(2);
    });

    it('extracts builds', () => {
      const response = `
BUILDS:
BUILD A Paris
BUILD F Brest
      `;

      const result = parseAgentResponse(response);
      expect(result.buildOrders.length).toBe(2);
    });

    it('extracts diplomatic messages', () => {
      const response = `
ORDERS:
A Paris HOLD

DIPLOMACY:
SEND FRANCE: "I propose we form an alliance"
SEND GERMANY: "Your movements concern me"
      `;

      const result = parseAgentResponse(response);
      expect(result.diplomaticMessages.length).toBe(2);
      expect(result.diplomaticMessages[0]).toEqual({
        type: 'SEND_MESSAGE',
        targetPowers: ['FRANCE'],
        content: 'I propose we form an alliance',
      });
      expect(result.diplomaticMessages[1]).toEqual({
        type: 'SEND_MESSAGE',
        targetPowers: ['GERMANY'],
        content: 'Your movements concern me',
      });
    });

    it('handles complete response with all sections', () => {
      const response = `
REASONING: Strategic analysis here.

ORDERS:
A Paris -> Burgundy
F Brest -> English Channel

DIPLOMACY:
SEND ENGLAND: "Let us agree to peace in the Channel"
      `;

      const result = parseAgentResponse(response);
      expect(result.orders.length).toBe(2);
      expect(result.diplomaticMessages.length).toBe(1);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('extractDiplomacySection', () => {
    it('extracts diplomacy section from response', () => {
      const response = `
ORDERS:
A Paris HOLD

DIPLOMACY:
SEND FRANCE: "Hello"
SEND GERMANY: "Hi"
      `;

      const section = extractDiplomacySection(response);
      expect(section).toContain('SEND FRANCE');
      expect(section).toContain('SEND GERMANY');
    });

    it('returns null when no diplomacy section', () => {
      const response = `
ORDERS:
A Paris HOLD
      `;

      const section = extractDiplomacySection(response);
      expect(section).toBeNull();
    });
  });

  describe('parseDiplomacyLine', () => {
    it('parses SEND command with double quotes', () => {
      const result = parseDiplomacyLine('SEND FRANCE: "I propose we form an alliance"');
      expect(result.action).toEqual({
        type: 'SEND_MESSAGE',
        targetPowers: ['FRANCE'],
        content: 'I propose we form an alliance',
      });
      expect(result.error).toBeNull();
    });

    it('parses SEND command with single quotes', () => {
      const result = parseDiplomacyLine("SEND GERMANY: 'Your movements concern me'");
      expect(result.action).toEqual({
        type: 'SEND_MESSAGE',
        targetPowers: ['GERMANY'],
        content: 'Your movements concern me',
      });
      expect(result.error).toBeNull();
    });

    it('normalizes power names', () => {
      const result = parseDiplomacyLine('SEND france: "Test message"');
      expect(result.action?.targetPowers[0]).toBe('FRANCE');
    });

    it('returns error for unknown power', () => {
      const result = parseDiplomacyLine('SEND MORDOR: "We want the ring"');
      expect(result.action).toBeNull();
      expect(result.error).toContain('Unknown power');
    });

    it('ignores empty lines', () => {
      const result = parseDiplomacyLine('');
      expect(result.action).toBeNull();
      expect(result.error).toBeNull();
    });

    it('ignores comment lines', () => {
      const result = parseDiplomacyLine('# This is a comment');
      expect(result.action).toBeNull();
      expect(result.error).toBeNull();
    });

    it('handles bullet points', () => {
      const result = parseDiplomacyLine('- SEND ITALY: "Support my move"');
      expect(result.action?.targetPowers[0]).toBe('ITALY');
    });
  });

  describe('validateOrders', () => {
    it('validates orders against game state', () => {
      const state = createInitialState();
      const orders: Order[] = [
        { type: 'HOLD', unit: 'LON' },
        { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
      ];

      const { valid, errors } = validateOrders(orders, state, 'ENGLAND');
      expect(valid.length).toBe(2);
      expect(errors.length).toBe(0);
    });

    it('rejects orders for units not owned', () => {
      const state = createInitialState();
      const orders: Order[] = [
        { type: 'HOLD', unit: 'PAR' }, // France's unit
      ];

      const { valid, errors } = validateOrders(orders, state, 'ENGLAND');
      expect(valid.length).toBe(0);
      expect(errors.length).toBe(1);
    });
  });

  describe('fillDefaultOrders', () => {
    it('adds HOLD for units without orders', () => {
      const state = createInitialState();
      const orders: Order[] = [
        { type: 'HOLD', unit: 'LON' },
      ];

      const filled = fillDefaultOrders(orders, state, 'ENGLAND');
      expect(filled.length).toBe(3); // England has 3 units
      expect(filled.filter(o => o.type === 'HOLD').length).toBe(3);
    });
  });
});

describe('Game View', () => {
  describe('createAgentGameView', () => {
    it('creates view for a power', () => {
      const state = createInitialState();
      const view = createAgentGameView(state, 'ENGLAND');

      expect(view.viewingPower).toBe('ENGLAND');
      expect(view.year).toBe(1901);
      expect(view.season).toBe('SPRING');
      expect(view.phase).toBe('DIPLOMACY');
    });

    it('shows own units', () => {
      const state = createInitialState();
      const view = createAgentGameView(state, 'ENGLAND');

      expect(view.myUnits.length).toBe(3);
      expect(view.myUnits.some(u => u.province === 'LON')).toBe(true);
    });

    it('shows other powers units', () => {
      const state = createInitialState();
      const view = createAgentGameView(state, 'ENGLAND');

      expect(view.otherUnits.get('FRANCE')?.length).toBe(3);
      expect(view.otherUnits.get('GERMANY')?.length).toBe(3);
    });

    it('shows supply center counts', () => {
      const state = createInitialState();
      const view = createAgentGameView(state, 'ENGLAND');

      expect(view.supplyCenterCounts.get('ENGLAND')).toBe(3);
      expect(view.supplyCenterCounts.get('RUSSIA')).toBe(4);
    });
  });

  describe('createStrategicSummary', () => {
    it('creates summary with position info', () => {
      const state = createInitialState();
      const summary = createStrategicSummary(state, 'ENGLAND');

      expect(summary).toContain('ENGLAND');
      expect(summary).toContain('3 supply centers');
    });
  });

  describe('getProvinceName', () => {
    it('returns full name', () => {
      expect(getProvinceName('LON')).toBe('London');
      expect(getProvinceName('PAR')).toBe('Paris');
    });

    it('returns ID for unknown', () => {
      expect(getProvinceName('UNKNOWN')).toBe('UNKNOWN');
    });
  });
});

describe('Session Manager', () => {
  let llmProvider: MockLLMProvider;
  let sessionManager: AgentSessionManager;

  beforeEach(() => {
    llmProvider = new MockLLMProvider(['Test response']);
    sessionManager = createTestSessionManager('game-1', llmProvider);
  });

  it('creates session for a power', async () => {
    const session = await sessionManager.createSession({ power: 'ENGLAND' });

    expect(session.power).toBe('ENGLAND');
    expect(session.isActive).toBe(true);
    expect(session.memory.power).toBe('ENGLAND');
  });

  it('creates sessions for all powers', async () => {
    const sessions = await sessionManager.createAllSessions();

    expect(sessions.size).toBe(7);
    expect(sessions.has('ENGLAND')).toBe(true);
    expect(sessions.has('TURKEY')).toBe(true);
  });

  it('gets existing session', async () => {
    await sessionManager.createSession({ power: 'ENGLAND' });
    const session = sessionManager.getSession('ENGLAND');

    expect(session).toBeDefined();
    expect(session?.power).toBe('ENGLAND');
  });

  it('adds messages to conversation history', async () => {
    await sessionManager.createSession({ power: 'ENGLAND' });
    sessionManager.addMessage('ENGLAND', {
      role: 'user',
      content: 'Test message',
    });

    const session = sessionManager.getSession('ENGLAND');
    expect(session?.conversationHistory.length).toBe(1);
    expect(session?.conversationHistory[0].content).toBe('Test message');
  });

  it('deactivates and reactivates sessions', async () => {
    await sessionManager.createSession({ power: 'ENGLAND' });

    sessionManager.deactivateSession('ENGLAND');
    expect(sessionManager.getSession('ENGLAND')?.isActive).toBe(false);

    sessionManager.reactivateSession('ENGLAND');
    expect(sessionManager.getSession('ENGLAND')?.isActive).toBe(true);
  });

  it('returns session statistics', async () => {
    await sessionManager.createAllSessions();
    sessionManager.addMessage('ENGLAND', { role: 'user', content: 'Test' });

    const stats = sessionManager.getStats();
    expect(stats.totalSessions).toBe(7);
    expect(stats.activeSessions).toBe(7);
    expect(stats.totalMessages).toBe(1);
  });
});

describe('Mock LLM Provider', () => {
  it('returns configured responses', async () => {
    const provider = new MockLLMProvider(['Response 1', 'Response 2']);

    const result1 = await provider.complete({ messages: [] });
    expect(result1.content).toBe('Response 1');

    const result2 = await provider.complete({ messages: [] });
    expect(result2.content).toBe('Response 2');
  });

  it('cycles through responses', async () => {
    const provider = new MockLLMProvider(['Only response']);

    await provider.complete({ messages: [] });
    const result = await provider.complete({ messages: [] });
    expect(result.content).toBe('Only response');
  });

  it('tracks calls', async () => {
    const provider = new MockLLMProvider(['Response']);

    await provider.complete({
      messages: [{ role: 'user', content: 'Test', timestamp: new Date() }],
    });

    expect(provider.calls.length).toBe(1);
    expect(provider.calls[0].messages[0].content).toBe('Test');
  });

  it('returns parseable default response with ORDERS section', async () => {
    const provider = new MockLLMProvider();

    const result = await provider.complete({ messages: [] });

    // Default response should include ORDERS section
    expect(result.content).toContain('ORDERS:');

    // Should be parseable by order parser
    const parsed = parseAgentResponse(result.content);
    expect(parsed.errors.length).toBe(0);
  });
});
