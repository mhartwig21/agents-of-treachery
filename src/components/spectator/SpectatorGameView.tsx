/**
 * SpectatorGameView - Full game viewing interface.
 *
 * Layout with DiplomacyMap, side panels, and bottom scrubber.
 */

import { useState } from 'react';
import { useSpectator } from '../../spectator/SpectatorContext';
import { type LowercasePower } from '../../spectator/types';
import { DiplomacyMap } from '../DiplomacyMap';
import { PowerStatsPanel } from './PowerStatsPanel';
import { OrdersPanel } from './OrdersPanel';
import { ChannelPanel } from './ChannelPanel';
import { PressTimeline } from './PressTimeline';
import { TurnScrubber } from './TurnScrubber';
import { LiveActivityPanel } from './LiveActivityPanel';
import { PhaseIndicator, PhaseBadge } from '../shared/PhaseIndicator';
import { CollapsiblePanel } from '../shared/CollapsiblePanel';

/** State for which sidebar panels are collapsed */
interface CollapsedPanels {
  liveActivity: boolean;
  powerStats: boolean;
  orders: boolean;
  press: boolean;
}

interface SpectatorGameViewProps {
  /** Callback to return to dashboard */
  onBack?: () => void;
}

export function SpectatorGameView({ onBack }: SpectatorGameViewProps) {
  const {
    state,
    activeGame,
    currentSnapshot,
    isLive,
    setGameViewTab,
  } = useSpectator();

  const [selectedPower, setSelectedPower] = useState<LowercasePower | undefined>();
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const [orderFilterPower, setOrderFilterPower] = useState<LowercasePower | undefined>();
  const [collapsedPanels, setCollapsedPanels] = useState<CollapsedPanels>({
    liveActivity: false,
    powerStats: false,
    orders: false,
    press: false,
  });

  // Compute supply center counts from current snapshot
  const supplyCenterCounts = { england: 0, france: 0, germany: 0, italy: 0, austria: 0, russia: 0, turkey: 0 } as Record<LowercasePower, number>;
  const unitCounts = { england: 0, france: 0, germany: 0, italy: 0, austria: 0, russia: 0, turkey: 0 } as Record<LowercasePower, number>;

  if (currentSnapshot) {
    for (const owner of Object.values(currentSnapshot.gameState.supplyCenters)) {
      if (owner) supplyCenterCounts[owner]++;
    }
    for (const unit of currentSnapshot.gameState.units) {
      unitCounts[unit.power]++;
    }
  }

  if (!activeGame || !currentSnapshot) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎯</div>
          <h2 className="text-xl font-semibold mb-2">No game selected</h2>
          <button
            onClick={onBack}
            className="text-blue-400 hover:underline"
          >
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }

  // Mobile layout uses tabs
  if (state.isMobile) {
    return (
      <MobileGameView
        activeGame={activeGame}
        currentSnapshot={currentSnapshot}
        supplyCenterCounts={supplyCenterCounts}
        unitCounts={unitCounts}
        isLive={isLive}
        selectedTerritory={selectedTerritory}
        setSelectedTerritory={setSelectedTerritory}
        gameViewTab={state.gameViewTab}
        setGameViewTab={setGameViewTab}
        onBack={onBack}
      />
    );
  }

  // Desktop layout
  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <div>
            <h1 className="font-semibold">{activeGame.name}</h1>
            <PhaseIndicator
              year={currentSnapshot.year}
              season={currentSnapshot.season}
              phase={currentSnapshot.phase}
              size="sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isLive ? (
            <span className="flex items-center gap-2 text-green-400 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="text-yellow-400 text-sm">Replay</span>
          )}
          <PhaseBadge phase={currentSnapshot.phase} />
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map area */}
        <div className="flex-1 relative">
          <DiplomacyMap
            gameState={currentSnapshot.gameState}
            selectedTerritory={selectedTerritory}
            onTerritorySelect={setSelectedTerritory}
            readOnly
            highlightedTerritories={selectedPower ? getTerritoriesForPower(currentSnapshot.gameState, selectedPower) : undefined}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-80 bg-gray-850 border-l border-gray-700 flex flex-col overflow-y-auto">
          {/* Live activity (only when live) */}
          {isLive && (
            <CollapsiblePanel
              title="Live Activity"
              collapsed={collapsedPanels.liveActivity}
              onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, liveActivity: v }))}
              className="border-b border-gray-700"
            >
              <LiveActivityPanel
                currentAgent={activeGame.currentAgent}
                latestMessages={activeGame.latestMessages}
                latestOrders={activeGame.latestOrders}
                isLive={isLive}
              />
            </CollapsiblePanel>
          )}

          {/* Power stats */}
          <CollapsiblePanel
            title="Power Statistics"
            collapsed={collapsedPanels.powerStats}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, powerStats: v }))}
            className="border-b border-gray-700"
          >
            <PowerStatsPanel
              supplyCenterCounts={supplyCenterCounts}
              unitCounts={unitCounts}
              selectedPower={selectedPower}
              onPowerClick={setSelectedPower}
            />
          </CollapsiblePanel>

          {/* Orders */}
          <CollapsiblePanel
            title="Orders"
            count={currentSnapshot.orders.length}
            collapsed={collapsedPanels.orders}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, orders: v }))}
            className="border-b border-gray-700"
          >
            <OrdersPanel
              orders={currentSnapshot.orders}
              units={currentSnapshot.gameState.units}
              filterPower={orderFilterPower}
              onFilterChange={setOrderFilterPower}
            />
          </CollapsiblePanel>

          {/* Press channels */}
          <CollapsiblePanel
            title="Press Channels"
            count={currentSnapshot.messages.length}
            collapsed={collapsedPanels.press}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, press: v }))}
            className="flex-1 min-h-0"
          >
            <ChannelPanel
              messages={currentSnapshot.messages}
              className="max-h-96"
            />
          </CollapsiblePanel>
        </div>
      </div>

      {/* Bottom turn scrubber */}
      <TurnScrubber className="border-t border-gray-700" />
    </div>
  );
}

/**
 * Mobile-optimized game view with tabs.
 */
interface MobileGameViewProps {
  activeGame: NonNullable<ReturnType<typeof useSpectator>['activeGame']>;
  currentSnapshot: NonNullable<ReturnType<typeof useSpectator>['currentSnapshot']>;
  supplyCenterCounts: Record<LowercasePower, number>;
  unitCounts: Record<LowercasePower, number>;
  isLive: boolean;
  selectedTerritory: string | null;
  setSelectedTerritory: (id: string | null) => void;
  gameViewTab: 'map' | 'orders' | 'press';
  setGameViewTab: (tab: 'map' | 'orders' | 'press') => void;
  onBack?: () => void;
}

function MobileGameView({
  activeGame,
  currentSnapshot,
  supplyCenterCounts,
  unitCounts,
  isLive,
  selectedTerritory,
  setSelectedTerritory,
  gameViewTab,
  setGameViewTab,
  onBack,
}: MobileGameViewProps) {
  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Compact header */}
      <header className="bg-gray-800 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="text-gray-400 flex-shrink-0">←</button>
          <span className="truncate font-medium">{activeGame.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
          <PhaseIndicator
            year={currentSnapshot.year}
            season={currentSnapshot.season}
            phase={currentSnapshot.phase}
            compact
            size="sm"
          />
        </div>
      </header>

      {/* Power stats bar */}
      <PowerStatsPanel
        supplyCenterCounts={supplyCenterCounts}
        unitCounts={unitCounts}
        compact
        className="border-b border-gray-700"
      />

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {gameViewTab === 'map' && (
          <DiplomacyMap
            gameState={currentSnapshot.gameState}
            selectedTerritory={selectedTerritory}
            onTerritorySelect={setSelectedTerritory}
            readOnly
          />
        )}
        {gameViewTab === 'orders' && (
          <div className="h-full overflow-auto p-4">
            <OrdersPanel
              orders={currentSnapshot.orders}
              units={currentSnapshot.gameState.units}
            />
          </div>
        )}
        {gameViewTab === 'press' && (
          <div className="h-full overflow-auto">
            <PressTimeline messages={currentSnapshot.messages} />
          </div>
        )}
      </div>

      {/* Compact scrubber */}
      <TurnScrubber compact className="border-t border-gray-700" />

      {/* Bottom tab bar */}
      <nav className="bg-gray-800 border-t border-gray-700 flex">
        {(['map', 'orders', 'press'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setGameViewTab(tab)}
            className={`
              flex-1 py-3 text-sm font-medium transition-colors
              ${gameViewTab === tab
                ? 'text-blue-400 border-t-2 border-blue-400 -mt-px'
                : 'text-gray-400'
              }
            `}
          >
            {tab === 'map' && 'Map'}
            {tab === 'orders' && 'Orders'}
            {tab === 'press' && 'Press'}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * Gets territories owned by or containing units of a power.
 */
function getTerritoriesForPower(
  gameState: { units: { power: LowercasePower; territory: string }[]; supplyCenters: Record<string, LowercasePower | undefined> },
  power: LowercasePower
): string[] {
  const territories = new Set<string>();

  // Add unit positions
  for (const unit of gameState.units) {
    if (unit.power === power) {
      territories.add(unit.territory.split('_')[0]); // Handle coastal variants
    }
  }

  // Add owned supply centers
  for (const [territory, owner] of Object.entries(gameState.supplyCenters)) {
    if (owner === power) {
      territories.add(territory);
    }
  }

  return Array.from(territories);
}
