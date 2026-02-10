/**
 * SpectatorGameView - Full game viewing interface.
 *
 * Layout with DiplomacyMap, side panels, and bottom scrubber.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useSpectator } from '../../spectator/SpectatorContext';
import { type LowercasePower, type GameSnapshot } from '../../spectator/types';
import type { Message } from '../../press/types';
import type { Order as UIOrder } from '../../types/game';
import { DiplomacyMap } from '../DiplomacyMap';
import { PowerStatsPanel } from './PowerStatsPanel';
import { OrdersPanel } from './OrdersPanel';
import { ChannelPanel } from './ChannelPanel';
import { PressTimeline } from './PressTimeline';
import { PressMessageModal } from './PressMessageModal';
import { TurnScrubber } from './TurnScrubber';
import { TurnResolutionPlayer } from './TurnResolutionPlayer';
import { LiveActivityPanel } from './LiveActivityPanel';
import { SupplyCenterBalanceChart } from './SupplyCenterBalanceChart';
import { RelationshipGraphPanel } from './RelationshipGraphPanel';
import { PhaseIndicator, PhaseBadge } from '../shared/PhaseIndicator';
import { CollapsiblePanel } from '../shared/CollapsiblePanel';
import { GameEventOverlay } from './GameEventOverlay';
import { useGameSounds } from '../../audio';
import { useResolutionAnimation } from '../../hooks/useResolutionAnimation';
import { synthesizeResolutionEvent } from '../../spectator/synthesizeResolutionEvent';

/** State for which sidebar panels are collapsed */
interface CollapsedPanels {
  liveActivity: boolean;
  powerStats: boolean;
  scBalance: boolean;
  orders: boolean;
  press: boolean;
  relationships: boolean;
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
    liveAccumulator,
    setGameViewTab,
  } = useSpectator();

  const [selectedPower, setSelectedPower] = useState<LowercasePower | undefined>();
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const [orderFilterPower, setOrderFilterPower] = useState<LowercasePower | undefined>();
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [collapsedPanels, setCollapsedPanels] = useState<CollapsedPanels>({
    liveActivity: false,
    powerStats: false,
    scBalance: false,
    orders: false,
    press: false,
    relationships: false,
  });
  const [animationSpeed, setAnimationSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);

  // Track previous snapshot for resolution detection
  const prevSnapshotRef = useRef<GameSnapshot | null>(null);
  const prevSnapshotIdRef = useRef<string | null>(null);

  // Get the previous snapshot for resolution synthesis
  const previousSnapshot = useMemo(() => {
    if (!activeGame || state.replayPosition === null || state.replayPosition === 0) {
      return null;
    }
    return activeGame.snapshots[state.replayPosition - 1] ?? null;
  }, [activeGame, state.replayPosition]);

  // Synthesize resolution event when viewing a resolved turn
  const resolutionEvent = useMemo(() => {
    if (!currentSnapshot) return null;
    return synthesizeResolutionEvent(currentSnapshot, previousSnapshot);
  }, [currentSnapshot, previousSnapshot]);

  // Resolution animation hook
  const [animationState, animationControls] = useResolutionAnimation(resolutionEvent, {
    speed: animationSpeed,
  });

  // Track animation playing state
  useEffect(() => {
    const playing = animationState.phase !== 'idle' && animationState.phase !== 'complete';
    setIsAnimationPlaying(playing);
  }, [animationState.phase]);

  // Wrap controls to track speed changes
  const wrappedControls = useMemo(() => ({
    ...animationControls,
    setSpeed: (speed: 'slow' | 'normal' | 'fast') => {
      setAnimationSpeed(speed);
      animationControls.setSpeed(speed);
    },
  }), [animationControls]);

  // Update previous snapshot ref when snapshot changes
  useEffect(() => {
    if (currentSnapshot?.id !== prevSnapshotIdRef.current) {
      prevSnapshotRef.current = currentSnapshot;
      prevSnapshotIdRef.current = currentSnapshot?.id ?? null;
    }
  }, [currentSnapshot]);

  // Game sounds for audio feedback on events
  const { lastEvents } = useGameSounds(currentSnapshot);

  // Determine if animation mode should be active
  const isAnimationActive = animationState.phase !== 'idle' && animationState.phase !== 'complete';

  // Live Data Accumulator: Merge snapshot data with streaming data when live
  // This shows messages/orders as they arrive, before phase resolution
  const accumulatedMessages = useMemo(() => {
    if (!currentSnapshot) return [];
    const snapshotMessages = currentSnapshot.messages;

    // In replay mode, just use snapshot data
    if (!isLive || !liveAccumulator?.messages.length) {
      return snapshotMessages;
    }

    // In live mode, merge snapshot messages with live accumulator messages
    // Use a Set to dedupe by message ID
    const messageIds = new Set(snapshotMessages.map((m: Message) => m.id));
    const merged = [...snapshotMessages];

    for (const msg of liveAccumulator.messages) {
      if (!messageIds.has(msg.id)) {
        merged.push(msg);
        messageIds.add(msg.id);
      }
    }

    // Sort by timestamp
    return merged.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [currentSnapshot, isLive, liveAccumulator?.messages]);

  // Accumulate orders: merge snapshot orders with live streaming orders
  const accumulatedOrders = useMemo(() => {
    if (!currentSnapshot) return [];
    const snapshotOrders = currentSnapshot.orders;

    // In replay mode, just use snapshot data
    if (!isLive || !liveAccumulator || !Object.keys(liveAccumulator.orders).length) {
      return snapshotOrders;
    }

    // In live mode, merge snapshot orders with live accumulator orders
    // orders is Record<power, Order[]> - flatten and dedupe by unit
    const ordersByUnit = new Map<string, typeof snapshotOrders[0]>();

    // Add snapshot orders first
    for (const order of snapshotOrders) {
      ordersByUnit.set(order.unit, order);
    }

    // Override with live accumulator orders (more recent)
    for (const orders of Object.values(liveAccumulator.orders)) {
      for (const order of orders) {
        ordersByUnit.set(order.unit, order);
      }
    }

    return Array.from(ordersByUnit.values());
  }, [currentSnapshot, isLive, liveAccumulator]);

  // Find selected message from accumulated messages (includes live data)
  const selectedMessage = useMemo(() => {
    if (!selectedMessageId) return null;
    return accumulatedMessages.find((m: Message) => m.id === selectedMessageId) || null;
  }, [selectedMessageId, accumulatedMessages]);

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
        selectedMessageId={selectedMessageId}
        setSelectedMessageId={setSelectedMessageId}
        accumulatedMessages={accumulatedMessages}
        accumulatedOrders={accumulatedOrders}
        lastEvents={lastEvents}
        animationState={animationState}
        animationControls={wrappedControls}
        animationSpeed={animationSpeed}
        isAnimationPlaying={isAnimationPlaying}
        hasResolutionEvent={!!resolutionEvent}
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
            aria-label="Back to dashboard"
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
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-finite" />
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
            animationMode={isAnimationActive}
            animationState={animationState}
            orders={accumulatedOrders}
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
                latestMessages={liveAccumulator?.messages}
                latestOrders={liveAccumulator?.orders}
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

{/* Supply Center Balance Chart */}
          <CollapsiblePanel
            title="SC Balance"
            collapsed={collapsedPanels.scBalance}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, scBalance: v }))}
            className="border-b border-gray-700"
          >
            <SupplyCenterBalanceChart height={180} />
          </CollapsiblePanel>

          {/* Relationships */}
          <CollapsiblePanel
            title="Relationships"
            collapsed={collapsedPanels.relationships}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, relationships: v }))}
            className="border-b border-gray-700"
          >
            <RelationshipGraphPanel
              messages={accumulatedMessages}
              selectedPower={selectedPower}
              onPowerClick={setSelectedPower}
            />
          </CollapsiblePanel>

          {/* Orders */}
          <CollapsiblePanel
            title="Orders"
            count={accumulatedOrders.length}
            collapsed={collapsedPanels.orders}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, orders: v }))}
            className="border-b border-gray-700"
          >
            <OrdersPanel
              orders={accumulatedOrders}
              units={currentSnapshot.gameState.units}
              filterPower={orderFilterPower}
              onFilterChange={setOrderFilterPower}
            />
          </CollapsiblePanel>

          {/* Press channels */}
          <CollapsiblePanel
            title="Press Channels"
            count={accumulatedMessages.length}
            collapsed={collapsedPanels.press}
            onCollapsedChange={(v) => setCollapsedPanels((p) => ({ ...p, press: v }))}
            className="flex-1 min-h-0"
          >
            <ChannelPanel
              messages={accumulatedMessages}
              selectedChannelId={selectedChannelId ?? undefined}
              onChannelSelect={setSelectedChannelId}
              selectedMessageId={selectedMessageId ?? undefined}
              onMessageSelect={setSelectedMessageId}
              className="max-h-96"
            />
          </CollapsiblePanel>
        </div>
      </div>

      {/* Bottom turn scrubber */}
      <TurnScrubber className="border-t border-gray-700" />

      {/* Turn resolution player - shows when viewing a resolved turn */}
      {resolutionEvent && (
        <TurnResolutionPlayer
          state={animationState}
          controls={wrappedControls}
          speed={animationSpeed}
          isPlaying={isAnimationPlaying}
          className="border-t border-gray-700"
        />
      )}

      {/* Press message modal */}
      {selectedMessage && (
        <PressMessageModal
          message={selectedMessage}
          allMessages={accumulatedMessages}
          onClose={() => setSelectedMessageId(null)}
          onNavigate={setSelectedMessageId}
        />
      )}

      {/* Game event overlay for dramatic moments */}
      <GameEventOverlay events={lastEvents} />
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
  gameViewTab: 'map' | 'orders' | 'press' | 'relationships';
  setGameViewTab: (tab: 'map' | 'orders' | 'press' | 'relationships') => void;
  onBack?: () => void;
  selectedMessageId: string | null;
  setSelectedMessageId: (id: string | null) => void;
  /** Accumulated messages (snapshot + live) */
  accumulatedMessages: Message[];
  /** Accumulated orders (snapshot + live) */
  accumulatedOrders: UIOrder[];
  /** Last detected game events for sound/visual effects */
  lastEvents: import('../../audio').DetectedGameEvent[];
  /** Resolution animation state */
  animationState: import('../../hooks/useResolutionAnimation').ResolutionAnimationState;
  /** Resolution animation controls */
  animationControls: import('../../hooks/useResolutionAnimation').ResolutionAnimationControls;
  /** Current animation speed */
  animationSpeed: 'slow' | 'normal' | 'fast';
  /** Whether animation is currently playing */
  isAnimationPlaying: boolean;
  /** Whether there's a resolution event to animate */
  hasResolutionEvent: boolean;
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
  selectedMessageId,
  setSelectedMessageId,
  accumulatedMessages,
  accumulatedOrders,
  lastEvents,
  animationState,
  animationControls,
  animationSpeed,
  isAnimationPlaying,
  hasResolutionEvent,
}: MobileGameViewProps) {
  // Determine if animation mode is active
  const isAnimationActive = animationState.phase !== 'idle' && animationState.phase !== 'complete';
  // Find selected message from accumulated messages (includes live data)
  const selectedMessage = useMemo(() => {
    if (!selectedMessageId) return null;
    return accumulatedMessages.find((m: Message) => m.id === selectedMessageId) || null;
  }, [selectedMessageId, accumulatedMessages]);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Compact header */}
      <header className="bg-gray-800 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="text-gray-400 flex-shrink-0" aria-label="Back to dashboard">←</button>
          <span className="truncate font-medium">{activeGame.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-finite" />
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
      <div className="flex-1 overflow-hidden relative">
        {gameViewTab === 'map' && (
          <DiplomacyMap
            gameState={currentSnapshot.gameState}
            selectedTerritory={selectedTerritory}
            onTerritorySelect={setSelectedTerritory}
            readOnly
            animationMode={isAnimationActive}
            animationState={animationState}
            orders={accumulatedOrders}
          />
        )}
        {gameViewTab === 'orders' && (
          <div className="h-full overflow-auto p-4">
            <OrdersPanel
              orders={accumulatedOrders}
              units={currentSnapshot.gameState.units}
            />
          </div>
        )}
        {gameViewTab === 'press' && (
          <div className="h-full overflow-auto">
            <PressTimeline
              messages={accumulatedMessages}
              onMessageSelect={(msg) => setSelectedMessageId(msg.id)}
            />
          </div>
        )}
        {gameViewTab === 'relationships' && (
          <div className="h-full overflow-auto p-4">
            <RelationshipGraphPanel
              messages={accumulatedMessages}
            />
          </div>
        )}
      </div>

      {/* Compact scrubber */}
      <TurnScrubber compact className="border-t border-gray-700" />

      {/* Press message modal */}
      {selectedMessage && (
        <PressMessageModal
          message={selectedMessage}
          allMessages={accumulatedMessages}
          onClose={() => setSelectedMessageId(null)}
          onNavigate={setSelectedMessageId}
        />
      )}

      {/* Compact resolution player - shows when viewing a resolved turn on map tab */}
      {hasResolutionEvent && gameViewTab === 'map' && (
        <TurnResolutionPlayer
          state={animationState}
          controls={animationControls}
          speed={animationSpeed}
          isPlaying={isAnimationPlaying}
          compact
          className="border-t border-gray-700"
        />
      )}

      {/* Bottom tab bar */}
      <nav className="bg-gray-800 border-t border-gray-700 flex relative z-10" role="tablist" aria-label="Game view tabs">
        {(['map', 'orders', 'press', 'relationships'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setGameViewTab(tab)}
            role="tab"
            aria-selected={gameViewTab === tab}
            aria-label={tab === 'map' ? 'Map' : tab === 'orders' ? 'Orders' : tab === 'press' ? 'Press' : 'Graph'}
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
            {tab === 'relationships' && 'Graph'}
          </button>
        ))}
      </nav>

      {/* Game event overlay for dramatic moments */}
      <GameEventOverlay events={lastEvents} />
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
