/**
 * Tests for the negotiation analysis module.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAnalysisPrompt,
  parseAnalysisResponse,
  analyzeIncomingMessage,
  formatAnalysisForDiary,
  generateAnalysisSummary,
} from '../negotiation';
import { createInitialMemory, updateTrust, recordEvent } from '../memory';
import type { Message } from '../../press/types';
import type { LLMProvider, MessageAnalysis } from '../types';

describe('Negotiation Analysis', () => {
  describe('buildAnalysisPrompt', () => {
    it('should build a prompt with message content and relationship context', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      const message: Message = {
        id: 'msg-1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'Let us ally against Germany. I propose we coordinate our fleets in the Channel.',
        timestamp: new Date(),
      };

      const prompt = buildAnalysisPrompt('ENGLAND', message, memory, []);

      expect(prompt).toContain('ENGLAND');
      expect(prompt).toContain('FRANCE');
      expect(prompt).toContain('ally against Germany');
      expect(prompt).toContain('Trust Level: 0.00');
      expect(prompt).toContain('INTENT:');
      expect(prompt).toContain('CREDIBILITY:');
      expect(prompt).toContain('STRATEGIC_VALUE:');
    });

    it('should include trust history in the prompt', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      // Set negative trust due to betrayal
      // Note: recordEvent also applies trustImpact, so -0.5 + -0.3 = -0.8
      updateTrust(memory, 'FRANCE', -0.5, 1901, 'SPRING');
      recordEvent(memory, {
        year: 1901,
        season: 'SPRING',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France attacked English Channel despite alliance',
      }, -0.3);

      const message: Message = {
        id: 'msg-1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'I apologize for our misunderstanding. Let us try again.',
        timestamp: new Date(),
      };

      const prompt = buildAnalysisPrompt('ENGLAND', message, memory, []);

      expect(prompt).toContain('Past betrayals: 1');
      expect(prompt).toContain('Trust Level: -0.80'); // -0.5 from updateTrust + -0.3 from recordEvent
    });

    it('should include recent conversation history', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      const recentHistory: Message[] = [
        {
          id: 'msg-0',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'What are your intentions toward Belgium?',
          timestamp: new Date(Date.now() - 60000),
        },
      ];

      const message: Message = {
        id: 'msg-1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'I have no designs on Belgium.',
        timestamp: new Date(),
      };

      const prompt = buildAnalysisPrompt('ENGLAND', message, memory, recentHistory);

      expect(prompt).toContain('What are your intentions toward Belgium?');
    });
  });

  describe('parseAnalysisResponse', () => {
    it('should parse a well-formatted response', () => {
      const response = `INTENT: alliance_proposal
CREDIBILITY: 0.75
STRATEGIC_VALUE: high
RECOMMENDED_RESPONSE: counter
RED_FLAGS: None
COMMITMENTS: Support into Munich, DMZ in Burgundy
REASONING: France appears sincere but the proposal benefits them more. Counter with specific terms.`;

      const analysis = parseAnalysisResponse(response, 'msg-1', 'FRANCE', 'ENGLAND');

      expect(analysis.senderIntent).toBe('alliance_proposal');
      expect(analysis.credibilityScore).toBe(0.75);
      expect(analysis.strategicValue).toBe('high');
      expect(analysis.recommendedResponse).toBe('counter');
      expect(analysis.redFlags).toHaveLength(0);
      expect(analysis.extractedCommitments).toContain('Support into Munich');
      expect(analysis.extractedCommitments).toContain('DMZ in Burgundy');
      expect(analysis.reasoning).toContain('France appears sincere');
    });

    it('should parse response with red flags', () => {
      const response = `INTENT: deception
CREDIBILITY: 0.2
STRATEGIC_VALUE: low
RECOMMENDED_RESPONSE: reject
RED_FLAGS: Vague promises, Benefits them more, History of broken promises
COMMITMENTS: None
REASONING: This proposal appears to be a trap. France has betrayed us before.`;

      const analysis = parseAnalysisResponse(response, 'msg-1', 'FRANCE', 'ENGLAND');

      expect(analysis.senderIntent).toBe('deception');
      expect(analysis.credibilityScore).toBe(0.2);
      expect(analysis.redFlags).toContain('Vague promises');
      expect(analysis.redFlags).toContain('Benefits them more');
      expect(analysis.redFlags).toContain('History of broken promises');
    });

    it('should handle malformed response gracefully', () => {
      const response = 'This is not a properly formatted response at all.';

      const analysis = parseAnalysisResponse(response, 'msg-1', 'FRANCE', 'ENGLAND');

      // Should fall back to defaults
      expect(analysis.senderIntent).toBe('neutral');
      expect(analysis.credibilityScore).toBe(0.5);
      expect(analysis.strategicValue).toBe('medium');
      expect(analysis.recommendedResponse).toBe('investigate');
    });

    it('should clamp credibility to 0-1 range', () => {
      const response = `INTENT: information
CREDIBILITY: 1.5
STRATEGIC_VALUE: medium
RECOMMENDED_RESPONSE: accept
RED_FLAGS: None
COMMITMENTS: None
REASONING: Test`;

      const analysis = parseAnalysisResponse(response, 'msg-1', 'FRANCE', 'ENGLAND');

      expect(analysis.credibilityScore).toBe(1.0);
    });
  });

  describe('analyzeIncomingMessage', () => {
    it('should call LLM and return parsed analysis', async () => {
      const mockLLM: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: `INTENT: alliance_proposal
CREDIBILITY: 0.8
STRATEGIC_VALUE: high
RECOMMENDED_RESPONSE: accept
RED_FLAGS: None
COMMITMENTS: Joint attack on Germany
REASONING: Strong proposal with clear benefits.`,
        }),
      };

      const memory = createInitialMemory('ENGLAND', 'test-game');
      const message: Message = {
        id: 'msg-1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'Let us ally against Germany!',
        timestamp: new Date(),
      };

      const analysis = await analyzeIncomingMessage(
        'ENGLAND',
        message,
        memory,
        [],
        mockLLM
      );

      expect(mockLLM.complete).toHaveBeenCalled();
      expect(analysis.senderIntent).toBe('alliance_proposal');
      expect(analysis.credibilityScore).toBe(0.8);
      expect(analysis.sender).toBe('FRANCE');
      expect(analysis.receiver).toBe('ENGLAND');
    });

    it('should return fallback analysis on LLM error', async () => {
      const mockLLM: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };

      const memory = createInitialMemory('ENGLAND', 'test-game');
      updateTrust(memory, 'FRANCE', -0.5, 1901, 'SPRING'); // Low trust

      const message: Message = {
        id: 'msg-1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'FRANCE',
        content: 'Trust me!',
        timestamp: new Date(),
      };

      const analysis = await analyzeIncomingMessage(
        'ENGLAND',
        message,
        memory,
        [],
        mockLLM
      );

      expect(analysis.senderIntent).toBe('neutral');
      expect(analysis.recommendedResponse).toBe('investigate');
      expect(analysis.redFlags).toContain('Low trust history');
    });
  });

  describe('formatAnalysisForDiary', () => {
    it('should format analysis as a diary entry', () => {
      const analysis: MessageAnalysis = {
        messageId: 'msg-1',
        sender: 'FRANCE',
        receiver: 'ENGLAND',
        senderIntent: 'alliance_proposal',
        credibilityScore: 0.75,
        strategicValue: 'high',
        recommendedResponse: 'counter',
        reasoning: 'Good proposal but needs better terms.',
        redFlags: ['Vague on specifics'],
        extractedCommitments: ['Support into Munich'],
        timestamp: new Date(),
      };

      const formatted = formatAnalysisForDiary(analysis);

      expect(formatted).toContain('FRANCE');
      expect(formatted).toContain('alliance_proposal');
      expect(formatted).toContain('0.75');
      expect(formatted).toContain('counter');
      expect(formatted).toContain('Vague on specifics');
    });
  });

  describe('generateAnalysisSummary', () => {
    it('should generate a summary for agent prompts', () => {
      const analyses: MessageAnalysis[] = [
        {
          messageId: 'msg-1',
          sender: 'FRANCE',
          receiver: 'ENGLAND',
          senderIntent: 'alliance_proposal',
          credibilityScore: 0.8,
          strategicValue: 'high',
          recommendedResponse: 'accept',
          reasoning: 'Good proposal.',
          redFlags: [],
          extractedCommitments: [],
          timestamp: new Date(),
        },
        {
          messageId: 'msg-2',
          sender: 'GERMANY',
          receiver: 'ENGLAND',
          senderIntent: 'deception',
          credibilityScore: 0.2,
          strategicValue: 'low',
          recommendedResponse: 'reject',
          reasoning: 'Likely a trap.',
          redFlags: ['History of betrayal', 'Vague terms'],
          extractedCommitments: [],
          timestamp: new Date(),
        },
      ];

      const summary = generateAnalysisSummary(analyses);

      expect(summary).toContain('Message Analysis');
      expect(summary).toContain('FRANCE');
      expect(summary).toContain('alliance_proposal');
      expect(summary).toContain('high credibility');
      expect(summary).toContain('GERMANY');
      expect(summary).toContain('LOW CREDIBILITY');
      expect(summary).toContain('History of betrayal');
    });

    it('should return empty string for no analyses', () => {
      const summary = generateAnalysisSummary([]);
      expect(summary).toBe('');
    });
  });
});
