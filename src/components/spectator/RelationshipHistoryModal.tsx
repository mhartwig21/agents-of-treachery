/**
 * RelationshipHistoryModal - Detailed timeline view of relationship history.
 *
 * Shows the full history of a relationship between two powers with:
 * - Score progression chart
 * - Key events timeline
 * - Turn-by-turn breakdown
 */

import { useMemo } from 'react';
import type { RelationshipHistory, KeyEvent, TimelinePoint } from '../../hooks/useRelationshipHistory';
import { RelationshipSparkline } from './RelationshipSparkline';

interface RelationshipHistoryModalProps {
  /** The relationship history to display */
  history: RelationshipHistory;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Power colors for styling */
  powerColors?: Record<string, string>;
}

/**
 * Format power name for display.
 */
function formatPowerName(power: string): string {
  return power.charAt(0).toUpperCase() + power.slice(1).toLowerCase();
}

/**
 * Get display info for a key event.
 */
function getEventDisplay(event: KeyEvent): { icon: string; label: string; color: string } {
  switch (event) {
    case 'betrayal':
      return { icon: '🗡️', label: 'Betrayal', color: 'text-red-400 bg-red-900/50' };
    case 'alliance':
      return { icon: '🤝', label: 'Alliance', color: 'text-green-400 bg-green-900/50' };
    case 'war':
      return { icon: '⚔️', label: 'War', color: 'text-orange-400 bg-orange-900/50' };
    case 'peace':
      return { icon: '🕊️', label: 'Peace', color: 'text-blue-400 bg-blue-900/50' };
    default:
      return { icon: '•', label: 'Event', color: 'text-gray-400 bg-gray-900/50' };
  }
}

/**
 * Get status color and label.
 */
function getStatusDisplay(status: 'ally' | 'enemy' | 'neutral'): { label: string; color: string } {
  switch (status) {
    case 'ally':
      return { label: 'Allied', color: 'text-green-400' };
    case 'enemy':
      return { label: 'Hostile', color: 'text-red-400' };
    default:
      return { label: 'Neutral', color: 'text-gray-400' };
  }
}

/**
 * Timeline event item component.
 */
function TimelineEvent({ point }: { point: TimelinePoint }) {
  if (!point.keyEvent) return null;

  const eventDisplay = getEventDisplay(point.keyEvent);

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex-shrink-0 w-16 text-xs text-gray-500 font-mono">
        {point.turn}
      </div>
      <div className={`flex-shrink-0 px-2 py-1 rounded text-xs ${eventDisplay.color}`}>
        {eventDisplay.icon} {eventDisplay.label}
      </div>
      {point.description && (
        <div className="text-sm text-gray-300 flex-1">
          {point.description}
        </div>
      )}
    </div>
  );
}

/**
 * Full relationship history modal.
 */
export function RelationshipHistoryModal({
  history,
  isOpen,
  onClose,
  powerColors = {},
}: RelationshipHistoryModalProps) {
  if (!isOpen) return null;

  const statusDisplay = getStatusDisplay(history.currentStatus);

  // Filter to only turns with key events
  const keyEvents = useMemo(
    () => history.timeline.filter((p) => p.keyEvent),
    [history.timeline]
  );

  // Get colors for powers
  const p1Color = powerColors[history.power1.toLowerCase()] || '#6b7280';
  const p2Color = powerColors[history.power2.toLowerCase()] || '#6b7280';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: p1Color }}
              />
              <span className="font-medium text-white">
                {formatPowerName(history.power1)}
              </span>
            </div>
            <span className="text-gray-500">&harr;</span>
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: p2Color }}
              />
              <span className="font-medium text-white">
                {formatPowerName(history.power2)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-8rem)]">
          {/* Current Status */}
          <div className="flex items-center justify-between mb-6 p-3 bg-gray-800 rounded-lg">
            <div>
              <div className="text-sm text-gray-400">Current Status</div>
              <div className={`text-lg font-medium ${statusDisplay.color}`}>
                {statusDisplay.label}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-400">Score</div>
              <div className={`text-lg font-medium ${statusDisplay.color}`}>
                {history.currentScore > 0 ? '+' : ''}{history.currentScore}
              </div>
            </div>
          </div>

          {/* Score Chart */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Score History</h3>
            <div className="bg-gray-800 rounded-lg p-4">
              <RelationshipSparkline
                timeline={history.timeline}
                width={520}
                height={100}
                showEvents
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>{history.timeline[0]?.turn || 'S1901'}</span>
                <span>{history.timeline[history.timeline.length - 1]?.turn || 'Present'}</span>
              </div>
            </div>
          </div>

          {/* Key Events Timeline */}
          {keyEvents.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Key Events</h3>
              <div className="bg-gray-800 rounded-lg p-4 divide-y divide-gray-700">
                {keyEvents.map((point, index) => (
                  <TimelineEvent key={`${point.turn}-${index}`} point={point} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {history.timeline.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No relationship history recorded yet.
            </div>
          )}

          {keyEvents.length === 0 && history.timeline.length > 0 && (
            <div className="mt-4 p-4 bg-gray-800 rounded-lg text-center text-gray-400">
              No key events recorded. Relationship has been stable.
            </div>
          )}

          {/* Score Legend */}
          <div className="mt-6 flex flex-wrap gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>Allied (10+)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>Hostile (-10 or less)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gray-500" />
              <span>Neutral (-9 to 9)</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
