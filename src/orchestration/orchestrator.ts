/**
 * Game orchestrator.
 *
 * Manages phase transitions, deadlines, agent prodding, and auto-adjudication.
 * This is the "game master" that keeps games moving without human intervention.
 */

import {
  GameState,
  Power,
  Phase,
  Season,
  Order,
  RetreatOrder,
  BuildOrder,
  POWERS,
} from '../engine/types';
import {
  submitOrders,
  allOrdersSubmitted,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  cloneState,
} from '../engine/game';
import {
  GameId,
  GameEventCallback,
  GameEvent,
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
  PhaseStatus,
  SubmissionStatus,
  ResolutionSummary,
  AgentHandle,
} from './types';

/**
 * Generates default HOLD orders for all units of a power.
 */
function generateDefaultOrders(state: GameState, power: Power): Order[] {
  return state.units
    .filter((u) => u.power === power)
    .map((u) => ({ type: 'HOLD' as const, unit: u.province }));
}

/**
 * Generates default retreat orders (disband) for a power's dislodged units.
 */
function generateDefaultRetreats(state: GameState, power: Power): RetreatOrder[] {
  return state.pendingRetreats
    .filter((u) => u.power === power)
    .map((u) => ({ unit: u.province })); // No destination = disband
}

/**
 * Generates default build orders (auto-disband or skip builds) for a power.
 */
function generateDefaultBuilds(state: GameState, power: Power): BuildOrder[] {
  const buildCount = state.pendingBuilds.get(power) || 0;

  if (buildCount < 0) {
    // Must disband - pick units to disband (farthest from home centers)
    const powerUnits = state.units.filter((u) => u.power === power);
    const toDisband = powerUnits.slice(0, -buildCount);
    return toDisband.map((u) => ({
      type: 'DISBAND' as const,
      province: u.province,
    }));
  }

  // Positive buildCount - skip builds (waive)
  return [];
}

/**
 * Game orchestrator that manages turn progression and deadlines.
 */
export class GameOrchestrator {
  private gameId: GameId;
  private config: OrchestratorConfig;
  private eventCallbacks: GameEventCallback[] = [];
  private phaseStatus: PhaseStatus | null = null;
  private agents: Map<Power, AgentHandle> = new Map();

  // Timer handles for deadline management
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private autoResolveTimer: ReturnType<typeof setTimeout> | null = null;

  // Callback for when auto-resolve should happen
  private autoResolveCallback: (() => void) | null = null;

  constructor(gameId: GameId, config: Partial<OrchestratorConfig> = {}) {
    this.gameId = gameId;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
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
   * Emits a game event to all listeners.
   */
  private emit(event: GameEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (err) {
        console.error('Event callback error:', err);
      }
    }
  }

  /**
   * Registers an agent for a power.
   */
  registerAgent(handle: AgentHandle): void {
    this.agents.set(handle.power, handle);
  }

  /**
   * Gets the agent handle for a power.
   */
  getAgent(power: Power): AgentHandle | undefined {
    return this.agents.get(power);
  }

  /**
   * Updates agent activity timestamp.
   */
  markAgentActive(power: Power): void {
    const agent = this.agents.get(power);
    if (agent) {
      agent.isResponsive = true;
      agent.lastActivity = new Date();
    }
  }

  /**
   * Gets the current phase status.
   */
  getPhaseStatus(): PhaseStatus | null {
    return this.phaseStatus;
  }

  /**
   * Gets the phase duration based on phase type.
   */
  private getPhaseDuration(phase: Phase): number {
    switch (phase) {
      case 'DIPLOMACY':
        return this.config.diplomacyPhaseDuration;
      case 'MOVEMENT':
        return this.config.movementPhaseDuration;
      case 'RETREAT':
        return this.config.retreatPhaseDuration;
      case 'BUILD':
        return this.config.buildPhaseDuration;
    }
  }

  /**
   * Gets powers that need to submit orders for the current phase.
   */
  getActivePowers(state: GameState): Power[] {
    switch (state.phase) {
      case 'DIPLOMACY':
      case 'MOVEMENT':
        // Powers with units need to submit
        return [...new Set(state.units.map((u) => u.power))];

      case 'RETREAT':
        // Powers with pending retreats need to submit
        return [...new Set(state.pendingRetreats.map((u) => u.power))];

      case 'BUILD':
        // Powers with pending builds/disbands need to submit
        return [...state.pendingBuilds.keys()].filter(
          (p) => state.pendingBuilds.get(p) !== 0
        );
    }
  }

  /**
   * Starts a new phase with deadline tracking.
   */
  startPhase(state: GameState): void {
    this.clearTimers();

    const now = new Date();
    const duration = this.getPhaseDuration(state.phase);
    const deadline = new Date(now.getTime() + duration);
    const activePowers = this.getActivePowers(state);

    // Initialize submission tracking
    const submissions: SubmissionStatus[] = activePowers.map((power) => ({
      power,
      submitted: false,
      orderCount: 0,
    }));

    this.phaseStatus = {
      year: state.year,
      season: state.season,
      phase: state.phase,
      deadline,
      startedAt: now,
      submissions,
      nudgeSent: false,
    };

    // Emit phase started event
    this.emit({
      type: 'PHASE_STARTED',
      gameId: this.gameId,
      timestamp: now,
      year: state.year,
      season: state.season,
      phase: state.phase,
      deadline,
      activePowers,
    });

    // Set up deadline timer
    this.deadlineTimer = setTimeout(() => {
      this.handleDeadline(state);
    }, duration);

    // Set up nudge timer
    const nudgeTime = duration - this.config.nudgeBeforeDeadline;
    if (nudgeTime > 0) {
      this.nudgeTimer = setTimeout(() => {
        this.handleNudge(state);
      }, nudgeTime);
    }
  }

  /**
   * Handles the nudge (deadline approaching) notification.
   */
  private handleNudge(state: GameState): void {
    if (!this.phaseStatus) return;

    const pendingPowers = this.phaseStatus.submissions
      .filter((s) => !s.submitted)
      .map((s) => s.power);

    if (pendingPowers.length === 0) return;

    this.phaseStatus.nudgeSent = true;
    const now = new Date();
    const timeRemaining = this.phaseStatus.deadline.getTime() - now.getTime();

    // Emit phase ending soon event
    this.emit({
      type: 'PHASE_ENDING_SOON',
      gameId: this.gameId,
      timestamp: now,
      year: this.phaseStatus.year,
      season: this.phaseStatus.season,
      phase: this.phaseStatus.phase,
      deadline: this.phaseStatus.deadline,
      timeRemaining,
      pendingPowers,
    });

    // Nudge each pending agent
    for (const power of pendingPowers) {
      this.emit({
        type: 'AGENT_NUDGED',
        gameId: this.gameId,
        timestamp: now,
        power,
        deadline: this.phaseStatus.deadline,
        timeRemaining,
      });
    }
  }

  /**
   * Handles phase deadline expiration.
   */
  private handleDeadline(state: GameState): void {
    if (!this.phaseStatus) return;

    const timeoutPowers: Power[] = [];
    const now = new Date();

    // Find powers that missed the deadline
    for (const submission of this.phaseStatus.submissions) {
      if (!submission.submitted) {
        timeoutPowers.push(submission.power);

        // Emit agent timeout event
        this.emit({
          type: 'AGENT_TIMEOUT',
          gameId: this.gameId,
          timestamp: now,
          power: submission.power,
          phase: state.phase,
          action: this.config.autoHoldOnTimeout ? 'auto-hold' : 'none',
        });

        // Update agent tracking if registered
        const agent = this.agents.get(submission.power);
        if (agent) {
          agent.missedDeadlines++;
          agent.isResponsive = false;

          // Check if agent should be marked inactive
          if (agent.missedDeadlines >= this.config.maxMissedDeadlines) {
            this.emit({
              type: 'AGENT_INACTIVE',
              gameId: this.gameId,
              timestamp: now,
              power: submission.power,
              missedDeadlines: agent.missedDeadlines,
            });
          }
        }

        // Auto-submit default orders if configured
        if (this.config.autoHoldOnTimeout) {
          this.submitDefaultOrders(state, submission.power);
        }
      }
    }

    // Emit phase ended event
    this.emit({
      type: 'PHASE_ENDED',
      gameId: this.gameId,
      timestamp: now,
      year: this.phaseStatus.year,
      season: this.phaseStatus.season,
      phase: this.phaseStatus.phase,
      timeoutPowers,
    });
  }

  /**
   * Submits default orders for a power (HOLD for movement, disband for retreats).
   */
  private submitDefaultOrders(state: GameState, power: Power): void {
    switch (state.phase) {
      case 'DIPLOMACY':
      case 'MOVEMENT': {
        const orders = generateDefaultOrders(state, power);
        submitOrders(state, power, orders);
        break;
      }
      case 'RETREAT': {
        const retreats = generateDefaultRetreats(state, power);
        submitRetreats(state, power, retreats);
        break;
      }
      case 'BUILD': {
        const builds = generateDefaultBuilds(state, power);
        submitBuilds(state, power, builds);
        break;
      }
    }

    // Mark as submitted
    const submission = this.phaseStatus?.submissions.find((s) => s.power === power);
    if (submission) {
      submission.submitted = true;
      submission.submittedAt = new Date();
    }
  }

  /**
   * Records that a power has submitted orders.
   */
  recordSubmission(state: GameState, power: Power, orderCount: number): void {
    if (!this.phaseStatus) return;

    const submission = this.phaseStatus.submissions.find((s) => s.power === power);
    if (submission) {
      submission.submitted = true;
      submission.submittedAt = new Date();
      submission.orderCount = orderCount;
    }

    // Mark agent as active
    this.markAgentActive(power);

    // Reset missed deadline counter on successful submission
    const agent = this.agents.get(power);
    if (agent) {
      agent.missedDeadlines = 0;
    }

    // Emit orders submitted event
    this.emit({
      type: 'ORDERS_SUBMITTED',
      gameId: this.gameId,
      timestamp: new Date(),
      power,
      orderCount,
    });

    // Check if all orders received
    if (this.checkAllSubmitted()) {
      this.handleAllOrdersReceived(state);
    }
  }

  /**
   * Checks if all active powers have submitted.
   */
  private checkAllSubmitted(): boolean {
    if (!this.phaseStatus) return false;
    return this.phaseStatus.submissions.every((s) => s.submitted);
  }

  /**
   * Sets the callback to invoke when auto-resolution should happen.
   */
  setAutoResolveCallback(callback: () => void): void {
    this.autoResolveCallback = callback;
  }

  /**
   * Handles the case when all orders have been received.
   */
  private handleAllOrdersReceived(state: GameState): void {
    if (!this.phaseStatus) return;

    const now = new Date();

    this.emit({
      type: 'ALL_ORDERS_RECEIVED',
      gameId: this.gameId,
      timestamp: now,
      year: this.phaseStatus.year,
      season: this.phaseStatus.season,
      phase: this.phaseStatus.phase,
    });

    // Auto-resolve if configured
    if (this.config.autoResolveOnComplete && this.autoResolveCallback) {
      const elapsed = now.getTime() - this.phaseStatus.startedAt.getTime();
      const remaining = this.config.minPhaseDuration - elapsed;

      if (remaining <= 0) {
        // Min time already passed, resolve now
        this.clearTimers();
        this.autoResolveCallback();
      } else {
        // Schedule resolution for when min time passes
        this.clearTimers();
        this.autoResolveTimer = setTimeout(() => {
          if (this.autoResolveCallback) {
            this.autoResolveCallback();
          }
        }, remaining);
      }
    }
  }

  /**
   * Checks if we should auto-resolve (all submitted and minimum time passed).
   */
  shouldAutoResolve(): boolean {
    if (!this.config.autoResolveOnComplete) return false;
    if (!this.phaseStatus) return false;
    if (!this.checkAllSubmitted()) return false;

    const elapsed = Date.now() - this.phaseStatus.startedAt.getTime();
    return elapsed >= this.config.minPhaseDuration;
  }

  /**
   * Resolves the current phase and advances the game.
   * Returns resolution summary.
   */
  resolvePhase(state: GameState): ResolutionSummary {
    const summary: ResolutionSummary = {
      successfulMoves: 0,
      failedMoves: 0,
      dislodgedUnits: 0,
      unitsBuilt: 0,
      unitsDisbanded: 0,
      supplyChanges: [],
    };

    const prevSupplyCenters = new Map(state.supplyCenters);
    const prevPhase = state.phase;

    switch (state.phase) {
      case 'DIPLOMACY':
      case 'MOVEMENT': {
        const result = resolveMovement(state);

        // Count results
        for (const [, resolution] of result.results) {
          if (resolution.order.type === 'MOVE') {
            if (resolution.success) {
              summary.successfulMoves++;
            } else {
              summary.failedMoves++;
            }
          }
        }
        summary.dislodgedUnits = result.dislodged.length;
        break;
      }

      case 'RETREAT': {
        const prevUnitCount = state.units.length + state.pendingRetreats.length;
        resolveRetreats(state);
        summary.unitsDisbanded = prevUnitCount - state.units.length;
        break;
      }

      case 'BUILD': {
        const prevUnitCount = state.units.length;
        resolveBuilds(state);
        const diff = state.units.length - prevUnitCount;
        if (diff > 0) {
          summary.unitsBuilt = diff;
        } else {
          summary.unitsDisbanded = -diff;
        }
        break;
      }
    }

    // Detect supply center changes
    for (const [territory, newOwner] of state.supplyCenters) {
      const prevOwner = prevSupplyCenters.get(territory);
      if (prevOwner !== newOwner) {
        summary.supplyChanges.push({
          territory,
          from: prevOwner,
          to: newOwner,
        });
      }
    }

    // Emit resolution event
    this.emit({
      type: 'ORDERS_RESOLVED',
      gameId: this.gameId,
      timestamp: new Date(),
      year: this.phaseStatus?.year || state.year,
      season: this.phaseStatus?.season || state.season,
      phase: prevPhase,
      summary,
    });

    // Clear phase status (new phase will be started by GameSession)
    this.phaseStatus = null;

    return summary;
  }

  /**
   * Clears all pending timers.
   */
  clearTimers(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    if (this.nudgeTimer) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    if (this.autoResolveTimer) {
      clearTimeout(this.autoResolveTimer);
      this.autoResolveTimer = null;
    }
  }

  /**
   * Pauses the orchestrator (stops timers).
   */
  pause(): void {
    this.clearTimers();
  }

  /**
   * Resumes the orchestrator with remaining time.
   */
  resume(state: GameState): void {
    if (!this.phaseStatus) return;

    const now = Date.now();
    const remaining = this.phaseStatus.deadline.getTime() - now;

    if (remaining <= 0) {
      // Deadline already passed, trigger immediately
      this.handleDeadline(state);
      return;
    }

    // Reset deadline timer with remaining time
    this.deadlineTimer = setTimeout(() => {
      this.handleDeadline(state);
    }, remaining);

    // Reset nudge timer if there's still time
    if (!this.phaseStatus.nudgeSent) {
      const nudgeRemaining = remaining - this.config.nudgeBeforeDeadline;
      if (nudgeRemaining > 0) {
        this.nudgeTimer = setTimeout(() => {
          this.handleNudge(state);
        }, nudgeRemaining);
      }
    }
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Updates configuration (for runtime adjustments).
   */
  updateConfig(config: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
