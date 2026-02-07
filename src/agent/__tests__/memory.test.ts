import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialMemory,
  updateTrust,
  recordEvent,
  addCommitment,
  fulfillCommitment,
  breakCommitment,
  addStrategicNote,
  cleanupExpiredCommitments,
  addTurnSummary,
  updateMemoryTimestamp,
  getRelationshipSummary,
  getRecentEvents,
  getHighPriorityNotes,
  serializeMemory,
  deserializeMemory,
  InMemoryStore,
  MemoryManager,
} from '../memory';
import type { AgentMemory } from '../types';

// ---------------------------------------------------------------------------
// createInitialMemory
// ---------------------------------------------------------------------------
describe('createInitialMemory', () => {
  it('should create memory with correct power and gameId', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    expect(memory.power).toBe('FRANCE');
    expect(memory.gameId).toBe('game-1');
  });

  it('should initialize trust at 0 for all other powers', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    expect(memory.trustLevels.get('FRANCE')).toBe(0);
    expect(memory.trustLevels.get('GERMANY')).toBe(0);
    expect(memory.trustLevels.get('ITALY')).toBe(0);
    expect(memory.trustLevels.get('AUSTRIA')).toBe(0);
    expect(memory.trustLevels.get('RUSSIA')).toBe(0);
    expect(memory.trustLevels.get('TURKEY')).toBe(0);
  });

  it('should not include self in trust levels', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    expect(memory.trustLevels.has('ENGLAND')).toBe(false);
  });

  it('should have 6 relationships (all other powers)', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    expect(memory.relationships.size).toBe(6);
  });

  it('should initialize relationships as neutral', () => {
    const memory = createInitialMemory('GERMANY', 'game-1');
    const rel = memory.relationships.get('FRANCE')!;
    expect(rel.isAlly).toBe(false);
    expect(rel.isEnemy).toBe(false);
    expect(rel.trustLevel).toBe(0);
    expect(rel.lastInteraction).toBeNull();
    expect(rel.commitments).toHaveLength(0);
  });

  it('should start with empty collections', () => {
    const memory = createInitialMemory('ITALY', 'game-1');
    expect(memory.events).toHaveLength(0);
    expect(memory.activeCommitments).toHaveLength(0);
    expect(memory.strategicNotes).toHaveLength(0);
    expect(memory.currentAllies).toHaveLength(0);
    expect(memory.currentEnemies).toHaveLength(0);
    expect(memory.turnSummaries).toHaveLength(0);
    expect(memory.fullPrivateDiary).toHaveLength(0);
    expect(memory.yearSummaries).toHaveLength(0);
    expect(memory.currentYearDiary).toHaveLength(0);
  });

  it('should set initial timestamp to Spring 1901 Diplomacy', () => {
    const memory = createInitialMemory('AUSTRIA', 'game-1');
    expect(memory.lastUpdated).toEqual({
      year: 1901,
      season: 'SPRING',
      phase: 'DIPLOMACY',
    });
  });
});

// ---------------------------------------------------------------------------
// updateTrust
// ---------------------------------------------------------------------------
describe('updateTrust', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should increase trust', () => {
    updateTrust(memory, 'FRANCE', 0.3, 1901, 'SPRING');
    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
  });

  it('should decrease trust', () => {
    updateTrust(memory, 'GERMANY', -0.5, 1901, 'SPRING');
    expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(-0.5);
  });

  it('should clamp trust to max 1', () => {
    updateTrust(memory, 'FRANCE', 0.8, 1901, 'SPRING');
    updateTrust(memory, 'FRANCE', 0.5, 1901, 'FALL');
    expect(memory.trustLevels.get('FRANCE')).toBe(1);
  });

  it('should clamp trust to min -1', () => {
    updateTrust(memory, 'GERMANY', -0.8, 1901, 'SPRING');
    updateTrust(memory, 'GERMANY', -0.5, 1901, 'FALL');
    expect(memory.trustLevels.get('GERMANY')).toBe(-1);
  });

  it('should update relationship trust level', () => {
    updateTrust(memory, 'FRANCE', 0.4, 1901, 'SPRING');
    const rel = memory.relationships.get('FRANCE')!;
    expect(rel.trustLevel).toBeCloseTo(0.4);
  });

  it('should update lastInteraction', () => {
    updateTrust(memory, 'ITALY', 0.1, 1902, 'FALL');
    const rel = memory.relationships.get('ITALY')!;
    expect(rel.lastInteraction).toEqual({ year: 1902, season: 'FALL' });
  });

  it('should mark power as ally at trust >= 0.5', () => {
    updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');
    const rel = memory.relationships.get('FRANCE')!;
    expect(rel.isAlly).toBe(true);
    expect(rel.isEnemy).toBe(false);
    expect(memory.currentAllies).toContain('FRANCE');
  });

  it('should mark power as enemy at trust <= -0.5', () => {
    updateTrust(memory, 'GERMANY', -0.5, 1901, 'SPRING');
    const rel = memory.relationships.get('GERMANY')!;
    expect(rel.isAlly).toBe(false);
    expect(rel.isEnemy).toBe(true);
    expect(memory.currentEnemies).toContain('GERMANY');
  });

  it('should keep neutral at moderate trust', () => {
    updateTrust(memory, 'ITALY', 0.3, 1901, 'SPRING');
    const rel = memory.relationships.get('ITALY')!;
    expect(rel.isAlly).toBe(false);
    expect(rel.isEnemy).toBe(false);
  });

  it('should transition ally to enemy on betrayal', () => {
    updateTrust(memory, 'FRANCE', 0.6, 1901, 'SPRING');
    expect(memory.currentAllies).toContain('FRANCE');

    updateTrust(memory, 'FRANCE', -1.2, 1901, 'FALL'); // Big betrayal
    expect(memory.currentAllies).not.toContain('FRANCE');
    expect(memory.currentEnemies).toContain('FRANCE');
  });
});

// ---------------------------------------------------------------------------
// recordEvent
// ---------------------------------------------------------------------------
describe('recordEvent', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should add event to memory', () => {
    recordEvent(
      memory,
      {
        year: 1901,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France attacked Channel',
      },
      -0.3
    );

    expect(memory.events).toHaveLength(1);
    expect(memory.events[0].type).toBe('BETRAYAL');
    expect(memory.events[0].impactOnTrust).toBe(-0.3);
  });

  it('should apply trust impact to involved powers', () => {
    recordEvent(
      memory,
      {
        year: 1901,
        season: 'SPRING',
        type: 'COOPERATION',
        powers: ['FRANCE'],
        description: 'France supported our position',
      },
      0.2
    );

    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(0.2);
  });

  it('should not apply trust impact to self', () => {
    recordEvent(
      memory,
      {
        year: 1901,
        season: 'SPRING',
        type: 'ALLIANCE_FORMED',
        powers: ['ENGLAND', 'FRANCE'], // Includes self
        description: 'Anglo-French alliance',
      },
      0.3
    );

    // Only France should get trust change
    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
    expect(memory.trustLevels.has('ENGLAND')).toBe(false);
  });

  it('should apply impact to multiple powers', () => {
    recordEvent(
      memory,
      {
        year: 1901,
        season: 'FALL',
        type: 'COOPERATION',
        powers: ['FRANCE', 'GERMANY'],
        description: 'Joint operation',
      },
      0.1
    );

    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(0.1);
    expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// addCommitment / fulfillCommitment / breakCommitment
// ---------------------------------------------------------------------------
describe('Commitments', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should add a commitment with generated ID', () => {
    const commitment = addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Support France into Belgium',
    });

    expect(commitment.id).toBeTruthy();
    expect(memory.activeCommitments).toHaveLength(1);
    expect(commitment.description).toBe('Support France into Belgium');
  });

  it('should add commitment to the relationship', () => {
    addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Support France',
    });

    const rel = memory.relationships.get('FRANCE')!;
    expect(rel.commitments).toHaveLength(1);
  });

  it('should fulfill commitment and increase trust', () => {
    const commitment = addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Support France',
    });

    fulfillCommitment(memory, commitment.id, 1901, 'FALL');

    expect(commitment.fulfilled).toBe(true);
    // Trust should have increased via recordEvent
    expect(memory.trustLevels.get('FRANCE')!).toBeGreaterThan(0);
    expect(memory.events.some(e => e.type === 'PROMISE_KEPT')).toBe(true);
  });

  it('should break commitment and decrease trust', () => {
    const commitment = addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Support France',
    });

    breakCommitment(memory, commitment.id, 1901, 'FALL');

    expect(commitment.broken).toBe(true);
    expect(memory.trustLevels.get('FRANCE')!).toBeLessThan(0);
    expect(memory.events.some(e => e.type === 'PROMISE_BROKEN')).toBe(true);
  });

  it('should do nothing for nonexistent commitment ID', () => {
    fulfillCommitment(memory, 'nonexistent-id', 1901, 'SPRING');
    expect(memory.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addStrategicNote
// ---------------------------------------------------------------------------
describe('addStrategicNote', () => {
  it('should add note with generated ID', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    const note = addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'German threat',
      content: 'Germany may attack Burgundy',
      priority: 'HIGH',
    });

    expect(note.id).toBeTruthy();
    expect(memory.strategicNotes).toHaveLength(1);
    expect(note.content).toBe('Germany may attack Burgundy');
  });
});

// ---------------------------------------------------------------------------
// cleanupExpiredCommitments
// ---------------------------------------------------------------------------
describe('cleanupExpiredCommitments', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should remove fulfilled commitments', () => {
    const c = addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Test',
    });
    c.fulfilled = true;

    cleanupExpiredCommitments(memory, 1901, 'FALL');
    expect(memory.activeCommitments).toHaveLength(0);
  });

  it('should remove broken commitments', () => {
    const c = addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Test',
    });
    c.broken = true;

    cleanupExpiredCommitments(memory, 1901, 'FALL');
    expect(memory.activeCommitments).toHaveLength(0);
  });

  it('should remove expired commitments', () => {
    addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Expires end of 1901',
      expiresYear: 1901,
      expiresSeason: 'FALL',
    });

    cleanupExpiredCommitments(memory, 1902, 'SPRING');
    expect(memory.activeCommitments).toHaveLength(0);
  });

  it('should keep active non-expired commitments', () => {
    addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Expires 1903',
      expiresYear: 1903,
      expiresSeason: 'WINTER',
    });

    cleanupExpiredCommitments(memory, 1901, 'FALL');
    expect(memory.activeCommitments).toHaveLength(1);
  });

  it('should keep commitments with no expiry', () => {
    addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'No expiry',
    });

    cleanupExpiredCommitments(memory, 1910, 'WINTER');
    expect(memory.activeCommitments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// addTurnSummary
// ---------------------------------------------------------------------------
describe('addTurnSummary', () => {
  it('should add a turn summary', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    addTurnSummary(memory, {
      year: 1901,
      season: 'SPRING',
      ordersSubmitted: ['A PAR -> BUR'],
      ordersSucceeded: ['A PAR -> BUR'],
      ordersFailed: [],
      supplyCentersGained: [],
      supplyCentersLost: [],
      unitsBuilt: 0,
      unitsLost: 0,
      diplomaticHighlights: [],
    });

    expect(memory.turnSummaries).toHaveLength(1);
  });

  it('should keep only last 10 turn summaries', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');

    for (let i = 0; i < 15; i++) {
      addTurnSummary(memory, {
        year: 1901 + Math.floor(i / 2),
        season: i % 2 === 0 ? 'SPRING' : 'FALL',
        ordersSubmitted: [],
        ordersSucceeded: [],
        ordersFailed: [],
        supplyCentersGained: [],
        supplyCentersLost: [],
        unitsBuilt: 0,
        unitsLost: 0,
        diplomaticHighlights: [],
      });
    }

    expect(memory.turnSummaries).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// updateMemoryTimestamp
// ---------------------------------------------------------------------------
describe('updateMemoryTimestamp', () => {
  it('should update the timestamp', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    updateMemoryTimestamp(memory, 1903, 'FALL', 'BUILD');

    expect(memory.lastUpdated).toEqual({
      year: 1903,
      season: 'FALL',
      phase: 'BUILD',
    });
  });
});

// ---------------------------------------------------------------------------
// getRelationshipSummary
// ---------------------------------------------------------------------------
describe('getRelationshipSummary', () => {
  it('should produce a summary for all relationships', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    const summary = getRelationshipSummary(memory);

    expect(summary).toContain('FRANCE');
    expect(summary).toContain('GERMANY');
    expect(summary).toContain('Trust');
  });

  it('should show ALLY for allied power', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    updateTrust(memory, 'FRANCE', 0.6, 1901, 'SPRING');
    const summary = getRelationshipSummary(memory);

    expect(summary).toContain('ALLY');
  });

  it('should show ENEMY for enemy power', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    updateTrust(memory, 'GERMANY', -0.6, 1901, 'SPRING');
    const summary = getRelationshipSummary(memory);

    expect(summary).toContain('ENEMY');
  });

  it('should show active commitments count', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    addCommitment(memory, {
      year: 1901,
      season: 'SPRING',
      fromPower: 'ENGLAND',
      toPower: 'FRANCE',
      description: 'Support',
    });
    const summary = getRelationshipSummary(memory);

    expect(summary).toContain('Active commitments: 1');
  });
});

// ---------------------------------------------------------------------------
// getRecentEvents
// ---------------------------------------------------------------------------
describe('getRecentEvents', () => {
  it('should return last N events', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');

    for (let i = 0; i < 15; i++) {
      memory.events.push({
        year: 1901,
        season: 'SPRING',
        type: 'COOPERATION',
        powers: ['FRANCE'],
        description: `Event ${i}`,
        impactOnTrust: 0,
      });
    }

    const recent = getRecentEvents(memory, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0].description).toBe('Event 10');
    expect(recent[4].description).toBe('Event 14');
  });

  it('should return all events if fewer than count', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    memory.events.push({
      year: 1901,
      season: 'SPRING',
      type: 'COOPERATION',
      powers: ['FRANCE'],
      description: 'Only event',
      impactOnTrust: 0,
    });

    const recent = getRecentEvents(memory, 10);
    expect(recent).toHaveLength(1);
  });

  it('should return empty for no events', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    expect(getRecentEvents(memory)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getHighPriorityNotes
// ---------------------------------------------------------------------------
describe('getHighPriorityNotes', () => {
  it('should return HIGH and CRITICAL notes', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'Low',
      content: 'Low priority',
      priority: 'LOW',
    });
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'High',
      content: 'High priority',
      priority: 'HIGH',
    });
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'Critical',
      content: 'Critical note',
      priority: 'CRITICAL',
    });
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'Medium',
      content: 'Medium priority',
      priority: 'MEDIUM',
    });

    const high = getHighPriorityNotes(memory);
    expect(high).toHaveLength(2);
    expect(high.some(n => n.content === 'High priority')).toBe(true);
    expect(high.some(n => n.content === 'Critical note')).toBe(true);
  });

  it('should return empty when no high priority notes', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'Low',
      content: 'Low priority only',
      priority: 'LOW',
    });
    expect(getHighPriorityNotes(memory)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeMemory / deserializeMemory
// ---------------------------------------------------------------------------
describe('serialize / deserialize', () => {
  it('should round-trip memory correctly', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    updateTrust(memory, 'FRANCE', 0.3, 1901, 'SPRING');
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'Test',
      content: 'Test note',
      priority: 'HIGH',
    });

    // Add diary entry
    memory.currentYearDiary.push({
      phase: '[S1901M]',
      type: 'reflection',
      content: 'Test diary entry',
      timestamp: new Date('2024-01-01'),
    });

    const serialized = serializeMemory(memory);
    const deserialized = deserializeMemory(serialized);

    expect(deserialized.power).toBe('ENGLAND');
    expect(deserialized.gameId).toBe('game-1');
    expect(deserialized.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
    expect(deserialized.strategicNotes).toHaveLength(1);
    expect(deserialized.currentYearDiary).toHaveLength(1);
    expect(deserialized.currentYearDiary[0].timestamp).toBeInstanceOf(Date);
  });

  it('should preserve diary entries through serialization', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    const now = new Date('2024-06-15T10:30:00Z');

    memory.fullPrivateDiary.push({
      phase: '[S1901M]',
      type: 'negotiation',
      content: 'Discussed alliance with England',
      timestamp: now,
    });

    memory.yearSummaries.push({
      year: 1901,
      summary: 'Expanded into Burgundy',
      territorialChanges: ['Gained BUR'],
      diplomaticChanges: ['Allied with England'],
      consolidatedAt: now,
    });

    const json = serializeMemory(memory);
    const restored = deserializeMemory(json);

    expect(restored.fullPrivateDiary[0].content).toBe(
      'Discussed alliance with England'
    );
    expect(restored.fullPrivateDiary[0].timestamp).toBeInstanceOf(Date);
    expect(restored.yearSummaries[0].summary).toBe('Expanded into Burgundy');
    expect(restored.yearSummaries[0].consolidatedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// InMemoryStore
// ---------------------------------------------------------------------------
describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('should save and load memory', async () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    await store.save(memory);

    const loaded = await store.load('ENGLAND', 'game-1');
    expect(loaded).toBeTruthy();
    expect(loaded!.power).toBe('ENGLAND');
    expect(loaded!.gameId).toBe('game-1');
  });

  it('should return null for non-existent memory', async () => {
    const loaded = await store.load('FRANCE', 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('should report existence correctly', async () => {
    const memory = createInitialMemory('GERMANY', 'game-1');
    await store.save(memory);

    expect(await store.exists('GERMANY', 'game-1')).toBe(true);
    expect(await store.exists('FRANCE', 'game-1')).toBe(false);
  });

  it('should delete memory', async () => {
    const memory = createInitialMemory('ITALY', 'game-1');
    await store.save(memory);

    await store.delete('ITALY', 'game-1');
    expect(await store.exists('ITALY', 'game-1')).toBe(false);
  });

  it('should store a deep copy (not a reference)', async () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    await store.save(memory);

    // Modify original
    updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');

    // Loaded copy should be unmodified
    const loaded = await store.load('ENGLAND', 'game-1');
    expect(loaded!.trustLevels.get('FRANCE')).toBe(0);
  });

  it('should clear all memories', async () => {
    await store.save(createInitialMemory('ENGLAND', 'game-1'));
    await store.save(createInitialMemory('FRANCE', 'game-1'));

    store.clear();

    expect(await store.exists('ENGLAND', 'game-1')).toBe(false);
    expect(await store.exists('FRANCE', 'game-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------
describe('MemoryManager', () => {
  let store: InMemoryStore;
  let manager: MemoryManager;

  beforeEach(() => {
    store = new InMemoryStore();
    manager = new MemoryManager(store);
  });

  it('should create new memory when none exists', async () => {
    const memory = await manager.getMemory('ENGLAND', 'game-1');
    expect(memory.power).toBe('ENGLAND');
    expect(memory.gameId).toBe('game-1');
  });

  it('should return cached memory on second call', async () => {
    const memory1 = await manager.getMemory('ENGLAND', 'game-1');
    updateTrust(memory1, 'FRANCE', 0.5, 1901, 'SPRING');

    const memory2 = await manager.getMemory('ENGLAND', 'game-1');
    // Should be the same reference (from cache)
    expect(memory2.trustLevels.get('FRANCE')).toBeCloseTo(0.5);
  });

  it('should load from store when not cached', async () => {
    const original = createInitialMemory('FRANCE', 'game-1');
    updateTrust(original, 'ENGLAND', 0.7, 1901, 'SPRING');
    await store.save(original);

    const loaded = await manager.getMemory('FRANCE', 'game-1');
    expect(loaded.trustLevels.get('ENGLAND')).toBeCloseTo(0.7);
  });

  it('should save memory to store', async () => {
    const memory = await manager.getMemory('GERMANY', 'game-1');
    updateTrust(memory, 'FRANCE', 0.3, 1901, 'SPRING');

    await manager.saveMemory(memory);

    // Verify in store
    const stored = await store.load('GERMANY', 'game-1');
    expect(stored!.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
  });

  it('should save all memories', async () => {
    await manager.getMemory('ENGLAND', 'game-1');
    await manager.getMemory('FRANCE', 'game-1');

    await manager.saveAll();

    expect(await store.exists('ENGLAND', 'game-1')).toBe(true);
    expect(await store.exists('FRANCE', 'game-1')).toBe(true);
  });

  it('should clear cache', async () => {
    const mem = await manager.getMemory('ENGLAND', 'game-1');
    updateTrust(mem, 'FRANCE', 0.8, 1901, 'SPRING');

    // Save to store, then clear cache
    await manager.saveMemory(mem);
    manager.clearCache();

    // Should reload from store (deep copy), not the modified cache reference
    const reloaded = await manager.getMemory('ENGLAND', 'game-1');
    expect(reloaded.trustLevels.get('FRANCE')).toBeCloseTo(0.8);
  });
});
