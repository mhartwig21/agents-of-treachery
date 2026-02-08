/**
 * Agent Runtime Coordinator.
 *
 * Orchestrates the game loop: presenting state to agents, collecting orders,
 * managing press, and handling phase transitions.
 */

import type { Power, GameState, Order, Season, Phase, OrderResolution } from '../engine/types';
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
import type { Message } from '../press/types';

import type {
  AgentRuntimeConfig,
  AgentTurnResult,
  RuntimeStatus,
  LLMProvider,
} from './types';
import { DEFAULT_RUNTIME_CONFIG } from './types';

import { AgentSessionManager } from './session';
import { InMemoryStore, MemoryStore, updateMemoryTimestamp } from './memory';
import {
  shouldConsolidateDiary,
  consolidateDiary,
  recordOrders as recordDiaryOrders,
  recordReflection as recordDiaryReflection,
} from './diary';
import { buildSystemPrompt, buildTurnPrompt, getPromptContextStats } from './prompts';
import { getCompressionLevel } from './context-compression';
import { consolidateMemory } from './consolidation';
import {
  createNegotiationMetricsTracker,
  NegotiationMetricsTracker,
} from './negotiation-metrics';
import { createAgentGameView, createStrategicSummary } from './game-view';
import { parseAgentResponse, validateOrders, fillDefaultOrders } from './order-parser';
import { GameLogger, getGameLogger, getInvalidOrderStats, formatModelStatsReport } from '../server/game-logger';
import {
  createDiaryEntry,
  analyzeDiaryForDeception,
  type DeceptionRecord,
} from '../analysis/deception';
import {
  createPromiseTracker,
  generatePromiseSummary,
  PromiseTracker,
  PromiseMemoryUpdate,
} from '../analysis/promise-tracker';
import {
  analyzeIncomingMessages,
  generateAnalysisSummary,
  recordAnalysisInDiary,
} from './negotiation';
import {
  generatePhaseReflection,
  applyReflectionToMemory,
  recordReflectionInDiary,
  formatReflectionForLog,
} from './reflection';
import type { MessageAnalysis, PhaseReflection } from './types';

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
  | 'game_ended'
  | 'deception_detected'
  | 'promise_reconciled';

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
    deceptions?: DeceptionRecord[];
    promiseUpdates?: PromiseMemoryUpdate[];
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
  private promiseTracker: PromiseTracker;
  private metricsTracker: NegotiationMetricsTracker;
  private pendingPromiseUpdates: PromiseMemoryUpdate[] = [];
  private pendingMessageAnalyses: Map<Power, MessageAnalysis[]> = new Map();
  private analyzedMessageIds: Set<string> = new Set();
  private lastPhaseMessages: Message[] = [];
  private pendingReflections: Map<Power, PhaseReflection> = new Map();
  /** Track SC ownership at start of year for yearly summary calculation */
  private yearStartSCs: Map<Power, string[]> = new Map();

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

    // Initialize promise tracker for memory/relationship evolution
    this.promiseTracker = createPromiseTracker();

    // Initialize negotiation metrics tracker
    this.metricsTracker = createNegotiationMetricsTracker(this.config.gameId);
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

    this.logger.gameStarted(this.config.gameId, POWERS as unknown as string[]);

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

    this.logger.gameEnded(this.gameState.winner, this.gameState.draw);

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

      // Print negotiation metrics report
      const metricsReport = this.metricsTracker.generateMarkdownReport();
      console.log('\n' + metricsReport);
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

    this.logger.phaseStarted(phasePhase, phaseYear, phaseSeason);

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

    // At the start of Spring Diplomacy, capture SC ownership for yearly summary
    if (phaseSeason === 'SPRING' && phasePhase === 'DIPLOMACY') {
      this.captureYearStartSCs();
    }

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

    this.logger.phaseResolved(phasePhase, phaseYear, phaseSeason);

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
    const pressPeriodMinutes = this.config.pressPeriodMinutes ?? 1;

    // Skip diplomacy entirely when press period is 0
    if (pressPeriodMinutes === 0) {
      console.log(`\n📬 Press period skipped (0 minute window)`);
      return;
    }

    const pressPeriodMs = pressPeriodMinutes * 60 * 1000;
    const pollIntervalMs = (this.config.pressPollIntervalSeconds ?? 5) * 1000;
    const startTime = Date.now();
    const endTime = startTime + pressPeriodMs;

    console.log(`\n📬 Press period started (${pressPeriodMinutes} minute window)`);

    // Track which agents have sent at least one message this phase
    const agentsWhoActed = new Set<Power>();
    let roundNumber = 0;

    // First round: everyone sends initial messages
    roundNumber++;
    this.pressSystem.setCurrentRound(roundNumber);
    console.log(`\n📨 Press round ${roundNumber}: Initial outreach`);
    const initialTurns = await this.runAgentTurns('diplomacy');
    for (const [power, result] of initialTurns) {
      this.processAgentDiplomacy(power, result);
      agentsWhoActed.add(power);
    }

    // Analyze new messages after round 1
    await this.analyzeMessagesForAllPowers();

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

      // Let agents with unread messages respond - all compose simultaneously (no ordering bias)
      roundNumber++;
      this.pressSystem.setCurrentRound(roundNumber);
      console.log(`\n📨 Press round ${roundNumber}: ${agentsWithUnread.length} agents responding`);

      const roundTurns = await this.runAgentTurns('diplomacy', new Set(agentsWithUnread));
      for (const [power, result] of roundTurns) {
        this.processAgentDiplomacy(power, result);
      }

      // Analyze new messages after each round (not just round 1)
      await this.analyzeMessagesForAllPowers();
    }

    const totalRounds = roundNumber;
    const totalMessages = this.countTotalPressMessages();
    console.log(`\n📬 Press period ended after ${totalRounds} rounds, ${totalMessages} total messages\n`);

    // Extract promises from this turn's press messages for later reconciliation
    const allMessages = this.getAllPressMessages();
    const promises = this.promiseTracker.recordTurnPromises(
      allMessages,
      this.gameState.year,
      this.gameState.season
    );
    if (promises.length > 0) {
      console.log(`📝 Extracted ${promises.length} promises from diplomatic communications`);
    }

    // Record messages and promises in negotiation metrics tracker
    const allAnalyses: MessageAnalysis[] = [];
    for (const analyses of this.pendingMessageAnalyses.values()) {
      allAnalyses.push(...analyses);
    }
    this.metricsTracker.recordTurnMessages(
      allMessages,
      allAnalyses,
      this.gameState.year,
      this.gameState.season
    );
    if (promises.length > 0) {
      this.metricsTracker.recordPromises(promises, []);
    }

    // Store messages for phase reflection after movement resolution
    this.lastPhaseMessages = allMessages;

    // Transition to movement phase
    this.gameState.phase = 'MOVEMENT';
  }

  /**
   * Collects all press messages from the system.
   */
  private getAllPressMessages(): Message[] {
    const allMessages: Message[] = [];
    for (const channel of this.pressSystem.getAllChannels()) {
      const result = this.pressSystem.queryMessages({ channelId: channel.id });
      allMessages.push(...result.messages);
    }
    return allMessages;
  }

  /**
   * Analyze incoming messages for all powers.
   * Generates analysis summaries that will be included in agent prompts.
   */
  private async analyzeMessagesForAllPowers(): Promise<void> {
    const llm = this.sessionManager.getLLMProvider();
    console.log(`\n🔍 Analyzing incoming diplomatic messages...`);

    // Analyze messages for each power sequentially to avoid TPM rate limit crashes.
    // Each analysis makes an LLM call; parallel execution would burst the token budget.
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (!session) continue;

      // Get messages from all channels this power participates in
      const pressAPI = this.pressAPIs.get(power)!;
      const inbox = pressAPI.getInbox();
      const incomingMessages = inbox.recentMessages
        .filter(m => m.sender !== power && !this.analyzedMessageIds.has(m.id));

      if (incomingMessages.length === 0) {
        continue;
      }

      try {
        const analyses = await analyzeIncomingMessages(
          power,
          incomingMessages,
          session.memory,
          llm
        );

        if (analyses.length > 0) {
          // Append to existing analyses (don't replace - accumulates across rounds)
          const existing = this.pendingMessageAnalyses.get(power) ?? [];
          this.pendingMessageAnalyses.set(power, [...existing, ...analyses]);

          // Track analyzed message IDs to avoid re-analysis
          for (const msg of incomingMessages) {
            this.analyzedMessageIds.add(msg.id);
          }

          // Record analyses in diary
          for (const analysis of analyses) {
            recordAnalysisInDiary(
              session.memory,
              analysis,
              this.gameState.year,
              this.gameState.season
            );
          }

          // Log summary
          const deceptionCount = analyses.filter(a => a.senderIntent === 'deception').length;
          const lowCredCount = analyses.filter(a => a.credibilityScore < 0.3).length;
          if (deceptionCount > 0 || lowCredCount > 0) {
            console.log(`  [${power}] ⚠️ Analyzed ${analyses.length} messages (${deceptionCount} potential deceptions, ${lowCredCount} low credibility)`);
          } else {
            console.log(`  [${power}] Analyzed ${analyses.length} messages`);
          }
        }
      } catch (error) {
        console.warn(`  [${power}] Message analysis failed:`, error);
      }
    }
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
            this.logger.messageSent(power, target, action.content.slice(0, 100));
            console.log(`  [${power} → ${target}] ${action.content.slice(0, 60)}${action.content.length > 60 ? '...' : ''}`);
          }
        }
      }
    }
  }

  /**
   * Format messages grouped by press round with direction labels and NEW markers.
   */
  private formatRoundAwareMessages(
    power: Power,
    messages: Message[],
    unreadCount: number
  ): string[] {
    if (messages.length === 0) return [];

    // Group messages by round number (0 = unknown/legacy)
    const byRound = new Map<number, Message[]>();
    for (const msg of messages) {
      const round = msg.metadata?.pressRound ?? 0;
      if (!byRound.has(round)) byRound.set(round, []);
      byRound.get(round)!.push(msg);
    }

    // Sort round numbers ascending
    const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
    const maxRound = rounds[rounds.length - 1];

    const lines: string[] = [];
    if (unreadCount > 0) {
      lines.push(`--- DIPLOMATIC MESSAGES (${unreadCount} new) ---`);
    } else {
      lines.push(`--- DIPLOMATIC MESSAGES ---`);
    }

    for (const round of rounds) {
      const roundMsgs = byRound.get(round)!;
      const isNew = round === maxRound && unreadCount > 0;
      const label = round > 0
        ? `[Round ${round}]${isNew ? ' [NEW]' : ''}`
        : '[Previous]';
      lines.push(label);

      for (const msg of roundMsgs) {
        if (msg.sender === power) {
          // Extract target from bilateral channel ID
          const target = this.extractChannelTarget(msg.channelId, power);
          lines.push(`  You -> ${target}: "${msg.content}"`);
        } else {
          lines.push(`  ${msg.sender} -> You: "${msg.content}"`);
        }
      }
    }

    return lines;
  }

  /**
   * Extract the other power from a bilateral channel ID.
   */
  private extractChannelTarget(channelId: string, self: Power): string {
    // Channel format: "bilateral:POWER1:POWER2"
    const parts = channelId.split(':');
    if (parts.length >= 3 && parts[0] === 'bilateral') {
      return parts[1] === self ? parts[2] : parts[1];
    }
    // Multiparty or global - just return the channel type
    if (parts[0] === 'global') return 'ALL';
    return channelId;
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

    // Collect orders for promise reconciliation
    const ordersByPower = new Map<Power, Order[]>();

    // Submit orders for each power
    for (const [power, result] of agentTurns) {
      const orders = fillDefaultOrders(result.orders, this.gameState, power);
      ordersByPower.set(power, orders);
      submitOrders(this.gameState, power, orders);

      const orderStrings = orders.map(o => {
        if ('destination' in o && o.destination) return `${o.unit} -> ${o.destination}`;
        return `${o.unit} ${o.type}`;
      });
      this.logger.ordersSubmitted(power, orderStrings, true);

      this.emitEvent({
        type: 'orders_submitted',
        timestamp: new Date(),
        data: {
          power,
          orders,
        },
      });
    }

    // Build unit owners map before resolution (for promise reconciliation)
    const unitOwners = new Map<string, Power>();
    for (const unit of this.gameState.units) {
      unitOwners.set(unit.province, unit.power);
    }

    // Resolve movement and capture results
    const resolutionResult = resolveMovement(this.gameState);
    const orderResults: OrderResolution[] = Array.from(resolutionResult.results.values());

    // Reconcile promises against orders and generate memory updates
    const promiseUpdates = this.promiseTracker.reconcileTurn(
      this.gameState.year,
      this.gameState.season,
      ordersByPower,
      unitOwners
    );

    if (promiseUpdates.length > 0) {
      console.log(`🔍 Promise reconciliation: ${promiseUpdates.length} updates`);
      this.pendingPromiseUpdates = promiseUpdates;

      // Apply trust updates to agent memories
      this.applyPromiseUpdatesToMemory(promiseUpdates);

      this.emitEvent({
        type: 'promise_reconciled',
        timestamp: new Date(),
        data: {
          year: this.gameState.year,
          season: this.gameState.season,
          promiseUpdates,
        },
      });

      // Record alliance signals from trust updates in metrics tracker
      for (const update of promiseUpdates) {
        const signal: 'cooperative' | 'hostile' | 'neutral' =
          update.trustDelta > 0.1 ? 'cooperative' :
          update.trustDelta < -0.1 ? 'hostile' : 'neutral';
        this.metricsTracker.recordAllianceSignal(
          update.power,
          update.aboutPower,
          signal,
          update.year,
          update.season
        );
      }
    }

    // Generate phase reflections for all powers
    await this.generatePhaseReflections(
      ordersByPower,
      orderResults
    );

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
   * Applies promise reconciliation updates to agent memories.
   */
  private applyPromiseUpdatesToMemory(updates: PromiseMemoryUpdate[]): void {
    for (const update of updates) {
      const session = this.sessionManager.getSession(update.power);
      if (!session) continue;

      // Update trust level
      const currentTrust = session.memory.trustLevels.get(update.aboutPower) ?? 0;
      const newTrust = Math.max(-1, Math.min(1, currentTrust + update.trustDelta));
      session.memory.trustLevels.set(update.aboutPower, newTrust);

      // Update relationship
      const relationship = session.memory.relationships.get(update.aboutPower);
      if (relationship) {
        relationship.trustLevel = newTrust;
        relationship.lastInteraction = {
          year: update.year,
          season: update.season,
        };
        relationship.isAlly = newTrust >= 0.5;
        relationship.isEnemy = newTrust <= -0.5;
      }

      // Record the event
      session.memory.events.push({
        year: update.year,
        season: update.season,
        type: update.eventType,
        powers: [update.aboutPower],
        description: update.memoryPrompt,
        impactOnTrust: update.trustDelta,
      });

      // Log the update
      if (update.eventType === 'BETRAYAL') {
        console.log(`  ⚠️ ${update.power} detected betrayal by ${update.aboutPower}`);
      } else if (update.eventType === 'PROMISE_BROKEN') {
        console.log(`  ❌ ${update.power}: ${update.aboutPower} broke promise`);
      } else {
        console.log(`  ✓ ${update.power}: ${update.aboutPower} kept promise`);
      }
    }
  }

  /**
   * Generate phase reflections for all powers after movement resolution.
   * This analyzes what happened vs what was promised to detect betrayals.
   */
  private async generatePhaseReflections(
    ordersByPower: Map<Power, Order[]>,
    orderResults: OrderResolution[]
  ): Promise<void> {
    const llm = this.sessionManager.getLLMProvider();
    console.log(`\n🪞 Generating phase reflections...`);

    // Clear previous reflections
    this.pendingReflections.clear();

    // Generate reflections for each power sequentially to avoid TPM rate limit crashes.
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (!session) continue;

      try {
        const reflection = await generatePhaseReflection(
          power,
          this.gameState.year,
          this.gameState.season,
          ordersByPower,
          orderResults,
          this.lastPhaseMessages,
          session.memory,
          llm
        );

        this.pendingReflections.set(power, reflection);

        // Apply trust updates from reflection
        applyReflectionToMemory(session.memory, reflection);

        // Record reflection in diary
        recordReflectionInDiary(session.memory, reflection);

        // Log betrayals detected
        const betrayals = reflection.trustUpdates.filter(u => u.isBetrayal);
        if (betrayals.length > 0) {
          console.log(`  [${power}] ⚠️ Detected ${betrayals.length} betrayal(s):`);
          for (const b of betrayals) {
            console.log(`    ${b.power}: ${b.reason}`);
          }
        } else if (reflection.trustUpdates.length > 0) {
          console.log(`  [${power}] Updated trust for ${reflection.trustUpdates.length} power(s)`);
        }

        if (this.config.verbose) {
          console.log(formatReflectionForLog(reflection));
        }
      } catch (error) {
        console.warn(`  [${power}] Reflection failed:`, error);
      }
    }

    // Log summary
    const totalBetrayals = Array.from(this.pendingReflections.values())
      .reduce((sum, r) => sum + r.trustUpdates.filter(u => u.isBetrayal).length, 0);
    if (totalBetrayals > 0) {
      console.log(`\n🪞 Phase reflection complete: ${totalBetrayals} betrayal(s) detected across all powers\n`);
    } else {
      console.log(`\n🪞 Phase reflection complete\n`);
    }
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

    // Consolidate diaries at end of year (after Winter builds)
    await this.consolidateDiaries();

    // Consolidate turn summaries and strategic notes for long games
    await this.consolidateAgentMemories();
  }

  /**
   * Capture SC ownership at the start of a year for yearly summary calculation.
   */
  private captureYearStartSCs(): void {
    for (const power of POWERS) {
      const scs: string[] = [];
      for (const [province, owner] of this.gameState.supplyCenters) {
        if (owner === power) {
          scs.push(province);
        }
      }
      this.yearStartSCs.set(power, scs);
    }
  }

  /**
   * Consolidate agent diaries for the completed year.
   * This compresses the year's diary entries into a summary for efficient context usage.
   * Now includes game state context for richer yearly summaries.
   */
  private async consolidateDiaries(): Promise<void> {
    const llm = this.sessionManager.getLLMProvider();
    const year = this.gameState.year;
    const season = this.gameState.season;
    const phase = this.gameState.phase;

    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (!session) continue;

      if (shouldConsolidateDiary(year, season, phase, session.memory)) {
        if (this.config.verbose) {
          console.log(`[${power}] Consolidating diary for year ${year}...`);
        }

        try {
          // Get the SCs from the start of the year for comparison
          const previousYearSCs = this.yearStartSCs.get(power);

          const summary = await consolidateDiary(
            session.memory,
            power,
            year,
            llm,
            this.gameState,
            previousYearSCs
          );

          if (this.config.verbose) {
            console.log(`[${power}] Year ${year} summary: ${summary.summary}`);
          }
        } catch (error) {
          console.error(`[${power}] Diary consolidation failed:`, error);
        }
      }
    }
  }

  /**
   * Consolidate turn summaries and strategic notes for all agents.
   * Prevents memory overflow in 30+ turn games.
   */
  private async consolidateAgentMemories(): Promise<void> {
    const llm = this.sessionManager.getLLMProvider();

    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (!session) continue;

      try {
        const result = await consolidateMemory(session.memory, llm);
        if (result.turnBlock && this.config.verbose) {
          console.log(
            `[${power}] Consolidated turns ${result.turnBlock.fromYear} ${result.turnBlock.fromSeason}` +
            ` - ${result.turnBlock.toYear} ${result.turnBlock.toSeason}`
          );
        }
        if (result.notesMerged && this.config.verbose) {
          console.log(`[${power}] Merged strategic notes (now ${session.memory.strategicNotes.length})`);
        }
      } catch (error) {
        console.error(`[${power}] Memory consolidation failed:`, error);
      }
    }
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

    // Diplomacy always runs sequentially to avoid TPM rate limit crashes.
    // 7 parallel agents x ~35K tokens = 245K tokens/batch, which exceeds
    // typical TPM limits (e.g. OpenAI free tier 200K TPM).
    const useParallel = this.config.parallelExecution && turnType !== 'diplomacy';

    if (useParallel) {
      // Run all agents in parallel - individual failures produce HOLD orders
      const promises = Array.from(powersToAct).map(async power => {
        try {
          const result = await this.runSingleAgentTurn(power, turnType);
          return [power, result] as const;
        } catch (error) {
          console.error(`[${power}] Agent turn failed, defaulting to HOLD orders:`, error instanceof Error ? error.message : error);
          return [power, this.createFallbackResult(power)] as const;
        }
      });

      const completed = await Promise.all(promises);
      for (const [power, result] of completed) {
        results.set(power, result);
      }
    } else {
      // Run agents sequentially - individual failures produce HOLD orders
      for (const power of powersToAct) {
        try {
          const result = await this.runSingleAgentTurn(power, turnType);
          results.set(power, result);
        } catch (error) {
          console.error(`[${power}] Agent turn failed, defaulting to HOLD orders:`, error instanceof Error ? error.message : error);
          results.set(power, this.createFallbackResult(power));
        }
      }
    }

    return results;
  }

  /**
   * Create a fallback result when an agent's LLM call fails.
   * All units HOLD, no diplomatic messages.
   */
  private createFallbackResult(power: Power): AgentTurnResult {
    const holdOrders = fillDefaultOrders([], this.gameState, power);
    return {
      power,
      orders: holdOrders,
      reasoning: '[LLM call failed - defaulting to HOLD orders]',
    };
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

    this.logger.agentTurnStarted(power);

    this.emitEvent({
      type: 'agent_turn_started',
      timestamp: new Date(),
      data: { power },
    });

    // Build the game view for this agent
    const gameView = createAgentGameView(this.gameState, power);

    // Refresh system prompt with compression at milestone turns
    this.refreshSystemPromptIfNeeded(power, session);

    // Get recent messages from press - include both incoming and own messages, grouped by round
    const pressAPI = this.pressAPIs.get(power)!;
    const inbox = pressAPI.getInbox();
    const recentMessages = this.formatRoundAwareMessages(power, inbox.recentMessages, inbox.unreadCount);

    // Build the turn prompt with progressive compression
    const turnPrompt = buildTurnPrompt(
      gameView,
      session.memory,
      recentMessages,
      this.gameState.phase,
      this.gameState,
      this.turnNumber
    );

    // Add strategic summary
    const strategicSummary = createStrategicSummary(this.gameState, power);

    // Add promise reconciliation summary (shows who kept/broke promises last turn)
    const promiseSummary = generatePromiseSummary(this.pendingPromiseUpdates, power);
    const promiseSection = promiseSummary
      ? `\n${promiseSummary}\n`
      : '';

    // Add message analysis summary (for diplomacy phase)
    let analysisSection = '';
    if (this.gameState.phase === 'DIPLOMACY') {
      const analyses = this.pendingMessageAnalyses.get(power);
      if (analyses && analyses.length > 0) {
        analysisSection = `\n${generateAnalysisSummary(analyses)}\n`;
      }
    }

    const fullPrompt = `${strategicSummary}${promiseSection}${analysisSection}\n\n${turnPrompt}`;

    // Verbose: log the full prompt being sent
    if (this.config.verbose) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[${power}] FULL PROMPT (${this.gameState.phase} phase):`);
      console.log(`${'='.repeat(80)}`);
      console.log(fullPrompt);
      console.log(`${'='.repeat(80)}\n`);
    }

    // Add user message to conversation
    this.sessionManager.addMessage(power, {
      role: 'user',
      content: fullPrompt,
    });

    // Log context stats
    const systemMsg = session.conversationHistory.find(m => m.role === 'system');
    const contextStats = getPromptContextStats(
      systemMsg?.content ?? '',
      fullPrompt,
      this.turnNumber
    );
    if (this.config.verbose) {
      console.log(`[${power}] Context: ${contextStats.compressionLevel} compression, ` +
        `~${contextStats.totalTokens} tokens (ratio: ${contextStats.compressionRatio.toFixed(2)})`);
    }

    // Call the LLM
    const llm = this.sessionManager.getLLMProvider();
    console.log(`[${power}] Calling LLM (${session.conversationHistory.length} msgs, ~${fullPrompt.length} chars, turn ${this.turnNumber}, ${contextStats.compressionLevel})...`);
    const startTime = Date.now();
    this.logger.llmRequest(power, session.config.model, session.conversationHistory.length, fullPrompt.length);
    let response;
    try {
      response = await llm.complete({
        messages: session.conversationHistory,
        model: session.config.model,
        temperature: session.config.temperature,
        maxTokens: session.config.maxTokens,
      });
      const durationMs = Date.now() - startTime;
      this.logger.llmResponse(power, durationMs, session.config.model, response.usage, response.stopReason);
      console.log(`[${power}] LLM responded in ${(durationMs / 1000).toFixed(1)}s (${response.content.length} chars)`);

      // Verbose: log the full response
      if (this.config.verbose) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`[${power}] LLM RESPONSE:`);
        console.log(`${'─'.repeat(80)}`);
        console.log(response.content);
        console.log(`${'─'.repeat(80)}\n`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.llmError(power, errorMsg, session.config.model);
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

    // Log parsed orders
    if (parsed.orders.length > 0) {
      const orderStrings = parsed.orders.map(o => {
        if ('destination' in o && o.destination) return `${o.unit} -> ${o.destination}`;
        return `${o.unit} ${o.type}`;
      });
      this.logger.ordersParsed(power, orderStrings, response.content);
    }

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
    // Only log for phases where orders are expected (MOVEMENT, RETREAT, BUILD).
    // During DIPLOMACY, LLM responses contain diplomatic content (ANALYSIS:,
    // INTENTIONS:, SEND POWER:, reasoning) that doesn't parse as orders —
    // logging these as invalid_order would inflate the error rate.
    const isOrderPhase = this.gameState.phase !== 'DIPLOMACY';

    if (errors.length > 0 && isOrderPhase) {
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

    // Also log parse errors as invalid orders (only for order phases)
    if (parsed.errors.length > 0 && isOrderPhase) {
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
    if (deceptions.length > 0) {
      this.emitEvent({
        type: 'deception_detected',
        timestamp: new Date(),
        data: { power, deceptions },
      });
    }

    // Record to agent's persistent diary for context management
    if (this.gameState.phase === 'MOVEMENT' && valid.length > 0) {
      const orderStrings = valid.map(o => {
        if ('destination' in o && o.destination) {
          return `${o.unit} -> ${o.destination}`;
        }
        return `${o.unit} ${o.type}`;
      });
      const ordersContent = orderStrings.join(', ') +
        (diaryEntry.reasoning ? `. ${diaryEntry.reasoning.slice(0, 200)}` : '');
      recordDiaryOrders(
        session.memory,
        this.gameState.year,
        this.gameState.season,
        this.gameState.phase,
        ordersContent
      );
    } else if (diaryEntry.reasoning) {
      // Record reasoning as reflection for non-movement phases
      recordDiaryReflection(
        session.memory,
        this.gameState.year,
        this.gameState.season,
        this.gameState.phase,
        diaryEntry.reasoning.slice(0, 300)
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
    this.logger.agentTurnCompleted(power, durationMs);

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
   * Refresh the system prompt with compression when crossing compression level boundaries.
   * This replaces the system message in conversation history with a compressed version.
   */
  private refreshSystemPromptIfNeeded(power: Power, session: import('./types').AgentSession): void {
    const currentLevel = getCompressionLevel(this.turnNumber);
    const previousLevel = getCompressionLevel(Math.max(0, this.turnNumber - 1));

    // Only refresh when crossing a compression level boundary
    if (currentLevel === previousLevel && this.turnNumber > 0) {
      return;
    }

    // Don't refresh on turn 0 (initial setup handles this)
    if (this.turnNumber === 0) {
      return;
    }

    const compressedPrompt = buildSystemPrompt(
      power,
      session.config.personality!,
      undefined,
      this.turnNumber
    );

    // Replace the system message in conversation history
    const systemIdx = session.conversationHistory.findIndex(m => m.role === 'system');
    if (systemIdx >= 0) {
      const oldLength = session.conversationHistory[systemIdx].content.length;
      session.conversationHistory[systemIdx] = {
        role: 'system',
        content: compressedPrompt,
        timestamp: new Date(),
      };
      if (this.config.verbose) {
        console.log(`[${power}] System prompt compressed: ${oldLength} → ${compressedPrompt.length} chars (${currentLevel})`);
      }
    }
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
    this.promiseTracker.clear();
    this.metricsTracker.reset();
    this.pendingPromiseUpdates = [];
    this.pendingMessageAnalyses.clear();
    this.analyzedMessageIds.clear();
    this.lastPhaseMessages = [];
    this.pendingReflections.clear();
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

  /**
   * Get the negotiation metrics tracker.
   */
  getMetricsTracker(): NegotiationMetricsTracker {
    return this.metricsTracker;
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
