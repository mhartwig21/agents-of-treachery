/**
 * Spectator view for the press system.
 *
 * Provides omniscient access to all diplomatic communications for observers.
 * Humans watching AI Diplomacy can see all negotiations, lies, and betrayals.
 */

import { PressSystem } from './press-system';
import {
  Channel,
  ChannelId,
  ChannelType,
  Message,
  Power,
  PressNotification,
  SpectatorView,
} from './types';

/**
 * Statistics about press activity.
 */
export interface PressStatistics {
  totalMessages: number;
  messagesByPower: Map<Power, number>;
  messagesByChannel: Map<ChannelId, number>;
  messagesByChannelType: Record<ChannelType, number>;
  averageMessageLength: number;
  mostActiveChannel: ChannelId | null;
  mostActivePower: Power | null;
  allianceCount: number;
}

/**
 * A diplomatic exchange (request/response pair).
 */
export interface DiplomaticExchange {
  proposal: Message;
  responses: Message[];
  outcome: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'IGNORED';
}

/**
 * Activity in a time period.
 */
export interface ActivityPeriod {
  start: Date;
  end: Date;
  messages: Message[];
  newAlliances: Channel[];
}

/**
 * Spectator API - omniscient view of all press activity.
 *
 * Usage:
 * ```typescript
 * const spectator = new SpectatorAPI(pressSystem);
 *
 * // Watch all messages in real-time
 * spectator.onAnyMessage((msg) => {
 *   console.log(`${msg.sender} to ${msg.channelId}: ${msg.content}`);
 * });
 *
 * // Get full view
 * const view = spectator.getFullView();
 *
 * // See what England is saying privately vs publicly
 * const englandPrivate = spectator.getPrivateMessagesFrom('ENGLAND');
 * const englandPublic = spectator.getPublicMessagesFrom('ENGLAND');
 * ```
 */
export class SpectatorAPI {
  private pressSystem: PressSystem;
  private messageCallbacks: ((message: Message, channel: Channel) => void)[] = [];
  private seenMessageIds: Set<string> = new Set();

  constructor(pressSystem: PressSystem) {
    this.pressSystem = pressSystem;

    // Subscribe to all notifications
    this.pressSystem.onNotification(this.handleNotification.bind(this));
  }

  /**
   * Handles all notifications for spectator view.
   * Deduplicates to ensure each message is only reported once.
   */
  private handleNotification(
    _power: Power,
    notification: PressNotification
  ): void {
    if (notification.type === 'NEW_MESSAGE' && notification.message) {
      // Deduplicate - only process each message once
      if (this.seenMessageIds.has(notification.message.id)) {
        return;
      }
      this.seenMessageIds.add(notification.message.id);

      for (const callback of this.messageCallbacks) {
        callback(notification.message, notification.channel);
      }
    }
  }

  /**
   * Gets the complete spectator view of all press.
   */
  getFullView(): SpectatorView {
    const channels = this.pressSystem.getAllChannels();
    const messagesByChannel = new Map<ChannelId, Message[]>();
    const recentMessages: Message[] = [];

    for (const channel of channels) {
      const result = this.pressSystem.queryMessages({ channelId: channel.id });
      messagesByChannel.set(channel.id, result.messages);
      recentMessages.push(...result.messages);
    }

    // Sort recent messages and take the latest 50
    recentMessages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      channels,
      recentMessages: recentMessages.slice(0, 50),
      messagesByChannel,
    };
  }

  /**
   * Gets all messages from a specific power.
   */
  getMessagesFrom(power: Power): Message[] {
    const allChannels = this.pressSystem.getAllChannels();
    const messages: Message[] = [];

    for (const channel of allChannels) {
      const result = this.pressSystem.queryMessages({
        channelId: channel.id,
        sender: power,
      });
      messages.push(...result.messages);
    }

    return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Gets all private (non-global) messages from a power.
   */
  getPrivateMessagesFrom(power: Power): Message[] {
    return this.getMessagesFrom(power).filter((m) => {
      const channel = this.pressSystem.getChannelManager().getChannel(m.channelId);
      return channel && channel.type !== 'GLOBAL';
    });
  }

  /**
   * Gets all public (global) messages from a power.
   */
  getPublicMessagesFrom(power: Power): Message[] {
    return this.getMessagesFrom(power).filter((m) => {
      const channel = this.pressSystem.getChannelManager().getChannel(m.channelId);
      return channel && channel.type === 'GLOBAL';
    });
  }

  /**
   * Gets all messages in a bilateral relationship.
   */
  getBilateralConversation(power1: Power, power2: Power): Message[] {
    const channel = this.pressSystem.getBilateralChannel(power1, power2);
    return this.pressSystem.queryMessages({ channelId: channel.id }).messages;
  }

  /**
   * Gets all multiparty (alliance) channels.
   */
  getAlliances(): Channel[] {
    return this.pressSystem.getAllChannels().filter((c) => c.type === 'MULTIPARTY');
  }

  /**
   * Gets messages from a specific alliance channel.
   */
  getAllianceMessages(channelId: ChannelId): Message[] {
    const channel = this.pressSystem.getChannelManager().getChannel(channelId);
    if (!channel || channel.type !== 'MULTIPARTY') {
      return [];
    }
    return this.pressSystem.queryMessages({ channelId }).messages;
  }

  /**
   * Computes statistics about press activity.
   */
  getStatistics(): PressStatistics {
    const channels = this.pressSystem.getAllChannels();
    const messagesByPower = new Map<Power, number>();
    const messagesByChannel = new Map<ChannelId, number>();
    const messagesByChannelType: Record<ChannelType, number> = {
      BILATERAL: 0,
      MULTIPARTY: 0,
      GLOBAL: 0,
    };

    let totalMessages = 0;
    let totalLength = 0;
    let mostActiveChannel: ChannelId | null = null;
    let maxChannelMessages = 0;

    for (const channel of channels) {
      const messages = this.pressSystem.queryMessages({ channelId: channel.id }).messages;
      const count = messages.length;

      messagesByChannel.set(channel.id, count);
      messagesByChannelType[channel.type] += count;
      totalMessages += count;

      if (count > maxChannelMessages) {
        maxChannelMessages = count;
        mostActiveChannel = channel.id;
      }

      for (const message of messages) {
        totalLength += message.content.length;
        const currentCount = messagesByPower.get(message.sender) || 0;
        messagesByPower.set(message.sender, currentCount + 1);
      }
    }

    // Find most active power
    let mostActivePower: Power | null = null;
    let maxPowerMessages = 0;
    for (const [power, count] of messagesByPower) {
      if (count > maxPowerMessages) {
        maxPowerMessages = count;
        mostActivePower = power;
      }
    }

    const allianceCount = channels.filter((c) => c.type === 'MULTIPARTY').length;

    return {
      totalMessages,
      messagesByPower,
      messagesByChannel,
      messagesByChannelType,
      averageMessageLength: totalMessages > 0 ? totalLength / totalMessages : 0,
      mostActiveChannel,
      mostActivePower,
      allianceCount,
    };
  }

  /**
   * Finds potential deception - when a power says contradictory things.
   * Returns messages where the same power made different proposals to different powers.
   */
  findContradictions(power: Power): { message1: Message; message2: Message }[] {
    const privateMessages = this.getPrivateMessagesFrom(power);
    const contradictions: { message1: Message; message2: Message }[] = [];

    // Simple heuristic: look for PROPOSAL intent messages with different content
    const proposals = privateMessages.filter(
      (m) => m.metadata?.intent === 'PROPOSAL'
    );

    for (let i = 0; i < proposals.length; i++) {
      for (let j = i + 1; j < proposals.length; j++) {
        // Different channels, similar timeframe
        if (
          proposals[i].channelId !== proposals[j].channelId &&
          Math.abs(proposals[i].timestamp.getTime() - proposals[j].timestamp.getTime()) <
            3600000 // Within 1 hour
        ) {
          contradictions.push({
            message1: proposals[i],
            message2: proposals[j],
          });
        }
      }
    }

    return contradictions;
  }

  /**
   * Gets activity timeline - messages grouped by time periods.
   */
  getActivityTimeline(intervalMinutes: number = 30): ActivityPeriod[] {
    const view = this.getFullView();
    const allMessages = view.recentMessages.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    if (allMessages.length === 0) return [];

    const periods: ActivityPeriod[] = [];
    let currentPeriod: ActivityPeriod | null = null;
    const intervalMs = intervalMinutes * 60 * 1000;

    for (const message of allMessages) {
      if (
        !currentPeriod ||
        message.timestamp.getTime() - currentPeriod.start.getTime() > intervalMs
      ) {
        if (currentPeriod) {
          periods.push(currentPeriod);
        }
        currentPeriod = {
          start: message.timestamp,
          end: message.timestamp,
          messages: [message],
          newAlliances: [],
        };
      } else {
        currentPeriod.messages.push(message);
        currentPeriod.end = message.timestamp;
      }
    }

    if (currentPeriod) {
      periods.push(currentPeriod);
    }

    return periods;
  }

  /**
   * Registers a callback for any new message (real-time spectating).
   */
  onAnyMessage(
    callback: (message: Message, channel: Channel) => void
  ): () => void {
    this.messageCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index !== -1) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Gets messages mentioning specific territories.
   */
  getMessagesAboutTerritories(territories: string[]): Message[] {
    const view = this.getFullView();
    const lowerTerritories = territories.map((t) => t.toLowerCase());

    return view.recentMessages.filter((m) => {
      const content = m.content.toLowerCase();
      const refs = m.metadata?.references?.map((r) => r.toLowerCase()) || [];

      return (
        lowerTerritories.some((t) => content.includes(t)) ||
        refs.some((r) => lowerTerritories.includes(r))
      );
    });
  }

  /**
   * Builds a relationship graph based on message frequency.
   */
  getRelationshipGraph(): Map<string, number> {
    const edges = new Map<string, number>();
    const channels = this.pressSystem.getAllChannels();

    for (const channel of channels) {
      if (channel.type === 'BILATERAL') {
        const [power1, power2] = channel.participants;
        const key = `${power1}-${power2}`;
        const messages = this.pressSystem.queryMessages({ channelId: channel.id }).messages;
        edges.set(key, messages.length);
      }
    }

    return edges;
  }
}
