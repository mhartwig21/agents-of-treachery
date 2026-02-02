/**
 * Hook for integrating with the SpectatorAPI for real-time press viewing.
 *
 * Wraps SpectatorAPI with React state management and real-time subscriptions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SpectatorAPI, type PressStatistics } from '../press/spectator';
import { PressSystem } from '../press/press-system';
import type { Message, Channel, Power, ChannelId, SpectatorView } from '../press/types';

interface UseSpectatorAPIOptions {
  /** PressSystem instance to observe */
  pressSystem?: PressSystem;
  /** Whether to auto-subscribe to new messages */
  autoSubscribe?: boolean;
  /** Callback for new messages */
  onNewMessage?: (message: Message, channel: Channel) => void;
}

interface UseSpectatorAPIReturn {
  /** Whether the API is connected */
  isConnected: boolean;
  /** Full spectator view data */
  view: SpectatorView | null;
  /** Press statistics */
  statistics: PressStatistics | null;
  /** All channels */
  channels: Channel[];
  /** Recent messages (last 50) */
  recentMessages: Message[];
  /** Get messages for a specific channel */
  getChannelMessages: (channelId: ChannelId) => Message[];
  /** Get messages from a power */
  getMessagesFrom: (power: Power) => Message[];
  /** Get bilateral conversation */
  getBilateralConversation: (power1: Power, power2: Power) => Message[];
  /** Get all alliance channels */
  getAlliances: () => Channel[];
  /** Find potential contradictions */
  findContradictions: (power: Power) => { message1: Message; message2: Message }[];
  /** Refresh all data */
  refresh: () => void;
}

/**
 * Hook to use the SpectatorAPI with React state.
 */
export function useSpectatorAPI(options: UseSpectatorAPIOptions = {}): UseSpectatorAPIReturn {
  const { pressSystem, autoSubscribe = true, onNewMessage } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [view, setView] = useState<SpectatorView | null>(null);
  const [statistics, setStatistics] = useState<PressStatistics | null>(null);

  const spectatorRef = useRef<SpectatorAPI | null>(null);

  // Initialize spectator when pressSystem is provided
  useEffect(() => {
    if (!pressSystem) {
      setIsConnected(false);
      return;
    }

    const spectator = new SpectatorAPI(pressSystem);
    spectatorRef.current = spectator;
    setIsConnected(true);

    // Initial data load
    setView(spectator.getFullView());
    setStatistics(spectator.getStatistics());

    // Subscribe to new messages
    let unsubscribe: (() => void) | undefined;
    if (autoSubscribe) {
      unsubscribe = spectator.onAnyMessage((message, channel) => {
        // Update view with new message
        setView(spectator.getFullView());
        setStatistics(spectator.getStatistics());

        // Call external callback
        onNewMessage?.(message, channel);
      });
    }

    return () => {
      unsubscribe?.();
      spectatorRef.current = null;
      setIsConnected(false);
    };
  }, [pressSystem, autoSubscribe, onNewMessage]);

  const refresh = useCallback(() => {
    if (spectatorRef.current) {
      setView(spectatorRef.current.getFullView());
      setStatistics(spectatorRef.current.getStatistics());
    }
  }, []);

  const getChannelMessages = useCallback((channelId: ChannelId): Message[] => {
    if (!view) return [];
    return view.messagesByChannel.get(channelId) || [];
  }, [view]);

  const getMessagesFrom = useCallback((power: Power): Message[] => {
    return spectatorRef.current?.getMessagesFrom(power) || [];
  }, []);

  const getBilateralConversation = useCallback((power1: Power, power2: Power): Message[] => {
    return spectatorRef.current?.getBilateralConversation(power1, power2) || [];
  }, []);

  const getAlliances = useCallback((): Channel[] => {
    return spectatorRef.current?.getAlliances() || [];
  }, []);

  const findContradictions = useCallback((power: Power) => {
    return spectatorRef.current?.findContradictions(power) || [];
  }, []);

  return {
    isConnected,
    view,
    statistics,
    channels: view?.channels || [],
    recentMessages: view?.recentMessages || [],
    getChannelMessages,
    getMessagesFrom,
    getBilateralConversation,
    getAlliances,
    findContradictions,
    refresh,
  };
}

/**
 * Hook for filtering and searching messages.
 */
interface MessageFilter {
  channelIds?: ChannelId[];
  powers?: Power[];
  searchQuery?: string;
  intents?: string[];
  since?: Date;
}

export function useFilteredMessages(
  messages: Message[],
  filter: MessageFilter
): Message[] {
  return messages.filter((message) => {
    // Filter by channel
    if (filter.channelIds?.length && !filter.channelIds.includes(message.channelId)) {
      return false;
    }

    // Filter by sender
    if (filter.powers?.length && !filter.powers.includes(message.sender)) {
      return false;
    }

    // Filter by search query
    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      if (!message.content.toLowerCase().includes(query)) {
        return false;
      }
    }

    // Filter by intent
    if (filter.intents?.length && message.metadata?.intent) {
      if (!filter.intents.includes(message.metadata.intent)) {
        return false;
      }
    }

    // Filter by time
    if (filter.since && message.timestamp < filter.since) {
      return false;
    }

    return true;
  });
}

/**
 * Hook for grouping messages by channel.
 */
export function useMessagesByChannel(messages: Message[]): Map<ChannelId, Message[]> {
  const grouped = new Map<ChannelId, Message[]>();

  for (const message of messages) {
    if (!grouped.has(message.channelId)) {
      grouped.set(message.channelId, []);
    }
    grouped.get(message.channelId)!.push(message);
  }

  // Sort messages within each channel by timestamp
  for (const [, channelMessages] of grouped) {
    channelMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  return grouped;
}

/**
 * Hook for real-time message notifications.
 */
export function useMessageNotifications(
  pressSystem: PressSystem | undefined,
  callback: (message: Message, channel: Channel) => void
) {
  useEffect(() => {
    if (!pressSystem) return;

    const spectator = new SpectatorAPI(pressSystem);
    const unsubscribe = spectator.onAnyMessage(callback);

    return () => {
      unsubscribe();
    };
  }, [pressSystem, callback]);
}
