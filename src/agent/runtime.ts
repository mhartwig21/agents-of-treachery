/**
 * Agent Runtime Coordinator.
 *
 * Orchestrates the game loop: presenting state to agents, collecting orders,
 * managing press, and handling phase transitions.
 */

import type { Power, GameState, Order, Season, Phase } from '../engine/types';
import { POWERS } from '../engine/types';
import {
  createInitialState,
  submitOrders,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  cloneState,
} from '../engine/game';
import { getHomeCenters } from '../engine/map';

import { PressSystem } from '../press/press-system';
import { AgentPressAPI, createAgentAPIs } from '../press/agent-api';

import type {
  AgentRuntimeConfig,
  AgentTurnResult,
  RuntimeStatus,
  LLMProvider,
} from './types';
import { DEFAULT_RUNTIME_CONFIG } from './types';

import { AgentSessionManager } from './session';
import { InMemoryStore, MemoryStore, updateMemoryTimestamp } from './memory';
import { buildSystemPrompt, buildTurnPrompt } from './prompts';
import { createAgentGameView, createStrategicSummary } from './game-view';
import { parseAgentResponse, validateOrders, fillDefaultOrders } from './order-parser';
import { GameLogger, getGameLogger, getInvalidOrderStats, formatModelStatsReport } from '../server/game-logger';
import {
  createDiaryEntry,
  analyzeDiaryForDeception,
} from '../analysis/deception';

/**
 * Event types emitted by the runtime.
 */
export type RuntimeEventType =
  | 'game_started'
  | 'phase_started'
  | 'agent_turn_started'
  | 'agent_turn_completed'
  | 'orders_submitted'
  | 'phase_resolved'
  | 'game_ended';

/**
 * Event data for runtime events.
 */
export interface RuntimeEvent {
  type: RuntimeEventType;
  timestamp: Date;
  data: {
    year?: number;
    season?: Season;
    phase?: Phase;
    power?: Power;
    orders?: Order[];
    winner?: Power;
    draw?: boolean;
    durationMs?: number;
  };
}

/**
 * Callback for runtime events.
 */
export type RuntimeEventCallback = (event: RuntimeEvent) => void;

/**
 * The main agent runtime that coordinates AI players.
 */
export class AgentRuntime {
  private config: AgentRuntimeConfig;
  private sessionManager: AgentSessionManager;
  private pressSystem: PressSystem;
  private pressAPIs: Map<Power, AgentPressAPI>;
  private gameState: GameState;
  private eventCallbacks: RuntimeEventCallback[] = [];
  private isRunning: boolean = false;
  private turnNumber: number = 0;
  private logger: GameLogger;

  constructor(
    config: AgentRuntimeConfig,
    llmProvider: LLMProvider,
    memoryStore?: MemoryStore,
    logger?: GameLogger
  ) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config } as AgentRuntimeConfig;

    // Initialize memory store
    const store = memoryStore ?? new InMemoryStore();

    // Initialize session manager with memory bounds
    this.sessionManager = new AgentSessionManager(
      this.config.gameId,
      store,
      llmProvider,
      this.config.maxConversationHistory
    );

    // Initialize game state
    this.gameState = createInitialState();

    // Initialize press system with memory bounds
    this.pressSystem = new PressSystem(
      {
        gameId: this.config.gameId,
        year: this.gameState.year,
        season: this.gameState.season,
        phase: this.gameState.phase,
      },
      {
        maxMessagesPerChannel: this.config.maxPressMessagesPerChannel,
      }
    );

    // Create press APIs for all powers
    this.pressAPIs = createAgentAPIs(this.pressSystem);

    // Initialize logger (use provided or create default)
    this.logger = logger ?? getGameLogger(this.config.gameId);
  }

  /**
   * Initialize all agent sessions.
   */
  async initialize(): Promise<void> {
    // Create sessions for all configured agents
    const agentConfigs: Partial<Record<Power, any>> = {};
    for (const agentConfig of this.config.agents) {
      agentConfigs[agentConfig.power] = agentConfig;
    }

    await this.sessionManager.createAllSessions(agentConfigs);

    // Initialize system prompts for each agent
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (session) {
        const systemPrompt = buildSystemPrompt(
          power,
          session.config.personality!
        );
        this.sessionManager.addMessage(power, {
          role: 'system',
          content: systemPrompt,
        });
      }
    }

    this.emitEvent({
      type: 'game_started',
      timestamp: new Date(),
      data: {
        year: this.gameState.year,
        season: this.gameState.season,
        phase: this.gameState.phase,
      },
    });
  }

  /**
   * Run the complete game loop until victory or draw.
   */
  async runGame(): Promise<{ winner?: Power; draw?: boolean }> {
    this.isRunning = true;

    while (this.isRunning && !this.gameState.winner && !this.gameState.draw) {
      await this.runPhase();
      // Throttle game loop - configurable via PHASE_DELAY_MS env var (default 2s)
      const phaseDelay = parseInt(process.env.PHASE_DELAY_MS || '2000', 10);
      await new Promise(resolve => setTimeout(resolve, phaseDelay));
    }

    this.isRunning = false;

    this.emitEvent({
      type: 'game_ended',
      timestamp: new Date(),
      data: {
        winner: this.gameState.winner,
        draw: this.gameState.draw,
      },
    });

    // Save all memories
    await this.sessionManager.saveAllMemories();

    // Print invalid order statistics by model
    if (this.config.verbose) {
      const stats = getInvalidOrderStats(this.config.gameId);
      console.log(formatModelStatsReport(stats));
    }

    return {
      winner: this.gameState.winner,
      draw: this.gameState.draw,
    };
  }

  /**
   * Run a single phase of the game.
   */
  async runPhase(): Promise<void> {
    // Capture the current phase/year/season BEFORE running (phase handlers may transition)
    const phaseYear = this.gameState.year;
    const phaseSeason = this.gameState.season;
    const phasePhase = this.gameState.phase;

    this.emitEvent({
      type: 'phase_started',
      timestamp: new Date(),
      data: {
        year: phaseYear,
        season: phaseSeason,
        phase: phasePhase,
      },
    });

    // Update press context
    this.pressSystem.updateContext({
      gameId: this.config.gameId,
      year: phaseYear,
      season: phaseSeason,
      phase: phasePhase,
    });

    switch (phasePhase) {
      case 'DIPLOMACY':
        await this.runDiplomacyPhase();
        break;
      case 'MOVEMENT':
        await this.runMovementPhase();
        break;
      case 'RETREAT':
        await this.runRetreatPhase();
        break;
      case 'BUILD':
        await this.runBuildPhase();
        break;
    }

    // Emit phase_resolved with the phase that COMPLETED (not the new phase)
    this.emitEvent({
      type: 'phase_resolved',
      timestamp: new Date(),
      data: {
        year: phaseYear,
        season: phaseSeason,
        phase: phasePhase,
      },
    });
  }

  /**
   * Run the diplomacy phase with time-boxed press period.
   * Agents can have back-and-forth conversations during the press window.
   */
  private async runDiplomacyPhase(): Promise<void> {
    const pressPeriodMs = (this.config.pressPeriodMinutes ?? 1) * 60 * 1000;
    const pollIntervalMs = (this.config.pressPollIntervalSeconds ?? 5) * 1000;
    const startTime = Date.now();
    const endTime = startTime + pressPeriodMs;

    console.log(`\n📬 Press period started (${this.config.pressPeriodMinutes ?? 1} minute window)`);

    // Track which agents have sent at least one message this phase
    const agentsWhoActed = new Set<Power>();
    let roundNumber = 0;

    // First round: everyone sends initial messages
    roundNumber++;
    console.log(`\n📨 Press round ${roundNumber}: Initial outreach`);
    const initialTurns = await this.runAgentTurns('diplomacy');
    for (const [power, result] of initialTurns) {
      this.processAgentDiplomacy(power, result);
      agentsWhoActed.add(power);
    }

    // Continue polling until time expires
    while (Date.now() < endTime) {
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Check if time expired during sleep
      if (Date.now() >= endTime) break;

      // Find agents with unread messages
      const agentsWithUnread: Power[] = [];
      for (const power of POWERS) {
        const api = this.pressAPIs.get(power)!;
        const inbox = api.getInbox();
        if (inbox.unreadCount > 0) {
          agentsWithUnread.push(power);
        }
      }

      if (agentsWithUnread.length === 0) {
        // No one has unread messages - conversation has settled
        const timeRemaining = Math.round((endTime - Date.now()) / 1000);
        console.log(`  💤 No unread messages. ${timeRemaining}s remaining in press period.`);
        continue;
      }

      // Let agents with unread messages respond
      roundNumber++;
      console.log(`\n📨 Press round ${roundNumber}: ${agentsWithUnread.length} agents responding`);

      for (const power of agentsWithUnread) {
        const result = await this.runSingleAgentTurn(power, 'diplomacy');
        this.processAgentDiplomacy(power, result);
      }
    }

    const totalRounds = roundNumber;
    const totalMessages = this.countTotalPressMessages();
    console.log(`\n📬 Press period ended after ${totalRounds} rounds, ${totalMessages} total messages\n`);

    // Transition to movement phase
    this.gameState.phase = 'MOVEMENT';
  }

  /**
   * Process diplomatic messages from an agent's turn result.
   */
  private processAgentDiplomacy(power: Power, result: AgentTurnResult): void {
    if (result.diplomaticMessages) {
      const api = this.pressAPIs.get(power)!;
      for (const action of result.diplomaticMessages) {
        if (action.type === 'SEND_MESSAGE') {
          for (const target of action.targetPowers) {
            api.sendTo(target, action.content);
            console.log(`  [${power} → ${target}] ${action.content.slice(0, 60)}${action.content.length > 60 ? '...' : ''}`);
          }
        }
      }
    }
  }

  /**
   * Count total press messages in the system.
   */
  private countTotalPressMessages(): number {
    let total = 0;
    for (const power of POWERS) {
      const api = this.pressAPIs.get(power)!;
      const inbox = api.getInbox();
      // Count messages from all channels (recentMessages includes last 20)
      total += inbox.channels.reduce((sum, ch) => sum + ch.messageCount, 0);
    }
    // Divide by ~2 since bilateral messages show up for both parties
    return Math.round(total / 2);
  }

  /**
   * Run the movement phase (order submission and resolution).
   */
  private async runMovementPhase(): Promise<void> {
    // Get orders from all agents
    const agentTurns = await this.runAgentTurns('movement');

    // Submit orders for each power
    for (const [power, result] of agentTurns) {
      const orders = fillDefaultOrders(result.orders, this.gameState, power);
      submitOrders(this.gameState, power, orders);

      this.emitEvent({
        type: 'orders_submitted',
        timestamp: new Date(),
        data: {
          power,
          orders,
        },
      });
    }

    // Resolve movement
    resolveMovement(this.gameState);

    // Update agent memories with results
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (session) {
        updateMemoryTimestamp(
          session.memory,
          this.gameState.year,
          this.gameState.season,
          this.gameState.phase
        );
      }
    }

    this.turnNumber++;
  }

  /**
   * Run the retreat phase.
   */
  private async runRetreatPhase(): Promise<void> {
    // Only agents with pending retreats need to act
    const powersWithRetreats = new Set(
      this.gameState.pendingRetreats.map(u => u.power)
    );

    const agentTurns = await this.runAgentTurns('retreat', powersWithRetreats);

    // Submit retreat orders
    for (const [power, result] of agentTurns) {
      if (result.retreatOrders && result.retreatOrders.length > 0) {
        submitRetreats(this.gameState, power, result.retreatOrders);
      }
    }

    // Resolve retreats
    resolveRetreats(this.gameState);
  }

  /**
   * Run the build phase.
   */
  private async runBuildPhase(): Promise<void> {
    // Only agents with pending builds/disbands need to act
    const powersWithBuilds = new Set(
      Array.from(this.gameState.pendingBuilds.entries())
        .filter(([, count]) => count !== 0)
        .map(([power]) => power)
    );

    const agentTurns = await this.runAgentTurns('build', powersWithBuilds);

    // Get currently occupied provinces
    const occupiedProvinces = new Set(this.gameState.units.map(u => u.province));

    // Submit build orders with validation
    for (const [power, result] of agentTurns) {
      if (result.buildOrders && result.buildOrders.length > 0) {
        // Filter out invalid builds
        const homeCenters = getHomeCenters(power).map(h => h.id);
        const validBuilds = result.buildOrders.filter(build => {
          if (build.type === 'BUILD') {
            // Must be unoccupied home center we control
            if (!build.province) return false;
            if (occupiedProvinces.has(build.province)) {
              if (this.config.verbose) {
                console.log(`[${power}] Invalid build: ${build.province} is occupied`);
              }
              return false;
            }
            if (!homeCenters.includes(build.province)) {
              if (this.config.verbose) {
                console.log(`[${power}] Invalid build: ${build.province} is not a home center`);
              }
              return false;
            }
            if (this.gameState.supplyCenters.get(build.province) !== power) {
              if (this.config.verbose) {
                console.log(`[${power}] Invalid build: ${power} does not control ${build.province}`);
              }
              return false;
            }
            // Mark province as occupied for subsequent builds in this phase
            occupiedProvinces.add(build.province);
          }
          return true;
        });

        if (validBuilds.length > 0) {
          try {
            submitBuilds(this.gameState, power, validBuilds);
          } catch (error) {
            if (this.config.verbose) {
              console.log(`[${power}] Build submission error: ${error}`);
            }
          }
        }
      }
    }

    // Resolve builds
    resolveBuilds(this.gameState);
  }

  /**
   * Run agent turns for a phase.
   */
  private async runAgentTurns(
    turnType: 'diplomacy' | 'movement' | 'retreat' | 'build',
    activePowers?: Set<Power>
  ): Promise<Map<Power, AgentTurnResult>> {
    const results = new Map<Power, AgentTurnResult>();
    const powersToAct = activePowers ?? new Set(POWERS);

    if (this.config.parallelExecution) {
      // Run all agents in parallel
      const promises = Array.from(powersToAct).map(async power => {
        const result = await this.runSingleAgentTurn(power, turnType);
        return [power, result] as const;
      });

      const completed = await Promise.all(promises);
      for (const [power, result] of completed) {
        results.set(power, result);
      }
    } else {
      // Run agents sequentially
      for (const power of powersToAct) {
        const result = await this.runSingleAgentTurn(power, turnType);
        results.set(power, result);
      }
    }

    return results;
  }

  /**
   * Run a single agent's turn.
   */
  private async runSingleAgentTurn(
    power: Power,
    _turnType: 'diplomacy' | 'movement' | 'retreat' | 'build'
  ): Promise<AgentTurnResult> {
    const session = this.sessionManager.getSession(power);
    if (!session) {
      throw new Error(`No session for ${power}`);
    }

    this.emitEvent({
      type: 'agent_turn_started',
      timestamp: new Date(),
      data: { power },
    });

    // Build the game view for this agent
    const gameView = createAgentGameView(this.gameState, power);

    // Get recent messages from press - filter for INCOMING only (messages from other powers)
    const pressAPI = this.pressAPIs.get(power)!;
    const inbox = pressAPI.getInbox();
    const incomingMessages = inbox.recentMessages
      .filter((m: { sender: string }) => m.sender !== power)
      .map((m: { sender: string; content: string }) =>
        `FROM ${m.sender}: "${m.content}"`
      );
    const recentMessages = incomingMessages.length > 0
      ? [`--- INCOMING MESSAGES (you should respond to these!) ---`, ...incomingMessages]
      : [];

    // Build the turn prompt with strategic context
    const turnPrompt = buildTurnPrompt(
      gameView,
      session.memory,
      recentMessages,
      this.gameState.phase,
      this.gameState
    );

    // Add strategic summary
    const strategicSummary = createStrategicSummary(this.gameState, power);
    const fullPrompt = `${strategicSummary}\n\n${turnPrompt}`;

    // Verbose: log the full prompt being sent
    if (this.config.verbose) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[${power}] FULL PROMPT (${turnType} phase):`);
      console.log(`${'='.repeat(80)}`);
      console.log(fullPrompt);
      console.log(`${'='.repeat(80)}\n`);
    }

    // Add user message to conversation
    this.sessionManager.addMessage(power, {
      role: 'user',
      content: fullPrompt,
    });

    // Call the LLM
    const llm = this.sessionManager.getLLMProvider();
    console.log(`[${power}] Calling LLM (${session.conversationHistory.length} messages, ~${fullPrompt.length} chars)...`);
    const startTime = Date.now();
    let response;
    try {
      response = await llm.complete({
        messages: session.conversationHistory,
        model: session.config.model,
        temperature: session.config.temperature,
        maxTokens: session.config.maxTokens,
      });
      console.log(`[${power}] LLM responded in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${response.content.length} chars)`);

      // Verbose: log the full response
      if (this.config.verbose) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`[${power}] LLM RESPONSE:`);
        console.log(`${'─'.repeat(80)}`);
        console.log(response.content);
        console.log(`${'─'.repeat(80)}\n`);
      }
    } catch (error) {
      console.error(`[${power}] LLM error:`, error);
      throw error;
    }

    // Add assistant response to conversation
    this.sessionManager.addMessage(power, {
      role: 'assistant',
      content: response.content,
    });

    // Parse the response
    const parsed = parseAgentResponse(response.content);

    // Debug: show what was parsed during MOVEMENT phase
    if (this.gameState.phase === 'MOVEMENT') {
      // Show raw ORDERS section from LLM
      const ordersMatch = response.content.match(/ORDERS:\s*([\s\S]*?)(?=(?:RETREATS:|BUILDS:|REASONING:|DIPLOMACY:|$))/i);
      if (ordersMatch) {
        console.log(`[${power}] Raw ORDERS section:\n${ordersMatch[1].trim().slice(0, 300)}`);
      } else {
        console.log(`[${power}] No ORDERS section found in response`);
      }
      console.log(`[${power}] Parsed ${parsed.orders.length} orders`);
      if (parsed.orders.length > 0) {
        console.log(`[${power}] Orders:`, parsed.orders.map(o => `${o.unit} ${o.type}${'destination' in o ? ' -> ' + o.destination : ''}`).join(', '));
      }
      if (parsed.errors.length > 0) {
        console.log(`[${power}] Parse errors:`, parsed.errors);
      }
    }

    // Validate orders
    const { valid, errors } = validateOrders(
      parsed.orders,
      this.gameState,
      power
    );

    // Log invalid orders with model info for statistics tracking
    if (errors.length > 0) {
      console.warn(`[${power}] Order validation errors:`, errors);

      // Find invalid orders (orders that didn't make it to valid list)
      const validUnits = new Set(valid.map(o => o.unit));
      const invalidOrders = parsed.orders.filter(o => !validUnits.has(o.unit));

      // Log each invalid order
      for (let i = 0; i < errors.length; i++) {
        const orderText = invalidOrders[i]
          ? `${invalidOrders[i].unit} ${invalidOrders[i].type}`
          : `unknown order ${i}`;
        this.logger.invalidOrder(
          power,
          session.config.model,
          orderText,
          errors[i],
          this.gameState.year,
          this.gameState.season,
          this.gameState.phase
        );
      }
    }

    // Also log parse errors as invalid orders
    if (parsed.errors.length > 0) {
      for (const error of parsed.errors) {
        this.logger.invalidOrder(
          power,
          session.config.model,
          'parse_failure',
          error,
          this.gameState.year,
          this.gameState.season,
          this.gameState.phase
        );
      }
    }

    // Log diary entry and detect deception
    const diaryEntry = createDiaryEntry(
      power,
      this.gameState.year,
      this.gameState.season,
      this.gameState.phase,
      response.content,
      session.config.model
    );

    // Log the diary entry
    this.logger.diaryEntry(
      power,
      session.config.model,
      this.gameState.year,
      this.gameState.season,
      this.gameState.phase,
      diaryEntry.intentions,
      diaryEntry.reasoning,
      diaryEntry.analysis
    );

    // Detect and log deception
    const deceptions = analyzeDiaryForDeception(diaryEntry);
    for (const deception of deceptions) {
      this.logger.deceptionDetected(
        deception.deceiver,
        session.config.model,
        deception.type,
        deception.targets,
        deception.year,
        deception.season,
        deception.diaryEvidence,
        deception.confidence
      );
    }

    const result: AgentTurnResult = {
      power,
      orders: valid,
      retreatOrders: parsed.retreatOrders,
      buildOrders: parsed.buildOrders,
      diplomaticMessages: parsed.diplomaticMessages,
      reasoning: response.content,
    };

    const durationMs = Date.now() - startTime;
    this.emitEvent({
      type: 'agent_turn_completed',
      timestamp: new Date(),
      data: {
        power,
        orders: valid,
        durationMs,
      },
    });

    return result;
  }

  /**
   * Register an event callback.
   */
  onEvent(callback: RuntimeEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all registered callbacks.
   */
  private emitEvent(event: RuntimeEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    }
  }

  /**
   * Stop the game loop.
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Clean up all resources.
   * Call this after the game ends to free memory.
   */
  cleanup(): void {
    this.isRunning = false;
    this.sessionManager.destroyAll();
    this.pressSystem.clear();
    this.pressAPIs.clear();
    this.eventCallbacks = [];
  }

  /**
   * Get current runtime status.
   */
  getStatus(): RuntimeStatus {
    return {
      gameId: this.config.gameId,
      isRunning: this.isRunning,
      currentPhase: this.gameState.phase,
      currentSeason: this.gameState.season,
      currentYear: this.gameState.year,
      activeSessions: this.sessionManager.getAllSessions().map(s => s.id),
      lastUpdate: new Date(),
    };
  }

  /**
   * Get the current game state (clone).
   */
  getGameState(): GameState {
    return cloneState(this.gameState);
  }

  /**
   * Get the press system.
   */
  getPressSystem(): PressSystem {
    return this.pressSystem;
  }

  /**
   * Get the session manager.
   */
  getSessionManager(): AgentSessionManager {
    return this.sessionManager;
  }

  /**
   * Get the game logger.
   */
  getLogger(): GameLogger {
    return this.logger;
  }
}

/**
 * Create a runtime with test configuration.
 */
export function createTestRuntime(
  gameId: string,
  llmProvider: LLMProvider
): AgentRuntime {
  const config: AgentRuntimeConfig = {
    gameId,
    agents: POWERS.map(power => ({ power })),
    parallelExecution: true,
    turnTimeout: 60000,
    persistMemory: false,
    verbose: true,
  };

  return new AgentRuntime(config, llmProvider, new InMemoryStore());
}

/**
 * Quick start function to create and run a game.
 */
export async function runAutonomousGame(
  gameId: string,
  llmProvider: LLMProvider,
  config?: Partial<AgentRuntimeConfig>
): Promise<{ winner?: Power; draw?: boolean }> {
  const fullConfig: AgentRuntimeConfig = {
    gameId,
    agents: POWERS.map(power => ({ power })),
    parallelExecution: true,
    turnTimeout: 120000,
    persistMemory: true,
    verbose: false,
    ...config,
  };

  const runtime = new AgentRuntime(fullConfig, llmProvider);
  await runtime.initialize();
  return runtime.runGame();
}
