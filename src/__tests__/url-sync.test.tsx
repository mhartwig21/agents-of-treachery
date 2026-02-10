import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { SpectatorProvider, useSpectator } from '../spectator/SpectatorContext'
import { useEffect } from 'react'
import type { GameHistory } from '../spectator/types'

// Mock heavy child components to isolate URL sync logic
vi.mock('../components/DiplomacyMap', () => ({
  DiplomacyMap: () => <div data-testid="diplomacy-map" />,
}))
vi.mock('../components/spectator/SpectatorDashboard', () => ({
  SpectatorDashboard: () => <div data-testid="spectator-dashboard" />,
}))
vi.mock('../components/spectator/SpectatorGameView', () => ({
  SpectatorGameView: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="spectator-game-view">
      <button data-testid="back-button" onClick={onBack}>Back</button>
    </div>
  ),
}))

/**
 * Minimal reproduction of the three URL sync effects from AppContent (lines 220-254).
 * We isolate these effects so tests don't depend on the full App render tree.
 */
function URLSyncTestHarness({ onState }: { onState?: (s: { activeGameId: string | null }) => void }) {
  const { activeGame, selectGame, state } = useSpectator()

  // B19: Restore game selection from URL on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gameId = params.get('game')
    if (gameId && !activeGame) {
      selectGame(gameId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // B15 + B19: Sync URL and history state with game selection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const currentUrlGame = params.get('game')

    if (activeGame) {
      if (currentUrlGame !== activeGame.gameId) {
        params.set('game', activeGame.gameId)
        window.history.pushState({ gameId: activeGame.gameId }, '', `?${params.toString()}`)
      }
    } else if (currentUrlGame) {
      params.delete('game')
      const search = params.toString()
      window.history.pushState({}, '', search ? `?${search}` : window.location.pathname)
    }
  }, [activeGame])

  // B15: Handle browser back/forward button
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const gameId = event.state?.gameId ?? null
      selectGame(gameId)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [selectGame])

  // Report state to test via callback
  useEffect(() => {
    onState?.({ activeGameId: state.activeGameId })
  })

  return (
    <div data-testid="harness">
      {activeGame ? (
        <div data-testid="game-active">{activeGame.gameId}</div>
      ) : (
        <div data-testid="no-game">No game selected</div>
      )}
    </div>
  )
}

function makeGame(id: string): GameHistory {
  return {
    gameId: id,
    name: `Game ${id}`,
    status: 'active',
    snapshots: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function renderWithProvider(
  ui: React.ReactElement,
  { games = [] as GameHistory[] } = {}
) {
  return render(
    <SpectatorProvider initialGames={games}>
      {ui}
    </SpectatorProvider>
  )
}

describe('URL sync and browser history navigation (B15/B19)', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>
  const originalLocation = window.location.href

  beforeEach(() => {
    pushStateSpy = vi.spyOn(window.history, 'pushState')
    // Reset URL to clean state
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    pushStateSpy.mockRestore()
    // Restore URL
    window.history.replaceState({}, '', originalLocation)
  })

  describe('B19: initial URL restore on load', () => {
    it('selects game when URL contains valid game ID', async () => {
      window.history.replaceState({}, '', '/?game=game-1')

      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      await act(async () => {
        renderWithProvider(
          <URLSyncTestHarness onState={onState} />,
          { games: [makeGame('game-1'), makeGame('game-2')] }
        )
      })

      // The last reported state should have game-1 selected
      const lastState = states[states.length - 1]
      expect(lastState.activeGameId).toBe('game-1')
    })

    it('does not select game when URL has no game param', async () => {
      window.history.replaceState({}, '', '/')

      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      await act(async () => {
        renderWithProvider(
          <URLSyncTestHarness onState={onState} />,
          { games: [makeGame('game-1')] }
        )
      })

      const lastState = states[states.length - 1]
      expect(lastState.activeGameId).toBeNull()
    })

    it('handles nonexistent game ID gracefully', async () => {
      window.history.replaceState({}, '', '/?game=nonexistent')

      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      await act(async () => {
        renderWithProvider(
          <URLSyncTestHarness onState={onState} />,
          { games: [makeGame('game-1')] }
        )
      })

      // selectGame is called with the nonexistent ID, but activeGame (the resolved
      // GameHistory object) remains null since the game doesn't exist in the store.
      // The component still renders without crashing.
      const lastState = states[states.length - 1]
      expect(lastState.activeGameId).toBe('nonexistent')
    })
  })

  describe('B15 + B19: URL sync on game change', () => {
    it('pushes URL with game ID when game is selected', async () => {
      window.history.replaceState({}, '', '/')

      // Use a component that lets us trigger game selection
      function SelectTrigger() {
        const { selectGame } = useSpectator()
        return (
          <button data-testid="select" onClick={() => selectGame('game-1')}>
            Select
          </button>
        )
      }

      const { getByTestId } = render(
        <SpectatorProvider initialGames={[makeGame('game-1')]}>
          <URLSyncTestHarness />
          <SelectTrigger />
        </SpectatorProvider>
      )

      pushStateSpy.mockClear()

      await act(async () => {
        getByTestId('select').click()
      })

      expect(pushStateSpy).toHaveBeenCalledWith(
        { gameId: 'game-1' },
        '',
        '?game=game-1'
      )
    })

    it('removes game param from URL when game is deselected', async () => {
      window.history.replaceState({}, '', '/?game=game-1')

      function DeselectTrigger() {
        const { selectGame } = useSpectator()
        return (
          <>
            <button data-testid="select" onClick={() => selectGame('game-1')}>
              Select
            </button>
            <button data-testid="deselect" onClick={() => selectGame(null)}>
              Deselect
            </button>
          </>
        )
      }

      const { getByTestId } = render(
        <SpectatorProvider initialGames={[makeGame('game-1')]}>
          <URLSyncTestHarness />
          <DeselectTrigger />
        </SpectatorProvider>
      )

      // First select the game (URL already has ?game=game-1)
      await act(async () => {
        getByTestId('select').click()
      })

      pushStateSpy.mockClear()

      // Now deselect — activeGame becomes null, but URL still has ?game=game-1
      // The effect should remove the game param
      await act(async () => {
        getByTestId('deselect').click()
      })

      // Should have called pushState to remove the game param
      expect(pushStateSpy).toHaveBeenCalledWith(
        {},
        '',
        '/'
      )
    })
  })

  describe('B15: browser back/forward navigation', () => {
    it('deselects game on popstate with no gameId in state', async () => {
      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      function SelectTrigger() {
        const { selectGame } = useSpectator()
        return (
          <button data-testid="select" onClick={() => selectGame('game-1')}>
            Select
          </button>
        )
      }

      const { getByTestId } = render(
        <SpectatorProvider initialGames={[makeGame('game-1')]}>
          <URLSyncTestHarness onState={onState} />
          <SelectTrigger />
        </SpectatorProvider>
      )

      // Select a game first
      await act(async () => {
        getByTestId('select').click()
      })

      expect(states[states.length - 1].activeGameId).toBe('game-1')

      // Simulate browser back button (popstate with no gameId)
      await act(async () => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
      })

      expect(states[states.length - 1].activeGameId).toBeNull()
    })

    it('selects game on popstate with gameId in state', async () => {
      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      render(
        <SpectatorProvider initialGames={[makeGame('game-1')]}>
          <URLSyncTestHarness onState={onState} />
        </SpectatorProvider>
      )

      expect(states[states.length - 1].activeGameId).toBeNull()

      // Simulate forward navigation to a game
      await act(async () => {
        window.dispatchEvent(
          new PopStateEvent('popstate', { state: { gameId: 'game-1' } })
        )
      })

      expect(states[states.length - 1].activeGameId).toBe('game-1')
    })

    it('deselects game on popstate with null state', async () => {
      const states: Array<{ activeGameId: string | null }> = []
      const onState = (s: { activeGameId: string | null }) => states.push(s)

      function SelectTrigger() {
        const { selectGame } = useSpectator()
        return (
          <button data-testid="select" onClick={() => selectGame('game-1')}>
            Select
          </button>
        )
      }

      const { getByTestId } = render(
        <SpectatorProvider initialGames={[makeGame('game-1')]}>
          <URLSyncTestHarness onState={onState} />
          <SelectTrigger />
        </SpectatorProvider>
      )

      // Select a game
      await act(async () => {
        getByTestId('select').click()
      })

      expect(states[states.length - 1].activeGameId).toBe('game-1')

      // Simulate back button with null state (e.g. initial history entry)
      await act(async () => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
      })

      expect(states[states.length - 1].activeGameId).toBeNull()
    })
  })
})
