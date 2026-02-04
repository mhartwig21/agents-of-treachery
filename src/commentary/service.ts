/**
 * Commentary Service - Integrates commentary generation with game events.
 *
 * Subscribes to game store events and generates real-time commentary
 * for spectators watching live games.
 */

import type { GameStore, StoreSnapshot } from '../store/game-store';
import type { GameEvent } from '../store/events';
import type { LLMProvider } from '../agent/types';
import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';
import { CommentaryGenerator } from './generator';
import type {
  CommentaryEntry,
  CommentaryConfig,
  CommentaryTrigger,
  EventDetails,
  CommentaryGenerationContext,
} from './types';
import { DEFAULT_COMMENTARY_CONFIG } from './types';

/**
 * Callback for commentary events.
 */
export type CommentaryCallback = (entry: CommentaryEntry) => void;

/**
 * Commentary service configuration.
 */
export interface CommentaryServiceConfig extends CommentaryConfig {
  /** Whether to use LLM for generation (vs templated) */
  useLLM: boolean;
  /** Debounce time for rapid events (ms) */
  debounceMs: number;
}

/**
 * Default service configuration.
 */
const DEFAULT_SERVICE_CONFIG: CommentaryServiceConfig = {
  ...DEFAULT_COMMENTARY_CONFIG,
  useLLM: true,
  debounceMs: 500,
};

/**
 * Service that generates commentary for game events.
 */
export class CommentaryService {
  private store: GameStore | null = null;
  private generator: CommentaryGenerator;
  private config: CommentaryServiceConfig;
  private callbacks: CommentaryCallback[] = [];
  private unsubscribe: (() => void) | null = null;
  private lastEventTime: number = 0;
  private pendingEvents: GameEvent[] = [];
  private processingTimeout: NodeJS.Timeout | null = null;
  private recentHistory: string[] = [];

  constructor(llmProvider: LLMProvider, config?: Partial<CommentaryServiceConfig>) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
    this.generator = new CommentaryGenerator(llmProvider, this.config.style);
  }

  /**
   * Attach to a game store and start generating commentary.
   */
  attach(store: GameStore): void {
    if (this.store) {
      this.detach();
    }

    this.store = store;
    this.unsubscribe = store.subscribe(this.handleSnapshot.bind(this));
  }

  /**
   * Detach from the current game store.
   */
  detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.store = null;
    this.recentHistory = [];
    this.pendingEvents = [];
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
  }

  /**
   * Subscribe to commentary events.
   */
  subscribe(callback: CommentaryCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx >= 0) {
        this.callbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Update service configuration.
   */
  updateConfig(config: Partial<CommentaryServiceConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.style) {
      this.generator.setStyle(config.style);
    }
  }

  /**
   * Manually trigger commentary for a specific event.
   */
  async triggerCommentary(
    trigger: CommentaryTrigger,
    details: EventDetails,
    gameState: CommentaryGenerationContext['gameState']
  ): Promise<CommentaryEntry | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const entry = this.config.useLLM
        ? await this.generateLLMCommentary(trigger, details, gameState)
        : this.generator.generateQuickCommentary(trigger, details, gameState);

      this.emitCommentary(entry);
      return entry;
    } catch (error) {
      console.error('Commentary generation failed:', error);
      return null;
    }
  }

  /**
   * Handle store snapshot updates.
   */
  private handleSnapshot(snapshot: StoreSnapshot): void {
    const latestEvent = snapshot.events[snapshot.events.length - 1];
    if (!latestEvent) return;

    // Debounce rapid events
    const now = Date.now();
    if (now - this.lastEventTime < this.config.debounceMs) {
      this.pendingEvents.push(latestEvent);
      if (!this.processingTimeout) {
        this.processingTimeout = setTimeout(() => {
          this.processPendingEvents(snapshot);
        }, this.config.debounceMs);
      }
      return;
    }

    this.lastEventTime = now;
    this.processEvent(latestEvent, snapshot);
  }

  /**
   * Process pending events after debounce.
   */
  private processPendingEvents(snapshot: StoreSnapshot): void {
    this.processingTimeout = null;

    // Process the most significant pending event
    if (this.pendingEvents.length === 0) return;

    const significantEvent = this.findMostSignificantEvent(this.pendingEvents);
    this.pendingEvents = [];

    if (significantEvent) {
      this.processEvent(significantEvent, snapshot);
    }
  }

  /**
   * Find the most significant event from a list.
   */
  private findMostSignificantEvent(events: GameEvent[]): GameEvent | null {
    const priority: Record<string, number> = {
      GAME_ENDED: 10,
      SUPPLY_CENTERS_CAPTURED: 8,
      MOVEMENT_RESOLVED: 7,
      BUILDS_RESOLVED: 6,
      RETREATS_RESOLVED: 5,
      PHASE_ADVANCED: 3,
      ORDERS_SUBMITTED: 2,
      MESSAGE_SENT: 1,
      GAME_CREATED: 0,
    };

    let best: GameEvent | null = null;
    let bestPriority = -1;

    for (const event of events) {
      const p = priority[event.type] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        best = event;
      }
    }

    return best;
  }

  /**
   * Process a single game event.
   */
  private async processEvent(event: GameEvent, snapshot: StoreSnapshot): Promise<void> {
    const result = this.eventToCommentaryTrigger(event);
    if (!result) return;

    const { trigger, details } = result;

    // Check intensity threshold
    const intensity = this.estimateIntensity(trigger, details);
    const intensityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    if (intensityOrder[intensity] < intensityOrder[this.config.minIntensity]) {
      return;
    }

    const gameState = this.buildGameStateContext(snapshot);

    try {
      const entry = this.config.useLLM
        ? await this.generateLLMCommentary(trigger, details, gameState)
        : this.generator.generateQuickCommentary(trigger, details, gameState);

      this.emitCommentary(entry);
      this.updateRecentHistory(entry);
    } catch (error) {
      console.error('Commentary generation failed:', error);
    }
  }

  /**
   * Convert a game event to commentary trigger and details.
   */
  private eventToCommentaryTrigger(event: GameEvent): { trigger: CommentaryTrigger; details: EventDetails } | null {
    switch (event.type) {
      case 'PHASE_ADVANCED':
        return {
          trigger: 'phase_start',
          details: {
            type: 'phase_start',
            newPhase: event.payload.toPhase,
            newSeason: event.payload.toSeason,
            newYear: event.payload.toYear,
          },
        };

      case 'MOVEMENT_RESOLVED':
        return {
          trigger: 'movement_resolved',
          details: {
            type: 'movement_resolved',
            successes: event.payload.results.filter(r => r.success).length,
            failures: event.payload.results.filter(r => !r.success).length,
            dislodged: event.payload.dislodged.map(d => ({
              power: d.unit.power,
              from: d.dislodgedFrom,
            })),
          },
        };

      case 'RETREATS_RESOLVED':
        return {
          trigger: 'retreat_resolved',
          details: {
            type: 'retreat_resolved',
            retreats: event.payload.retreatResults.map(r => ({
              power: r.unit.power,
              from: r.unit.province,
              to: r.destination,
            })),
          },
        };

      case 'BUILDS_RESOLVED':
        return {
          trigger: 'build_resolved',
          details: {
            type: 'build_resolved',
            builds: event.payload.unitsBuilt.map(b => ({
              power: b.power,
              province: b.province,
            })),
            disbands: event.payload.unitsDisbanded.map(d => ({
              power: d.power,
              province: d.province,
            })),
          },
        };

      case 'SUPPLY_CENTERS_CAPTURED':
        if (event.payload.changes.length === 0) return null;
        return {
          trigger: 'supply_center_captured',
          details: {
            type: 'supply_center_captured',
            changes: event.payload.changes,
          },
        };

      case 'GAME_ENDED':
        return {
          trigger: 'game_ended',
          details: {
            type: 'game_ended',
            winner: event.payload.winner,
            isDraw: event.payload.draw,
          },
        };

      default:
        return null;
    }
  }

  /**
   * Estimate intensity for an event.
   */
  private estimateIntensity(
    trigger: CommentaryTrigger,
    details: EventDetails
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (trigger === 'game_ended') return 'critical';
    if (trigger === 'betrayal_detected' || trigger === 'elimination') return 'high';

    if (details.type === 'movement_resolved' && details.dislodged.length > 0) {
      return 'high';
    }

    if (details.type === 'supply_center_captured' && details.changes.length >= 3) {
      return 'high';
    }

    if (trigger === 'supply_center_captured' || trigger === 'movement_resolved') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Build game state context from snapshot.
   */
  private buildGameStateContext(snapshot: StoreSnapshot): CommentaryGenerationContext['gameState'] {
    const state = snapshot.state;

    const supplyCenterCounts = {} as Record<Power, number>;
    const unitCounts = {} as Record<Power, number>;
    const eliminatedPowers: Power[] = [];

    for (const power of POWERS) {
      supplyCenterCounts[power] = 0;
      unitCounts[power] = 0;
    }

    state.supplyCenters.forEach((power) => {
      supplyCenterCounts[power]++;
    });

    for (const unit of state.units) {
      unitCounts[unit.power]++;
    }

    for (const power of POWERS) {
      if (supplyCenterCounts[power] === 0 && unitCounts[power] === 0) {
        eliminatedPowers.push(power);
      }
    }

    return {
      year: state.year,
      season: state.season,
      phase: state.phase,
      supplyCenterCounts,
      unitCounts,
      eliminatedPowers,
    };
  }

  /**
   * Generate commentary using LLM.
   */
  private async generateLLMCommentary(
    trigger: CommentaryTrigger,
    details: EventDetails,
    gameState: CommentaryGenerationContext['gameState']
  ): Promise<CommentaryEntry> {
    const context: CommentaryGenerationContext = {
      gameState,
      trigger,
      eventDetails: details,
      recentHistory: this.recentHistory.join('\n'),
      style: this.config.style,
    };

    return this.generator.generateCommentary(context);
  }

  /**
   * Emit commentary to all subscribers.
   */
  private emitCommentary(entry: CommentaryEntry): void {
    for (const callback of this.callbacks) {
      try {
        callback(entry);
      } catch (error) {
        console.error('Commentary callback error:', error);
      }
    }
  }

  /**
   * Update recent history for context.
   */
  private updateRecentHistory(entry: CommentaryEntry): void {
    this.recentHistory.push(`${entry.context.season} ${entry.context.year}: ${entry.text}`);

    // Keep only last 5 entries
    if (this.recentHistory.length > 5) {
      this.recentHistory.shift();
    }
  }
}

/**
 * Create a mock LLM provider for testing.
 */
export function createMockCommentaryProvider(): LLMProvider {
  return {
    async complete() {
      return {
        content: 'The tension mounts as the powers maneuver for advantage.',
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
}
