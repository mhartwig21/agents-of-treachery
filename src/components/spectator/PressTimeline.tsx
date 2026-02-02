/**
 * PressTimeline - Chronological view of all press messages.
 *
 * Shows messages in time order with filtering and highlighting.
 */

import { useState, useMemo } from 'react';
import type { Message, MessageIntent, Power } from '../../press/types';
import { toUIPower, type LowercasePower, UI_POWERS, POWER_COLORS } from '../../spectator/types';
import { useFilteredMessages } from '../../spectator/useSpectatorAPI';
import { MessageCard, IntentBadge } from './MessageCard';
import { PowerBadge } from '../shared/PowerBadge';

interface PressTimelineProps {
  /** All messages to display */
  messages: Message[];
  /** Highlight messages involving this power */
  highlightPower?: LowercasePower;
  /** Callback when a message is selected */
  onMessageSelect?: (message: Message) => void;
  /** Show filters panel */
  showFilters?: boolean;
  className?: string;
}

const ALL_INTENTS: MessageIntent[] = [
  'PROPOSAL', 'ACCEPTANCE', 'REJECTION', 'THREAT',
  'INFORMATION', 'REQUEST', 'SMALL_TALK', 'DECEPTION'
];

export function PressTimeline({
  messages,
  highlightPower,
  onMessageSelect,
  showFilters = true,
  className = '',
}: PressTimelineProps) {
  const [filterPowers, setFilterPowers] = useState<Power[]>([]);
  const [filterIntents, setFilterIntents] = useState<MessageIntent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Apply filters
  const filteredMessages = useFilteredMessages(messages, {
    powers: filterPowers.length > 0 ? filterPowers : undefined,
    intents: filterIntents.length > 0 ? filterIntents : undefined,
    searchQuery: searchQuery || undefined,
  });

  // Sort by timestamp (newest first)
  const sortedMessages = useMemo(() => {
    return [...filteredMessages].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }, [filteredMessages]);

  // Group messages by time period (hour)
  const groupedMessages = useMemo(() => {
    const groups: { label: string; messages: Message[] }[] = [];
    let currentGroup: { label: string; messages: Message[] } | null = null;

    for (const message of sortedMessages) {
      const hour = new Date(message.timestamp);
      hour.setMinutes(0, 0, 0);
      const label = formatGroupLabel(hour);

      if (!currentGroup || currentGroup.label !== label) {
        currentGroup = { label, messages: [] };
        groups.push(currentGroup);
      }
      currentGroup.messages.push(message);
    }

    return groups;
  }, [sortedMessages]);

  const togglePowerFilter = (power: Power) => {
    setFilterPowers((prev) =>
      prev.includes(power)
        ? prev.filter((p) => p !== power)
        : [...prev, power]
    );
  };

  const toggleIntentFilter = (intent: MessageIntent) => {
    setFilterIntents((prev) =>
      prev.includes(intent)
        ? prev.filter((i) => i !== intent)
        : [...prev, intent]
    );
  };

  const clearFilters = () => {
    setFilterPowers([]);
    setFilterIntents([]);
    setSearchQuery('');
  };

  const hasFilters = filterPowers.length > 0 || filterIntents.length > 0 || searchQuery;

  return (
    <div className={`flex flex-col bg-gray-800 ${className}`}>
      {showFilters && (
        <>
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Press Timeline</h3>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Search */}
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
            {/* Power filters */}
            <div className="flex flex-wrap gap-1">
              {UI_POWERS.map((power) => {
                const upperPower = power.toUpperCase() as Power;
                const isActive = filterPowers.includes(upperPower);
                return (
                  <button
                    key={power}
                    onClick={() => togglePowerFilter(upperPower)}
                    className={`
                      px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors
                      ${isActive ? 'bg-gray-600 ring-1 ring-blue-500' : 'bg-gray-700 hover:bg-gray-650'}
                    `}
                  >
                    <PowerBadge power={power} size="sm" />
                  </button>
                );
              })}
            </div>

            {/* Intent filters */}
            <div className="flex flex-wrap gap-1">
              {ALL_INTENTS.map((intent) => {
                const isActive = filterIntents.includes(intent);
                return (
                  <button
                    key={intent}
                    onClick={() => toggleIntentFilter(intent)}
                    className={`transition-opacity ${isActive ? '' : 'opacity-50 hover:opacity-75'}`}
                  >
                    <IntentBadge intent={intent} size="sm" />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {sortedMessages.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {hasFilters ? 'No messages match filters' : 'No messages yet'}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {groupedMessages.map((group, groupIdx) => (
              <div key={groupIdx}>
                {/* Time label */}
                <div className="sticky top-0 bg-gray-800/95 backdrop-blur py-1 mb-2">
                  <span className="text-xs text-gray-500 font-medium">
                    {group.label}
                  </span>
                </div>

                {/* Messages */}
                <div className="space-y-2 pl-3 border-l-2 border-gray-700">
                  {group.messages.map((message) => {
                    const senderPower = toUIPower(message.sender);
                    const isHighlighted = highlightPower && senderPower === highlightPower;

                    return (
                      <div
                        key={message.id}
                        className={`relative ${isHighlighted ? 'ring-1 ring-blue-500/50 rounded-lg' : ''}`}
                      >
                        {/* Timeline dot */}
                        <div
                          className="absolute -left-[calc(0.75rem+5px)] top-3 w-2 h-2 rounded-full"
                          style={{ backgroundColor: POWER_COLORS[senderPower] }}
                        />

                        <MessageCard
                          message={message}
                          showChannel
                          onClick={() => onMessageSelect?.(message)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500">
        {sortedMessages.length} of {messages.length} messages
        {hasFilters && ' (filtered)'}
      </div>
    </div>
  );
}

/**
 * Formats a time group label.
 */
function formatGroupLabel(date: Date): string {
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

  if (diffHours < 1) return 'This hour';
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });
}

/**
 * Compact timeline for mobile/sidebar.
 */
interface PressTimelineCompactProps {
  messages: Message[];
  maxMessages?: number;
  onViewAll?: () => void;
  className?: string;
}

export function PressTimelineCompact({
  messages,
  maxMessages = 5,
  onViewAll,
  className = '',
}: PressTimelineCompactProps) {
  const recentMessages = useMemo(() => {
    return [...messages]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, maxMessages);
  }, [messages, maxMessages]);

  return (
    <div className={className}>
      <div className="space-y-2">
        {recentMessages.map((message) => (
          <MessageCard key={message.id} message={message} compact />
        ))}
      </div>

      {messages.length > maxMessages && onViewAll && (
        <button
          onClick={onViewAll}
          className="w-full mt-2 py-2 text-sm text-blue-400 hover:text-blue-300 text-center"
        >
          View all {messages.length} messages →
        </button>
      )}
    </div>
  );
}
