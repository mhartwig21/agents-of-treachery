/**
 * Tests for Negotiation Quality Metrics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../../press/types';
import type { Power } from '../../engine/types';
import type { MessageAnalysis } from '../types';
import type { ExtractedPromise, PromiseReconciliation } from '../../analysis/promise-tracker';
import {
  NegotiationMetricsTracker,
  createNegotiationMetricsTracker,
  calculatePromiseCorrelationFromReconciliations,
} from '../negotiation-metrics';

/** Helper to create a test message. */
function createMessage(
  id: string,
  sender: Power,
  receiver: Power,
  content: string
): Message {
  return {
    id,
    channelId: `bilateral:${sender}:${receiver}`,
    sender,
    content,
    timestamp: new Date(),
  };
}

/** Helper to create a test MessageAnalysis. */
function createAnalysis(
  messageId: string,
  sender: Power,
  receiver: Power,
  overrides: Partial<MessageAnalysis> = {}
): MessageAnalysis {
  return {
    messageId,
    sender,
    receiver,
    senderIntent: 'neutral',
    credibilityScore: 0.5,
    strategicValue: 'medium',
    recommendedResponse: 'investigate',
    reasoning: 'Test analysis',
    redFlags: [],
    extractedCommitments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

/** Helper to create a test ExtractedPromise. */
function createPromise(
  id: string,
  promiser: Power,
  promisee: Power,
  type: ExtractedPromise['type'] = 'SUPPORT'
): ExtractedPromise {
  return {
    id,
    promiser,
    promisee,
    year: 1901,
    season: 'SPRING',
    messageContent: 'Test promise',
    type,
  };
}

/** Helper to create a test PromiseReconciliation. */
function createReconciliation(
  promise: ExtractedPromise,
  kept: boolean,
  confidence: number = 0.8
): PromiseReconciliation {
  return {
    promise,
    kept,
    evidence: kept ? 'Promise was kept' : 'Promise was broken',
    confidence,
    relatedOrders: [],
  };
}

describe('NegotiationMetricsTracker', () => {
  let tracker: NegotiationMetricsTracker;

  beforeEach(() => {
    tracker = new NegotiationMetricsTracker('test-game');
  });

  describe('constructor', () => {
    it('should create a tracker with the given game ID', () => {
      const report = tracker.generateReport();
      expect(report.gameId).toBe('test-game');
    });

    it('should initialize with zero metrics', () => {
      const report = tracker.generateReport();
      expect(report.totalMessages).toBe(0);
      expect(report.totalPromises).toBe(0);
      expect(report.turnsAnalyzed).toBe(0);
    });
  });

  describe('createNegotiationMetricsTracker', () => {
    it('should create a tracker instance', () => {
      const t = createNegotiationMetricsTracker('game-1');
      expect(t).toBeInstanceOf(NegotiationMetricsTracker);
      const report = t.generateReport();
      expect(report.gameId).toBe('game-1');
    });
  });

  describe('recordMessage', () => {
    it('should record a message and increment count', () => {
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Hello');
      tracker.recordMessage(msg, 'FRANCE');

      const score = tracker.calculatePowerScore('ENGLAND');
      expect(score.deception.totalMessagesSent).toBe(1);
    });

    it('should record analysis when provided', () => {
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Alliance?');
      const analysis = createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
        senderIntent: 'alliance_proposal',
        credibilityScore: 0.8,
      });

      tracker.recordMessage(msg, 'FRANCE', analysis);

      const metrics = tracker.calculateDeceptionMetrics('ENGLAND');
      expect(metrics.avgCredibilityScore).toBe(0.8);
    });
  });

  describe('recordTurnMessages', () => {
    it('should record all messages from a turn', () => {
      const messages: Message[] = [
        createMessage('msg1', 'ENGLAND', 'FRANCE', 'Hello France'),
        createMessage('msg2', 'FRANCE', 'ENGLAND', 'Hello England'),
        createMessage('msg3', 'GERMANY', 'RUSSIA', 'Hello Russia'),
      ];

      tracker.recordTurnMessages(messages, [], 1901, 'SPRING');

      const report = tracker.generateReport();
      expect(report.totalMessages).toBe(3);
      expect(report.turnsAnalyzed).toBe(1);
    });

    it('should associate analyses with correct messages', () => {
      const messages: Message[] = [
        createMessage('msg1', 'ENGLAND', 'FRANCE', 'I propose alliance'),
      ];
      const analyses: MessageAnalysis[] = [
        createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
          senderIntent: 'alliance_proposal',
          credibilityScore: 0.9,
        }),
      ];

      tracker.recordTurnMessages(messages, analyses, 1901, 'SPRING');

      const metrics = tracker.calculateDeceptionMetrics('ENGLAND');
      expect(metrics.avgCredibilityScore).toBe(0.9);
    });

    it('should ignore non-bilateral messages', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'global',
          sender: 'ENGLAND',
          content: 'Global announcement',
          timestamp: new Date(),
        },
      ];

      tracker.recordTurnMessages(messages, [], 1901, 'SPRING');

      const report = tracker.generateReport();
      expect(report.totalMessages).toBe(0);
    });
  });

  describe('calculatePromiseCorrelation', () => {
    it('should return zero metrics when no promises exist', () => {
      const correlation = tracker.calculatePromiseCorrelation('ENGLAND');

      expect(correlation.power).toBe('ENGLAND');
      expect(correlation.totalPromises).toBe(0);
      expect(correlation.keepRate).toBe(0);
    });

    it('should calculate keep rate from reconciled promises', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'ENGLAND', 'GERMANY', 'NON_AGGRESSION');
      const p3 = createPromise('p3', 'ENGLAND', 'RUSSIA', 'SUPPORT');

      const r1 = createReconciliation(p1, true);
      const r2 = createReconciliation(p2, false);
      const r3 = createReconciliation(p3, true);

      tracker.recordPromises([p1, p2, p3], [r1, r2, r3]);

      const correlation = tracker.calculatePromiseCorrelation('ENGLAND');
      expect(correlation.totalPromises).toBe(3);
      expect(correlation.promisesKept).toBe(2);
      expect(correlation.promisesBroken).toBe(1);
      expect(correlation.keepRate).toBeCloseTo(2 / 3);
    });

    it('should track unverified promises (low confidence)', () => {
      const p1 = createPromise('p1', 'FRANCE', 'ENGLAND', 'ALLIANCE_PROPOSAL');
      const r1 = createReconciliation(p1, true, 0.2); // Low confidence

      tracker.recordPromises([p1], [r1]);

      const correlation = tracker.calculatePromiseCorrelation('FRANCE');
      expect(correlation.promisesUnverified).toBe(1);
      expect(correlation.promisesKept).toBe(0);
    });

    it('should break down by promise type', () => {
      const p1 = createPromise('p1', 'GERMANY', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'GERMANY', 'FRANCE', 'SUPPORT');
      const p3 = createPromise('p3', 'GERMANY', 'RUSSIA', 'NON_AGGRESSION');

      const r1 = createReconciliation(p1, true);
      const r2 = createReconciliation(p2, false);
      const r3 = createReconciliation(p3, true);

      tracker.recordPromises([p1, p2, p3], [r1, r2, r3]);

      const correlation = tracker.calculatePromiseCorrelation('GERMANY');
      expect(correlation.byType['SUPPORT']).toEqual({ kept: 1, broken: 1, total: 2 });
      expect(correlation.byType['NON_AGGRESSION']).toEqual({ kept: 1, broken: 0, total: 1 });
    });

    it('should only count promises for the specified power', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'FRANCE', 'ENGLAND', 'SUPPORT');

      const r1 = createReconciliation(p1, true);
      const r2 = createReconciliation(p2, false);

      tracker.recordPromises([p1, p2], [r1, r2]);

      const engCorrelation = tracker.calculatePromiseCorrelation('ENGLAND');
      expect(engCorrelation.totalPromises).toBe(1);
      expect(engCorrelation.promisesKept).toBe(1);

      const fraCorrelation = tracker.calculatePromiseCorrelation('FRANCE');
      expect(fraCorrelation.totalPromises).toBe(1);
      expect(fraCorrelation.promisesBroken).toBe(1);
    });

    it('should handle promises without reconciliations', () => {
      const p1 = createPromise('p1', 'ITALY', 'AUSTRIA', 'ALLIANCE_PROPOSAL');

      tracker.recordPromises([p1], []);

      const correlation = tracker.calculatePromiseCorrelation('ITALY');
      expect(correlation.totalPromises).toBe(1);
      expect(correlation.promisesUnverified).toBe(1);
      expect(correlation.keepRate).toBe(0);
    });

    it('should calculate weighted keep rate using confidence', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'ENGLAND', 'GERMANY', 'NON_AGGRESSION');

      const r1 = createReconciliation(p1, true, 0.9); // High confidence kept
      const r2 = createReconciliation(p2, false, 0.6); // Lower confidence broken

      tracker.recordPromises([p1, p2], [r1, r2]);

      const correlation = tracker.calculatePromiseCorrelation('ENGLAND');
      // Weighted: 0.9 / (0.9 + 0.6) = 0.6
      expect(correlation.weightedKeepRate).toBeCloseTo(0.9 / 1.5);
    });
  });

  describe('detectAlliancePatterns', () => {
    it('should return empty array when no signals exist', () => {
      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(0);
    });

    it('should detect a bilateral alliance from cooperative signals', () => {
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1902, 'SPRING');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].powers).toContain('ENGLAND');
      expect(patterns[0].powers).toContain('FRANCE');
      expect(patterns[0].duration).toBe(3);
      expect(patterns[0].endedInBetrayal).toBe(false);
      expect(patterns[0].stability).toBe(1.0);
    });

    it('should detect betrayal when alliance ends with hostile signal', () => {
      tracker.recordAllianceSignal('GERMANY', 'RUSSIA', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('GERMANY', 'RUSSIA', 'cooperative', 1901, 'FALL');
      tracker.recordAllianceSignal('GERMANY', 'RUSSIA', 'hostile', 1902, 'SPRING');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].endedInBetrayal).toBe(true);
      expect(patterns[0].endedTurn).toEqual({ year: 1902, season: 'SPRING' });
    });

    it('should calculate stability correctly with mixed signals', () => {
      tracker.recordAllianceSignal('ITALY', 'AUSTRIA', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ITALY', 'AUSTRIA', 'cooperative', 1901, 'FALL');
      tracker.recordAllianceSignal('ITALY', 'AUSTRIA', 'neutral', 1902, 'SPRING');
      tracker.recordAllianceSignal('ITALY', 'AUSTRIA', 'hostile', 1902, 'FALL');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(1);
      // 2 cooperative out of 4 total
      expect(patterns[0].stability).toBe(0.5);
    });

    it('should not detect alliance from single signal', () => {
      tracker.recordAllianceSignal('ENGLAND', 'GERMANY', 'cooperative', 1901, 'SPRING');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(0);
    });

    it('should sort power pair consistently regardless of order', () => {
      tracker.recordAllianceSignal('FRANCE', 'ENGLAND', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].duration).toBe(2);
    });

    it('should track multiple alliances independently', () => {
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');

      tracker.recordAllianceSignal('GERMANY', 'RUSSIA', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('GERMANY', 'RUSSIA', 'cooperative', 1901, 'FALL');

      const patterns = tracker.detectAlliancePatterns();
      expect(patterns).toHaveLength(2);
    });
  });

  describe('calculateDeceptionMetrics', () => {
    it('should return zero metrics when no messages exist', () => {
      const metrics = tracker.calculateDeceptionMetrics('ENGLAND');

      expect(metrics.power).toBe('ENGLAND');
      expect(metrics.totalMessagesSent).toBe(0);
      expect(metrics.deceptionRate).toBe(0);
    });

    it('should track messages with red flags', () => {
      const msg = createMessage('msg1', 'TURKEY', 'RUSSIA', 'Trust me');
      const analysis = createAnalysis('msg1', 'TURKEY', 'RUSSIA', {
        redFlags: ['Vague promise', 'History of betrayal'],
      });

      tracker.recordMessage(msg, 'RUSSIA', analysis);

      const metrics = tracker.calculateDeceptionMetrics('TURKEY');
      expect(metrics.messagesWithRedFlags).toBe(1);
      expect(metrics.topRedFlags).toContain('Vague promise');
      expect(metrics.topRedFlags).toContain('History of betrayal');
    });

    it('should track deceptive intent', () => {
      const msg = createMessage('msg1', 'FRANCE', 'GERMANY', 'I will help');
      const analysis = createAnalysis('msg1', 'FRANCE', 'GERMANY', {
        senderIntent: 'deception',
      });

      tracker.recordMessage(msg, 'GERMANY', analysis);

      const metrics = tracker.calculateDeceptionMetrics('FRANCE');
      expect(metrics.deceptiveIntentCount).toBe(1);
    });

    it('should calculate average credibility score', () => {
      const msg1 = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Message 1');
      const msg2 = createMessage('msg2', 'ENGLAND', 'GERMANY', 'Message 2');

      const a1 = createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
        credibilityScore: 0.8,
      });
      const a2 = createAnalysis('msg2', 'ENGLAND', 'GERMANY', {
        credibilityScore: 0.4,
      });

      tracker.recordMessage(msg1, 'FRANCE', a1);
      tracker.recordMessage(msg2, 'GERMANY', a2);

      const metrics = tracker.calculateDeceptionMetrics('ENGLAND');
      expect(metrics.avgCredibilityScore).toBeCloseTo(0.6);
    });

    it('should rank top red flags by frequency', () => {
      for (let i = 0; i < 3; i++) {
        const msg = createMessage(`msg${i}`, 'RUSSIA', 'TURKEY', `Msg ${i}`);
        const analysis = createAnalysis(`msg${i}`, 'RUSSIA', 'TURKEY', {
          redFlags: ['Vague promise'],
        });
        tracker.recordMessage(msg, 'TURKEY', analysis);
      }

      const msg = createMessage('msg3', 'RUSSIA', 'ENGLAND', 'Msg 3');
      const analysis = createAnalysis('msg3', 'RUSSIA', 'ENGLAND', {
        redFlags: ['Contradicts position'],
      });
      tracker.recordMessage(msg, 'ENGLAND', analysis);

      const metrics = tracker.calculateDeceptionMetrics('RUSSIA');
      expect(metrics.topRedFlags[0]).toBe('Vague promise');
    });

    it('should calculate deception rate', () => {
      // 2 messages: 1 with red flags, 1 with deceptive intent
      const msg1 = createMessage('msg1', 'ITALY', 'FRANCE', 'Msg 1');
      const msg2 = createMessage('msg2', 'ITALY', 'GERMANY', 'Msg 2');

      const a1 = createAnalysis('msg1', 'ITALY', 'FRANCE', {
        redFlags: ['Flag 1'],
      });
      const a2 = createAnalysis('msg2', 'ITALY', 'GERMANY', {
        senderIntent: 'deception',
      });

      tracker.recordMessage(msg1, 'FRANCE', a1);
      tracker.recordMessage(msg2, 'GERMANY', a2);

      const metrics = tracker.calculateDeceptionMetrics('ITALY');
      // rate = (1 + 1) / (2 * 2) = 0.5
      expect(metrics.deceptionRate).toBe(0.5);
    });
  });

  describe('contradiction detection', () => {
    it('should detect contradictory alliance proposals to different powers', () => {
      const messages: Message[] = [
        createMessage('msg1', 'FRANCE', 'ENGLAND', 'Alliance against Germany?'),
        createMessage('msg2', 'FRANCE', 'GERMANY', 'Alliance against England?'),
      ];

      const analyses: MessageAnalysis[] = [
        createAnalysis('msg1', 'FRANCE', 'ENGLAND', {
          senderIntent: 'alliance_proposal',
          extractedCommitments: ['Alliance against Germany'],
        }),
        createAnalysis('msg2', 'FRANCE', 'GERMANY', {
          senderIntent: 'alliance_proposal',
          extractedCommitments: ['Alliance against England'],
        }),
      ];

      tracker.recordTurnMessages(messages, analyses, 1901, 'SPRING');

      const metrics = tracker.calculateDeceptionMetrics('FRANCE');
      expect(metrics.contradictionCount).toBeGreaterThan(0);
    });

    it('should not flag non-contradictory messages', () => {
      const messages: Message[] = [
        createMessage('msg1', 'ENGLAND', 'FRANCE', 'Peace?'),
        createMessage('msg2', 'ENGLAND', 'GERMANY', 'Trade?'),
      ];

      const analyses: MessageAnalysis[] = [
        createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
          senderIntent: 'information',
          extractedCommitments: [],
        }),
        createAnalysis('msg2', 'ENGLAND', 'GERMANY', {
          senderIntent: 'information',
          extractedCommitments: [],
        }),
      ];

      tracker.recordTurnMessages(messages, analyses, 1901, 'SPRING');

      const metrics = tracker.calculateDeceptionMetrics('ENGLAND');
      expect(metrics.contradictionCount).toBe(0);
    });
  });

  describe('calculatePowerScore', () => {
    it('should return scores for a power with no activity', () => {
      const score = tracker.calculatePowerScore('ENGLAND');

      expect(score.power).toBe('ENGLAND');
      expect(score.overallScore).toBeGreaterThanOrEqual(0);
      expect(score.overallScore).toBeLessThanOrEqual(100);
      expect(score.trustworthiness).toBe(0); // No promises = 0
      expect(score.diplomaticActivity).toBe(0); // No messages
    });

    it('should reward high promise keep rate', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'ENGLAND', 'GERMANY', 'NON_AGGRESSION');
      const r1 = createReconciliation(p1, true);
      const r2 = createReconciliation(p2, true);

      tracker.recordPromises([p1, p2], [r1, r2]);

      const score = tracker.calculatePowerScore('ENGLAND');
      expect(score.trustworthiness).toBe(100);
    });

    it('should penalize deceptive behavior', () => {
      const msg = createMessage('msg1', 'TURKEY', 'RUSSIA', 'Lies');
      const analysis = createAnalysis('msg1', 'TURKEY', 'RUSSIA', {
        senderIntent: 'deception',
        redFlags: ['Blatant lie'],
        credibilityScore: 0.1,
      });

      tracker.recordMessage(msg, 'RUSSIA', analysis);

      const score = tracker.calculatePowerScore('TURKEY');
      expect(score.deceptionPropensity).toBeGreaterThan(0);
    });

    it('should score all component metrics in valid ranges', () => {
      // Add varied data
      const messages: Message[] = [
        createMessage('msg1', 'ENGLAND', 'FRANCE', 'Support BEL'),
        createMessage('msg2', 'ENGLAND', 'GERMANY', 'Non-aggression'),
      ];
      const analyses: MessageAnalysis[] = [
        createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
          senderIntent: 'commitment',
          credibilityScore: 0.7,
          extractedCommitments: ['Support BEL'],
        }),
        createAnalysis('msg2', 'ENGLAND', 'GERMANY', {
          senderIntent: 'commitment',
          credibilityScore: 0.8,
          extractedCommitments: ['Non-aggression'],
        }),
      ];

      tracker.recordTurnMessages(messages, analyses, 1901, 'SPRING');

      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const r1 = createReconciliation(p1, true);
      tracker.recordPromises([p1], [r1]);

      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');

      const score = tracker.calculatePowerScore('ENGLAND');

      expect(score.overallScore).toBeGreaterThanOrEqual(0);
      expect(score.overallScore).toBeLessThanOrEqual(100);
      expect(score.trustworthiness).toBeGreaterThanOrEqual(0);
      expect(score.trustworthiness).toBeLessThanOrEqual(100);
      expect(score.diplomaticActivity).toBeGreaterThanOrEqual(0);
      expect(score.diplomaticActivity).toBeLessThanOrEqual(100);
      expect(score.deceptionPropensity).toBeGreaterThanOrEqual(0);
      expect(score.deceptionPropensity).toBeLessThanOrEqual(100);
      expect(score.allianceReliability).toBeGreaterThanOrEqual(0);
      expect(score.allianceReliability).toBeLessThanOrEqual(100);
      expect(score.strategicEffectiveness).toBeGreaterThanOrEqual(0);
      expect(score.strategicEffectiveness).toBeLessThanOrEqual(100);
    });
  });

  describe('generateReport', () => {
    it('should generate a report for all powers', () => {
      const report = tracker.generateReport();

      expect(report.gameId).toBe('test-game');
      expect(report.powerScores).toHaveLength(7); // 7 Diplomacy powers
      expect(report.totalMessages).toBe(0);
      expect(report.totalPromises).toBe(0);
      expect(report.overallKeepRate).toBe(0);
      expect(report.turnsAnalyzed).toBe(0);
    });

    it('should sort power scores by overall score descending', () => {
      // England: high trustworthiness
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const r1 = createReconciliation(p1, true);
      tracker.recordPromises([p1], [r1]);

      // Add messages so England has more activity
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Hello');
      tracker.recordMessage(msg, 'FRANCE', createAnalysis('msg1', 'ENGLAND', 'FRANCE', {
        credibilityScore: 0.9,
      }));

      const report = tracker.generateReport();
      // England should rank higher than powers with no activity
      const englandIdx = report.powerScores.findIndex(s => s.power === 'ENGLAND');
      expect(englandIdx).toBeLessThan(report.powerScores.length - 1);
    });

    it('should calculate overall keep rate across all powers', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const p2 = createPromise('p2', 'FRANCE', 'ENGLAND', 'NON_AGGRESSION');
      const p3 = createPromise('p3', 'GERMANY', 'RUSSIA', 'SUPPORT');

      const r1 = createReconciliation(p1, true);
      const r2 = createReconciliation(p2, false);
      const r3 = createReconciliation(p3, true);

      tracker.recordPromises([p1, p2, p3], [r1, r2, r3]);

      const report = tracker.generateReport();
      expect(report.totalPromises).toBe(3);
      expect(report.overallKeepRate).toBeCloseTo(2 / 3);
    });

    it('should include alliance patterns', () => {
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');

      const report = tracker.generateReport();
      expect(report.alliancePatterns).toHaveLength(1);
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate valid markdown', () => {
      const report = tracker.generateMarkdownReport();

      expect(report).toContain('# Negotiation Quality Metrics Report');
      expect(report).toContain('test-game');
      expect(report).toContain('## Power Rankings');
    });

    it('should include power rankings table', () => {
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Hello');
      tracker.recordMessage(msg, 'FRANCE');

      const report = tracker.generateMarkdownReport();
      expect(report).toContain('| Rank | Power | Overall |');
      expect(report).toContain('ENGLAND');
    });

    it('should include promise correlation when promises exist', () => {
      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      const r1 = createReconciliation(p1, true);
      tracker.recordPromises([p1], [r1]);

      // Need at least one message for England to appear in deception section
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Supporting you');
      tracker.recordMessage(msg, 'FRANCE');

      const report = tracker.generateMarkdownReport();
      expect(report).toContain('## Promise-to-Action Correlation');
      expect(report).toContain('ENGLAND');
      expect(report).toContain('Keep Rate:');
    });

    it('should include alliance patterns when they exist', () => {
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');
      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'FALL');

      const report = tracker.generateMarkdownReport();
      expect(report).toContain('## Alliance Patterns');
      expect(report).toContain('ENGLAND');
      expect(report).toContain('FRANCE');
    });

    it('should include deception analysis', () => {
      const msg = createMessage('msg1', 'TURKEY', 'RUSSIA', 'Trust me');
      const analysis = createAnalysis('msg1', 'TURKEY', 'RUSSIA', {
        redFlags: ['Suspicious timing'],
        credibilityScore: 0.3,
      });
      tracker.recordMessage(msg, 'RUSSIA', analysis);

      const report = tracker.generateMarkdownReport();
      expect(report).toContain('## Deception Analysis');
      expect(report).toContain('TURKEY');
    });
  });

  describe('reset', () => {
    it('should clear all tracked data', () => {
      const msg = createMessage('msg1', 'ENGLAND', 'FRANCE', 'Hello');
      tracker.recordMessage(msg, 'FRANCE');

      const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
      tracker.recordPromises([p1], []);

      tracker.recordAllianceSignal('ENGLAND', 'FRANCE', 'cooperative', 1901, 'SPRING');

      tracker.reset();

      const report = tracker.generateReport();
      expect(report.totalMessages).toBe(0);
      expect(report.totalPromises).toBe(0);
      expect(report.alliancePatterns).toHaveLength(0);
      expect(report.turnsAnalyzed).toBe(0);
    });
  });
});

describe('calculatePromiseCorrelationFromReconciliations', () => {
  it('should calculate correlation from pre-computed data', () => {
    const p1 = createPromise('p1', 'ENGLAND', 'FRANCE', 'SUPPORT');
    const p2 = createPromise('p2', 'ENGLAND', 'GERMANY', 'NON_AGGRESSION');
    const p3 = createPromise('p3', 'FRANCE', 'ENGLAND', 'SUPPORT');

    const r1 = createReconciliation(p1, true);
    const r2 = createReconciliation(p2, false);
    const r3 = createReconciliation(p3, true);

    const correlation = calculatePromiseCorrelationFromReconciliations(
      'ENGLAND',
      [p1, p2, p3],
      [r1, r2, r3]
    );

    expect(correlation.power).toBe('ENGLAND');
    expect(correlation.totalPromises).toBe(2); // Only ENGLAND's promises
    expect(correlation.promisesKept).toBe(1);
    expect(correlation.promisesBroken).toBe(1);
    expect(correlation.keepRate).toBe(0.5);
  });

  it('should handle empty inputs', () => {
    const correlation = calculatePromiseCorrelationFromReconciliations(
      'ENGLAND',
      [],
      []
    );

    expect(correlation.totalPromises).toBe(0);
    expect(correlation.keepRate).toBe(0);
    expect(correlation.weightedKeepRate).toBe(0);
  });

  it('should handle promises without reconciliations', () => {
    const p1 = createPromise('p1', 'RUSSIA', 'TURKEY', 'COORDINATION');

    const correlation = calculatePromiseCorrelationFromReconciliations(
      'RUSSIA',
      [p1],
      []
    );

    expect(correlation.totalPromises).toBe(1);
    expect(correlation.promisesUnverified).toBe(1);
    expect(correlation.keepRate).toBe(0);
  });

  it('should break down by type correctly', () => {
    const p1 = createPromise('p1', 'AUSTRIA', 'ITALY', 'SUPPORT');
    const p2 = createPromise('p2', 'AUSTRIA', 'RUSSIA', 'SUPPORT');
    const p3 = createPromise('p3', 'AUSTRIA', 'GERMANY', 'TERRITORY_DEAL');

    const r1 = createReconciliation(p1, true, 0.9);
    const r2 = createReconciliation(p2, true, 0.7);
    const r3 = createReconciliation(p3, false, 0.8);

    const correlation = calculatePromiseCorrelationFromReconciliations(
      'AUSTRIA',
      [p1, p2, p3],
      [r1, r2, r3]
    );

    expect(correlation.byType['SUPPORT']).toEqual({ kept: 2, broken: 0, total: 2 });
    expect(correlation.byType['TERRITORY_DEAL']).toEqual({ kept: 0, broken: 1, total: 1 });
  });
});
