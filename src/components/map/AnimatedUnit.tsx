import type { Unit } from '../../types/game'

export interface AnimatedUnitProps {
  unit: Unit
  x: number
  y: number
  color: string
  isDislodged?: boolean
  isMoving?: boolean
}

/**
 * Animated unit component with CSS transitions for smooth position changes.
 *
 * - Slides smoothly when x/y coordinates change
 * - Shows pulsing red glow when unit is dislodged
 * - Displays "A" for armies and "F" for fleets in a colored circle
 */
export function AnimatedUnit({
  unit,
  x,
  y,
  color,
  isDislodged = false,
  isMoving = false,
}: AnimatedUnitProps) {
  // Build class names for animation states
  const animationClass = isDislodged ? 'animate-battle-pulse' : ''

  // Use CSS transform for position with transition for smooth movement
  // The transition is applied via inline style for precise control
  const style: React.CSSProperties = {
    transform: `translate(${x - 12}px, ${y - 12}px)`,
    transition: 'transform 500ms ease-out',
    // Reduce transition duration when not actively moving for snappier initial render
    ...(isMoving ? {} : { transition: 'transform 100ms ease-out' }),
  }

  const unitLetter = unit.type === 'army' ? 'A' : 'F'

  return (
    <g
      className={animationClass}
      style={style}
    >
      <circle
        cx="12"
        cy="12"
        r="11"
        fill={color}
        stroke={isDislodged ? '#ff0000' : '#000'}
        strokeWidth={isDislodged ? 2.5 : 1.5}
      />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fill="#fff"
        fontSize="14"
        fontWeight="bold"
      >
        {unitLetter}
      </text>
    </g>
  )
}
