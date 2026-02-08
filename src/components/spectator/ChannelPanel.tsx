/**
 * ChannelPanel - Sidebar showing press channels and messages.
 *
 * Displays channel list with filtering and message previews.
 */

import { useState, useMemo } from 'react';
import type { Message, Channel, ChannelType, Power } from '../../press/types';
import { toUIPower, type LowercasePower, UI_POWERS } from '../../spectator/types';
import { useMessagesByChannel } from '../../spectator/useSpectatorAPI';
import { MessageCard } from './MessageCard';
import { PowerBadge } from '../shared/PowerBadge';

interface ChannelPanelProps {
  /** Messages to display */
  messages: Message[];
  /** Available channels (optional, will derive from messages if not provided) */
  channels?: Channel[];
  /** Currently selected channel */
  selectedChannelId?: string;
  /** Callback when channel is selected */
  onChannelSelect?: (channelId: string | null) => void;
  /** Currently selected message */
  selectedMessageId?: string;
  /** Callback when message is selected */
  onMessageSelect?: (messageId: string | null) => void;
  className?: string;
}

type ChannelFilter = 'all' | 'bilateral' | 'multiparty' | 'global';

export function ChannelPanel({
  messages,
  channels,
  selectedChannelId,
  onChannelSelect,
  selectedMessageId,
  onMessageSelect,
  className = '',
}: ChannelPanelProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [powerFilter, setPowerFilter] = useState<LowercasePower | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Group messages by channel
  const messagesByChannel = useMessagesByChannel(messages);

  // Derive channels from messages if not provided
  const derivedChannels = useMemo(() => {
    if (channels) return channels;

    const channelMap = new Map<string, { id: string; type: ChannelType; participants: Power[] }>();
    for (const message of messages) {
      if (!channelMap.has(message.channelId)) {
        // Parse channel type from ID
        let type: ChannelType = 'BILATERAL';
        if (message.channelId === 'global') {
          type = 'GLOBAL';
        } else if (message.channelId.startsWith('multiparty:')) {
          type = 'MULTIPARTY';
        }

        // Extract participants from channel ID
        const participants: Power[] = [];
        if (type === 'BILATERAL') {
          const parts = message.channelId.replace('bilateral:', '').split(':');
          participants.push(...(parts as Power[]));
        } else if (type === 'MULTIPARTY') {
          const parts = message.channelId.replace('multiparty:', '').split(':');
          participants.push(...(parts as Power[]));
        }

        channelMap.set(message.channelId, {
          id: message.channelId,
          type,
          participants,
        });
      }
    }

    return Array.from(channelMap.values()) as Channel[];
  }, [channels, messages]);

  // Filter channels
  const filteredChannels = useMemo(() => {
    return derivedChannels.filter((channel) => {
      // Type filter
      if (channelFilter !== 'all') {
        const typeMap: Record<ChannelFilter, ChannelType> = {
          all: 'BILATERAL',
          bilateral: 'BILATERAL',
          multiparty: 'MULTIPARTY',
          global: 'GLOBAL',
        };
        if (channel.type !== typeMap[channelFilter]) return false;
      }

      // Power filter
      if (powerFilter) {
        const upperPower = powerFilter.toUpperCase() as Power;
        if (!channel.participants.includes(upperPower)) return false;
      }

      return true;
    });
  }, [derivedChannels, channelFilter, powerFilter]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    if (!searchQuery) return null;
    const query = searchQuery.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(query));
  }, [messages, searchQuery]);

  return (
    <div className={`flex flex-col bg-gray-800 ${className}`}>
      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-700">
        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm
            placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-gray-700 space-y-2">
        {/* Channel type filter */}
        <div className="flex gap-1">
          {(['all', 'bilateral', 'multiparty', 'global'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setChannelFilter(filter)}
              aria-label={`Filter channels: ${filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}`}
              aria-pressed={channelFilter === filter}
              className={`
                px-2 py-1 text-xs rounded transition-colors
                ${channelFilter === filter
                  ? 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-white'
                }
              `}
            >
              {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>

        {/* Power filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setPowerFilter(null)}
            aria-label="Filter by power: All Powers"
            aria-pressed={!powerFilter}
            className={`
              px-2 py-1 text-xs rounded transition-colors
              ${!powerFilter ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}
            `}
          >
            All Powers
          </button>
          {UI_POWERS.map((power) => (
            <button
              key={power}
              onClick={() => setPowerFilter(powerFilter === power ? null : power)}
              aria-label={`Filter by power: ${power.charAt(0).toUpperCase() + power.slice(1)}`}
              aria-pressed={powerFilter === power}
              className={`
                px-2 py-1 text-xs rounded transition-colors flex items-center gap-1
                ${powerFilter === power ? 'bg-gray-600' : 'hover:bg-gray-700'}
              `}
            >
              <PowerBadge power={power} size="sm" />
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filteredMessages ? (
          // Search results
          <div className="p-2 space-y-2">
            <div className="text-xs text-gray-500 px-2">
              {filteredMessages.length} results for "{searchQuery}"
            </div>
            {filteredMessages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                compact
                onClick={() => onMessageSelect?.(message.id)}
              />
            ))}
          </div>
        ) : selectedChannelId ? (
          // Selected channel messages
          <ChannelMessages
            channelId={selectedChannelId}
            messages={messagesByChannel.get(selectedChannelId) || []}
            selectedMessageId={selectedMessageId}
            onMessageSelect={onMessageSelect}
            onBack={() => onChannelSelect?.(null)}
          />
        ) : (
          // Channel list
          <div className="p-2 space-y-1">
            {filteredChannels.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                No channels match filters
              </div>
            ) : (
              filteredChannels.map((channel) => (
                <ChannelListItem
                  key={channel.id}
                  channel={channel}
                  messageCount={messagesByChannel.get(channel.id)?.length || 0}
                  lastMessage={messagesByChannel.get(channel.id)?.slice(-1)[0]}
                  onClick={() => onChannelSelect?.(channel.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ChannelListItemProps {
  channel: Channel;
  messageCount: number;
  lastMessage?: Message;
  onClick: () => void;
}

function ChannelListItem({ channel, messageCount, lastMessage, onClick }: ChannelListItemProps) {
  const channelName = getChannelName(channel);

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2 rounded hover:bg-gray-700 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{channelName}</span>
        <span className="text-xs text-gray-500">{messageCount}</span>
      </div>
      {lastMessage && (
        <p className="text-xs text-gray-400 line-clamp-1">
          {toUIPower(lastMessage.sender).slice(0, 3).toUpperCase()}: {lastMessage.content}
        </p>
      )}
    </button>
  );
}

interface ChannelMessagesProps {
  channelId: string;
  messages: Message[];
  selectedMessageId?: string;
  onMessageSelect?: (messageId: string | null) => void;
  onBack: () => void;
}

function ChannelMessages({
  channelId,
  messages,
  selectedMessageId,
  onMessageSelect,
  onBack,
}: ChannelMessagesProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2">
        <button onClick={onBack} className="text-gray-400 hover:text-white" aria-label="Back to channel list">
          ←
        </button>
        <span className="font-medium text-sm truncate">{channelId}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No messages in this channel
          </div>
        ) : (
          messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              compact
              onClick={() => onMessageSelect?.(
                selectedMessageId === message.id ? null : message.id
              )}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Gets a display name for a channel.
 */
function getChannelName(channel: Channel): string {
  if (channel.type === 'GLOBAL') {
    return 'Global';
  }

  if (channel.type === 'MULTIPARTY' && channel.name) {
    return channel.name;
  }

  // Format participant names
  const names = channel.participants.map((p) =>
    p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  );

  if (channel.type === 'BILATERAL') {
    return `${names[0]} - ${names[1]}`;
  }

  return names.join(', ');
}
