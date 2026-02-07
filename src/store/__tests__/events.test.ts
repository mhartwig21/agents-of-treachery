/**
 * Tests for store/events.ts — Event sourcing event utilities.
 *
 * Covers: generateEventId, createEventBase
 */

import { describe, it, expect } from 'vitest';
import { generateEventId, createEventBase } from '../events';

describe('generateEventId', () => {
  it('should return a string starting with evt_', () => {
    const id = generateEventId();
    expect(id).toMatch(/^evt_/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateEventId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('createEventBase', () => {
  it('should create a base event with id, timestamp, and gameId', () => {
    const base = createEventBase('test-game');
    expect(base.id).toMatch(/^evt_/);
    expect(base.timestamp).toBeInstanceOf(Date);
    expect(base.gameId).toBe('test-game');
  });

  it('should create unique events each call', () => {
    const e1 = createEventBase('game-1');
    const e2 = createEventBase('game-1');
    expect(e1.id).not.toBe(e2.id);
  });
});
