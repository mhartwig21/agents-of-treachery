/**
 * Channel management for the press system.
 *
 * Handles creation, lookup, and management of communication channels.
 */

import {
  Channel,
  ChannelId,
  ChannelType,
  Power,
  POWERS,
  CreateChannelRequest,
} from './types';

/**
 * Generates a canonical channel ID for bilateral channels.
 * Powers are sorted alphabetically to ensure consistency.
 */
export function getBilateralChannelId(power1: Power, power2: Power): ChannelId {
  const sorted = [power1, power2].sort();
  return `bilateral:${sorted[0]}:${sorted[1]}`;
}

/**
 * Generates a channel ID for multiparty channels.
 * Powers are sorted alphabetically for consistency.
 */
export function getMultipartyChannelId(powers: Power[]): ChannelId {
  const sorted = [...powers].sort();
  return `multiparty:${sorted.join(':')}`;
}

/**
 * The global channel ID (constant).
 */
export const GLOBAL_CHANNEL_ID: ChannelId = 'global';

/**
 * Parses a channel ID to extract its type and participants.
 */
export function parseChannelId(channelId: ChannelId): {
  type: ChannelType;
  participants: Power[];
} {
  if (channelId === GLOBAL_CHANNEL_ID) {
    return { type: 'GLOBAL', participants: [...POWERS] };
  }

  const parts = channelId.split(':');
  const typeStr = parts[0];
  const participants = parts.slice(1) as Power[];

  if (typeStr === 'bilateral') {
    return { type: 'BILATERAL', participants };
  } else if (typeStr === 'multiparty') {
    return { type: 'MULTIPARTY', participants };
  }

  throw new Error(`Invalid channel ID format: ${channelId}`);
}

/**
 * Checks if a power is a participant in a channel.
 */
export function isParticipant(channelId: ChannelId, power: Power): boolean {
  const { participants } = parseChannelId(channelId);
  return participants.includes(power);
}

/**
 * Manages press channels for a game.
 */
export class ChannelManager {
  private channels: Map<ChannelId, Channel> = new Map();
  private powerChannels: Map<Power, Set<ChannelId>> = new Map();

  constructor() {
    // Initialize power channel tracking
    for (const power of POWERS) {
      this.powerChannels.set(power, new Set());
    }

    // Create the global channel
    this.createGlobalChannel();

    // Create all bilateral channels
    this.createAllBilateralChannels();
  }

  /**
   * Creates the global broadcast channel.
   */
  private createGlobalChannel(): Channel {
    const channel: Channel = {
      id: GLOBAL_CHANNEL_ID,
      type: 'GLOBAL',
      participants: [...POWERS],
      createdAt: new Date(),
      name: 'Global Press',
    };

    this.channels.set(channel.id, channel);

    // Add to all powers' channel lists
    for (const power of POWERS) {
      this.powerChannels.get(power)!.add(channel.id);
    }

    return channel;
  }

  /**
   * Creates all bilateral channels at game start.
   * In Diplomacy, all powers can communicate with all others.
   */
  private createAllBilateralChannels(): void {
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const power1 = POWERS[i];
        const power2 = POWERS[j];
        this.createBilateralChannel(power1, power2);
      }
    }
  }

  /**
   * Creates a bilateral channel between two powers.
   */
  private createBilateralChannel(power1: Power, power2: Power): Channel {
    const channelId = getBilateralChannelId(power1, power2);

    if (this.channels.has(channelId)) {
      return this.channels.get(channelId)!;
    }

    const channel: Channel = {
      id: channelId,
      type: 'BILATERAL',
      participants: [power1, power2].sort() as Power[],
      createdAt: new Date(),
    };

    this.channels.set(channelId, channel);
    this.powerChannels.get(power1)!.add(channelId);
    this.powerChannels.get(power2)!.add(channelId);

    return channel;
  }

  /**
   * Creates a multiparty channel (alliance group chat).
   */
  createMultipartyChannel(request: CreateChannelRequest): Channel {
    if (request.participants.length < 3) {
      throw new Error('Multiparty channels require at least 3 participants');
    }

    if (request.participants.length > POWERS.length) {
      throw new Error('Too many participants');
    }

    // Check for duplicates
    const uniqueParticipants = new Set(request.participants);
    if (uniqueParticipants.size !== request.participants.length) {
      throw new Error('Duplicate participants not allowed');
    }

    const channelId = getMultipartyChannelId(request.participants);

    if (this.channels.has(channelId)) {
      return this.channels.get(channelId)!;
    }

    const channel: Channel = {
      id: channelId,
      type: 'MULTIPARTY',
      participants: [...request.participants].sort() as Power[],
      createdAt: new Date(),
      name: request.name,
    };

    this.channels.set(channelId, channel);

    for (const power of request.participants) {
      this.powerChannels.get(power)!.add(channelId);
    }

    return channel;
  }

  /**
   * Gets a channel by ID.
   */
  getChannel(channelId: ChannelId): Channel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Gets all channels a power participates in.
   */
  getChannelsForPower(power: Power): Channel[] {
    const channelIds = this.powerChannels.get(power);
    if (!channelIds) return [];

    return Array.from(channelIds)
      .map((id) => this.channels.get(id)!)
      .filter(Boolean);
  }

  /**
   * Gets the bilateral channel between two powers.
   */
  getBilateralChannel(power1: Power, power2: Power): Channel {
    const channelId = getBilateralChannelId(power1, power2);
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Bilateral channel not found: ${channelId}`);
    }
    return channel;
  }

  /**
   * Gets the global channel.
   */
  getGlobalChannel(): Channel {
    return this.channels.get(GLOBAL_CHANNEL_ID)!;
  }

  /**
   * Gets all channels (for spectator view).
   */
  getAllChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Gets all multiparty channels.
   */
  getMultipartyChannels(): Channel[] {
    return Array.from(this.channels.values()).filter(
      (c) => c.type === 'MULTIPARTY'
    );
  }

  /**
   * Validates that a power can send to a channel.
   */
  canSendToChannel(power: Power, channelId: ChannelId): boolean {
    return isParticipant(channelId, power);
  }
}
