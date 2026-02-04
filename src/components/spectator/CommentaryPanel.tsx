/**
 * CommentaryPanel - Real-time AI commentary display for spectators.
 *
 * Displays live commentary as the game unfolds, with optional
 * voice synthesis and configuration controls.
 */

import { useState, useRef, useEffect } from 'react';
import type { CommentaryEntry, CommentaryConfig, CommentaryStyle } from '../../commentary/types';
import { POWER_COLORS, type LowercasePower } from '../../spectator/types';

interface CommentaryPanelProps {
  /** Commentary entries to display */
  entries: CommentaryEntry[];
  /** Currently playing entry (for highlighting) */
  currentEntry: CommentaryEntry | null;
  /** Whether voice is speaking */
  isSpeaking: boolean;
  /** Current configuration */
  config: CommentaryConfig;
  /** Whether voice synthesis is available */
  isVoiceAvailable: boolean;
  /** Callback to update config */
  onConfigChange: (config: Partial<CommentaryConfig>) => void;
  /** Callback to speak an entry */
  onSpeak?: (entry: CommentaryEntry) => void;
  /** Callback to stop speaking */
  onStopSpeaking?: () => void;
  /** Callback to clear history */
  onClearHistory?: () => void;
  /** Additional CSS classes */
  className?: string;
}

export function CommentaryPanel({
  entries,
  currentEntry,
  isSpeaking,
  config,
  isVoiceAvailable,
  onConfigChange,
  onSpeak,
  onStopSpeaking,
  onClearHistory,
  className = '',
}: CommentaryPanelProps) {
  const [showSettings, setShowSettings] = useState(false);
  const entriesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (entriesEndRef.current) {
      entriesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length]);

  return (
    <div className={`bg-gray-800 rounded-lg overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="bg-gray-900 px-3 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-2">
          <CommentaryIcon />
          <span className="font-medium text-sm">AI Commentary</span>
          {isSpeaking && <SpeakingIndicator />}
        </div>
        <div className="flex items-center gap-2">
          {/* Voice toggle */}
          {isVoiceAvailable && (
            <button
              onClick={() => onConfigChange({ voiceEnabled: !config.voiceEnabled })}
              className={`p-1 rounded ${config.voiceEnabled ? 'bg-blue-600' : 'bg-gray-700'} hover:opacity-80`}
              title={config.voiceEnabled ? 'Disable voice' : 'Enable voice'}
            >
              <VoiceIcon enabled={config.voiceEnabled} />
            </button>
          )}
          {/* Stop button */}
          {isSpeaking && onStopSpeaking && (
            <button
              onClick={onStopSpeaking}
              className="p-1 rounded bg-red-600 hover:bg-red-700"
              title="Stop speaking"
            >
              <StopIcon />
            </button>
          )}
          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded ${showSettings ? 'bg-gray-600' : 'bg-gray-700'} hover:bg-gray-600`}
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <CommentarySettings
          config={config}
          onConfigChange={onConfigChange}
          onClearHistory={onClearHistory}
        />
      )}

      {/* Commentary entries */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] max-h-[300px]">
        {entries.length === 0 ? (
          <div className="text-gray-500 text-sm italic text-center py-4">
            Commentary will appear as the game unfolds...
          </div>
        ) : (
          entries.map((entry) => (
            <CommentaryEntryItem
              key={entry.id}
              entry={entry}
              isPlaying={currentEntry?.id === entry.id}
              onSpeak={onSpeak}
            />
          ))
        )}
        <div ref={entriesEndRef} />
      </div>
    </div>
  );
}

/**
 * Individual commentary entry display.
 */
function CommentaryEntryItem({
  entry,
  isPlaying,
  onSpeak,
}: {
  entry: CommentaryEntry;
  isPlaying: boolean;
  onSpeak?: (entry: CommentaryEntry) => void;
}) {
  const intensityColors = {
    low: 'border-gray-600',
    medium: 'border-blue-600',
    high: 'border-yellow-500',
    critical: 'border-red-500',
  };

  const intensityBg = {
    low: 'bg-gray-800/50',
    medium: 'bg-blue-900/30',
    high: 'bg-yellow-900/30',
    critical: 'bg-red-900/30',
  };

  return (
    <div
      className={`rounded px-3 py-2 border-l-2 ${intensityColors[entry.intensity]} ${intensityBg[entry.intensity]} ${
        isPlaying ? 'ring-1 ring-blue-400' : ''
      }`}
    >
      {/* Header with time and trigger */}
      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
        <span className="capitalize">
          {entry.context.season.toLowerCase()} {entry.context.year}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{formatTrigger(entry.trigger)}</span>
          {onSpeak && (
            <button
              onClick={() => onSpeak(entry)}
              className="hover:text-blue-400"
              title="Speak this entry"
            >
              <PlayIcon />
            </button>
          )}
        </div>
      </div>

      {/* Commentary text */}
      <p className="text-sm text-gray-200">{entry.text}</p>

      {/* Mentioned powers */}
      {entry.mentionedPowers.length > 0 && (
        <div className="flex gap-1 mt-1">
          {entry.mentionedPowers.map((power) => (
            <PowerTag key={power} power={power} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Settings panel for commentary configuration.
 */
function CommentarySettings({
  config,
  onConfigChange,
  onClearHistory,
}: {
  config: CommentaryConfig;
  onConfigChange: (config: Partial<CommentaryConfig>) => void;
  onClearHistory?: () => void;
}) {
  return (
    <div className="bg-gray-900/50 px-3 py-2 border-b border-gray-700 space-y-3">
      {/* Style selector */}
      <div>
        <label className="text-xs text-gray-400 block mb-1">Style</label>
        <select
          value={config.style}
          onChange={(e) => onConfigChange({ style: e.target.value as CommentaryStyle })}
          className="w-full bg-gray-700 text-sm rounded px-2 py-1 border border-gray-600"
        >
          <option value="dramatic">Dramatic</option>
          <option value="analytical">Analytical</option>
          <option value="sportscaster">Sportscaster</option>
          <option value="historian">Historian</option>
          <option value="neutral">Neutral</option>
        </select>
      </div>

      {/* Minimum intensity */}
      <div>
        <label className="text-xs text-gray-400 block mb-1">Minimum Intensity</label>
        <select
          value={config.minIntensity}
          onChange={(e) => onConfigChange({ minIntensity: e.target.value as 'low' | 'medium' | 'high' })}
          className="w-full bg-gray-700 text-sm rounded px-2 py-1 border border-gray-600"
        >
          <option value="low">All commentary</option>
          <option value="medium">Medium+ only</option>
          <option value="high">High+ only</option>
        </select>
      </div>

      {/* Voice settings */}
      {config.voiceEnabled && (
        <>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Voice Speed: {config.voiceSpeed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={config.voiceSpeed}
              onChange={(e) => onConfigChange({ voiceSpeed: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Queue Mode</label>
            <select
              value={config.queueMode}
              onChange={(e) => onConfigChange({ queueMode: e.target.value as 'queue' | 'interrupt' | 'skip' })}
              className="w-full bg-gray-700 text-sm rounded px-2 py-1 border border-gray-600"
            >
              <option value="queue">Queue entries</option>
              <option value="interrupt">Interrupt for new</option>
              <option value="skip">Skip if speaking</option>
            </select>
          </div>
        </>
      )}

      {/* Clear history button */}
      {onClearHistory && (
        <button
          onClick={onClearHistory}
          className="text-xs text-red-400 hover:text-red-300"
        >
          Clear History
        </button>
      )}
    </div>
  );
}

/**
 * Power tag component.
 */
function PowerTag({ power }: { power: string }) {
  const lowerPower = power.toLowerCase() as LowercasePower;
  const color = POWER_COLORS[lowerPower] || '#666';

  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `${color}40`, color }}
    >
      {power}
    </span>
  );
}

/**
 * Format trigger for display.
 */
function formatTrigger(trigger: string): string {
  return trigger
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Icon components
function CommentaryIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SpeakingIndicator() {
  return (
    <div className="flex items-center gap-0.5">
      <div className="w-1 h-3 bg-blue-400 rounded-full animate-pulse" />
      <div className="w-1 h-4 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
      <div className="w-1 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function VoiceIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      {enabled ? (
        <path
          fillRule="evenodd"
          d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
          clipRule="evenodd"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
        clipRule="evenodd"
      />
    </svg>
  );
}
