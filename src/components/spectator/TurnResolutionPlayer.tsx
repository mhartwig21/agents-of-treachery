/**
 * TurnResolutionPlayer - Controls for playing turn resolution animations.
 *
 * Provides play/pause/reset/skip controls and displays current animation phase and progress.
 * Features a segmented progress bar showing all 6 phases and keyboard shortcuts.
 */

import { useEffect, useCallback } from 'react';
import { type AnimationPhase, type ResolutionAnimationState, type ResolutionAnimationControls } from '../../hooks/useResolutionAnimation';

interface TurnResolutionPlayerProps {
  /** Animation state from useResolutionAnimation */
  state: ResolutionAnimationState;
  /** Controls from useResolutionAnimation */
  controls: ResolutionAnimationControls;
  /** Current speed setting */
  speed: 'slow' | 'normal' | 'fast';
  /** Whether animation is currently playing */
  isPlaying: boolean;
  /** Compact mode for mobile */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Human-readable phase labels.
 */
const PHASE_LABELS: Record<AnimationPhase, string> = {
  idle: 'Ready',
  show_orders: 'Showing Orders',
  highlight_conflicts: 'Highlighting Conflicts',
  resolve_battles: 'Resolving Battles',
  animate_moves: 'Moving Units',
  show_failures: 'Failed Orders',
  show_dislodged: 'Dislodged Units',
  complete: 'Complete',
};

/**
 * Speed options with labels.
 */
const SPEED_OPTIONS: Array<{ value: 'slow' | 'normal' | 'fast'; label: string }> = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];

/**
 * The 6 animation phases (excluding idle and complete) for the segmented progress bar.
 */
const ANIMATION_PHASES: AnimationPhase[] = [
  'show_orders',
  'highlight_conflicts',
  'resolve_battles',
  'animate_moves',
  'show_failures',
  'show_dislodged',
];

export function TurnResolutionPlayer({
  state,
  controls,
  speed,
  isPlaying,
  compact = false,
  className = '',
}: TurnResolutionPlayerProps) {
  const isIdle = state.phase === 'idle';
  const isComplete = state.phase === 'complete';

  // Keyboard shortcuts: Space=play/pause, Right=skip
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        if (isIdle || isComplete) {
          controls.play();
        } else if (isPlaying) {
          controls.pause();
        } else {
          controls.play();
        }
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        if (!isComplete) {
          controls.skip();
        }
      }
    },
    [isIdle, isComplete, isPlaying, controls]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-gray-800 ${className}`}>
        {/* Play/Pause button */}
        <button
          onClick={isIdle || isComplete ? controls.play : isPlaying ? controls.pause : controls.play}
          className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white transition-colors"
          title={isPlaying ? 'Pause' : 'Play Resolution'}
        >
          {isPlaying ? (
            <PauseIcon className="w-4 h-4" />
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
        </button>

        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-100"
            style={{ width: `${state.progress}%` }}
          />
        </div>

        {/* Reset button */}
        <button
          onClick={controls.reset}
          disabled={isIdle}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={isIdle ? 'Nothing to reset' : 'Reset'}
        >
          <ResetIcon className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
      {/* Phase indicator */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">Resolution</span>
        <span className="text-sm font-medium text-white">
          {PHASE_LABELS[state.phase]}
        </span>
      </div>

      {/* Segmented progress bar showing 6 phases */}
      <SegmentedProgressBar phase={state.phase} phaseProgress={state.phaseProgress} />

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={isIdle || isComplete ? controls.play : isPlaying ? controls.pause : controls.play}
            className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white transition-colors"
            title={isPlaying ? 'Pause' : isComplete ? 'Replay' : 'Play'}
          >
            {isPlaying ? (
              <PauseIcon className="w-5 h-5" />
            ) : (
              <PlayIcon className="w-5 h-5" />
            )}
          </button>

          {/* Reset */}
          <button
            onClick={controls.reset}
            disabled={isIdle}
            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={isIdle ? 'Nothing to reset' : 'Reset'}
          >
            <ResetIcon className="w-4 h-4" />
          </button>

          {/* Skip */}
          <button
            onClick={controls.skip}
            disabled={isComplete}
            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={isComplete ? 'Already at end' : 'Skip to End'}
          >
            <SkipIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1 bg-gray-700 rounded-full p-0.5">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => controls.setSpeed(option.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                speed === option.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Battle indicator (when resolving battles) */}
      {state.phase === 'resolve_battles' && state.currentBattle && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            Battle at{' '}
            <span className="text-white font-medium capitalize">
              {state.currentBattle.territory.replace(/_/g, ' ')}
            </span>
            {state.currentBattle.winner && (
              <span className="ml-2 text-green-400">
                → {state.currentBattle.winner}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Segmented progress bar showing 6 animation phases.
 * Each segment represents one phase, fills as phases complete, and the current phase pulses.
 */
function SegmentedProgressBar({
  phase,
  phaseProgress,
}: {
  phase: AnimationPhase;
  phaseProgress: number;
}) {
  const currentPhaseIndex = ANIMATION_PHASES.indexOf(phase);
  const isComplete = phase === 'complete';
  const isIdle = phase === 'idle';

  return (
    <div className="mb-4">
      <div className="flex gap-1 h-2">
        {ANIMATION_PHASES.map((p, index) => {
          const isCurrentPhase = p === phase;
          const isCompletedPhase = isComplete || index < currentPhaseIndex;
          const fillPercent = isCurrentPhase ? phaseProgress : isCompletedPhase ? 100 : 0;

          return (
            <div
              key={p}
              className="flex-1 bg-gray-700 rounded-sm overflow-hidden relative"
              title={PHASE_LABELS[p]}
            >
              <div
                className={`h-full transition-all duration-100 ${
                  isCurrentPhase ? 'bg-blue-400 animate-pulse' : 'bg-blue-500'
                }`}
                style={{ width: `${fillPercent}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* Progress percentage */}
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-500">
          {isIdle ? 'Ready' : isComplete ? 'Complete' : `Phase ${currentPhaseIndex + 1}/6`}
        </span>
        <span className="text-xs text-gray-500">
          {Math.round(isComplete ? 100 : isIdle ? 0 : ((currentPhaseIndex + phaseProgress / 100) / 6) * 100)}%
        </span>
      </div>
    </div>
  );
}

// Simple icon components
function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function ResetIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function SkipIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 4l10 8-10 8V4zm10 0h4v16h-4V4z" />
    </svg>
  );
}
