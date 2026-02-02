/**
 * PowerBadge - Colored indicator for a Diplomacy power.
 *
 * Displays a small badge with the power's color and optional label.
 */

import { type LowercasePower, POWER_COLORS } from '../../spectator/types';

interface PowerBadgeProps {
  power: LowercasePower;
  /** Show full power name */
  showLabel?: boolean;
  /** Show abbreviated name (first 3 letters) */
  showAbbrev?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  sm: 'w-3 h-3 text-xs',
  md: 'w-4 h-4 text-sm',
  lg: 'w-6 h-6 text-base',
};

const labelSizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export function PowerBadge({
  power,
  showLabel = false,
  showAbbrev = false,
  size = 'md',
  className = '',
}: PowerBadgeProps) {
  const color = POWER_COLORS[power];
  const label = power.charAt(0).toUpperCase() + power.slice(1);
  const abbrev = power.slice(0, 3).toUpperCase();

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`${sizeClasses[size]} rounded inline-block flex-shrink-0`}
        style={{ backgroundColor: color }}
        title={label}
      />
      {showLabel && (
        <span className={`${labelSizeClasses[size]} font-medium`}>{label}</span>
      )}
      {showAbbrev && !showLabel && (
        <span className={`${labelSizeClasses[size]} font-medium text-gray-400`}>
          {abbrev}
        </span>
      )}
    </span>
  );
}

/**
 * Renders a row of power badges for all powers.
 */
interface PowerBadgeRowProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function PowerBadgeRow({ size = 'sm', className = '' }: PowerBadgeRowProps) {
  const powers: LowercasePower[] = ['england', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey'];

  return (
    <div className={`flex gap-2 ${className}`}>
      {powers.map((power) => (
        <PowerBadge key={power} power={power} size={size} />
      ))}
    </div>
  );
}

/**
 * Power indicator with count (for stats displays).
 */
interface PowerStatProps {
  power: LowercasePower;
  count: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function PowerStat({ power, count, label, size = 'md', className = '' }: PowerStatProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <PowerBadge power={power} size={size} />
      <span className={`${labelSizeClasses[size]} font-mono`}>{count}</span>
      {label && (
        <span className={`${labelSizeClasses[size]} text-gray-400`}>{label}</span>
      )}
    </div>
  );
}
