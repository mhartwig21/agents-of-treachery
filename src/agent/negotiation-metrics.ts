/**
 * Negotiation Quality Metrics.
 *
 * Tracks and scores negotiation effectiveness across a Diplomacy game.
 * Measures promise-to-action correlation, alliance patterns, deceptive
 * messaging detection, and per-power scoring.
 *
 * Designed for post-game analysis and real-time agent context enrichment.
 */

import type { Power, Season } from '../engine/types';
import { POWERS } from '../engine/types';
import type { Message } from '../press/types';
import type { MessageAnalysis } from './types';
import type { ExtractedPromise, PromiseReconciliation } from '../analysis/promise-tracker';

/**
 * Promise correlation metrics for a single power.
 */
export interface PromiseCorrelation {
  /** Power being measured */
  power: Power;
  /** Total promises made */
  totalPromises: number;
  /** Promises kept (verified) */
  promisesKept: number;
  /** Promises broken (verified) */
  promisesBroken: number;
  /** Promises with unknown outcome */
  promisesUnverified: number;
  /** Keep rate (0-1), only counting verified promises */
  keepRate: number;
  /** Weighted keep rate factoring in confidence */
  weightedKeepRate: number;
  /** Breakdown by promise type */
  byType: Record<string, { kept: number; broken: number; total: number }>;
}

/**
 * Alliance pattern detected between powers.
 */
export interface AlliancePattern {
  /** Powers involved */
  powers: Power[];
  /** When the alliance was first detected */
  formedTurn: { year: number; season: Season };
  /** When the alliance ended (if it did) */
  endedTurn?: { year: number; season: Season };
  /** How many turns the alliance lasted */
  duration: number;
  /** Whether the alliance ended in betrayal */
  endedInBetrayal: boolean;
  /** Stability score (0-1): ratio of cooperative vs hostile actions during alliance */
  stability: number;
  /** Type of alliance pattern */
  type: 'bilateral' | 'coalition';
}

/**
 * Deception metrics for a single power.
 */
export interface DeceptionMetrics {
  /** Power being measured */
  power: Power;
  /** Total messages sent */
  totalMessagesSent: number;
  /** Messages flagged with red flags */
  messagesWithRedFlags: number;
  /** Messages classified as deceptive intent */
  deceptiveIntentCount: number;
  /** Average credibility score assigned by recipients */
  avgCredibilityScore: number;
  /** Number of contradictory messages (different things to different powers) */
  contradictionCount: number;
  /** Deception rate (0-1) based on flagged messages */
  deceptionRate: number;
  /** Most common red flags */
  topRedFlags: string[];
}

/**
 * Comprehensive negotiation score for a single power.
 */
export interface PowerNegotiationScore {
  /** Power being scored */
  power: Power;
  /** Overall negotiation quality (0-100) */
  overallScore: number;
  /** Trustworthiness: how often they keep promises (0-100) */
  trustworthiness: number;
  /** Diplomatic activity: volume of messaging (0-100) */
  diplomaticActivity: number;
  /** Deception propensity: tendency to deceive (0-100, lower is more honest) */
  deceptionPropensity: number;
  /** Alliance reliability: how stable their alliances are (0-100) */
  allianceReliability: number;
  /** Strategic messaging: how effective their diplomacy is (0-100) */
  strategicEffectiveness: number;
  /** Promise correlation data */
  promiseCorrelation: PromiseCorrelation;
  /** Deception data */
  deception: DeceptionMetrics;
}

/**
 * Full negotiation metrics report for a game.
 */
export interface NegotiationMetricsReport {
  /** Game identifier */
  gameId: string;
  /** Scores for each power */
  powerScores: PowerNegotiationScore[];
  /** Alliance patterns detected */
  alliancePatterns: AlliancePattern[];
  /** Total messages exchanged */
  totalMessages: number;
  /** Total promises extracted */
  totalPromises: number;
  /** Overall promise keep rate */
  overallKeepRate: number;
  /** Game turns analyzed */
  turnsAnalyzed: number;
}

/**
 * Recorded interaction for metrics tracking.
 */
interface RecordedInteraction {
  year: number;
  season: Season;
  sender: Power;
  receiver: Power;
  messageId: string;
  analysis?: MessageAnalysis;
}

/**
 * Per-turn alliance signal between two powers.
 */
interface AllianceSignal {
  year: number;
  season: Season;
  power1: Power;
  power2: Power;
  signal: 'cooperative' | 'hostile' | 'neutral';
}

/**
 * Tracks negotiation quality metrics across a game.
 */
export class NegotiationMetricsTracker {
  private gameId: string;
  private interactions: RecordedInteraction[] = [];
  private promiseRecords: Array<{
    promise: ExtractedPromise;
    reconciliation?: PromiseReconciliation;
  }> = [];
  private allianceSignals: AllianceSignal[] = [];
  private messagesByPower: Map<Power, number> = new Map();
  private analysesBySender: Map<Power, MessageAnalysis[]> = new Map();
  private turnsTracked = 0;

  constructor(gameId: string) {
    this.gameId = gameId;
    for (const power of POWERS) {
      this.messagesByPower.set(power, 0);
      this.analysesBySender.set(power, []);
    }
  }

  /**
   * Records a message exchange with optional analysis.
   */
  recordMessage(
    message: Message,
    receiver: Power,
    analysis?: MessageAnalysis
  ): void {
    this.interactions.push({
      year: 0, // Set by caller via recordTurnMessages
      season: 'SPRING',
      sender: message.sender,
      receiver,
      messageId: message.id,
      analysis,
    });

    const count = this.messagesByPower.get(message.sender) ?? 0;
    this.messagesByPower.set(message.sender, count + 1);

    if (analysis) {
      const analyses = this.analysesBySender.get(message.sender) ?? [];
      analyses.push(analysis);
      this.analysesBySender.set(message.sender, analyses);
    }
  }

  /**
   * Records messages from a turn with context.
   */
  recordTurnMessages(
    messages: Message[],
    analyses: MessageAnalysis[],
    year: number,
    season: Season
  ): void {
    this.turnsTracked++;

    const analysisMap = new Map<string, MessageAnalysis>();
    for (const a of analyses) {
      analysisMap.set(a.messageId, a);
    }

    for (const message of messages) {
      // Determine receiver from channel ID for bilateral
      let receiver: Power | undefined;
      if (message.channelId.startsWith('bilateral:')) {
        const [, power1, power2] = message.channelId.split(':');
        receiver = (message.sender === power1 ? power2 : power1) as Power;
      }

      if (receiver) {
        const analysis = analysisMap.get(message.id);
        const interaction: RecordedInteraction = {
          year,
          season,
          sender: message.sender,
          receiver,
          messageId: message.id,
          analysis,
        };
        this.interactions.push(interaction);

        const count = this.messagesByPower.get(message.sender) ?? 0;
        this.messagesByPower.set(message.sender, count + 1);

        if (analysis) {
          const senderAnalyses = this.analysesBySender.get(message.sender) ?? [];
          senderAnalyses.push(analysis);
          this.analysesBySender.set(message.sender, senderAnalyses);
        }
      }
    }
  }

  /**
   * Records promise extraction and reconciliation results.
   */
  recordPromises(
    promises: ExtractedPromise[],
    reconciliations: PromiseReconciliation[]
  ): void {
    const reconMap = new Map<string, PromiseReconciliation>();
    for (const r of reconciliations) {
      reconMap.set(r.promise.id, r);
    }

    for (const promise of promises) {
      this.promiseRecords.push({
        promise,
        reconciliation: reconMap.get(promise.id),
      });
    }
  }

  /**
   * Records an alliance signal from observed actions.
   */
  recordAllianceSignal(
    power1: Power,
    power2: Power,
    signal: 'cooperative' | 'hostile' | 'neutral',
    year: number,
    season: Season
  ): void {
    this.allianceSignals.push({
      year,
      season,
      power1: [power1, power2].sort()[0] as Power,
      power2: [power1, power2].sort()[1] as Power,
      signal,
    });
  }

  /**
   * Calculates promise-to-action correlation for a power.
   */
  calculatePromiseCorrelation(power: Power): PromiseCorrelation {
    const powerPromises = this.promiseRecords.filter(
      r => r.promise.promiser === power
    );

    const byType: Record<string, { kept: number; broken: number; total: number }> = {};
    let kept = 0;
    let broken = 0;
    let unverified = 0;
    let weightedKeptSum = 0;
    let weightedTotalSum = 0;

    for (const record of powerPromises) {
      const type = record.promise.type;
      if (!byType[type]) {
        byType[type] = { kept: 0, broken: 0, total: 0 };
      }
      byType[type].total++;

      if (record.reconciliation) {
        const confidence = record.reconciliation.confidence;
        if (confidence >= 0.5) {
          if (record.reconciliation.kept) {
            kept++;
            byType[type].kept++;
            weightedKeptSum += confidence;
          } else {
            broken++;
            byType[type].broken++;
          }
          weightedTotalSum += confidence;
        } else {
          unverified++;
        }
      } else {
        unverified++;
      }
    }

    const verified = kept + broken;
    const keepRate = verified > 0 ? kept / verified : 0;
    const weightedKeepRate = weightedTotalSum > 0
      ? weightedKeptSum / weightedTotalSum
      : 0;

    return {
      power,
      totalPromises: powerPromises.length,
      promisesKept: kept,
      promisesBroken: broken,
      promisesUnverified: unverified,
      keepRate,
      weightedKeepRate,
      byType,
    };
  }

  /**
   * Detects alliance patterns from recorded signals.
   */
  detectAlliancePatterns(): AlliancePattern[] {
    const patterns: AlliancePattern[] = [];
    const pairSignals = new Map<string, AllianceSignal[]>();

    // Group signals by power pair
    for (const signal of this.allianceSignals) {
      const key = `${signal.power1}-${signal.power2}`;
      const signals = pairSignals.get(key) ?? [];
      signals.push(signal);
      pairSignals.set(key, signals);
    }

    for (const [key, signals] of pairSignals) {
      const [power1, power2] = key.split('-') as [Power, Power];
      const sorted = signals.sort((a, b) => {
        const turnA = a.year * 2 + (a.season === 'FALL' ? 1 : 0);
        const turnB = b.year * 2 + (b.season === 'FALL' ? 1 : 0);
        return turnA - turnB;
      });

      // Detect alliance periods: consecutive cooperative signals
      let allianceStart: { year: number; season: Season } | null = null;
      let cooperativeCount = 0;
      let totalDuringAlliance = 0;

      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];

        if (s.signal === 'cooperative') {
          if (!allianceStart) {
            allianceStart = { year: s.year, season: s.season };
            cooperativeCount = 0;
            totalDuringAlliance = 0;
          }
          cooperativeCount++;
          totalDuringAlliance++;
        } else if (s.signal === 'hostile' && allianceStart) {
          totalDuringAlliance++;

          // Alliance ended - record it if it lasted at least 2 turns
          const duration = totalDuringAlliance;
          if (duration >= 2) {
            const stability = cooperativeCount / totalDuringAlliance;
            patterns.push({
              powers: [power1, power2],
              formedTurn: allianceStart,
              endedTurn: { year: s.year, season: s.season },
              duration,
              endedInBetrayal: true,
              stability,
              type: 'bilateral',
            });
          }
          allianceStart = null;
        } else if (s.signal === 'neutral' && allianceStart) {
          totalDuringAlliance++;
        }
      }

      // If alliance is still active at end
      if (allianceStart && totalDuringAlliance >= 2) {
        const stability = cooperativeCount / totalDuringAlliance;
        patterns.push({
          powers: [power1, power2],
          formedTurn: allianceStart,
          duration: totalDuringAlliance,
          endedInBetrayal: false,
          stability,
          type: 'bilateral',
        });
      }
    }

    return patterns;
  }

  /**
   * Calculates deception metrics for a power.
   */
  calculateDeceptionMetrics(power: Power): DeceptionMetrics {
    const totalSent = this.messagesByPower.get(power) ?? 0;
    const analyses = this.analysesBySender.get(power) ?? [];

    let redFlagCount = 0;
    let deceptiveIntentCount = 0;
    let credibilitySum = 0;
    let credibilityCount = 0;
    const redFlagFrequency = new Map<string, number>();

    for (const analysis of analyses) {
      if (analysis.redFlags.length > 0) {
        redFlagCount++;
        for (const flag of analysis.redFlags) {
          redFlagFrequency.set(flag, (redFlagFrequency.get(flag) ?? 0) + 1);
        }
      }
      if (analysis.senderIntent === 'deception') {
        deceptiveIntentCount++;
      }
      credibilitySum += analysis.credibilityScore;
      credibilityCount++;
    }

    // Detect contradictions: same sender, different receivers, same turn, conflicting intents
    const contradictions = this.detectContradictions(power);

    const topRedFlags = [...redFlagFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([flag]) => flag);

    return {
      power,
      totalMessagesSent: totalSent,
      messagesWithRedFlags: redFlagCount,
      deceptiveIntentCount,
      avgCredibilityScore: credibilityCount > 0
        ? credibilitySum / credibilityCount
        : 0.5,
      contradictionCount: contradictions,
      deceptionRate: totalSent > 0
        ? (redFlagCount + deceptiveIntentCount) / totalSent
        : 0,
      topRedFlags,
    };
  }

  /**
   * Detects contradictory messages from a power in the same turn.
   */
  private detectContradictions(power: Power): number {
    // Group interactions by turn
    const byTurn = new Map<string, RecordedInteraction[]>();
    for (const interaction of this.interactions) {
      if (interaction.sender !== power || !interaction.analysis) continue;
      const key = `${interaction.year}-${interaction.season}`;
      const group = byTurn.get(key) ?? [];
      group.push(interaction);
      byTurn.set(key, group);
    }

    let contradictions = 0;

    for (const turnInteractions of byTurn.values()) {
      if (turnInteractions.length < 2) continue;

      // Check for conflicting commitments to different powers
      for (let i = 0; i < turnInteractions.length; i++) {
        for (let j = i + 1; j < turnInteractions.length; j++) {
          const a = turnInteractions[i].analysis!;
          const b = turnInteractions[j].analysis!;

          // If sender makes commitments to different powers that conflict
          if (
            a.extractedCommitments.length > 0 &&
            b.extractedCommitments.length > 0 &&
            turnInteractions[i].receiver !== turnInteractions[j].receiver
          ) {
            // Check if both have alliance-type commitments (suggesting playing both sides)
            const aHasAlliance = a.senderIntent === 'alliance_proposal' || a.senderIntent === 'commitment';
            const bHasAlliance = b.senderIntent === 'alliance_proposal' || b.senderIntent === 'commitment';
            if (aHasAlliance && bHasAlliance) {
              contradictions++;
            }
          }
        }
      }
    }

    return contradictions;
  }

  /**
   * Calculates a comprehensive negotiation score for a power.
   */
  calculatePowerScore(power: Power): PowerNegotiationScore {
    const promiseCorrelation = this.calculatePromiseCorrelation(power);
    const deception = this.calculateDeceptionMetrics(power);

    // Trustworthiness: based on promise keep rate (0-100)
    const trustworthiness = Math.round(promiseCorrelation.keepRate * 100);

    // Diplomatic activity: normalized message count (0-100)
    const maxMessages = Math.max(...POWERS.map(p => this.messagesByPower.get(p) ?? 0), 1);
    const diplomaticActivity = Math.round(
      ((this.messagesByPower.get(power) ?? 0) / maxMessages) * 100
    );

    // Deception propensity: based on deception rate (0-100, higher = more deceptive)
    const deceptionPropensity = Math.round(
      Math.min(1, deception.deceptionRate) * 100
    );

    // Alliance reliability: based on alliance stability
    const patterns = this.detectAlliancePatterns();
    const powerAlliances = patterns.filter(
      p => p.powers.includes(power)
    );
    const allianceReliability = powerAlliances.length > 0
      ? Math.round(
          (powerAlliances.reduce((sum, a) => sum + a.stability, 0) /
            powerAlliances.length) * 100
        )
      : 50; // Default neutral if no alliances

    // Strategic effectiveness: composite of credibility and activity
    const strategicEffectiveness = Math.round(
      (deception.avgCredibilityScore * 0.6 + (diplomaticActivity / 100) * 0.4) * 100
    );

    // Overall score: weighted composite
    const overallScore = Math.round(
      trustworthiness * 0.30 +
      diplomaticActivity * 0.15 +
      (100 - deceptionPropensity) * 0.20 +
      allianceReliability * 0.20 +
      strategicEffectiveness * 0.15
    );

    return {
      power,
      overallScore,
      trustworthiness,
      diplomaticActivity,
      deceptionPropensity,
      allianceReliability,
      strategicEffectiveness,
      promiseCorrelation,
      deception,
    };
  }

  /**
   * Generates a full metrics report for the game.
   */
  generateReport(): NegotiationMetricsReport {
    const powerScores = POWERS.map(p => this.calculatePowerScore(p));
    const alliancePatterns = this.detectAlliancePatterns();

    const totalPromises = this.promiseRecords.length;
    const verifiedPromises = this.promiseRecords.filter(
      r => r.reconciliation && r.reconciliation.confidence >= 0.5
    );
    const keptPromises = verifiedPromises.filter(
      r => r.reconciliation!.kept
    );
    const overallKeepRate = verifiedPromises.length > 0
      ? keptPromises.length / verifiedPromises.length
      : 0;

    const totalMessages = [...this.messagesByPower.values()].reduce(
      (sum, count) => sum + count, 0
    );

    return {
      gameId: this.gameId,
      powerScores: powerScores.sort((a, b) => b.overallScore - a.overallScore),
      alliancePatterns,
      totalMessages,
      totalPromises,
      overallKeepRate,
      turnsAnalyzed: this.turnsTracked,
    };
  }

  /**
   * Generates a markdown report from the metrics.
   */
  generateMarkdownReport(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push('# Negotiation Quality Metrics Report');
    lines.push('');
    lines.push(`**Game:** ${report.gameId}`);
    lines.push(`**Turns Analyzed:** ${report.turnsAnalyzed}`);
    lines.push(`**Total Messages:** ${report.totalMessages}`);
    lines.push(`**Total Promises:** ${report.totalPromises}`);
    lines.push(`**Overall Promise Keep Rate:** ${(report.overallKeepRate * 100).toFixed(1)}%`);
    lines.push('');

    // Power Rankings
    lines.push('## Power Rankings');
    lines.push('');
    lines.push('| Rank | Power | Overall | Trust | Activity | Deception | Alliances |');
    lines.push('|------|-------|---------|-------|----------|-----------|-----------|');

    for (let i = 0; i < report.powerScores.length; i++) {
      const s = report.powerScores[i];
      lines.push(
        `| ${i + 1} | ${s.power} | ${s.overallScore} | ${s.trustworthiness} | ` +
        `${s.diplomaticActivity} | ${s.deceptionPropensity} | ${s.allianceReliability} |`
      );
    }

    lines.push('');

    // Promise Correlation
    lines.push('## Promise-to-Action Correlation');
    lines.push('');

    for (const score of report.powerScores) {
      const pc = score.promiseCorrelation;
      if (pc.totalPromises === 0) continue;

      lines.push(`### ${pc.power}`);
      lines.push(`- Promises Made: ${pc.totalPromises}`);
      lines.push(`- Kept: ${pc.promisesKept} | Broken: ${pc.promisesBroken} | Unverified: ${pc.promisesUnverified}`);
      lines.push(`- Keep Rate: ${(pc.keepRate * 100).toFixed(1)}%`);

      const types = Object.entries(pc.byType);
      if (types.length > 0) {
        lines.push('- By Type:');
        for (const [type, counts] of types) {
          lines.push(`  - ${type}: ${counts.kept}/${counts.total} kept`);
        }
      }
      lines.push('');
    }

    // Alliance Patterns
    if (report.alliancePatterns.length > 0) {
      lines.push('## Alliance Patterns');
      lines.push('');

      for (const pattern of report.alliancePatterns) {
        const status = pattern.endedInBetrayal ? 'BETRAYED' : 'ACTIVE';
        lines.push(
          `- **${pattern.powers.join(' + ')}**: ` +
          `${pattern.formedTurn.season} ${pattern.formedTurn.year} ` +
          `(${pattern.duration} turns, stability: ${(pattern.stability * 100).toFixed(0)}%, ${status})`
        );
      }
      lines.push('');
    }

    // Deception Analysis
    lines.push('## Deception Analysis');
    lines.push('');

    for (const score of report.powerScores) {
      const d = score.deception;
      if (d.totalMessagesSent === 0) continue;

      lines.push(`### ${d.power}`);
      lines.push(`- Messages Sent: ${d.totalMessagesSent}`);
      lines.push(`- Red Flags: ${d.messagesWithRedFlags}`);
      lines.push(`- Deceptive Intent: ${d.deceptiveIntentCount}`);
      lines.push(`- Avg Credibility: ${d.avgCredibilityScore.toFixed(2)}`);
      lines.push(`- Contradictions: ${d.contradictionCount}`);
      if (d.topRedFlags.length > 0) {
        lines.push(`- Top Red Flags: ${d.topRedFlags.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Resets all tracked data.
   */
  reset(): void {
    this.interactions = [];
    this.promiseRecords = [];
    this.allianceSignals = [];
    this.turnsTracked = 0;
    for (const power of POWERS) {
      this.messagesByPower.set(power, 0);
      this.analysesBySender.set(power, []);
    }
  }
}

/**
 * Creates a new NegotiationMetricsTracker instance.
 */
export function createNegotiationMetricsTracker(
  gameId: string
): NegotiationMetricsTracker {
  return new NegotiationMetricsTracker(gameId);
}

/**
 * Calculates promise correlation from pre-computed reconciliation data.
 * Utility for one-shot analysis without the tracker.
 */
export function calculatePromiseCorrelationFromReconciliations(
  power: Power,
  promises: ExtractedPromise[],
  reconciliations: PromiseReconciliation[]
): PromiseCorrelation {
  const reconMap = new Map<string, PromiseReconciliation>();
  for (const r of reconciliations) {
    reconMap.set(r.promise.id, r);
  }

  const powerPromises = promises.filter(p => p.promiser === power);
  const byType: Record<string, { kept: number; broken: number; total: number }> = {};
  let kept = 0;
  let broken = 0;
  let unverified = 0;
  let weightedKeptSum = 0;
  let weightedTotalSum = 0;

  for (const promise of powerPromises) {
    const type = promise.type;
    if (!byType[type]) {
      byType[type] = { kept: 0, broken: 0, total: 0 };
    }
    byType[type].total++;

    const recon = reconMap.get(promise.id);
    if (recon && recon.confidence >= 0.5) {
      if (recon.kept) {
        kept++;
        byType[type].kept++;
        weightedKeptSum += recon.confidence;
      } else {
        broken++;
        byType[type].broken++;
      }
      weightedTotalSum += recon.confidence;
    } else {
      unverified++;
    }
  }

  const verified = kept + broken;

  return {
    power,
    totalPromises: powerPromises.length,
    promisesKept: kept,
    promisesBroken: broken,
    promisesUnverified: unverified,
    keepRate: verified > 0 ? kept / verified : 0,
    weightedKeepRate: weightedTotalSum > 0 ? weightedKeptSum / weightedTotalSum : 0,
    byType,
  };
}
