/**
 * Tests for the negotiation analysis system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  analyzeIncomingMessage,
  analyzeUnreadMessages,
  summarizeAnalyses,
} from '../negotiation';
import { createInitialMemory, updateTrust, recordEvent } from '../memory';
import type { AgentMemory, LLMProvider, MessageAnalysis } from '../types';
import type { Message } from '../../press/types';

// Mock LLM provider
function createMockLLMProvider(response: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

// Helper to create a test message
function createTestMessage(
  sender: 'ENGLAND' | 'FRANCE' | 'GERMANY' | 'ITALY' | 'AUSTRIA' | 'RUSSIA' | 'TURKEY',
  content: string,
  id = 'msg-1'
): Message {
  return {
    id,
    channelId: `bilateral:${sender}:ENGLAND`,
    sender,
    content,
    timestamp: new Date(),
  };
}

describe('Negotiation Analysis', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'test-game');
  });

  describe('analyzeIncomingMessage', () => {
    it('should analyze a simple alliance proposal', async () => {
      const llmResponse = `INTENT: alliance_proposal
STRATEGIC_VALUE: high
RECOMMENDED_RESPONSE: counter
KEY_POINTS: Proposes joint attack on Germany, Offers Belgium
REASONING: France is proposing a classic Western alliance. Given their neutral trust level, we should counter with specific terms.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage('FRANCE', 'Let us ally against Germany. I will support you into Belgium.');

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      expect(analysis.senderIntent).toBe('alliance_proposal');
      expect(analysis.strategicValue).toBe('high');
      expect(analysis.recommendedResponse).toBe('counter');
      expect(analysis.sender).toBe('FRANCE');
      expect(analysis.keyPoints).toContain('Proposes joint attack on Germany');
      expect(analysis.keyPoints).toContain('Offers Belgium');
    });

    it('should detect red flags in suspicious messages', async () => {
      const llmResponse = `INTENT: deception
STRATEGIC_VALUE: low
RECOMMENDED_RESPONSE: reject
KEY_POINTS: Vague alliance terms
REASONING: This message contains multiple deception indicators.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage(
        'GERMANY',
        'Trust me, I promise you can definitely have Belgium. Everyone knows we should ally immediately!'
      );

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      expect(analysis.redFlags.length).toBeGreaterThan(0);
      expect(analysis.redFlags).toContain('Direct appeals to trust');
      expect(analysis.redFlags).toContain('Strong guarantees without specifics');
      expect(analysis.redFlags).toContain('Artificial urgency');
    });

    it('should calculate credibility based on trust history', async () => {
      // Set up a history with France
      updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');
      recordEvent(memory, {
        year: 1901,
        season: 'SPRING',
        type: 'PROMISE_KEPT',
        powers: ['FRANCE', 'ENGLAND'],
        description: 'France kept promise to support into Belgium',
      }, 0.1);

      const llmResponse = `INTENT: alliance_proposal
STRATEGIC_VALUE: high
RECOMMENDED_RESPONSE: accept
KEY_POINTS: Continue alliance
REASONING: France has proven trustworthy.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage('FRANCE', 'Shall we continue our successful partnership?');

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      // Credibility should be high due to positive history
      expect(analysis.credibilityScore).toBeGreaterThan(0.5);
      expect(analysis.historyAlignment).toBe('consistent');
    });

    it('should detect inconsistent behavior', async () => {
      // Record a recent betrayal from Germany
      recordEvent(memory, {
        year: 1901,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['GERMANY', 'ENGLAND'],
        description: 'Germany attacked without warning',
      }, -0.5);

      const llmResponse = `INTENT: alliance_proposal
STRATEGIC_VALUE: low
RECOMMENDED_RESPONSE: stall
KEY_POINTS: Peace offer after attack
REASONING: Suspicious given recent betrayal.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage('GERMANY', 'Let us forget the past and ally together against France.');

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      expect(analysis.historyAlignment).toBe('inconsistent');
    });

    it('should fall back to heuristics when LLM fails', async () => {
      const llm: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };

      const message = createTestMessage('FRANCE', 'Let us form an alliance against Germany.');

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      // Should still produce an analysis using fallback
      expect(analysis.senderIntent).toBe('alliance_proposal');
      expect(analysis.reasoning).toBe('Fallback analysis based on heuristics.');
    });

    it('should detect threat messages', async () => {
      const llmResponse = `INTENT: threat
STRATEGIC_VALUE: medium
RECOMMENDED_RESPONSE: investigate
KEY_POINTS: Threatens attack if no cooperation
REASONING: Germany is issuing an ultimatum.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage('GERMANY', 'If you do not leave Belgium, there will be war.');

      const analysis = await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      expect(analysis.senderIntent).toBe('threat');
    });

    it('should add analysis to diary', async () => {
      const llmResponse = `INTENT: information
STRATEGIC_VALUE: medium
RECOMMENDED_RESPONSE: investigate
KEY_POINTS: Intel about France
REASONING: Germany is sharing intelligence.`;

      const llm = createMockLLMProvider(llmResponse);
      const message = createTestMessage('GERMANY', 'I have heard that France is planning to attack you.');

      await analyzeIncomingMessage('ENGLAND', message, memory, llm);

      // Check diary was updated
      expect(memory.currentYearDiary.length).toBe(1);
      expect(memory.currentYearDiary[0].type).toBe('negotiation');
      expect(memory.currentYearDiary[0].content).toContain('GERMANY');
    });
  });

  describe('analyzeUnreadMessages', () => {
    it('should analyze multiple messages', async () => {
      const llmResponse = `INTENT: alliance_proposal
STRATEGIC_VALUE: medium
RECOMMENDED_RESPONSE: counter
KEY_POINTS: Alliance offer
REASONING: Standard proposal.`;

      const llm = createMockLLMProvider(llmResponse);

      const messages = [
        createTestMessage('FRANCE', 'Let us ally.', 'msg-1'),
        createTestMessage('GERMANY', 'Peace?', 'msg-2'),
        createTestMessage('ENGLAND', 'My own message', 'msg-3'), // Should be filtered
      ];

      const analyses = await analyzeUnreadMessages('ENGLAND', messages, memory, llm);

      // Should only analyze messages from other powers
      expect(analyses.length).toBe(2);
      expect(analyses[0].sender).toBe('FRANCE');
      expect(analyses[1].sender).toBe('GERMANY');
    });
  });

  describe('summarizeAnalyses', () => {
    it('should create a summary of analyses', () => {
      const analyses: MessageAnalysis[] = [
        {
          messageId: 'msg-1',
          sender: 'FRANCE',
          senderIntent: 'alliance_proposal',
          credibilityScore: 0.7,
          strategicValue: 'high',
          recommendedResponse: 'accept',
          reasoning: 'Trustworthy proposal.',
          redFlags: [],
          keyPoints: ['Alliance against Germany'],
          historyAlignment: 'consistent',
          timestamp: new Date(),
        },
        {
          messageId: 'msg-2',
          sender: 'GERMANY',
          senderIntent: 'deception',
          credibilityScore: 0.2,
          strategicValue: 'low',
          recommendedResponse: 'reject',
          reasoning: 'Suspicious.',
          redFlags: ['Direct appeals to trust'],
          keyPoints: [],
          historyAlignment: 'inconsistent',
          timestamp: new Date(),
        },
      ];

      const summary = summarizeAnalyses(analyses);

      expect(summary).toContain('FRANCE: alliance_proposal (accept)');
      expect(summary).toContain('GERMANY: deception (reject) ⚠️');
    });

    it('should handle empty analyses', () => {
      const summary = summarizeAnalyses([]);
      expect(summary).toBe('No messages analyzed.');
    });
  });
});
