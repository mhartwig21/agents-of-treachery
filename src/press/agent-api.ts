/**
 * Agent API for the press system.
 *
 * Provides a clean, structured interface for AI agents to send and receive
 * diplomatic messages. This API is designed for easy consumption by LLMs.
 */

import { PressSystem, NotificationCallback } from './press-system';
import { getBilateralChannelId, GLOBAL_CHANNEL_ID } from './channel';
import {
  Channel,
  ChannelId,
  Message,
  MessageId,
  MessageIntent,
  MessageMetadata,
  MessageQuery,
  Power,
  POWERS,
  PressNotification,
} from './types';

/**
 * Structured response format for agents.
 */
export interface AgentResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Inbox summary for an agent.
 */
export interface InboxSummary {
  unreadCount: number;
  channels: ChannelSummary[];
  recentMessages: Message[];
}

/**
 * Summary of a channel for agent view.
 */
export interface ChannelSummary {
  id: ChannelId;
  type: 'BILATERAL' | 'MULTIPARTY' | 'GLOBAL';
  participants: Power[];
  name?: string;
  messageCount: number;
  lastMessage?: Message;
}

/**
 * Options for sending a message.
 */
export interface AgentSendOptions {
  intent?: MessageIntent;
  replyTo?: MessageId;
  references?: string[];
}

/**
 * Agent API - the primary interface for AI agents to interact with press.
 *
 * Usage example:
 * ```typescript
 * const api = new AgentPressAPI(pressSystem, 'ENGLAND');
 *
 * // Send a bilateral message
 * api.sendTo('FRANCE', 'Let us discuss the Channel situation.');
 *
 * // Send with intent metadata
 * api.sendTo('GERMANY', 'I propose we ally against France.', {
 *   intent: 'PROPOSAL',
 *   references: ['BEL', 'HOL']
 * });
 *
 * // Broadcast to all
 * api.broadcast('We seek only peace.');
 *
 * // Check inbox
 * const inbox = api.getInbox();
 * ```
 */
export class AgentPressAPI {
  private pressSystem: PressSystem;
  private power: Power;
  private lastReadTimestamp: Map<ChannelId, Date> = new Map();
  private notificationQueue: PressNotification[] = [];

  constructor(pressSystem: PressSystem, power: Power) {
    this.pressSystem = pressSystem;
    this.power = power;

    // Register for notifications
    this.pressSystem.onNotification(this.handleNotification.bind(this));
  }

  /**
   * Handles incoming notifications.
   */
  private handleNotification(
    targetPower: Power,
    notification: PressNotification
  ): void {
    if (targetPower === this.power) {
      this.notificationQueue.push(notification);
    }
  }

  /**
   * Gets the power this API represents.
   */
  getPower(): Power {
    return this.power;
  }

  /**
   * Sends a bilateral message to another power.
   */
  sendTo(
    recipient: Power,
    content: string,
    options: AgentSendOptions = {}
  ): AgentResponse<Message> {
    if (recipient === this.power) {
      return { success: false, error: 'Cannot send message to yourself' };
    }

    const channelId = getBilateralChannelId(this.power, recipient);
    return this.sendToChannel(channelId, content, options);
  }

  /**
   * Sends a message to a multiparty channel.
   */
  sendToGroup(
    channelId: ChannelId,
    content: string,
    options: AgentSendOptions = {}
  ): AgentResponse<Message> {
    return this.sendToChannel(channelId, content, options);
  }

  /**
   * Broadcasts a message to all powers (global press).
   */
  broadcast(
    content: string,
    options: AgentSendOptions = {}
  ): AgentResponse<Message> {
    return this.sendToChannel(GLOBAL_CHANNEL_ID, content, options);
  }

  /**
   * Sends a message to any channel.
   */
  private sendToChannel(
    channelId: ChannelId,
    content: string,
    options: AgentSendOptions = {}
  ): AgentResponse<Message> {
    try {
      const metadata: MessageMetadata | undefined =
        options.intent || options.references
          ? {
              intent: options.intent,
              references: options.references,
            }
          : undefined;

      const message = this.pressSystem.sendMessage(this.power, {
        channelId,
        content,
        replyTo: options.replyTo,
        metadata,
      });

      return { success: true, data: message };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Replies to a specific message.
   */
  replyTo(
    messageId: MessageId,
    content: string,
    options: Omit<AgentSendOptions, 'replyTo'> = {}
  ): AgentResponse<Message> {
    const originalMessage = this.pressSystem.getMessage(messageId);
    if (!originalMessage) {
      return { success: false, error: 'Original message not found' };
    }

    return this.sendToChannel(originalMessage.channelId, content, {
      ...options,
      replyTo: messageId,
    });
  }

  /**
   * Creates a multiparty channel (alliance chat).
   */
  createAlliance(
    participants: Power[],
    name?: string
  ): AgentResponse<Channel> {
    try {
      const channel = this.pressSystem.createMultipartyChannel(this.power, {
        participants,
        name,
      });
      return { success: true, data: channel };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Gets the agent's inbox summary.
   */
  getInbox(): InboxSummary {
    const channels = this.pressSystem.getChannelsForPower(this.power);
    const channelSummaries: ChannelSummary[] = [];
    let unreadCount = 0;
    const recentMessages: Message[] = [];
    const seenIds = new Set<MessageId>();
    const currentContext = this.pressSystem.getContext();

    for (const channel of channels) {
      const messages = this.pressSystem.queryMessages({
        channelId: channel.id,
      }).messages;

      const lastMessage = messages[messages.length - 1];
      const lastRead = this.lastReadTimestamp.get(channel.id);

      // Count unread messages
      const unreadInChannel = lastRead
        ? messages.filter((m) => m.timestamp > lastRead && m.sender !== this.power).length
        : messages.filter((m) => m.sender !== this.power).length;

      unreadCount += unreadInChannel;

      channelSummaries.push({
        id: channel.id,
        type: channel.type,
        participants: channel.participants,
        name: channel.name,
        messageCount: messages.length,
        lastMessage,
      });

      // Collect recent messages (last 5 from each channel), filtered to current phase
      const phaseMessages = messages.filter((m) =>
        !m.phase || (
          m.phase.year === currentContext.year &&
          m.phase.season === currentContext.season &&
          m.phase.phase === currentContext.phase
        )
      );
      for (const msg of phaseMessages.slice(-5)) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          recentMessages.push(msg);
        }
      }
    }

    // Sort recent messages chronologically (oldest-first, natural reading order)
    recentMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      unreadCount,
      channels: channelSummaries,
      recentMessages: recentMessages.slice(0, 20),
    };
  }

  /**
   * Gets messages from a specific channel.
   */
  getChannelMessages(
    channelId: ChannelId,
    options: { limit?: number; since?: Date } = {}
  ): AgentResponse<Message[]> {
    // Verify access
    const channel = this.pressSystem.getChannelManager().getChannel(channelId);
    if (!channel || !channel.participants.includes(this.power)) {
      return { success: false, error: 'Channel not accessible' };
    }

    const result = this.pressSystem.queryMessages({
      channelId,
      limit: options.limit,
      since: options.since,
    });

    // Mark as read
    this.lastReadTimestamp.set(channelId, new Date());

    return { success: true, data: result.messages };
  }

  /**
   * Gets the conversation with another power.
   */
  getConversationWith(
    otherPower: Power,
    options: { limit?: number; since?: Date } = {}
  ): AgentResponse<Message[]> {
    const channelId = getBilateralChannelId(this.power, otherPower);
    return this.getChannelMessages(channelId, options);
  }

  /**
   * Gets all pending notifications and clears the queue.
   */
  getNotifications(): PressNotification[] {
    const notifications = [...this.notificationQueue];
    this.notificationQueue = [];
    return notifications;
  }

  /**
   * Checks if there are pending notifications.
   */
  hasNotifications(): boolean {
    return this.notificationQueue.length > 0;
  }

  /**
   * Gets a list of all powers the agent can communicate with.
   */
  getOtherPowers(): Power[] {
    return POWERS.filter((p: Power) => p !== this.power);
  }

  /**
   * Gets available alliance (multiparty) channels.
   */
  getAlliances(): Channel[] {
    return this.pressSystem
      .getChannelsForPower(this.power)
      .filter((c) => c.type === 'MULTIPARTY');
  }

  /**
   * Gets all messages visible to this power from a specific press round.
   */
  getMessagesByRound(round: number): Message[] {
    const allRoundMessages = this.pressSystem.getMessagesByRound(round);
    const myChannels = new Set(
      this.pressSystem.getChannelsForPower(this.power).map((c) => c.id)
    );
    return allRoundMessages
      .filter((m) => myChannels.has(m.channelId))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Searches messages for keywords.
   */
  searchMessages(
    keyword: string,
    options: { channelId?: ChannelId; sender?: Power } = {}
  ): Message[] {
    const query: MessageQuery = {
      channelId: options.channelId,
      sender: options.sender,
    };

    const messages = options.channelId
      ? this.pressSystem.queryMessages(query).messages
      : this.pressSystem.getMessagesForPower(this.power);

    const lowerKeyword = keyword.toLowerCase();
    return messages.filter((m) =>
      m.content.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Gets a thread (message and all replies).
   */
  getThread(messageId: MessageId): AgentResponse<Message[]> {
    const result = this.pressSystem.queryMessages({ threadId: messageId });
    return { success: true, data: result.messages };
  }

  /**
   * Registers a callback for real-time notifications.
   */
  onMessage(callback: (notification: PressNotification) => void): () => void {
    const wrappedCallback: NotificationCallback = (power, notification) => {
      if (power === this.power) {
        callback(notification);
      }
    };

    this.pressSystem.onNotification(wrappedCallback);

    // Return unsubscribe function
    return () => {
      this.pressSystem.offNotification(wrappedCallback);
    };
  }
}

/**
 * Factory function to create agent APIs for all powers.
 */
export function createAgentAPIs(
  pressSystem: PressSystem
): Map<Power, AgentPressAPI> {
  const apis = new Map<Power, AgentPressAPI>();

  for (const power of POWERS) {
    apis.set(power, new AgentPressAPI(pressSystem, power));
  }

  return apis;
}
