import { describe, it, expect } from 'vitest'
import { spectatorReducer } from '../SpectatorContext'
import {
  createEmptyAccumulator,
  getLiveAccumulator,
  initialSpectatorState,
  type SpectatorState,
} from '../types'
import type { Message } from '../../press/types'
import type { Order as UIOrder } from '../../types/game'

// --- Test helpers ---

function makeMessage(id: string, content = `msg-${id}`): Message {
  return {
    id,
    channelId: 'bilateral:ENGLAND:FRANCE',
    sender: 'ENGLAND',
    content,
    timestamp: new Date('2026-01-01'),
  }
}

function stateWithAccumulator(
  gameId: string,
  messages: Message[] = [],
  orders: Record<string, UIOrder[]> = {},
): SpectatorState {
  const acc = new Map([[gameId, { messages, orders }]])
  return { ...initialSpectatorState, liveAccumulators: acc }
}

// --- Helper tests ---

describe('createEmptyAccumulator', () => {
  it('returns an accumulator with empty messages and orders', () => {
    const acc = createEmptyAccumulator()
    expect(acc).toEqual({ messages: [], orders: {} })
  })

  it('returns a new object each call', () => {
    const a = createEmptyAccumulator()
    const b = createEmptyAccumulator()
    expect(a).not.toBe(b)
    expect(a.messages).not.toBe(b.messages)
  })
})

describe('getLiveAccumulator', () => {
  it('returns null when there is no active game', () => {
    const state: SpectatorState = { ...initialSpectatorState, activeGameId: null }
    expect(getLiveAccumulator(state)).toBeNull()
  })

  it('returns null when active game has no accumulator', () => {
    const state: SpectatorState = { ...initialSpectatorState, activeGameId: 'game-1' }
    expect(getLiveAccumulator(state)).toBeNull()
  })

  it('returns the accumulator for the active game', () => {
    const messages = [makeMessage('m1')]
    const state = { ...stateWithAccumulator('game-1', messages), activeGameId: 'game-1' }
    const result = getLiveAccumulator(state)
    expect(result).not.toBeNull()
    expect(result!.messages).toHaveLength(1)
    expect(result!.messages[0].id).toBe('m1')
  })

  it('does not return accumulators for non-active games', () => {
    const state = { ...stateWithAccumulator('game-1', [makeMessage('m1')]), activeGameId: 'game-2' }
    expect(getLiveAccumulator(state)).toBeNull()
  })
})

// --- Reducer tests ---

describe('ACCUMULATE_MESSAGES', () => {
  it('creates a new accumulator when none exists for the game', () => {
    const messages = [makeMessage('m1'), makeMessage('m2')]
    const next = spectatorReducer(initialSpectatorState, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-1',
      messages,
    })
    const acc = next.liveAccumulators.get('game-1')
    expect(acc).toBeDefined()
    expect(acc!.messages).toHaveLength(2)
    expect(acc!.orders).toEqual({})
  })

  it('appends messages to an existing accumulator', () => {
    const state = stateWithAccumulator('game-1', [makeMessage('m1')])
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-1',
      messages: [makeMessage('m2')],
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.messages).toHaveLength(2)
    expect(acc.messages[0].id).toBe('m1')
    expect(acc.messages[1].id).toBe('m2')
  })

  it('deduplicates messages by id', () => {
    const state = stateWithAccumulator('game-1', [makeMessage('m1')])
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-1',
      messages: [makeMessage('m1', 'duplicate'), makeMessage('m2')],
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.messages).toHaveLength(2)
    expect(acc.messages[0].id).toBe('m1')
    expect(acc.messages[0].content).toBe('msg-m1') // original kept
    expect(acc.messages[1].id).toBe('m2')
  })

  it('does not mutate the original state', () => {
    const state = stateWithAccumulator('game-1', [makeMessage('m1')])
    const origAcc = state.liveAccumulators.get('game-1')!
    spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-1',
      messages: [makeMessage('m2')],
    })
    expect(origAcc.messages).toHaveLength(1)
    expect(state.liveAccumulators.get('game-1')!.messages).toHaveLength(1)
  })

  it('preserves existing orders when accumulating messages', () => {
    const orders: Record<string, UIOrder[]> = {
      england: [{ type: 'hold', unit: 'lon' }],
    }
    const state = stateWithAccumulator('game-1', [], orders)
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-1',
      messages: [makeMessage('m1')],
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.orders).toEqual(orders)
  })

  it('handles accumulating into separate game accumulators independently', () => {
    let state = stateWithAccumulator('game-1', [makeMessage('m1')])
    state = spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-2',
      messages: [makeMessage('m2')],
    })
    expect(state.liveAccumulators.get('game-1')!.messages).toHaveLength(1)
    expect(state.liveAccumulators.get('game-2')!.messages).toHaveLength(1)
  })
})

describe('ACCUMULATE_ORDERS', () => {
  it('creates a new accumulator when none exists for the game', () => {
    const orders: Record<string, UIOrder[]> = {
      england: [{ type: 'move', unit: 'lon', target: 'nth' }],
    }
    const next = spectatorReducer(initialSpectatorState, {
      type: 'ACCUMULATE_ORDERS',
      gameId: 'game-1',
      orders,
    })
    const acc = next.liveAccumulators.get('game-1')
    expect(acc).toBeDefined()
    expect(acc!.orders.england).toHaveLength(1)
    expect(acc!.messages).toEqual([])
  })

  it('replaces orders for the same power', () => {
    const initialOrders: Record<string, UIOrder[]> = {
      england: [{ type: 'hold', unit: 'lon' }],
    }
    const state = stateWithAccumulator('game-1', [], initialOrders)
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_ORDERS',
      gameId: 'game-1',
      orders: {
        england: [{ type: 'move', unit: 'lon', target: 'nth' }],
      },
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.orders.england).toHaveLength(1)
    expect(acc.orders.england[0].type).toBe('move')
  })

  it('merges orders from different powers', () => {
    const state = stateWithAccumulator('game-1', [], {
      england: [{ type: 'hold', unit: 'lon' }],
    })
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_ORDERS',
      gameId: 'game-1',
      orders: {
        france: [{ type: 'move', unit: 'par', target: 'bur' }],
      },
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.orders.england).toHaveLength(1)
    expect(acc.orders.france).toHaveLength(1)
  })

  it('does not mutate the original state', () => {
    const state = stateWithAccumulator('game-1', [], {
      england: [{ type: 'hold', unit: 'lon' }],
    })
    const origAcc = state.liveAccumulators.get('game-1')!
    spectatorReducer(state, {
      type: 'ACCUMULATE_ORDERS',
      gameId: 'game-1',
      orders: { france: [{ type: 'hold', unit: 'par' }] },
    })
    expect(origAcc.orders.france).toBeUndefined()
  })

  it('preserves existing messages when accumulating orders', () => {
    const state = stateWithAccumulator('game-1', [makeMessage('m1')])
    const next = spectatorReducer(state, {
      type: 'ACCUMULATE_ORDERS',
      gameId: 'game-1',
      orders: { england: [{ type: 'hold', unit: 'lon' }] },
    })
    const acc = next.liveAccumulators.get('game-1')!
    expect(acc.messages).toHaveLength(1)
    expect(acc.messages[0].id).toBe('m1')
  })
})

describe('CLEAR_LIVE_ACCUMULATOR', () => {
  it('removes the accumulator for the specified game', () => {
    const state = stateWithAccumulator('game-1', [makeMessage('m1')])
    const next = spectatorReducer(state, {
      type: 'CLEAR_LIVE_ACCUMULATOR',
      gameId: 'game-1',
    })
    expect(next.liveAccumulators.has('game-1')).toBe(false)
  })

  it('does nothing when no accumulator exists for the game', () => {
    const next = spectatorReducer(initialSpectatorState, {
      type: 'CLEAR_LIVE_ACCUMULATOR',
      gameId: 'nonexistent',
    })
    expect(next.liveAccumulators.size).toBe(0)
  })

  it('preserves accumulators for other games', () => {
    let state = stateWithAccumulator('game-1', [makeMessage('m1')])
    state = spectatorReducer(state, {
      type: 'ACCUMULATE_MESSAGES',
      gameId: 'game-2',
      messages: [makeMessage('m2')],
    })
    const next = spectatorReducer(state, {
      type: 'CLEAR_LIVE_ACCUMULATOR',
      gameId: 'game-1',
    })
    expect(next.liveAccumulators.has('game-1')).toBe(false)
    expect(next.liveAccumulators.get('game-2')!.messages).toHaveLength(1)
  })
})

describe('ADD_SNAPSHOT clears live accumulator', () => {
  it('clears the accumulator for the game when a snapshot is added', () => {
    const gameId = 'game-1'
    // Set up state with a game and an accumulator
    const games = new Map([[gameId, {
      gameId,
      name: 'Test Game',
      status: 'active' as const,
      snapshots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }]])
    const state: SpectatorState = {
      ...stateWithAccumulator(gameId, [makeMessage('m1')]),
      games,
    }
    const snapshot = {
      id: '1901-SPRING-DIPLOMACY',
      year: 1901,
      season: 'SPRING' as const,
      phase: 'DIPLOMACY' as const,
      gameState: {
        phase: 'spring' as const,
        year: 1901,
        units: [],
        orders: [],
        supplyCenters: {},
      },
      orders: [],
      messages: [],
      timestamp: new Date(),
    }
    const next = spectatorReducer(state, {
      type: 'ADD_SNAPSHOT',
      gameId,
      snapshot,
    })
    expect(next.liveAccumulators.has(gameId)).toBe(false)
  })
})
