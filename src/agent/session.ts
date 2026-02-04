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
 * Generate a unique session ID.
 */
function generateSessionId(): AgentSessionId {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Default maximum conversation history size (sliding window).
 */
const DEFAULT_MAX_CONVERSATION_HISTORY = 50;

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
   */
  private applyConversationWindow(session: AgentSession): void {
    const history = session.conversationHistory;
    if (history.length <= this.maxConversationHistory) {
      return;
    }

    // Find system message (usually first)
    const systemMessage = history.find(m => m.role === 'system');

    // Calculate how many non-system messages to keep
    const maxNonSystem = systemMessage
      ? this.maxConversationHistory - 1
      : this.maxConversationHistory;

    // Get non-system messages
    const nonSystemMessages = history.filter(m => m.role !== 'system');

    // Keep only the most recent
    const recentMessages = nonSystemMessages.slice(-maxNonSystem);

    // Rebuild history with system message first (if present)
    session.conversationHistory = systemMessage
      ? [systemMessage, ...recentMessages]
      : recentMessages;
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
