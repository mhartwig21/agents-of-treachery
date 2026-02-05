/**
 * Negotiation analysis for incoming diplomatic messages.
 *
 * Provides intelligent analysis of incoming messages before agents respond,
 * helping them assess credibility, detect potential deception, and formulate
 * strategic responses.
 *
 * Inspired by GoodStartLabs/AI_Diplomacy patterns.
 */

import type { Power, Season } from '../engine/types';
import type { Message } from '../press/types';
import type {
  AgentMemory,
  MessageAnalysis,
  SenderIntent,
  StrategicValue,
  RecommendedResponse,
  LLMProvider,
  TrustLevel,
} from './types';
import { addNegotiationEntry } from './diary';

/**
 * Build the analysis prompt for the LLM.
 */
export function buildAnalysisPrompt(
  receiver: Power,
  message: Message,
  memory: AgentMemory,
  recentHistory: Message[]
): string {
  // Get trust level for sender
  const trustLevel = memory.trustLevels.get(message.sender) ?? 0;
  const trustDescription = getTrustDescription(trustLevel);

  // Get relationship notes
  const relationship = memory.relationships.get(message.sender);
  const activeCommitments = relationship?.commitments.filter(c => !c.fulfilled && !c.broken) ?? [];
  const pastBrokenPromises = memory.events.filter(
    e => e.powers.includes(message.sender) && e.type === 'PROMISE_BROKEN'
  ).length;
  const pastBetrayals = memory.events.filter(
    e => e.powers.includes(message.sender) && e.type === 'BETRAYAL'
  ).length;

  // Format recent conversation history
  const conversationContext = recentHistory.length > 0
    ? recentHistory.map(m => `[${m.sender}]: ${m.content}`).join('\n')
    : 'No recent conversation history.';

  return `You are ${receiver}, analyzing an incoming diplomatic message in Diplomacy.

INCOMING MESSAGE:
From: ${message.sender}
Content: "${message.content}"

YOUR RELATIONSHIP WITH ${message.sender}:
- Trust Level: ${trustLevel.toFixed(2)} (${trustDescription})
- Status: ${relationship?.isAlly ? 'ALLY' : relationship?.isEnemy ? 'ENEMY' : 'NEUTRAL'}
- Active commitments from them: ${activeCommitments.length}
- Past broken promises: ${pastBrokenPromises}
- Past betrayals: ${pastBetrayals}

RECENT CONVERSATION:
${conversationContext}

YOUR STRATEGIC NOTES ABOUT ${message.sender}:
${relationship?.notes.slice(-3).join('\n') || 'None'}

Analyze this message and provide your assessment. Consider:
1. What is ${message.sender} really proposing or requesting?
2. Does this align with their past behavior and current board position?
3. What's in it for them? What's in it for you?
4. Are there any red flags suggesting deception?
5. How should you respond?

DECEPTION INDICATORS TO CHECK:
- Vague promises without specifics
- Requests that benefit them more than you
- Timing (proposing alliance right before attacking)
- Contradicts their board position
- History of broken promises

Format your response EXACTLY as:
INTENT: [alliance_proposal|threat|information|deception|request|commitment|neutral]
CREDIBILITY: [0.0-1.0]
STRATEGIC_VALUE: [high|medium|low]
RECOMMENDED_RESPONSE: [accept|counter|reject|stall|investigate]
RED_FLAGS: [comma-separated list, or "None"]
COMMITMENTS: [comma-separated extracted commitments/proposals, or "None"]
REASONING: [2-3 sentences explaining your analysis]`;
}

/**
 * Parse the LLM's analysis response.
 */
export function parseAnalysisResponse(
  response: string,
  messageId: string,
  sender: Power,
  receiver: Power
): MessageAnalysis {
  // Extract each field with fallback defaults
  const intentMatch = response.match(/INTENT:\s*(\w+)/i);
  const credibilityMatch = response.match(/CREDIBILITY:\s*([\d.]+)/i);
  const strategicMatch = response.match(/STRATEGIC_VALUE:\s*(\w+)/i);
  const responseMatch = response.match(/RECOMMENDED_RESPONSE:\s*(\w+)/i);
  const redFlagsMatch = response.match(/RED_FLAGS:\s*(.+?)(?=COMMITMENTS:|REASONING:|$)/is);
  const commitmentsMatch = response.match(/COMMITMENTS:\s*(.+?)(?=REASONING:|$)/is);
  const reasoningMatch = response.match(/REASONING:\s*(.+?)$/is);

  // Parse intent
  const intentRaw = intentMatch?.[1]?.toLowerCase() ?? 'neutral';
  const validIntents: SenderIntent[] = ['alliance_proposal', 'threat', 'information', 'deception', 'request', 'commitment', 'neutral'];
  const senderIntent: SenderIntent = validIntents.includes(intentRaw as SenderIntent)
    ? intentRaw as SenderIntent
    : 'neutral';

  // Parse credibility (0-1)
  const credibilityRaw = parseFloat(credibilityMatch?.[1] ?? '0.5');
  const credibilityScore = Math.max(0, Math.min(1, isNaN(credibilityRaw) ? 0.5 : credibilityRaw));

  // Parse strategic value
  const strategicRaw = strategicMatch?.[1]?.toLowerCase() ?? 'medium';
  const validStrategic: StrategicValue[] = ['high', 'medium', 'low'];
  const strategicValue: StrategicValue = validStrategic.includes(strategicRaw as StrategicValue)
    ? strategicRaw as StrategicValue
    : 'medium';

  // Parse recommended response
  const responseRaw = responseMatch?.[1]?.toLowerCase() ?? 'investigate';
  const validResponses: RecommendedResponse[] = ['accept', 'counter', 'reject', 'stall', 'investigate'];
  const recommendedResponse: RecommendedResponse = validResponses.includes(responseRaw as RecommendedResponse)
    ? responseRaw as RecommendedResponse
    : 'investigate';

  // Parse red flags
  const redFlagsText = redFlagsMatch?.[1]?.trim() ?? 'None';
  const redFlags = redFlagsText.toLowerCase() === 'none'
    ? []
    : redFlagsText.split(',').map(s => s.trim()).filter(s => s.length > 0);

  // Parse commitments
  const commitmentsText = commitmentsMatch?.[1]?.trim() ?? 'None';
  const extractedCommitments = commitmentsText.toLowerCase() === 'none'
    ? []
    : commitmentsText.split(',').map(s => s.trim()).filter(s => s.length > 0);

  // Get reasoning
  const reasoning = reasoningMatch?.[1]?.trim() ?? 'Analysis could not be completed.';

  return {
    messageId,
    sender,
    receiver,
    senderIntent,
    credibilityScore,
    strategicValue,
    recommendedResponse,
    reasoning,
    redFlags,
    extractedCommitments,
    timestamp: new Date(),
  };
}

/**
 * Analyze an incoming diplomatic message.
 * Uses LLM to assess the sender's intentions, credibility, and strategic implications.
 */
export async function analyzeIncomingMessage(
  receiver: Power,
  message: Message,
  memory: AgentMemory,
  recentHistory: Message[],
  llmProvider: LLMProvider
): Promise<MessageAnalysis> {
  const prompt = buildAnalysisPrompt(receiver, message, memory, recentHistory);

  try {
    const response = await llmProvider.complete({
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
      ],
      maxTokens: 500,
      temperature: 0.3, // Lower temperature for more consistent analysis
    });

    return parseAnalysisResponse(response.content, message.id, message.sender, receiver);
  } catch (error) {
    console.warn(`Message analysis failed for ${receiver}:`, error);
    // Return a cautious default analysis
    return createFallbackAnalysis(message, receiver, memory);
  }
}

/**
 * Create a fallback analysis when LLM fails.
 */
function createFallbackAnalysis(
  message: Message,
  receiver: Power,
  memory: AgentMemory
): MessageAnalysis {
  const trustLevel = memory.trustLevels.get(message.sender) ?? 0;

  return {
    messageId: message.id,
    sender: message.sender,
    receiver,
    senderIntent: 'neutral',
    credibilityScore: Math.max(0, Math.min(1, (trustLevel + 1) / 2)), // Convert -1..1 to 0..1
    strategicValue: 'medium',
    recommendedResponse: 'investigate',
    reasoning: 'Analysis unavailable. Proceeding with caution based on trust history.',
    redFlags: trustLevel < -0.3 ? ['Low trust history'] : [],
    extractedCommitments: [],
    timestamp: new Date(),
  };
}

/**
 * Convert trust level to human-readable description.
 */
function getTrustDescription(trust: TrustLevel): string {
  if (trust >= 0.8) return 'Very High';
  if (trust >= 0.5) return 'High';
  if (trust >= 0.2) return 'Moderate';
  if (trust >= -0.2) return 'Neutral';
  if (trust >= -0.5) return 'Low';
  if (trust >= -0.8) return 'Very Low';
  return 'Hostile';
}

/**
 * Format a message analysis for inclusion in agent diary.
 */
export function formatAnalysisForDiary(analysis: MessageAnalysis): string {
  const redFlagsText = analysis.redFlags.length > 0
    ? `Red flags: ${analysis.redFlags.join(', ')}.`
    : '';

  return `Analyzed message from ${analysis.sender}: ` +
    `Intent=${analysis.senderIntent}, ` +
    `Credibility=${analysis.credibilityScore.toFixed(2)}, ` +
    `Value=${analysis.strategicValue}. ` +
    `Recommendation: ${analysis.recommendedResponse}. ` +
    `${redFlagsText} ` +
    `${analysis.reasoning}`;
}

/**
 * Record a message analysis to the agent's diary.
 */
export function recordAnalysisInDiary(
  memory: AgentMemory,
  analysis: MessageAnalysis,
  year: number,
  season: Season
): void {
  const content = formatAnalysisForDiary(analysis);
  addNegotiationEntry(memory, year, season, 'DIPLOMACY', content);
}

/**
 * Analyze multiple incoming messages and return analyses.
 * Processes messages in parallel for efficiency.
 */
export async function analyzeIncomingMessages(
  receiver: Power,
  messages: Message[],
  memory: AgentMemory,
  llmProvider: LLMProvider
): Promise<MessageAnalysis[]> {
  // Filter to only messages from other powers
  const incomingMessages = messages.filter(m => m.sender !== receiver);

  if (incomingMessages.length === 0) {
    return [];
  }

  // Build conversation history for context
  const recentHistory = messages.slice(-10);

  // Analyze each message (in parallel for speed)
  const analyses = await Promise.all(
    incomingMessages.map(message =>
      analyzeIncomingMessage(receiver, message, memory, recentHistory, llmProvider)
    )
  );

  return analyses;
}

/**
 * Generate a summary of message analyses for inclusion in agent prompts.
 * This gives the agent context about incoming messages before responding.
 */
export function generateAnalysisSummary(analyses: MessageAnalysis[]): string {
  if (analyses.length === 0) {
    return '';
  }

  const sections: string[] = ['## Message Analysis'];

  for (const analysis of analyses) {
    const credibilityIndicator = analysis.credibilityScore >= 0.7 ? '(high credibility)'
      : analysis.credibilityScore <= 0.3 ? '(LOW CREDIBILITY - CAUTION)'
        : '(moderate credibility)';

    const redFlagsWarning = analysis.redFlags.length > 0
      ? ` ⚠️ Red flags: ${analysis.redFlags.join(', ')}`
      : '';

    sections.push(
      `**${analysis.sender}**: ${analysis.senderIntent} ${credibilityIndicator}` +
      ` → Recommend: ${analysis.recommendedResponse}${redFlagsWarning}`
    );
  }

  return sections.join('\n');
}
