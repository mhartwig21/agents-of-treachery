/**
 * PressMessageModal - Full-screen modal for viewing press message details.
 *
 * Displays complete message content with all metadata, thread context,
 * and navigation between messages.
 */

import { useEffect, useCallback, useRef } from 'react';
import type { Message, Channel, ChannelType, Power } from '../../press/types';
import { toUIPower, POWER_COLORS } from '../../spectator/types';
import { PowerBadge } from '../shared/PowerBadge';
import { IntentBadge, formatFullTime } from './MessageCard';

interface PressMessageModalProps {
  /** The message to display */
  message: Message;
  /** Channel information (optional, will derive from message if not provided) */
  channel?: Channel;
  /** All messages for thread navigation */
  allMessages?: Message[];
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback to navigate to another message */
  onNavigate?: (messageId: string) => void;
}

export function PressMessageModal({
  message,
  channel,
  allMessages = [],
  onClose,
  onNavigate,
}: PressMessageModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const clickedMessageRef = useRef<HTMLDivElement>(null);

  // Derive channel info from message if not provided
  const channelInfo = channel || deriveChannelInfo(message.channelId);
  const senderPower = toUIPower(message.sender);

  // Find all messages in the same channel, sorted chronologically
  const channelMessages = allMessages
    .filter((m) => m.channelId === message.channelId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trap and auto-scroll to clicked message
  useEffect(() => {
    closeButtonRef.current?.focus();
    // Delay scroll slightly to ensure DOM is rendered
    requestAnimationFrame(() => {
      clickedMessageRef.current?.scrollIntoView({ block: 'center' });
    });
  }, []);

  // Click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={modalRef}
        className="bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between border-b border-gray-700"
          style={{ backgroundColor: `${POWER_COLORS[senderPower]}20` }}
        >
          <div className="flex items-center gap-3">
            <PowerBadge power={senderPower} showLabel size="md" />
            <div className="text-gray-400">
              <ChannelIndicator channel={channelInfo} />
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
            aria-label="Close modal"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content - chronological channel conversation */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {channelMessages.map((msg) => {
            const isClicked = msg.id === message.id;
            const msgPower = toUIPower(msg.sender);
            return (
              <div
                key={msg.id}
                ref={isClicked ? clickedMessageRef : undefined}
                className={`rounded-lg p-3 transition-colors ${
                  isClicked
                    ? 'bg-blue-900/40 ring-1 ring-blue-500/50'
                    : 'bg-gray-700/30 hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <PowerBadge power={msgPower} size="sm" />
                  <span className="text-xs text-gray-500">
                    {formatFullTime(msg.timestamp)}
                  </span>
                  {msg.metadata?.intent && (
                    <IntentBadge intent={msg.metadata.intent} size="md" />
                  )}
                </div>
                <p
                  id={isClicked ? 'modal-title' : undefined}
                  className={`text-sm whitespace-pre-wrap leading-relaxed ${
                    isClicked ? 'text-gray-100' : 'text-gray-300'
                  }`}
                >
                  {msg.content}
                </p>
              </div>
            );
          })}

          {/* Metadata for clicked message */}
          <div className="space-y-3 pt-4 border-t border-gray-700">
            {/* References */}
            {message.metadata?.references && message.metadata.references.length > 0 && (
              <div>
                <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  References
                </h3>
                <div className="flex flex-wrap gap-2">
                  {message.metadata.references.map((ref, i) => (
                    <span
                      key={i}
                      className="text-sm bg-gray-700 text-gray-300 px-2 py-1 rounded"
                    >
                      {ref.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment */}
            {message.metadata?.sentiment !== undefined && (
              <div className="flex items-center gap-2">
                <h3 className="text-xs text-gray-500 uppercase tracking-wide">
                  Sentiment
                </h3>
                <SentimentIndicator value={message.metadata.sentiment} />
              </div>
            )}

            {/* Channel details */}
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Channel
              </h3>
              <ChannelDetails channel={channelInfo} />
            </div>
          </div>
        </div>

        {/* Footer with channel navigation */}
        {channelMessages.length > 1 && (
          <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {channelMessages.length} messages in channel
            </span>
            <div className="flex gap-2">
              <NavigateButton
                direction="prev"
                messages={channelMessages}
                currentId={message.id}
                onNavigate={onNavigate}
              />
              <NavigateButton
                direction="next"
                messages={channelMessages}
                currentId={message.id}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Derives channel info from channel ID.
 */
function deriveChannelInfo(channelId: string): Channel {
  let type: ChannelType = 'BILATERAL';
  const participants: Power[] = [];

  if (channelId === 'global') {
    type = 'GLOBAL';
  } else if (channelId.startsWith('multiparty:')) {
    type = 'MULTIPARTY';
    const parts = channelId.replace('multiparty:', '').split(':');
    participants.push(...(parts as Power[]));
  } else if (channelId.startsWith('bilateral:')) {
    type = 'BILATERAL';
    const parts = channelId.replace('bilateral:', '').split(':');
    participants.push(...(parts as Power[]));
  }

  return {
    id: channelId,
    type,
    participants,
    createdAt: new Date(),
  };
}

/**
 * Displays channel type indicator.
 */
function ChannelIndicator({ channel }: { channel: Channel }) {
  if (channel.type === 'GLOBAL') {
    return <span className="text-sm">Global broadcast</span>;
  }

  if (channel.type === 'MULTIPARTY') {
    return (
      <span className="text-sm">
        {channel.name || `${channel.participants.length}-way channel`}
      </span>
    );
  }

  // Bilateral
  return (
    <div className="flex items-center gap-1 text-sm">
      <span>→</span>
      {channel.participants.map((p) => (
        <PowerBadge key={p} power={toUIPower(p)} size="sm" />
      ))}
    </div>
  );
}

/**
 * Displays full channel details.
 */
function ChannelDetails({ channel }: { channel: Channel }) {
  const typeLabels: Record<ChannelType, string> = {
    BILATERAL: 'Private bilateral channel',
    MULTIPARTY: 'Multi-party channel',
    GLOBAL: 'Global broadcast',
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-400">{typeLabels[channel.type]}</span>
      {channel.participants.length > 0 && (
        <div className="flex items-center gap-1">
          {channel.participants.map((p) => (
            <PowerBadge key={p} power={toUIPower(p)} size="sm" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Visual sentiment indicator.
 */
function SentimentIndicator({ value }: { value: number }) {
  const percentage = ((value + 1) / 2) * 100;
  const color =
    value > 0.3 ? 'bg-green-500' : value < -0.3 ? 'bg-red-500' : 'bg-yellow-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-gray-400">{value.toFixed(2)}</span>
    </div>
  );
}

/**
 * Thread navigation button.
 */
function NavigateButton({
  direction,
  messages,
  currentId,
  onNavigate,
}: {
  direction: 'prev' | 'next';
  messages: Message[];
  currentId: string;
  onNavigate?: (id: string) => void;
}) {
  const currentIndex = messages.findIndex((m) => m.id === currentId);
  const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
  const targetMessage = messages[targetIndex];

  if (!targetMessage) {
    return (
      <button
        disabled
        className="px-3 py-1 text-sm text-gray-600 cursor-not-allowed"
      >
        {direction === 'prev' ? '← Prev' : 'Next →'}
      </button>
    );
  }

  return (
    <button
      onClick={() => onNavigate?.(targetMessage.id)}
      className="px-3 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
    >
      {direction === 'prev' ? '← Prev' : 'Next →'}
    </button>
  );
}

/**
 * Close icon SVG.
 */
function CloseIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
