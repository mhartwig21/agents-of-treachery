/**
 * Game session management.
 *
 * Wraps GameState, PressSystem, and GameOrchestrator into a unified
 * game session with lifecycle management.
 */

import {
  GameState,
  Power,
  Order,
  RetreatOrder,
  BuildOrder,
  POWERS,
} from '../engine/types';
import {
  createInitialState,
  submitOrders,
  submitRetreats,
  submitBuilds,
  cloneState,
  checkVictory,
} from '../engine/game';
import { PressSystem } from '../press/press-system';
import { PressContext } from '../press/types';
import { GameOrchestrator } from './orchestrator';
import {
  GameId,
  GameStatus,
  GameEventCallback,
  GameEvent,
  OrchestratorConfig,
  AgentHandle,
  GameSessionSnapshot,
  PhaseStatus,
} from './types';

/**
 * Generates a unique game ID.
 */
function generateGameId(): GameId {
  return `game_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Configuration for creating a game session.
 */
export interface GameSessionConfig {
  gameId?: GameId;
  orchestratorConfig?: Partial<OrchestratorConfig>;
  pressConfig?: Partial<import('../press/types').PressConfig>;
}

/**
 * A complete game session managing state, press, and orchestration.
 */
export class GameSession {
  private gameId: GameId;
  private status: GameStatus = 'PENDING';
  private gameState: GameState;
  private pressSystem: PressSystem;
  private orchestrator: GameOrchestrator;
  private eventHistory: GameEvent[] = [];
  private eventCallbacks: GameEventCallback[] = [];
  private createdAt: Date;
  private startedAt?: Date;
  private completedAt?: Date;

  constructor(config: GameSessionConfig = {}) {
    this.gameId = config.gameId || generateGameId();
    this.gameState = createInitialState();
    this.createdAt = new Date();

    // Initialize press system with initial context
    const pressContext = this.createPressContext();
    this.pressSystem = new PressSystem(pressContext, config.pressConfig);

    // Initialize orchestrator
    this.orchestrator = new GameOrchestrator(
      this.gameId,
      config.orchestratorConfig
    );

    // Forward orchestrator events to session listeners
    this.orchestrator.onEvent((event) => {
      this.recordAndEmit(event);
    });

    // Set up auto-resolve callback
    this.orchestrator.setAutoResolveCallback(() => {
      if (this.status === 'ACTIVE') {
        this.resolvePhase();
      }
    });

    // Emit game created event
    this.emitEvent({
      type: 'GAME_CREATED',
      gameId: this.gameId,
      timestamp: new Date(),
    });
  }

  /**
   * Creates a press context from current game state.
   */
  private createPressContext(): PressContext {
    return {
      gameId: this.gameId,
      year: this.gameState.year,
      season: this.gameState.season,
      phase: this.gameState.phase,
    };
  }

  /**
   * Records an event in history and emits to all listeners.
   */
  private recordAndEmit(event: GameEvent): void {
    this.eventHistory.push(event);
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (err) {
        console.error('Event callback error:', err);
      }
    }
  }

  /**
   * Emits an event (records to history and notifies listeners).
   */
  private emitEvent(event: GameEvent): void {
    this.recordAndEmit(event);
  }

  /**
   * Gets the game ID.
   */
  getGameId(): GameId {
    return this.gameId;
  }

  /**
   * Gets the current game status.
   */
  getStatus(): GameStatus {
    return this.status;
  }

  /**
   * Gets a clone of the current game state.
   */
  getGameState(): GameState {
    return cloneState(this.gameState);
  }

  /**
   * Gets the press system for messaging.
   */
  getPressSystem(): PressSystem {
    return this.pressSystem;
  }

  /**
   * Gets the orchestrator for direct access.
   */
  getOrchestrator(): GameOrchestrator {
    return this.orchestrator;
  }

  /**
   * Gets the current phase status.
   */
  getPhaseStatus(): PhaseStatus | null {
    return this.orchestrator.getPhaseStatus();
  }

  /**
   * Gets the event history.
   */
  getEventHistory(): GameEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Registers an event listener.
   */
  onEvent(callback: GameEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const idx = this.eventCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.eventCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Registers an agent for a power.
   */
  registerAgent(handle: AgentHandle): void {
    this.orchestrator.registerAgent(handle);
  }

  /**
   * Registers multiple agents at once.
   */
  registerAgents(handles: AgentHandle[]): void {
    for (const handle of handles) {
      this.registerAgent(handle);
    }
  }

  /**
   * Starts the game.
   */
  start(): void {
    if (this.status !== 'PENDING') {
      throw new Error(`Cannot start game in ${this.status} status`);
    }

    this.status = 'ACTIVE';
    this.startedAt = new Date();

    // Emit game started event
    this.emitEvent({
      type: 'GAME_STARTED',
      gameId: this.gameId,
      timestamp: this.startedAt,
      year: this.gameState.year,
      season: this.gameState.season,
      phase: this.gameState.phase,
    });

    // Start the first phase
    this.orchestrator.startPhase(this.gameState);
  }

  /**
   * Pauses the game.
   */
  pause(reason?: string): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Cannot pause game in ${this.status} status`);
    }

    this.status = 'PAUSED';
    this.orchestrator.pause();

    this.emitEvent({
      type: 'GAME_PAUSED',
      gameId: this.gameId,
      timestamp: new Date(),
      reason,
    });
  }

  /**
   * Resumes the game.
   */
  resume(): void {
    if (this.status !== 'PAUSED') {
      throw new Error(`Cannot resume game in ${this.status} status`);
    }

    this.status = 'ACTIVE';
    this.orchestrator.resume(this.gameState);

    this.emitEvent({
      type: 'GAME_RESUMED',
      gameId: this.gameId,
      timestamp: new Date(),
    });
  }

  /**
   * Abandons the game early.
   */
  abandon(reason: string): void {
    if (this.status === 'COMPLETED' || this.status === 'ABANDONED') {
      throw new Error(`Game already ended`);
    }

    this.status = 'ABANDONED';
    this.completedAt = new Date();
    this.orchestrator.clearTimers();

    this.emitEvent({
      type: 'GAME_ABANDONED',
      gameId: this.gameId,
      timestamp: this.completedAt,
      reason,
    });
  }

  /**
   * Submits movement orders for a power.
   */
  submitMovementOrders(power: Power, orders: Order[]): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Game is not active`);
    }
    if (
      this.gameState.phase !== 'DIPLOMACY' &&
      this.gameState.phase !== 'MOVEMENT'
    ) {
      throw new Error(`Cannot submit movement orders in ${this.gameState.phase} phase`);
    }

    submitOrders(this.gameState, power, orders);
    this.orchestrator.recordSubmission(this.gameState, power, orders.length);
  }

  /**
   * Submits retreat orders for a power.
   */
  submitRetreatOrders(power: Power, retreats: RetreatOrder[]): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Game is not active`);
    }
    if (this.gameState.phase !== 'RETREAT') {
      throw new Error(`Cannot submit retreat orders in ${this.gameState.phase} phase`);
    }

    submitRetreats(this.gameState, power, retreats);
    this.orchestrator.recordSubmission(this.gameState, power, retreats.length);
  }

  /**
   * Submits build/disband orders for a power.
   */
  submitBuildOrders(power: Power, builds: BuildOrder[]): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Game is not active`);
    }
    if (this.gameState.phase !== 'BUILD') {
      throw new Error(`Cannot submit build orders in ${this.gameState.phase} phase`);
    }

    submitBuilds(this.gameState, power, builds);
    this.orchestrator.recordSubmission(this.gameState, power, builds.length);
  }

  /**
   * Manually triggers phase resolution.
   * Returns true if the game continues, false if it ended.
   */
  resolvePhase(): boolean {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Game is not active`);
    }

    // Resolve the phase
    this.orchestrator.resolvePhase(this.gameState);

    // Check for game end
    if (this.gameState.winner || this.gameState.draw) {
      this.completeGame();
      return false;
    }

    // Update press context for new phase
    this.pressSystem.updateContext(this.createPressContext());

    // Start the next phase
    this.orchestrator.startPhase(this.gameState);

    return true;
  }

  /**
   * Completes the game (winner found or draw).
   */
  private completeGame(): void {
    this.status = 'COMPLETED';
    this.completedAt = new Date();
    this.orchestrator.clearTimers();

    this.emitEvent({
      type: 'GAME_COMPLETED',
      gameId: this.gameId,
      timestamp: this.completedAt,
      winner: this.gameState.winner,
      isDraw: this.gameState.draw || false,
      finalYear: this.gameState.year,
    });
  }

  /**
   * Forces a phase deadline (useful for testing or manual advancement).
   */
  forceDeadline(): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Game is not active`);
    }

    // Clear timers and trigger deadline handling
    this.orchestrator.clearTimers();
    // The deadline handler will submit default orders for missing powers
    // Then we can resolve
  }

  /**
   * Creates a snapshot of the session for persistence.
   */
  snapshot(): GameSessionSnapshot {
    const agents: AgentHandle[] = [];
    for (const power of POWERS) {
      const agent = this.orchestrator.getAgent(power);
      if (agent) {
        agents.push(agent);
      }
    }

    return {
      gameId: this.gameId,
      status: this.status,
      gameState: cloneState(this.gameState),
      phaseStatus: this.orchestrator.getPhaseStatus(),
      agents,
      eventHistory: [...this.eventHistory],
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    };
  }

  /**
   * Restores a session from a snapshot.
   */
  static fromSnapshot(
    snapshot: GameSessionSnapshot,
    config: Omit<GameSessionConfig, 'gameId'> = {}
  ): GameSession {
    const session = new GameSession({
      gameId: snapshot.gameId,
      ...config,
    });

    // Restore state
    session.gameState = cloneState(snapshot.gameState);
    session.status = snapshot.status;
    session.createdAt = snapshot.createdAt;
    session.startedAt = snapshot.startedAt;
    session.completedAt = snapshot.completedAt;
    session.eventHistory = [...snapshot.eventHistory];

    // Restore agents
    for (const agent of snapshot.agents) {
      session.registerAgent(agent);
    }

    // Update press context
    session.pressSystem.updateContext(session.createPressContext());

    // If the game was active, resume the orchestrator
    if (session.status === 'ACTIVE' && snapshot.phaseStatus) {
      // Manually set phase status and resume timers
      // This is a simplified restoration - full implementation would
      // need to restore the exact phase status
      session.orchestrator.startPhase(session.gameState);
    }

    return session;
  }

  /**
   * Gets the current year.
   */
  getYear(): number {
    return this.gameState.year;
  }

  /**
   * Gets the current season.
   */
  getSeason(): string {
    return this.gameState.season;
  }

  /**
   * Gets the current phase.
   */
  getPhase(): string {
    return this.gameState.phase;
  }

  /**
   * Checks if a specific power has submitted orders for the current phase.
   */
  hasSubmitted(power: Power): boolean {
    const phaseStatus = this.orchestrator.getPhaseStatus();
    if (!phaseStatus) return false;

    const submission = phaseStatus.submissions.find((s) => s.power === power);
    return submission?.submitted || false;
  }

  /**
   * Gets all powers that have not yet submitted orders.
   */
  getPendingPowers(): Power[] {
    const phaseStatus = this.orchestrator.getPhaseStatus();
    if (!phaseStatus) return [];

    return phaseStatus.submissions
      .filter((s) => !s.submitted)
      .map((s) => s.power);
  }

  /**
   * Gets the winner if the game has ended.
   */
  getWinner(): Power | undefined {
    return this.gameState.winner;
  }

  /**
   * Checks if the game ended in a draw.
   */
  isDraw(): boolean {
    return this.gameState.draw || false;
  }
}
