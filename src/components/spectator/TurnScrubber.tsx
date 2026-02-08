/**
 * TurnScrubber - Timeline control for replay navigation.
 *
 * Horizontal timeline with play/pause, speed control, and turn markers.
 */

import { useState } from 'react';
import { useSpectator, useReplayControls } from '../../spectator/SpectatorContext';
import { type Season } from '../../spectator/types';
import { TurnLabel } from '../shared/PhaseIndicator';

interface TurnScrubberProps {
  /** Compact mode for mobile */
  compact?: boolean;
  className?: string;
}

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

export function TurnScrubber({ compact = false, className = '' }: TurnScrubberProps) {
  const { activeGame } = useSpectator();
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Convert speed multiplier to interval (1x = 1000ms, 2x = 500ms, etc.)
  const {
    isPlaying,
    togglePlay,
    stepForward,
    stepBackward,
    goToLive,
    seekToPosition,
    currentPosition,
    totalSnapshots,
    isLive,
  } = useReplayControls(1000 / playbackSpeed);

  if (!activeGame || totalSnapshots === 0) {
    return null;
  }

  const snapshots = activeGame.snapshots;
  const displayPosition = currentPosition ?? totalSnapshots - 1;

  if (compact) {
    return (
      <div className={`bg-gray-800 px-3 py-2 ${className}`}>
        <div className="flex items-center gap-2">
          {/* Play/pause */}
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          {/* Progress bar */}
          <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${((displayPosition + 1) / totalSnapshots) * 100}%` }}
            />
          </div>

          {/* Position indicator */}
          <span className="text-xs text-gray-400 font-mono min-w-[4rem] text-right">
            {displayPosition + 1}/{totalSnapshots}
          </span>

          {/* Live button */}
          {!isLive && (
            <button
              onClick={goToLive}
              className="px-2 py-1 text-xs bg-green-900/50 text-green-400 rounded hover:bg-green-900"
            >
              LIVE
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 px-4 py-3 ${className}`}>
      <div className="flex items-center gap-4">
        {/* Playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={stepBackward}
            disabled={displayPosition === 0}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 disabled:opacity-40"
            aria-label="Previous turn"
          >
            <StepBackIcon />
          </button>

          <button
            onClick={togglePlay}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>

          <button
            onClick={stepForward}
            disabled={displayPosition >= totalSnapshots - 1}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 disabled:opacity-40"
            aria-label="Next turn"
          >
            <StepForwardIcon />
          </button>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Speed:</span>
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              aria-label={`Playback speed ${speed}x`}
              aria-pressed={playbackSpeed === speed}
              className={`
                px-2 py-1 rounded transition-colors
                ${playbackSpeed === speed
                  ? 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-white'
                }
              `}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* Timeline */}
        <div className="flex-1 relative">
          <TimelineTrack
            snapshots={snapshots}
            currentPosition={displayPosition}
            onSeek={seekToPosition}
          />
        </div>

        {/* Live indicator/button */}
        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="flex items-center gap-2 text-green-400 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            <button
              onClick={goToLive}
              className="px-3 py-1.5 text-sm bg-green-900/50 text-green-400 rounded hover:bg-green-900 transition-colors"
            >
              Go Live
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface TimelineTrackProps {
  snapshots: { id: string; year: number; season: Season }[];
  currentPosition: number;
  onSeek: (position: number) => void;
}

function TimelineTrack({ snapshots, currentPosition, onSeek }: TimelineTrackProps) {
  // Group snapshots by year for display
  const years = new Map<number, number[]>();
  snapshots.forEach((s, idx) => {
    if (!years.has(s.year)) {
      years.set(s.year, []);
    }
    years.get(s.year)!.push(idx);
  });

  const yearEntries = Array.from(years.entries());

  return (
    <div className="relative h-8 select-none">
      {/* Track background */}
      <div
        className="absolute top-1/2 left-0 right-0 h-1 bg-gray-700 rounded-full -translate-y-1/2 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percent = x / rect.width;
          const position = Math.round(percent * (snapshots.length - 1));
          onSeek(Math.max(0, Math.min(snapshots.length - 1, position)));
        }}
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-150"
          style={{ width: `${((currentPosition + 1) / snapshots.length) * 100}%` }}
        />
      </div>

      {/* Year markers */}
      <div className="absolute top-0 left-0 right-0 h-full flex items-center">
        {yearEntries.map(([year, indices]) => {
          const startPercent = (indices[0] / (snapshots.length - 1)) * 100;
          const endPercent = (indices[indices.length - 1] / (snapshots.length - 1)) * 100;
          const midPercent = (startPercent + endPercent) / 2;

          return (
            <div
              key={year}
              className="absolute text-xs text-gray-400 transform -translate-x-1/2"
              style={{ left: `${midPercent}%`, top: '-4px' }}
            >
              {year}
            </div>
          );
        })}
      </div>

      {/* Current position marker */}
      <div
        className="absolute top-1/2 w-4 h-4 bg-white rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
        style={{ left: `${(currentPosition / (snapshots.length - 1)) * 100}%` }}
      />

      {/* Turn indicator below */}
      <div className="absolute -bottom-4 left-0 right-0 text-center">
        <TurnLabel
          year={snapshots[currentPosition].year}
          season={snapshots[currentPosition].season}
          isActive
          size="sm"
        />
      </div>
    </div>
  );
}

// Icons
function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function StepBackIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="11,6 1,12 11,18" />
      <polygon points="22,6 12,12 22,18" />
    </svg>
  );
}

function StepForwardIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="2,6 12,12 2,18" />
      <polygon points="13,6 23,12 13,18" />
    </svg>
  );
}

/**
 * Minimal scrubber for inline use.
 */
interface MiniScrubberProps {
  position: number;
  total: number;
  onSeek: (position: number) => void;
  className?: string;
}

export function MiniScrubber({ position, total, onSeek, className = '' }: MiniScrubberProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="range"
        min={0}
        max={total - 1}
        value={position}
        onChange={(e) => onSeek(parseInt(e.target.value, 10))}
        className="flex-1 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white"
      />
      <span className="text-xs text-gray-400 font-mono">
        {position + 1}/{total}
      </span>
    </div>
  );
}
