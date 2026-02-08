import { useState, useMemo, useEffect } from 'react'
import { DiplomacyMap } from './components/DiplomacyMap'
import { SpectatorProvider, useSpectator } from './spectator/SpectatorContext'
import { SpectatorDashboard } from './components/spectator/SpectatorDashboard'
import { SpectatorGameView } from './components/spectator/SpectatorGameView'
import type { GameState, Power } from './types/game'
import type { GameHistory, GameSnapshot } from './spectator/types'

const initialGameState: GameState = {
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
    { type: 'fleet', power: 'russia', territory: 'stp_sc' },
    { type: 'fleet', power: 'russia', territory: 'sev' },
    { type: 'army', power: 'russia', territory: 'mos' },
    { type: 'army', power: 'russia', territory: 'war' },
    // Turkey
    { type: 'fleet', power: 'turkey', territory: 'ank' },
    { type: 'army', power: 'turkey', territory: 'con' },
    { type: 'army', power: 'turkey', territory: 'smy' },
  ],
  orders: [
    // Sample Spring 1901 orders to demonstrate visualization
    { type: 'move', unit: 'lon', target: 'nth' },
    { type: 'move', unit: 'edi', target: 'nwg' },
    { type: 'move', unit: 'lvp', target: 'yor' },
    { type: 'move', unit: 'ber', target: 'kie' },
    { type: 'support', unit: 'mun', target: 'ber' },
    { type: 'hold', unit: 'vie' },
  ],
  supplyCenters: {
    lon: 'england', edi: 'england', lvp: 'england',
    bre: 'france', par: 'france', mar: 'france',
    kie: 'germany', ber: 'germany', mun: 'germany',
    nap: 'italy', rom: 'italy', ven: 'italy',
    tri: 'austria', vie: 'austria', bud: 'austria',
    stp: 'russia', sev: 'russia', mos: 'russia', war: 'russia',
    ank: 'turkey', con: 'turkey', smy: 'turkey',
  },
}

const powerColors: Record<Power, string> = {
  england: '#1e3a5f',
  france: '#5c8dc9',
  germany: '#4a4a4a',
  italy: '#2e7d32',
  austria: '#c62828',
  russia: '#7b1fa2',
  turkey: '#f9a825',
}

// Create sample game history for demo
function createSampleGames(): GameHistory[] {
  const now = new Date()

  // Sample snapshot
  const snapshot1: GameSnapshot = {
    id: '1901-SPRING-MOVEMENT',
    year: 1901,
    season: 'SPRING',
    phase: 'MOVEMENT',
    gameState: initialGameState,
    orders: initialGameState.orders,
    messages: [
      {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND',
        content: 'Shall we coordinate against Germany? I propose we work together on the North Sea.',
        timestamp: new Date(now.getTime() - 3600000),
        metadata: { intent: 'PROPOSAL' },
      },
      {
        id: 'msg2',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'Interesting proposal. What guarantee can you offer?',
        timestamp: new Date(now.getTime() - 3000000),
        metadata: { intent: 'REQUEST' },
      },
      {
        id: 'msg3',
        channelId: 'bilateral:GERMANY:RUSSIA',
        sender: 'GERMANY',
        content: 'Russia, I suggest we maintain peace in the east. Focus on other threats.',
        timestamp: new Date(now.getTime() - 2400000),
        metadata: { intent: 'PROPOSAL' },
      },
    ],
    timestamp: new Date(now.getTime() - 3600000),
  }

  // Second snapshot (Fall 1901)
  const fall1901State: GameState = {
    ...initialGameState,
    phase: 'fall',
    units: [
      // England moved
      { type: 'fleet', power: 'england', territory: 'nth' },
      { type: 'fleet', power: 'england', territory: 'nwg' },
      { type: 'army', power: 'england', territory: 'yor' },
      // France
      { type: 'fleet', power: 'france', territory: 'mao' },
      { type: 'army', power: 'france', territory: 'bur' },
      { type: 'army', power: 'france', territory: 'spa' },
      // Germany
      { type: 'fleet', power: 'germany', territory: 'den' },
      { type: 'army', power: 'germany', territory: 'kie' },
      { type: 'army', power: 'germany', territory: 'ruh' },
      // Italy
      { type: 'fleet', power: 'italy', territory: 'ion' },
      { type: 'army', power: 'italy', territory: 'apu' },
      { type: 'army', power: 'italy', territory: 'tyr' },
      // Austria
      { type: 'fleet', power: 'austria', territory: 'alb' },
      { type: 'army', power: 'austria', territory: 'ser' },
      { type: 'army', power: 'austria', territory: 'gal' },
      // Russia
      { type: 'fleet', power: 'russia', territory: 'bot' },
      { type: 'fleet', power: 'russia', territory: 'bla' },
      { type: 'army', power: 'russia', territory: 'ukr' },
      { type: 'army', power: 'russia', territory: 'sil' },
      // Turkey
      { type: 'fleet', power: 'turkey', territory: 'ank' },
      { type: 'army', power: 'turkey', territory: 'bul' },
      { type: 'army', power: 'turkey', territory: 'arm' },
    ],
  }

  const snapshot2: GameSnapshot = {
    id: '1901-FALL-MOVEMENT',
    year: 1901,
    season: 'FALL',
    phase: 'MOVEMENT',
    gameState: fall1901State,
    orders: [
      { type: 'move', unit: 'nth', target: 'nwy' },
      { type: 'support', unit: 'nwg', target: 'nth', supportTarget: 'nwy' },
    ],
    messages: [
      {
        id: 'msg4',
        channelId: 'bilateral:AUSTRIA:ITALY',
        sender: 'AUSTRIA',
        content: 'Italy, I notice your moves towards Tyrolia. This concerns me greatly.',
        timestamp: new Date(now.getTime() - 1800000),
        metadata: { intent: 'THREAT' },
      },
      {
        id: 'msg5',
        channelId: 'bilateral:AUSTRIA:ITALY',
        sender: 'ITALY',
        content: 'A defensive measure only, I assure you. Perhaps we can discuss terms?',
        timestamp: new Date(now.getTime() - 1200000),
        metadata: { intent: 'SMALL_TALK' },
      },
    ],
    timestamp: new Date(now.getTime() - 1800000),
  }

  const game1: GameHistory = {
    gameId: 'game-001',
    name: 'AI Championship Round 1',
    status: 'active',
    snapshots: [snapshot1, snapshot2],
    createdAt: new Date(now.getTime() - 86400000),
    updatedAt: now,
  }

  const game2: GameHistory = {
    gameId: 'game-002',
    name: 'Training Match Alpha',
    status: 'completed',
    snapshots: [snapshot1],
    winner: 'england',
    createdAt: new Date(now.getTime() - 172800000),
    updatedAt: new Date(now.getTime() - 86400000),
  }

  const game3: GameHistory = {
    gameId: 'game-003',
    name: 'Practice Game Beta',
    status: 'paused',
    snapshots: [snapshot1],
    createdAt: new Date(now.getTime() - 259200000),
    updatedAt: new Date(now.getTime() - 172800000),
  }

  return [game1, game2, game3]
}

type AppMode = 'player' | 'spectator'

function AppContent() {
  const [mode, setMode] = useState<AppMode>('spectator')
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null)
  const { activeGame, selectGame } = useSpectator()

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

  // Player mode (original view)
  if (mode === 'player') {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="bg-gray-800 px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">Agents of Treachery</h1>
          <div className="flex items-center gap-4 text-sm">
            <button
              onClick={() => setMode('spectator')}
              className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              Spectator Mode
            </button>
            <span className="text-gray-400">
              {initialGameState.phase.charAt(0).toUpperCase() + initialGameState.phase.slice(1)} {initialGameState.year}
            </span>
            <div className="flex gap-2">
              {(Object.keys(powerColors) as Power[]).map((power) => (
                <div
                  key={power}
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: powerColors[power] }}
                  title={power.charAt(0).toUpperCase() + power.slice(1)}
                />
              ))}
            </div>
          </div>
        </header>
        <main className="flex-1 relative">
          <DiplomacyMap
            gameState={initialGameState}
            selectedTerritory={selectedTerritory}
            onTerritorySelect={setSelectedTerritory}
          />
        </main>
        {selectedTerritory && (
          <footer className="bg-gray-800 px-4 py-2 text-sm">
            Selected: <span className="font-semibold">{selectedTerritory}</span>
          </footer>
        )}
      </div>
    )
  }

  // Check URL params for live mode
  const urlParams = new URLSearchParams(window.location.search)
  const enableLive = urlParams.get('live') === 'true'
  const serverUrl = urlParams.get('server') || 'ws://localhost:3001'

  // Spectator mode
  if (activeGame) {
    return (
      <SpectatorGameView
        onBack={() => selectGame(null)}
      />
    )
  }

  return (
    <div>
      {/* Mode toggle header */}
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        {!enableLive && (
          <a
            href="?live=true"
            className="px-3 py-1.5 text-sm rounded bg-green-700 hover:bg-green-600 transition-colors"
          >
            Enable Live
          </a>
        )}
        <button
          onClick={() => setMode('player')}
          className="px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 transition-colors"
        >
          Player Mode
        </button>
      </div>
      <SpectatorDashboard
        enableLiveConnection={enableLive}
        serverUrl={serverUrl}
      />
    </div>
  )
}

export default function App() {
  const sampleGames = useMemo(() => createSampleGames(), [])

  return (
    <SpectatorProvider initialGames={sampleGames}>
      <AppContent />
    </SpectatorProvider>
  )
}
