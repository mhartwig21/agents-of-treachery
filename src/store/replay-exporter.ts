/**
 * Game replay export for sharing.
 *
 * Exports completed games in a portable JSON format including all phases,
 * orders, messages, and agent reasoning. The format is designed to be
 * compatible with standard Diplomacy replay viewers.
 */

import type { Power, Season, Phase, Order, Unit } from '../engine/types';
import type { GameEvent } from './events';
import type { GameStore, MessageRecord } from './game-store';
import type { DiaryEntry, YearSummary } from '../agent/types';

/**
 * Format version for replay files. Increment on breaking changes.
 */
export const REPLAY_FORMAT_VERSION = 1;

/**
 * Metadata about the exported game.
 */
export interface ReplayMetadata {
  formatVersion: number;
  exportedAt: string;
  gameId: string;
  startYear: number;
  endYear: number;
  winner?: Power;
  isDraw: boolean;
  totalPhases: number;
  totalMessages: number;
  variant: 'standard';
}

/**
 * A single phase in the replay timeline.
 */
export interface ReplayPhase {
  year: number;
  season: Season;
  phase: Phase;
  orders: Record<string, ReplayOrder[]>;
  results?: ReplayOrderResult[];
  unitPositions: ReplayUnit[];
  supplyCenters: Record<string, Power>;
  dislodged?: ReplayDislodgedUnit[];
  builds?: ReplayBuild[];
  disbands?: ReplayDisband[];
}

/**
 * An order in replay format.
 */
export interface ReplayOrder {
  unit: string;
  type: Order['type'];
  destination?: string;
  destinationCoast?: string;
  supportedUnit?: string;
  supportDestination?: string;
  convoyedUnit?: string;
  viaConvoy?: boolean;
}

/**
 * Order adjudication result.
 */
export interface ReplayOrderResult {
  order: ReplayOrder;
  power: Power;
  success: boolean;
  reason?: string;
}

/**
 * A unit in the replay.
 */
export interface ReplayUnit {
  type: 'ARMY' | 'FLEET';
  power: Power;
  province: string;
  coast?: string;
}

/**
 * A dislodged unit with retreat options.
 */
export interface ReplayDislodgedUnit {
  unit: ReplayUnit;
  dislodgedFrom: string;
  retreatOptions: string[];
}

/**
 * A unit build.
 */
export interface ReplayBuild {
  power: Power;
  province: string;
  unitType: 'ARMY' | 'FLEET';
  coast?: string;
}

/**
 * A unit disband.
 */
export interface ReplayDisband {
  power: Power;
  province: string;
}

/**
 * A message in the replay.
 */
export interface ReplayMessage {
  id: string;
  sender: Power;
  channelId: string;
  content: string;
  year: number;
  season: Season;
  phase: Phase;
  timestamp: string;
}

/**
 * Agent summary data for the full game.
 */
export interface ReplayAgentSummary {
  power: Power;
  yearSummaries: Array<{
    year: number;
    summary: string;
    territorialChanges: string[];
    diplomaticChanges: string[];
  }>;
  fullDiary: Array<{
    phase: string;
    type: string;
    content: string;
  }>;
}

/**
 * The complete game replay structure.
 */
export interface GameReplay {
  metadata: ReplayMetadata;
  phases: ReplayPhase[];
  messages: ReplayMessage[];
  agentReasoning?: Record<string, ReplayAgentSummary>;
}

/**
 * Options for controlling what gets included in the export.
 */
export interface ExportOptions {
  /** Include diplomatic messages. Default: true */
  includeMessages?: boolean;
  /** Include agent reasoning (diary entries, summaries). Default: true */
  includeAgentReasoning?: boolean;
  /** Filter messages to only include specific powers. Default: all */
  messagePowerFilter?: Power[];
}

const DEFAULT_EXPORT_OPTIONS: Required<ExportOptions> = {
  includeMessages: true,
  includeAgentReasoning: true,
  messagePowerFilter: [],
};

/**
 * Convert an engine Order to a ReplayOrder.
 */
function orderToReplayOrder(order: Order): ReplayOrder {
  const base: ReplayOrder = { unit: order.unit, type: order.type };

  switch (order.type) {
    case 'MOVE':
      base.destination = order.destination;
      base.destinationCoast = order.destinationCoast;
      base.viaConvoy = order.viaConvoy;
      break;
    case 'SUPPORT':
      base.supportedUnit = order.supportedUnit;
      base.supportDestination = order.destination;
      break;
    case 'CONVOY':
      base.convoyedUnit = order.convoyedUnit;
      base.destination = order.destination;
      break;
  }

  return base;
}

/**
 * Convert a Unit to a ReplayUnit.
 */
function unitToReplayUnit(unit: Unit): ReplayUnit {
  const replay: ReplayUnit = {
    type: unit.type,
    power: unit.power,
    province: unit.province,
  };
  if (unit.coast) {
    replay.coast = unit.coast;
  }
  return replay;
}

/**
 * Convert supply centers Map to a plain Record.
 */
function supplyCentersToRecord(sc: Map<string, Power>): Record<string, Power> {
  const record: Record<string, Power> = {};
  sc.forEach((power, territory) => {
    record[territory] = power;
  });
  return record;
}

/**
 * Build replay phases from game events by replaying the event stream.
 *
 * Walks the event list and reconstructs phase-by-phase state snapshots.
 * Each phase captures unit positions, supply centers, orders, and results.
 */
function buildPhasesFromEvents(events: GameEvent[]): ReplayPhase[] {
  const phases: ReplayPhase[] = [];
  let units: Unit[] = [];
  let supplyCenters = new Map<string, Power>();
  let pendingOrders: Record<string, ReplayOrder[]> = {};
  let pendingResults: ReplayOrderResult[] = [];
  let pendingDislodged: ReplayDislodgedUnit[] = [];
  let pendingBuilds: ReplayBuild[] = [];
  let pendingDisbands: ReplayDisband[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'GAME_CREATED': {
        units = event.payload.initialUnits.map(u => ({ ...u }));
        supplyCenters = new Map<string, Power>();
        for (const [territory, power] of Object.entries(event.payload.supplyCenters)) {
          supplyCenters.set(territory, power);
        }
        break;
      }

      case 'ORDERS_SUBMITTED': {
        const power = event.payload.power;
        pendingOrders[power] = event.payload.orders.map(orderToReplayOrder);
        break;
      }

      case 'MOVEMENT_RESOLVED': {
        // Build results
        pendingResults = event.payload.results.map(r => ({
          order: orderToReplayOrder(r.order),
          power: findOrderPower(r.order, pendingOrders),
          success: r.success,
          reason: r.reason,
        }));

        // Capture dislodged
        pendingDislodged = event.payload.dislodged.map(d => ({
          unit: unitToReplayUnit(d.unit),
          dislodgedFrom: d.dislodgedFrom,
          retreatOptions: [...d.retreatOptions],
        }));

        // Emit a movement phase record
        phases.push({
          year: event.payload.year,
          season: event.payload.season,
          phase: 'MOVEMENT',
          orders: { ...pendingOrders },
          results: pendingResults.length > 0 ? pendingResults : undefined,
          unitPositions: units.map(unitToReplayUnit),
          supplyCenters: supplyCentersToRecord(supplyCenters),
          dislodged: pendingDislodged.length > 0 ? pendingDislodged : undefined,
        });

        // Apply moves to local tracking
        for (const move of event.payload.unitMoves) {
          const unit = units.find(u => u.province === move.from && u.power === move.power);
          if (unit) {
            unit.province = move.to;
            if (move.coast) {
              unit.coast = move.coast as Unit['coast'];
            } else {
              delete unit.coast;
            }
          }
        }

        // Remove dislodged
        const dislodgedProvinces = new Set(event.payload.dislodged.map(d => d.unit.province));
        units = units.filter(u => !dislodgedProvinces.has(u.province));

        pendingOrders = {};
        pendingResults = [];
        pendingDislodged = [];
        break;
      }

      case 'RETREATS_RESOLVED': {
        // Add retreated units back
        for (const result of event.payload.retreatResults) {
          if (result.success && result.destination) {
            units.push({ ...result.unit, province: result.destination });
          }
        }
        break;
      }

      case 'BUILDS_RESOLVED': {
        pendingBuilds = event.payload.unitsBuilt.map(b => ({
          power: b.power,
          province: b.province,
          unitType: b.unitType,
          coast: b.coast,
        }));

        pendingDisbands = event.payload.unitsDisbanded.map(d => ({
          power: d.power,
          province: d.province,
        }));

        // Apply builds
        for (const build of event.payload.unitsBuilt) {
          units.push({
            type: build.unitType,
            power: build.power,
            province: build.province,
            coast: build.coast as Unit['coast'],
          });
        }

        // Apply disbands
        for (const disband of event.payload.unitsDisbanded) {
          const idx = units.findIndex(u => u.province === disband.province && u.power === disband.power);
          if (idx >= 0) {
            units = [...units.slice(0, idx), ...units.slice(idx + 1)];
          }
        }

        // Emit build phase
        phases.push({
          year: event.payload.year,
          season: 'WINTER',
          phase: 'BUILD',
          orders: {},
          unitPositions: units.map(unitToReplayUnit),
          supplyCenters: supplyCentersToRecord(supplyCenters),
          builds: pendingBuilds.length > 0 ? pendingBuilds : undefined,
          disbands: pendingDisbands.length > 0 ? pendingDisbands : undefined,
        });

        pendingBuilds = [];
        pendingDisbands = [];
        break;
      }

      case 'SUPPLY_CENTERS_CAPTURED': {
        for (const change of event.payload.changes) {
          supplyCenters.set(change.territory, change.to);
        }
        break;
      }

      // PHASE_ADVANCED, GAME_ENDED, MESSAGE_SENT handled elsewhere
    }
  }

  return phases;
}

/**
 * Find which power submitted an order by checking pending orders.
 */
function findOrderPower(order: Order, pendingOrders: Record<string, ReplayOrder[]>): Power {
  for (const [power, orders] of Object.entries(pendingOrders)) {
    if (orders.some(o => o.unit === order.unit)) {
      return power as Power;
    }
  }
  return 'ENGLAND'; // fallback
}

/**
 * Convert MessageRecords to ReplayMessages.
 */
function convertMessages(
  messages: readonly MessageRecord[],
  powerFilter: Power[]
): ReplayMessage[] {
  let filtered = [...messages];
  if (powerFilter.length > 0) {
    filtered = filtered.filter(m => powerFilter.includes(m.sender));
  }

  return filtered.map(m => ({
    id: m.id,
    sender: m.sender,
    channelId: m.channelId,
    content: m.content,
    year: m.year,
    season: m.season,
    phase: m.phase,
    timestamp: m.timestamp.toISOString(),
  }));
}

/**
 * Build agent reasoning data from diary entries and year summaries.
 */
function buildAgentReasoning(
  agentData: Map<Power, { diary: DiaryEntry[]; yearSummaries: YearSummary[] }>
): Record<string, ReplayAgentSummary> {
  const reasoning: Record<string, ReplayAgentSummary> = {};

  for (const [power, data] of agentData) {
    reasoning[power] = {
      power,
      yearSummaries: data.yearSummaries.map(s => ({
        year: s.year,
        summary: s.summary,
        territorialChanges: s.territorialChanges,
        diplomaticChanges: s.diplomaticChanges,
      })),
      fullDiary: data.diary.map(e => ({
        phase: e.phase,
        type: e.type,
        content: e.content,
      })),
    };
  }

  return reasoning;
}

/**
 * Extract end-of-game metadata from events.
 */
function extractGameEndInfo(events: GameEvent[]): {
  winner?: Power;
  isDraw: boolean;
  endYear: number;
} {
  const endEvent = events.find(e => e.type === 'GAME_ENDED');
  if (endEvent && endEvent.type === 'GAME_ENDED') {
    return {
      winner: endEvent.payload.winner,
      isDraw: endEvent.payload.draw,
      endYear: endEvent.payload.finalYear,
    };
  }
  // Game may not have ended - find the latest year from phase advances
  let maxYear = 1901;
  for (const event of events) {
    if (event.type === 'PHASE_ADVANCED') {
      maxYear = Math.max(maxYear, event.payload.toYear);
    }
  }
  return { isDraw: false, endYear: maxYear };
}

/**
 * Export a completed game from a GameStore as a portable replay.
 *
 * @param store - The GameStore containing the game to export
 * @param options - Export options controlling what to include
 * @param agentData - Optional agent diary/reasoning data keyed by power
 * @returns A GameReplay object that can be serialized to JSON
 */
export function exportGameReplay(
  store: GameStore,
  options?: ExportOptions,
  agentData?: Map<Power, { diary: DiaryEntry[]; yearSummaries: YearSummary[] }>
): GameReplay {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const snapshot = store.getSnapshot();
  const events = snapshot.events;
  const messages = snapshot.messages;

  const { winner, isDraw, endYear } = extractGameEndInfo(events);
  const phases = buildPhasesFromEvents(events);

  const replay: GameReplay = {
    metadata: {
      formatVersion: REPLAY_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      gameId: snapshot.gameId,
      startYear: 1901,
      endYear,
      winner,
      isDraw,
      totalPhases: phases.length,
      totalMessages: messages.length,
      variant: 'standard',
    },
    phases,
    messages: opts.includeMessages
      ? convertMessages(messages, opts.messagePowerFilter)
      : [],
  };

  if (opts.includeAgentReasoning && agentData) {
    replay.agentReasoning = buildAgentReasoning(agentData);
  }

  return replay;
}

/**
 * Serialize a GameReplay to a JSON string.
 */
export function serializeReplay(replay: GameReplay): string {
  return JSON.stringify(replay, null, 2);
}

/**
 * Deserialize a JSON string to a GameReplay.
 * Validates the format version.
 *
 * @throws Error if the format version is unsupported
 */
export function deserializeReplay(json: string): GameReplay {
  const parsed = JSON.parse(json) as GameReplay;

  if (!parsed.metadata?.formatVersion) {
    throw new Error('Invalid replay format: missing metadata.formatVersion');
  }

  if (parsed.metadata.formatVersion > REPLAY_FORMAT_VERSION) {
    throw new Error(
      `Unsupported replay format version ${parsed.metadata.formatVersion}. ` +
      `Maximum supported: ${REPLAY_FORMAT_VERSION}`
    );
  }

  return parsed;
}
