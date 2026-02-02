/**
 * MessageCard - Display for a single press message.
 *
 * Shows sender, content, timestamp, and optional intent badge.
 */

import type { Message, MessageIntent } from '../../press/types';
import { toUIPower, POWER_COLORS } from '../../spectator/types';
import { PowerBadge } from '../shared/PowerBadge';

interface MessageCardProps {
  message: Message;
  /** Show full message or preview */
  compact?: boolean;
  /** Show channel indicator */
  showChannel?: boolean;
  /** Channel name for display */
  channelName?: string;
  /** Click handler */
  onClick?: () => void;
  className?: string;
}

const intentColors: Record<MessageIntent, string> = {
  PROPOSAL: 'bg-blue-900/50 text-blue-300',
  ACCEPTANCE: 'bg-green-900/50 text-green-300',
  REJECTION: 'bg-red-900/50 text-red-300',
  THREAT: 'bg-orange-900/50 text-orange-300',
  INFORMATION: 'bg-purple-900/50 text-purple-300',
  REQUEST: 'bg-yellow-900/50 text-yellow-300',
  SMALL_TALK: 'bg-gray-700 text-gray-300',
  DECEPTION: 'bg-pink-900/50 text-pink-300',
};

const intentLabels: Record<MessageIntent, string> = {
  PROPOSAL: 'Proposal',
  ACCEPTANCE: 'Accept',
  REJECTION: 'Reject',
  THREAT: 'Threat',
  INFORMATION: 'Info',
  REQUEST: 'Request',
  SMALL_TALK: 'Chat',
  DECEPTION: 'Deception',
};

export function MessageCard({
  message,
  compact = false,
  showChannel = false,
  channelName,
  onClick,
  className = '',
}: MessageCardProps) {
  const senderPower = toUIPower(message.sender);
  const intent = message.metadata?.intent;

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`
          p-2 rounded bg-gray-800 hover:bg-gray-750 transition-colors
          ${onClick ? 'cursor-pointer' : ''}
          ${className}
        `}
      >
        <div className="flex items-center gap-2 mb-1">
          <PowerBadge power={senderPower} size="sm" />
          <span className="text-xs text-gray-400">{formatTime(message.timestamp)}</span>
          {intent && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${intentColors[intent]}`}>
              {intentLabels[intent]}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-300 line-clamp-2">{message.content}</p>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`
        rounded-lg overflow-hidden
        ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-gray-600' : ''}
        ${className}
      `}
    >
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ backgroundColor: `${POWER_COLORS[senderPower]}30` }}
      >
        <div className="flex items-center gap-2">
          <PowerBadge power={senderPower} showLabel size="sm" />
          {showChannel && channelName && (
            <>
              <span className="text-gray-500">→</span>
              <span className="text-sm text-gray-400">{channelName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {intent && (
            <IntentBadge intent={intent} />
          )}
          <span className="text-xs text-gray-500">{formatTime(message.timestamp)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2 bg-gray-800">
        <p className="text-sm text-gray-200 whitespace-pre-wrap">{message.content}</p>

        {/* Metadata */}
        {message.metadata?.references && message.metadata.references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.metadata.references.map((ref, i) => (
              <span
                key={i}
                className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded"
              >
                {ref.toUpperCase()}
              </span>
            ))}
          </div>
        )}

        {/* Reply indicator */}
        {message.replyTo && (
          <div className="mt-2 text-xs text-gray-500">
            ↩ Reply to message
          </div>
        )}
      </div>
    </div>
  );
}

interface IntentBadgeProps {
  intent: MessageIntent;
  size?: 'sm' | 'md';
}

export function IntentBadge({ intent, size = 'sm' }: IntentBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';

  return (
    <span className={`${sizeClasses} rounded font-medium ${intentColors[intent]}`}>
      {intentLabels[intent]}
    </span>
  );
}

/**
 * Message list item for compact channel views.
 */
interface MessageListItemProps {
  message: Message;
  isSelected?: boolean;
  onClick?: () => void;
}

export function MessageListItem({ message, isSelected, onClick }: MessageListItemProps) {
  const senderPower = toUIPower(message.sender);

  return (
    <div
      onClick={onClick}
      className={`
        px-3 py-2 flex items-start gap-2 cursor-pointer transition-colors
        ${isSelected ? 'bg-gray-700' : 'hover:bg-gray-750'}
      `}
    >
      <PowerBadge power={senderPower} size="sm" className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 line-clamp-1">{message.content}</p>
        <span className="text-xs text-gray-500">{formatTime(message.timestamp)}</span>
      </div>
      {message.metadata?.intent && (
        <IntentBadge intent={message.metadata.intent} size="sm" />
      )}
    </div>
  );
}

/**
 * Formats a timestamp for display.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a full timestamp with date.
 */
export function formatFullTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
