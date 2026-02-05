/**
 * Negotiation analysis system for incoming diplomatic messages.
 *
 * Provides intelligent analysis of messages before responding by:
 * - Identifying sender intentions
 * - Comparing to historical behavior
 * - Assessing credibility based on trust history
 * - Formulating response strategies
 */

import type { Power, GameState } from '../engine/types';
import type {
  AgentMemory,
  MessageAnalysis,
  SenderIntent,
  StrategicValue,
  RecommendedResponse,
  LLMProvider,
  TrustLevel,
} from './types';
import type { Message } from '../press/types';
import { addNegotiationEntry } from './diary';

/**
 * Deception indicators to check in messages.
 */
const DECEPTION_INDICATORS = [
  { pattern: /promise|guarantee|definitely|absolutely/i, flag: 'Strong guarantees without specifics' },
  { pattern: /you must|you should|you need to/i, flag: 'Pressuring language' },
  { pattern: /everyone|all powers|they all/i, flag: 'Vague references to other powers' },
  { pattern: /right now|immediately|urgent/i, flag: 'Artificial urgency' },
  { pattern: /trust me|believe me|I would never/i, flag: 'Direct appeals to trust' },
  { pattern: /secret|between us|don\'t tell/i, flag: 'Secrecy requests' },
];

/**
 * Calculate credibility score based on trust history.
 */
function calculateCredibilityScore(
  memory: AgentMemory,
  sender: Power
): number {
  const trustLevel = memory.trustLevels.get(sender) ?? 0;
  const relationship = memory.relationships.get(sender);

  // Base score from trust level (-1 to 1 mapped to 0 to 1)
  let score = (trustLevel + 1) / 2;

  if (relationship) {
    // Adjust based on commitment history
    const totalCommitments = relationship.commitments.length;
    const keptCommitments = relationship.commitments.filter(c => c.fulfilled).length;
    const brokenCommitments = relationship.commitments.filter(c => c.broken).length;

    if (totalCommitments > 0) {
      const commitmentRatio = (keptCommitments - brokenCommitments) / totalCommitments;
      score = (score + (commitmentRatio + 1) / 2) / 2;
    }
  }

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, score));
}

/**
 * Detect potential deception indicators in message content.
 */
function detectRedFlags(content: string): string[] {
  const flags: string[] = [];

  for (const indicator of DECEPTION_INDICATORS) {
    if (indicator.pattern.test(content)) {
      flags.push(indicator.flag);
    }
  }

  return flags;
}

/**
 * Check if the message aligns with historical behavior.
 */
function assessHistoryAlignment(
  memory: AgentMemory,
  sender: Power,
  content: string
): 'consistent' | 'inconsistent' | 'no_history' {
  const relationship = memory.relationships.get(sender);
  const recentEvents = memory.events
    .filter(e => e.powers.includes(sender))
    .slice(-5);

  if (recentEvents.length === 0 && (!relationship || !relationship.lastInteraction)) {
    return 'no_history';
  }

  // Check for inconsistencies
  const isProposalContent = /ally|alliance|cooperate|support|together/i.test(content);
  const isThreateningContent = /attack|destroy|consequences|war/i.test(content);

  // If they recently attacked us but are proposing alliance, that's inconsistent
  const recentBetrayals = recentEvents.filter(e =>
    e.type === 'BETRAYAL' || e.type === 'ATTACK' || e.type === 'PROMISE_BROKEN'
  );

  if (recentBetrayals.length > 0 && isProposalContent) {
    return 'inconsistent';
  }

  // If they have high trust but are threatening, that's inconsistent
  const trustLevel = memory.trustLevels.get(sender) ?? 0;
  if (trustLevel > 0.5 && isThreateningContent) {
    return 'inconsistent';
  }

  return 'consistent';
}

/**
 * Build the analysis prompt for the LLM.
 */
function buildAnalysisPrompt(
  power: Power,
  sender: Power,
  message: Message,
  memory: AgentMemory,
  credibilityScore: number,
  redFlags: string[],
  historyAlignment: string
): string {
  const trustLevel = memory.trustLevels.get(sender) ?? 0;
  const relationship = memory.relationships.get(sender);

  const recentEvents = memory.events
    .filter(e => e.powers.includes(sender))
    .slice(-3)
    .map(e => `- ${e.type}: ${e.description}`)
    .join('\n') || 'No recent history';

  const activeCommitments = memory.activeCommitments
    .filter(c => c.fromPower === sender || c.toPower === sender)
    .filter(c => !c.fulfilled && !c.broken)
    .map(c => `- ${c.description}`)
    .join('\n') || 'No active commitments';

  return `You are ${power}, analyzing an incoming diplomatic message from ${sender}.

MESSAGE:
"${message.content}"

SENDER ANALYSIS:
- Trust Level: ${trustLevel.toFixed(2)} (${getTrustDescription(trustLevel)})
- Credibility Score: ${(credibilityScore * 100).toFixed(0)}%
- Relationship Status: ${relationship?.isAlly ? 'ALLY' : relationship?.isEnemy ? 'ENEMY' : 'NEUTRAL'}
- History Alignment: ${historyAlignment}
${redFlags.length > 0 ? `- Red Flags Detected: ${redFlags.join(', ')}` : ''}

RECENT HISTORY WITH ${sender}:
${recentEvents}

ACTIVE COMMITMENTS:
${activeCommitments}

Analyze this message and respond with EXACTLY this format:
INTENT: [alliance_proposal|threat|information|deception|neutral|request|counter_proposal]
STRATEGIC_VALUE: [high|medium|low]
RECOMMENDED_RESPONSE: [accept|counter|reject|stall|investigate]
KEY_POINTS: [comma-separated list of key points/proposals in the message]
REASONING: [2-3 sentences explaining your analysis]

Consider:
1. What is ${sender} actually proposing or requesting?
2. Does this align with their past behavior?
3. What's in it for them? For us?
4. Is this credible given their board position?
5. How should we respond strategically?`;
}

/**
 * Convert trust level to description.
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
 * Parse the LLM analysis response.
 */
function parseAnalysisResponse(
  response: string,
  messageId: string,
  sender: Power,
  credibilityScore: number,
  redFlags: string[],
  historyAlignment: 'consistent' | 'inconsistent' | 'no_history'
): MessageAnalysis {
  const intentMatch = response.match(/INTENT:\s*(\w+)/i);
  const valueMatch = response.match(/STRATEGIC_VALUE:\s*(\w+)/i);
  const responseMatch = response.match(/RECOMMENDED_RESPONSE:\s*(\w+)/i);
  const keyPointsMatch = response.match(/KEY_POINTS:\s*(.+?)(?=REASONING:|$)/is);
  const reasoningMatch = response.match(/REASONING:\s*(.+?)$/is);

  const senderIntent = (intentMatch?.[1]?.toLowerCase() || 'neutral') as SenderIntent;
  const strategicValue = (valueMatch?.[1]?.toLowerCase() || 'medium') as StrategicValue;
  const recommendedResponse = (responseMatch?.[1]?.toLowerCase() || 'investigate') as RecommendedResponse;

  const keyPointsText = keyPointsMatch?.[1]?.trim() || '';
  const keyPoints = keyPointsText
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s !== 'None');

  const reasoning = reasoningMatch?.[1]?.trim() || 'Analysis could not be completed.';

  return {
    messageId,
    sender,
    senderIntent,
    credibilityScore,
    strategicValue,
    recommendedResponse,
    reasoning,
    redFlags,
    keyPoints,
    historyAlignment,
    timestamp: new Date(),
  };
}

/**
 * Create fallback analysis when LLM is unavailable.
 */
function createFallbackAnalysis(
  messageId: string,
  sender: Power,
  message: Message,
  credibilityScore: number,
  redFlags: string[],
  historyAlignment: 'consistent' | 'inconsistent' | 'no_history'
): MessageAnalysis {
  // Simple heuristic-based analysis
  const content = message.content.toLowerCase();

  let senderIntent: SenderIntent = 'neutral';
  if (/ally|alliance|together|cooperate|support/i.test(content)) {
    senderIntent = 'alliance_proposal';
  } else if (/attack|destroy|war|consequences/i.test(content)) {
    senderIntent = 'threat';
  } else if (/tell you|inform|news|heard/i.test(content)) {
    senderIntent = 'information';
  } else if (/would you|could you|please/i.test(content)) {
    senderIntent = 'request';
  }

  // Determine strategic value based on credibility
  let strategicValue: StrategicValue = 'medium';
  if (credibilityScore > 0.7 && senderIntent === 'alliance_proposal') {
    strategicValue = 'high';
  } else if (credibilityScore < 0.3 || redFlags.length > 2) {
    strategicValue = 'low';
  }

  // Determine recommended response
  let recommendedResponse: RecommendedResponse = 'investigate';
  if (historyAlignment === 'inconsistent' || redFlags.length > 2) {
    recommendedResponse = 'stall';
  } else if (credibilityScore > 0.6 && senderIntent === 'alliance_proposal') {
    recommendedResponse = 'counter';
  } else if (senderIntent === 'threat' && credibilityScore < 0.4) {
    recommendedResponse = 'reject';
  }

  return {
    messageId,
    sender,
    senderIntent,
    credibilityScore,
    strategicValue,
    recommendedResponse,
    reasoning: 'Fallback analysis based on heuristics.',
    redFlags,
    keyPoints: [],
    historyAlignment,
    timestamp: new Date(),
  };
}

/**
 * Analyze an incoming diplomatic message.
 *
 * This function should be called when receiving a message, before generating a response.
 * It creates a diary entry with the analysis results.
 *
 * @param power - The power receiving the message
 * @param message - The incoming message to analyze
 * @param memory - The agent's memory
 * @param gameState - Current game state (optional, for board position context)
 * @param llmProvider - LLM provider for advanced analysis
 * @returns Analysis of the message
 */
export async function analyzeIncomingMessage(
  power: Power,
  message: Message,
  memory: AgentMemory,
  llmProvider: LLMProvider,
  _gameState?: GameState  // Reserved for future board position analysis
): Promise<MessageAnalysis> {
  const sender = message.sender;

  // Calculate credibility score from history
  const credibilityScore = calculateCredibilityScore(memory, sender);

  // Detect red flags in content
  const redFlags = detectRedFlags(message.content);

  // Assess history alignment
  const historyAlignment = assessHistoryAlignment(memory, sender, message.content);

  let analysis: MessageAnalysis;

  try {
    // Build analysis prompt
    const prompt = buildAnalysisPrompt(
      power,
      sender,
      message,
      memory,
      credibilityScore,
      redFlags,
      historyAlignment
    );

    // Get LLM analysis
    const response = await llmProvider.complete({
      messages: [{ role: 'user', content: prompt, timestamp: new Date() }],
      maxTokens: 500,
      temperature: 0.3,
    });

    // Parse response
    analysis = parseAnalysisResponse(
      response.content,
      message.id,
      sender,
      credibilityScore,
      redFlags,
      historyAlignment
    );
  } catch (error) {
    console.warn(`Message analysis LLM call failed for ${power}:`, error);
    // Fall back to heuristic analysis
    analysis = createFallbackAnalysis(
      message.id,
      sender,
      message,
      credibilityScore,
      redFlags,
      historyAlignment
    );
  }

  // Record analysis in diary
  const diaryContent = formatAnalysisForDiary(analysis);
  addNegotiationEntry(
    memory,
    memory.lastUpdated.year,
    memory.lastUpdated.season,
    memory.lastUpdated.phase,
    diaryContent
  );

  return analysis;
}

/**
 * Format analysis for diary entry.
 */
function formatAnalysisForDiary(analysis: MessageAnalysis): string {
  const parts = [
    `📩 Analyzed message from ${analysis.sender}:`,
    `Intent: ${analysis.senderIntent} | Credibility: ${(analysis.credibilityScore * 100).toFixed(0)}%`,
    `Strategic Value: ${analysis.strategicValue} | Recommended: ${analysis.recommendedResponse}`,
  ];

  if (analysis.redFlags.length > 0) {
    parts.push(`⚠️ Red Flags: ${analysis.redFlags.join(', ')}`);
  }

  if (analysis.keyPoints.length > 0) {
    parts.push(`Key Points: ${analysis.keyPoints.join('; ')}`);
  }

  parts.push(`Analysis: ${analysis.reasoning}`);

  return parts.join('\n');
}

/**
 * Batch analyze multiple messages (e.g., at start of diplomacy phase).
 */
export async function analyzeUnreadMessages(
  power: Power,
  messages: Message[],
  memory: AgentMemory,
  llmProvider: LLMProvider,
  gameState?: GameState
): Promise<MessageAnalysis[]> {
  const analyses: MessageAnalysis[] = [];

  // Filter to only messages from other powers
  const relevantMessages = messages.filter(m => m.sender !== power);

  for (const message of relevantMessages) {
    const analysis = await analyzeIncomingMessage(
      power,
      message,
      memory,
      llmProvider,
      gameState
    );
    analyses.push(analysis);
  }

  return analyses;
}

/**
 * Get a summary of analyses for LLM context.
 */
export function summarizeAnalyses(analyses: MessageAnalysis[]): string {
  if (analyses.length === 0) {
    return 'No messages analyzed.';
  }

  const sections = analyses.map(a => {
    const flagWarning = a.redFlags.length > 0 ? ` ⚠️` : '';
    return `- ${a.sender}: ${a.senderIntent} (${a.recommendedResponse})${flagWarning}`;
  });

  return `Message Analysis Summary:\n${sections.join('\n')}`;
}
