/**
 * Agent session management.
 *
 * Creates and manages dedicated agent instances for each power.
 */

import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';
import type {
  AgentSession,
  AgentSessionId,
  AgentConfig,
  ConversationMessage,
  LLMProvider,
  AgentMemory,
} from './types';
import { MemoryManager, MemoryStore, InMemoryStore } from './memory';
import { getPowerPersonality } from './personalities';

/**
 * Prefix for summary messages so they can be identified in conversation history.
 */
const SUMMARY_PREFIX = '[CONVERSATION SUMMARY] ';

/**
 * Summarize evicted conversation messages into a compact context string.
 * Extracts orders, diplomatic actions, and key decisions without an LLM call.
 *
 * @param evicted - Messages being dropped from the conversation window
 * @param previousSummary - Content from any prior summary to merge with
 * @returns A compact summary message prefixed with SUMMARY_PREFIX
 */
export function summarizeEvictedMessages(
  evicted: ConversationMessage[],
  previousSummary: string = ''
): string {
  const orders: string[] = [];
  const diplomacy: string[] = [];
  const keyDecisions: string[] = [];

  for (const msg of evicted) {
    const content = msg.content;

    // Extract ORDERS sections from assistant responses
    if (msg.role === 'assistant') {
      const ordersMatch = content.match(/ORDERS:\s*([\s\S]*?)(?=(?:RETREATS:|BUILDS:|REASONING:|DIPLOMACY:|$))/i);
      if (ordersMatch) {
        const orderLines = ordersMatch[1].trim().split('\n')
          .filter(l => l.trim() && !l.startsWith('#'))
          .slice(0, 5); // Keep up to 5 order lines
        if (orderLines.length > 0) {
          orders.push(orderLines.join(', '));
        }
      }

      // Extract DIPLOMACY sends
      const sendMatches = content.match(/SEND\s+\w+:\s*"[^"]*"/gi);
      if (sendMatches) {
        for (const send of sendMatches.slice(0, 3)) {
          // Extract just the recipient and first 60 chars
          const truncated = send.length > 80 ? send.slice(0, 80) + '...' : send;
          diplomacy.push(truncated);
        }
      }

      // Extract key ANALYSIS/INTENTIONS lines
      const analysisMatch = content.match(/ANALYSIS:\s*(.*?)(?:\n|$)/i);
      if (analysisMatch && analysisMatch[1].trim()) {
        const analysis = analysisMatch[1].trim();
        if (analysis.length > 10) {
          keyDecisions.push(analysis.slice(0, 120));
        }
      }
    }

    // Extract game state headers from user messages (year/season/phase)
    if (msg.role === 'user') {
      const stateMatch = content.match(/Y:(\d+)\s+S:(\w+)\s+P:(\w+)/);
      if (stateMatch) {
        keyDecisions.push(`Turn: ${stateMatch[1]} ${stateMatch[2]} ${stateMatch[3]}`);
      }
    }
  }

  const sections: string[] = [SUMMARY_PREFIX + 'Prior turns context:'];

  if (previousSummary) {
    sections.push(previousSummary);
  }

  if (orders.length > 0) {
    // Keep only most recent 3 order sets
    sections.push('Orders: ' + orders.slice(-3).join(' | '));
  }
  if (diplomacy.length > 0) {
    sections.push('Diplomacy: ' + diplomacy.slice(-4).join(' | '));
  }
  if (keyDecisions.length > 0) {
    // Keep only most recent 3 decisions/states
    sections.push('Context: ' + keyDecisions.slice(-3).join(' | '));
  }

  // Cap total summary at ~500 tokens (~2000 chars)
  let summary = sections.join('\n');
  if (summary.length > 2000) {
    summary = summary.slice(0, 1997) + '...';
  }

  return summary;
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): AgentSessionId {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Default maximum conversation history size (sliding window).
 * Reduced to 10 to cut late-game token usage by 60-80%.
 * Evicted messages are summarized and injected as a context message.
 */
const DEFAULT_MAX_CONVERSATION_HISTORY = 10;

/**
 * Manages agent sessions for all powers in a game.
 */
export class AgentSessionManager {
  private sessions = new Map<Power, AgentSession>();
  private memoryManager: MemoryManager;
  private gameId: string;
  private llmProvider: LLMProvider;
  private maxConversationHistory: number;

  constructor(
    gameId: string,
    memoryStore: MemoryStore,
    llmProvider: LLMProvider,
    maxConversationHistory: number = DEFAULT_MAX_CONVERSATION_HISTORY
  ) {
    this.gameId = gameId;
    this.memoryManager = new MemoryManager(memoryStore);
    this.llmProvider = llmProvider;
    this.maxConversationHistory = maxConversationHistory;
  }

  /**
   * Create a new session for a power.
   */
  async createSession(config: AgentConfig): Promise<AgentSession> {
    const memory = await this.memoryManager.getMemory(config.power, this.gameId);

    const session: AgentSession = {
      id: generateSessionId(),
      power: config.power,
      config: {
        ...config,
        personality: config.personality ?? getPowerPersonality(config.power),
      },
      memory,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      conversationHistory: [],
      isActive: true,
    };

    this.sessions.set(config.power, session);
    return session;
  }

  /**
   * Create sessions for all powers with default configuration.
   */
  async createAllSessions(
    configs?: Partial<Record<Power, Partial<AgentConfig>>>
  ): Promise<Map<Power, AgentSession>> {
    const results = new Map<Power, AgentSession>();

    for (const power of POWERS) {
      const customConfig = configs?.[power] ?? {};
      const config: AgentConfig = {
        power,
        ...customConfig,
      };
      const session = await this.createSession(config);
      results.set(power, session);
    }

    return results;
  }

  /**
   * Get an existing session for a power.
   */
  getSession(power: Power): AgentSession | undefined {
    return this.sessions.get(power);
  }

  /**
   * Get all active sessions.
   */
  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive);
  }

  /**
   * Get the LLM provider.
   */
  getLLMProvider(): LLMProvider {
    return this.llmProvider;
  }

  /**
   * Add a message to a session's conversation history.
   * Implements sliding window to bound memory - keeps system message + most recent N messages.
   */
  addMessage(power: Power, message: Omit<ConversationMessage, 'timestamp'>): void {
    const session = this.sessions.get(power);
    if (session) {
      session.conversationHistory.push({
        ...message,
        timestamp: new Date(),
      });
      session.lastActiveAt = new Date();

      // Apply sliding window - preserve system message, keep only recent messages
      this.applyConversationWindow(session);
    }
  }

  /**
   * Apply sliding window to conversation history.
   * Preserves the system message (if any) and keeps only the most recent messages.
   * Evicted messages are summarized into a compact context message to preserve
   * strategic continuity without consuming the full token budget.
   */
  private applyConversationWindow(session: AgentSession): void {
    const history = session.conversationHistory;
    if (history.length <= this.maxConversationHistory) {
      return;
    }

    // Find system message (usually first)
    const systemMessage = history.find(m => m.role === 'system');

    // Reserve slots: 1 system + 1 summary + recent messages
    const reservedSlots = systemMessage ? 2 : 1; // system + summary (or just summary)
    const maxNonSystem = this.maxConversationHistory - reservedSlots;

    // Get non-system messages (excluding any existing summary)
    const nonSystemMessages = history.filter(
      m => m.role !== 'system' && !m.content.startsWith(SUMMARY_PREFIX)
    );

    // Find existing summary (if any)
    const existingSummary = history.find(
      m => m.content.startsWith(SUMMARY_PREFIX)
    );

    if (nonSystemMessages.length <= maxNonSystem) {
      return;
    }

    // Split into evicted and kept
    const evictedMessages = nonSystemMessages.slice(0, -maxNonSystem);
    const recentMessages = nonSystemMessages.slice(-maxNonSystem);

    // Build summary from evicted messages (merge with existing summary)
    const previousSummaryContent = existingSummary
      ? existingSummary.content.slice(SUMMARY_PREFIX.length).trim()
      : '';
    const newSummary = summarizeEvictedMessages(evictedMessages, previousSummaryContent);

    const summaryMessage: ConversationMessage = {
      role: 'user',
      content: newSummary,
      timestamp: new Date(),
    };

    // Rebuild: system + summary + recent
    session.conversationHistory = systemMessage
      ? [systemMessage, summaryMessage, ...recentMessages]
      : [summaryMessage, ...recentMessages];
  }

  /**
   * Clear conversation history for a session (keep system message if present).
   */
  clearHistory(power: Power, keepSystemMessage: boolean = true): void {
    const session = this.sessions.get(power);
    if (session) {
      if (keepSystemMessage && session.conversationHistory.length > 0) {
        const systemMessage = session.conversationHistory.find(m => m.role === 'system');
        session.conversationHistory = systemMessage ? [systemMessage] : [];
      } else {
        session.conversationHistory = [];
      }
    }
  }

  /**
   * Update memory for a power and save to persistent storage.
   */
  async updateMemory(power: Power, updates: Partial<AgentMemory>): Promise<void> {
    const session = this.sessions.get(power);
    if (session) {
      Object.assign(session.memory, updates);
      await this.memoryManager.saveMemory(session.memory);
    }
  }

  /**
   * Deactivate a session.
   */
  deactivateSession(power: Power): void {
    const session = this.sessions.get(power);
    if (session) {
      session.isActive = false;
    }
  }

  /**
   * Reactivate a session.
   */
  reactivateSession(power: Power): void {
    const session = this.sessions.get(power);
    if (session) {
      session.isActive = true;
    }
  }

  /**
   * Destroy a session completely.
   */
  destroySession(power: Power): void {
    this.sessions.delete(power);
  }

  /**
   * Save all session memories.
   */
  async saveAllMemories(): Promise<void> {
    await this.memoryManager.saveAll();
  }

  /**
   * Get the game ID.
   */
  getGameId(): string {
    return this.gameId;
  }

  /**
   * Destroy all sessions and clear memory.
   * Call this when the game is complete to free resources.
   */
  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.conversationHistory = [];
      session.isActive = false;
    }
    this.sessions.clear();
  }

  /**
   * Get session statistics.
   */
  getStats(): SessionStats {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.isActive).length,
      totalMessages: sessions.reduce((sum, s) => sum + s.conversationHistory.length, 0),
      sessionsByPower: Object.fromEntries(
        sessions.map(s => [s.power, {
          isActive: s.isActive,
          messageCount: s.conversationHistory.length,
          lastActive: s.lastActiveAt,
        }])
      ) as Record<Power, { isActive: boolean; messageCount: number; lastActive: Date }>,
    };
  }
}

/**
 * Statistics about agent sessions.
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  totalMessages: number;
  sessionsByPower: Record<Power, {
    isActive: boolean;
    messageCount: number;
    lastActive: Date;
  }>;
}

/**
 * Create a session manager with an in-memory store (for testing).
 */
export function createTestSessionManager(
  gameId: string,
  llmProvider: LLMProvider,
  maxConversationHistory?: number
): AgentSessionManager {
  return new AgentSessionManager(gameId, new InMemoryStore(), llmProvider, maxConversationHistory);
}

/**
 * Mock LLM provider for testing.
 */
export class MockLLMProvider implements LLMProvider {
  private responses: string[] = [];
  private responseIndex = 0;
  public calls: Array<{ messages: ConversationMessage[] }> = [];

  /**
   * Default response that includes valid ORDERS and DIPLOMACY sections.
   * This ensures mock agents always submit parseable orders and engage in press.
   */
  private static readonly DEFAULT_RESPONSE = `REASONING: This is a mock agent response for testing purposes.

ORDERS:
# All units hold by default

DIPLOMACY:
SEND FRANCE: "Greetings! I hope we can maintain peaceful relations."
SEND GERMANY: "Perhaps we could coordinate our efforts this turn?"
SEND RUSSIA: "I propose a mutual non-aggression agreement for now."
`;

  constructor(responses: string[] = []) {
    this.responses = responses;
  }

  addResponse(response: string): void {
    this.responses.push(response);
  }

  async complete(params: { messages: ConversationMessage[] }): Promise<{
    content: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  }> {
    this.calls.push({ messages: params.messages });

    const response = this.responses[this.responseIndex] ?? MockLLMProvider.DEFAULT_RESPONSE;
    this.responseIndex = (this.responseIndex + 1) % Math.max(1, this.responses.length);

    return {
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'end_turn',
    };
  }

  reset(): void {
    this.responseIndex = 0;
    this.calls = [];
  }
}
