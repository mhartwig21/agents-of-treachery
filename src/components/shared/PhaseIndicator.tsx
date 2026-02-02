/**
 * PhaseIndicator - Display for the current game phase and turn.
 *
 * Shows year, season, and phase in a consistent format.
 */

import type { Season, Phase } from '../../spectator/types';

interface PhaseIndicatorProps {
  year: number;
  season: Season;
  phase: Phase;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show all details or compact */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

const seasonLabels: Record<Season, string> = {
  SPRING: 'Spring',
  FALL: 'Fall',
  WINTER: 'Winter',
};

const seasonColors: Record<Season, string> = {
  SPRING: 'text-green-400',
  FALL: 'text-orange-400',
  WINTER: 'text-blue-400',
};

const phaseLabels: Record<Phase, string> = {
  DIPLOMACY: 'Diplomacy',
  MOVEMENT: 'Movement',
  RETREAT: 'Retreat',
  BUILD: 'Build',
};

const phaseAbbrev: Record<Phase, string> = {
  DIPLOMACY: 'DIP',
  MOVEMENT: 'MOV',
  RETREAT: 'RET',
  BUILD: 'BLD',
};

export function PhaseIndicator({
  year,
  season,
  phase,
  size = 'md',
  compact = false,
  className = '',
}: PhaseIndicatorProps) {
  if (compact) {
    return (
      <span className={`${sizeClasses[size]} font-mono ${className}`}>
        <span className={seasonColors[season]}>{season.charAt(0)}</span>
        <span className="text-gray-300">{year}</span>
        <span className="text-gray-500 ml-1">{phaseAbbrev[phase]}</span>
      </span>
    );
  }

  return (
    <span className={`${sizeClasses[size]} ${className}`}>
      <span className={seasonColors[season]}>{seasonLabels[season]}</span>
      <span className="text-gray-300 ml-1">{year}</span>
      <span className="text-gray-500 mx-1">-</span>
      <span className="text-gray-400">{phaseLabels[phase]}</span>
    </span>
  );
}

/**
 * Turn label for timeline display.
 */
interface TurnLabelProps {
  year: number;
  season: Season;
  /** Whether this is the current/active turn */
  isActive?: boolean;
  /** Whether this is live (most recent) */
  isLive?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function TurnLabel({
  year,
  season,
  isActive = false,
  isLive = false,
  size = 'sm',
  className = '',
}: TurnLabelProps) {
  const baseClasses = sizeClasses[size];
  const activeClasses = isActive ? 'bg-gray-700 rounded px-1' : '';
  const liveClasses = isLive ? 'text-green-400' : '';

  return (
    <span className={`${baseClasses} ${activeClasses} ${liveClasses} ${className} font-mono`}>
      {year}
      <span className={seasonColors[season]}>{season.charAt(0)}</span>
    </span>
  );
}

/**
 * Phase badge for displaying phase type.
 */
interface PhaseBadgeProps {
  phase: Phase;
  size?: 'sm' | 'md';
  className?: string;
}

const phaseBgColors: Record<Phase, string> = {
  DIPLOMACY: 'bg-purple-900/50 text-purple-300',
  MOVEMENT: 'bg-blue-900/50 text-blue-300',
  RETREAT: 'bg-yellow-900/50 text-yellow-300',
  BUILD: 'bg-green-900/50 text-green-300',
};

export function PhaseBadge({ phase, size = 'sm', className = '' }: PhaseBadgeProps) {
  return (
    <span
      className={`${sizeClasses[size]} ${phaseBgColors[phase]} px-2 py-0.5 rounded font-medium ${className}`}
    >
      {phaseLabels[phase]}
    </span>
  );
}
