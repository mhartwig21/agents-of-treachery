/**
 * Types for real-time AI commentary system.
 *
 * Provides interfaces for generating and displaying live commentary
 * as a Diplomacy game unfolds.
 */

import type { Power, Season, Phase } from '../engine/types';

/**
 * A single commentary entry generated for spectators.
 */
export interface CommentaryEntry {
  /** Unique identifier */
  id: string;
  /** Commentary text */
  text: string;
  /** When this commentary was generated */
  timestamp: Date;
  /** Game context when commentary was generated */
  context: {
    year: number;
    season: Season;
    phase: Phase;
  };
  /** Type of event that triggered this commentary */
  trigger: CommentaryTrigger;
  /** Intensity level for dramatic effect */
  intensity: 'low' | 'medium' | 'high' | 'critical';
  /** Powers mentioned in this commentary */
  mentionedPowers: Power[];
  /** Territories referenced */
  mentionedTerritories: string[];
  /** Optional voice synthesis key for caching */
  voiceKey?: string;
  /** Estimated duration for voice playback (ms) */
  voiceDuration?: number;
}

/**
 * Events that can trigger commentary generation.
 */
export type CommentaryTrigger =
  | 'phase_start'
  | 'orders_submitted'
  | 'movement_resolved'
  | 'retreat_resolved'
  | 'build_resolved'
  | 'supply_center_captured'
  | 'alliance_detected'
  | 'betrayal_detected'
  | 'elimination'
  | 'near_victory'
  | 'game_ended'
  | 'dramatic_moment'
  | 'agent_thinking';

/**
 * Configuration for commentary generation.
 */
export interface CommentaryConfig {
  /** Whether commentary is enabled */
  enabled: boolean;
  /** Voice synthesis enabled */
  voiceEnabled: boolean;
  /** Commentary style/persona */
  style: CommentaryStyle;
  /** Minimum intensity to trigger commentary */
  minIntensity: 'low' | 'medium' | 'high';
  /** Speed of voice playback (0.5 to 2.0) */
  voiceSpeed: number;
  /** Voice pitch adjustment (-1 to 1) */
  voicePitch: number;
  /** Whether to queue commentary or interrupt */
  queueMode: 'queue' | 'interrupt' | 'skip';
  /** Maximum commentary items to keep in history */
  historyLimit: number;
}

/**
 * Commentary style/persona options.
 */
export type CommentaryStyle =
  | 'neutral'      // Objective, informative
  | 'dramatic'     // Emphasizes tension and betrayals
  | 'analytical'   // Strategic insights
  | 'sportscaster' // Energetic play-by-play
  | 'historian';   // Long-term perspective

/**
 * Default commentary configuration.
 */
export const DEFAULT_COMMENTARY_CONFIG: CommentaryConfig = {
  enabled: true,
  voiceEnabled: false,
  style: 'dramatic',
  minIntensity: 'low',
  voiceSpeed: 1.0,
  voicePitch: 0,
  queueMode: 'queue',
  historyLimit: 50,
};

/**
 * Context provided to the LLM for generating commentary.
 */
export interface CommentaryGenerationContext {
  /** Current game state summary */
  gameState: {
    year: number;
    season: Season;
    phase: Phase;
    supplyCenterCounts: Record<Power, number>;
    unitCounts: Record<Power, number>;
    eliminatedPowers: Power[];
  };
  /** The event that triggered this commentary */
  trigger: CommentaryTrigger;
  /** Event-specific details */
  eventDetails: EventDetails;
  /** Recent game history (last few turns) */
  recentHistory?: string;
  /** Known alliances and relationships */
  relationships?: string;
  /** Commentary style to use */
  style: CommentaryStyle;
}

/**
 * Event-specific details for commentary generation.
 */
export type EventDetails =
  | { type: 'phase_start'; newPhase: Phase; newSeason: Season; newYear: number }
  | { type: 'orders_submitted'; power: Power; orderCount: number }
  | { type: 'movement_resolved'; successes: number; failures: number; dislodged: Array<{ power: Power; from: string }> }
  | { type: 'retreat_resolved'; retreats: Array<{ power: Power; from: string; to: string | null }> }
  | { type: 'build_resolved'; builds: Array<{ power: Power; province: string }>; disbands: Array<{ power: Power; province: string }> }
  | { type: 'supply_center_captured'; changes: Array<{ territory: string; from: Power | null; to: Power }> }
  | { type: 'betrayal_detected'; betrayer: Power; victim: Power; evidence: string }
  | { type: 'elimination'; power: Power; eliminatedBy?: Power }
  | { type: 'near_victory'; leader: Power; supplyCenters: number }
  | { type: 'game_ended'; winner?: Power; isDraw: boolean }
  | { type: 'agent_thinking'; power: Power }
  | { type: 'dramatic_moment'; description: string };

/**
 * State of the commentary system.
 */
export interface CommentaryState {
  /** Commentary history (most recent last) */
  entries: CommentaryEntry[];
  /** Currently playing/speaking entry */
  currentEntry: CommentaryEntry | null;
  /** Queue of entries waiting to be spoken */
  queue: CommentaryEntry[];
  /** Whether voice is currently speaking */
  isSpeaking: boolean;
  /** Configuration */
  config: CommentaryConfig;
  /** Whether the system is actively generating */
  isGenerating: boolean;
}

/**
 * Initial commentary state.
 */
export const initialCommentaryState: CommentaryState = {
  entries: [],
  currentEntry: null,
  queue: [],
  isSpeaking: false,
  config: DEFAULT_COMMENTARY_CONFIG,
  isGenerating: false,
};

/**
 * Actions for the commentary reducer.
 */
export type CommentaryAction =
  | { type: 'ADD_ENTRY'; entry: CommentaryEntry }
  | { type: 'SET_CURRENT'; entry: CommentaryEntry | null }
  | { type: 'QUEUE_ENTRY'; entry: CommentaryEntry }
  | { type: 'DEQUEUE_ENTRY' }
  | { type: 'SET_SPEAKING'; isSpeaking: boolean }
  | { type: 'SET_GENERATING'; isGenerating: boolean }
  | { type: 'UPDATE_CONFIG'; config: Partial<CommentaryConfig> }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'CLEAR_QUEUE' };

/**
 * Reducer for commentary state.
 */
export function commentaryReducer(
  state: CommentaryState,
  action: CommentaryAction
): CommentaryState {
  switch (action.type) {
    case 'ADD_ENTRY': {
      const entries = [...state.entries, action.entry];
      // Trim to history limit
      if (entries.length > state.config.historyLimit) {
        entries.splice(0, entries.length - state.config.historyLimit);
      }
      return { ...state, entries };
    }

    case 'SET_CURRENT':
      return { ...state, currentEntry: action.entry };

    case 'QUEUE_ENTRY':
      return { ...state, queue: [...state.queue, action.entry] };

    case 'DEQUEUE_ENTRY':
      return { ...state, queue: state.queue.slice(1) };

    case 'SET_SPEAKING':
      return { ...state, isSpeaking: action.isSpeaking };

    case 'SET_GENERATING':
      return { ...state, isGenerating: action.isGenerating };

    case 'UPDATE_CONFIG':
      return { ...state, config: { ...state.config, ...action.config } };

    case 'CLEAR_HISTORY':
      return { ...state, entries: [] };

    case 'CLEAR_QUEUE':
      return { ...state, queue: [], currentEntry: null };

    default:
      return state;
  }
}
