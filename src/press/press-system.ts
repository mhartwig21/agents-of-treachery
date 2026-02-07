/**
 * Main press system implementation.
 *
 * Coordinates message sending, storage, retrieval, and notifications.
 */

import { ChannelManager } from './channel';
import {
  Channel,
  ChannelId,
  CreateChannelRequest,
  Message,
  MessageId,
  MessageQuery,
  MessageQueryResult,
  Power,
  PressConfig,
  PressContext,
  PressNotification,
  SendMessageRequest,
  DEFAULT_PRESS_CONFIG,
} from './types';

/**
 * Generates a unique message ID.
 */
function generateMessageId(): MessageId {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Callback type for press notifications.
 */
export type NotificationCallback = (
  power: Power,
  notification: PressNotification
) => void;

/**
 * The main press system that manages all diplomatic communication.
 */
export class PressSystem {
  private channelManager: ChannelManager;
  private messages: Map<MessageId, Message> = new Map();
  private messagesByChannel: Map<ChannelId, Message[]> = new Map();
  private messagesByThread: Map<MessageId, Message[]> = new Map();
  private config: PressConfig;
  private context: PressContext;
  private notificationCallbacks: NotificationCallback[] = [];
  private messageCountByPowerAndPhase: Map<string, number> = new Map();
  private currentRound: number = 0;

  constructor(
    context: PressContext,
    config: Partial<PressConfig> = {}
  ) {
    this.channelManager = new ChannelManager();
    this.config = { ...DEFAULT_PRESS_CONFIG, ...config };
    this.context = context;
  }

  /**
   * Registers a callback for press notifications.
   */
  onNotification(callback: NotificationCallback): void {
    this.notificationCallbacks.push(callback);
  }

  /**
   * Removes a notification callback.
   */
  offNotification(callback: NotificationCallback): void {
    const index = this.notificationCallbacks.indexOf(callback);
    if (index !== -1) {
      this.notificationCallbacks.splice(index, 1);
    }
  }

  /**
   * Sends notifications to all relevant powers.
   */
  private notify(channel: Channel, notification: PressNotification): void {
    for (const power of channel.participants) {
      for (const callback of this.notificationCallbacks) {
        callback(power, notification);
      }
    }
  }

  /**
   * Gets the rate limit key for a power in the current phase.
   */
  private getRateLimitKey(power: Power): string {
    return `${this.context.gameId}:${this.context.year}:${this.context.season}:${this.context.phase}:${power}`;
  }

  /**
   * Checks if a power has exceeded their message rate limit.
   */
  private checkRateLimit(power: Power): boolean {
    const key = this.getRateLimitKey(power);
    const count = this.messageCountByPowerAndPhase.get(key) || 0;
    return count < this.config.maxMessagesPerPhase;
  }

  /**
   * Increments the message count for rate limiting.
   */
  private incrementMessageCount(power: Power): void {
    const key = this.getRateLimitKey(power);
    const count = this.messageCountByPowerAndPhase.get(key) || 0;
    this.messageCountByPowerAndPhase.set(key, count + 1);
  }

  /**
   * Updates the game context (call when phase/turn changes).
   */
  updateContext(context: PressContext): void {
    this.context = context;
    // Clear rate limits on phase change
    this.messageCountByPowerAndPhase.clear();
    // Reset round counter on phase change
    this.currentRound = 0;
  }

  /**
   * Sets the current press round number (1-based).
   * Call this at the start of each round in the diplomacy phase.
   */
  setCurrentRound(round: number): void {
    this.currentRound = round;
  }

  /**
   * Gets the current press round number.
   */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Gets the phase identifier string for the current context.
   * Format: "YEAR-SEASON-PHASE" (e.g., "1901-SPRING-DIPLOMACY")
   */
  getPhaseId(): string {
    return `${this.context.year}-${this.context.season}-${this.context.phase}`;
  }

  /**
   * Sends a message to a channel.
   */
  sendMessage(sender: Power, request: SendMessageRequest): Message {
    // Validate channel access
    if (!this.channelManager.canSendToChannel(sender, request.channelId)) {
      throw new Error(
        `Power ${sender} is not a participant in channel ${request.channelId}`
      );
    }

    // Check rate limiting
    if (!this.checkRateLimit(sender)) {
      throw new Error(
        `Power ${sender} has exceeded message limit for this phase`
      );
    }

    // Validate message length
    if (request.content.length > this.config.maxMessageLength) {
      throw new Error(
        `Message exceeds maximum length of ${this.config.maxMessageLength}`
      );
    }

    // Validate reply target exists
    if (request.replyTo && !this.messages.has(request.replyTo)) {
      throw new Error(`Reply target message not found: ${request.replyTo}`);
    }

    const channel = this.channelManager.getChannel(request.channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${request.channelId}`);
    }

    // Build metadata with round tracking
    let metadata = this.config.includeMetadata ? request.metadata : undefined;
    if (this.currentRound > 0) {
      metadata = {
        ...metadata,
        pressRound: this.currentRound,
        phaseId: this.getPhaseId(),
      };
    }

    // Create the message
    const message: Message = {
      id: generateMessageId(),
      channelId: request.channelId,
      sender,
      content: request.content,
      timestamp: new Date(),
      replyTo: request.replyTo,
      metadata,
      phase: { ...this.context },
    };

    // Store the message
    this.messages.set(message.id, message);

    // Add to channel messages with sliding window
    if (!this.messagesByChannel.has(request.channelId)) {
      this.messagesByChannel.set(request.channelId, []);
    }
    const channelMessages = this.messagesByChannel.get(request.channelId)!;
    channelMessages.push(message);

    // Apply sliding window - keep only most recent messages per channel
    if (channelMessages.length > this.config.maxMessagesPerChannel) {
      const toRemove = channelMessages.splice(
        0,
        channelMessages.length - this.config.maxMessagesPerChannel
      );
      // Also remove from main message map to free memory
      for (const oldMsg of toRemove) {
        this.messages.delete(oldMsg.id);
        // Remove from thread tracking if needed
        if (oldMsg.replyTo) {
          const threadRoot = this.getThreadRoot(oldMsg.replyTo);
          const threadMessages = this.messagesByThread.get(threadRoot);
          if (threadMessages) {
            const idx = threadMessages.indexOf(oldMsg);
            if (idx !== -1) {
              threadMessages.splice(idx, 1);
            }
          }
        }
      }
    }

    // Add to thread if it's a reply
    if (request.replyTo) {
      const threadRoot = this.getThreadRoot(request.replyTo);
      if (!this.messagesByThread.has(threadRoot)) {
        this.messagesByThread.set(threadRoot, []);
      }
      this.messagesByThread.get(threadRoot)!.push(message);
    }

    // Update rate limit counter
    this.incrementMessageCount(sender);

    // Send notifications
    this.notify(channel, {
      type: 'NEW_MESSAGE',
      message,
      channel,
      timestamp: new Date(),
    });

    return message;
  }

  /**
   * Gets the root message of a thread.
   */
  private getThreadRoot(messageId: MessageId): MessageId {
    const message = this.messages.get(messageId);
    if (!message || !message.replyTo) {
      return messageId;
    }
    return this.getThreadRoot(message.replyTo);
  }

  /**
   * Creates a multiparty channel (alliance chat).
   */
  createMultipartyChannel(
    creator: Power,
    request: CreateChannelRequest
  ): Channel {
    // Creator must be in the participants
    if (!request.participants.includes(creator)) {
      request.participants = [creator, ...request.participants];
    }

    const channel = this.channelManager.createMultipartyChannel(request);

    // Notify all participants
    for (const power of channel.participants) {
      if (power !== creator) {
        this.notify(channel, {
          type: 'CHANNEL_INVITED',
          channel,
          timestamp: new Date(),
        });
      }
    }

    return channel;
  }

  /**
   * Gets a message by ID.
   */
  getMessage(messageId: MessageId): Message | undefined {
    return this.messages.get(messageId);
  }

  /**
   * Queries messages based on criteria.
   */
  queryMessages(query: MessageQuery): MessageQueryResult {
    let messages: Message[] = [];

    if (query.threadId) {
      // Get all messages in a thread
      const threadRoot = this.getThreadRoot(query.threadId);
      const rootMessage = this.messages.get(threadRoot);
      if (rootMessage) {
        messages = [rootMessage, ...(this.messagesByThread.get(threadRoot) || [])];
      }
    } else if (query.channelId) {
      // Get messages from a specific channel
      messages = this.messagesByChannel.get(query.channelId) || [];
    } else {
      // Get all messages
      messages = Array.from(this.messages.values());
    }

    // Filter by sender
    if (query.sender) {
      messages = messages.filter((m) => m.sender === query.sender);
    }

    // Filter by time
    if (query.since) {
      messages = messages.filter((m) => m.timestamp >= query.since!);
    }

    // Sort by timestamp
    messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Apply limit
    const limit = query.limit || 100;
    const hasMore = messages.length > limit;
    messages = messages.slice(0, limit);

    return {
      messages,
      hasMore,
      nextCursor: hasMore ? messages[messages.length - 1]?.id : undefined,
    };
  }

  /**
   * Gets all messages visible to a power.
   */
  getMessagesForPower(power: Power): Message[] {
    const channels = this.channelManager.getChannelsForPower(power);
    const messages: Message[] = [];

    for (const channel of channels) {
      const channelMessages = this.messagesByChannel.get(channel.id) || [];
      messages.push(...channelMessages);
    }

    return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Gets all messages sent during a specific press round.
   */
  getMessagesByRound(round: number): Message[] {
    return Array.from(this.messages.values()).filter(
      (m) => m.metadata?.pressRound === round
    );
  }

  /**
   * Gets the channel manager for direct channel operations.
   */
  getChannelManager(): ChannelManager {
    return this.channelManager;
  }

  /**
   * Gets all channels.
   */
  getAllChannels(): Channel[] {
    return this.channelManager.getAllChannels();
  }

  /**
   * Gets channels for a specific power.
   */
  getChannelsForPower(power: Power): Channel[] {
    return this.channelManager.getChannelsForPower(power);
  }

  /**
   * Gets the bilateral channel between two powers.
   */
  getBilateralChannel(power1: Power, power2: Power): Channel {
    return this.channelManager.getBilateralChannel(power1, power2);
  }

  /**
   * Gets the global channel.
   */
  getGlobalChannel(): Channel {
    return this.channelManager.getGlobalChannel();
  }

  /**
   * Gets the current press context.
   */
  getContext(): PressContext {
    return { ...this.context };
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): PressConfig {
    return { ...this.config };
  }

  /**
   * Clear all stored messages and reset state.
   * Call this when the game is complete to free memory.
   */
  clear(): void {
    this.messages.clear();
    this.messagesByChannel.clear();
    this.messagesByThread.clear();
    this.messageCountByPowerAndPhase.clear();
    this.notificationCallbacks = [];
  }
}
