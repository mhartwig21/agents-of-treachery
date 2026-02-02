import { useState } from 'react'
import { DiplomacyMap } from './components/DiplomacyMap'
import type { GameState, Power } from './types/game'

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

export default function App() {
  const [gameState] = useState<GameState>(initialGameState)
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Agents of Treachery</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-400">
            {gameState.phase.charAt(0).toUpperCase() + gameState.phase.slice(1)} {gameState.year}
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
          gameState={gameState}
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
