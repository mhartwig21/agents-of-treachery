import { useMemo } from 'react'

export interface OrderArrowProps {
  fromX: number
  fromY: number
  toX: number
  toY: number
  type: 'move' | 'support' | 'convoy'
  status: 'pending' | 'success' | 'failed'
  color: string
  curved?: boolean
}

/**
 * Animated arrow component for move/support/convoy orders.
 * Uses SVG paths with CSS animations for smooth flow effects.
 */
export function OrderArrow({
  fromX,
  fromY,
  toX,
  toY,
  type,
  status,
  color,
  curved = false,
}: OrderArrowProps) {
  // Calculate path geometry
  const { path, arrowPath, totalLength } = useMemo(() => {
    const dx = toX - fromX
    const dy = toY - fromY
    const len = Math.sqrt(dx * dx + dy * dy)

    // Stop arrow before destination (leave room for arrowhead)
    const arrowheadOffset = 12
    const endX = fromX + dx * ((len - arrowheadOffset) / len)
    const endY = fromY + dy * ((len - arrowheadOffset) / len)

    let pathD: string
    let pathLength: number

    if (curved) {
      // Quadratic bezier curve - control point perpendicular to midpoint
      const midX = (fromX + endX) / 2
      const midY = (fromY + endY) / 2
      // Perpendicular offset (curve away from direct line)
      const perpX = -dy / len * 40
      const perpY = dx / len * 40
      const ctrlX = midX + perpX
      const ctrlY = midY + perpY

      pathD = `M ${fromX} ${fromY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`
      // Approximate bezier length (good enough for animation timing)
      pathLength = len * 1.2
    } else {
      pathD = `M ${fromX} ${fromY} L ${endX} ${endY}`
      pathLength = len - arrowheadOffset
    }

    // Calculate arrowhead at end of path
    // For curved paths, use tangent at endpoint; for straight, use direction vector
    let arrowAngle: number
    if (curved) {
      // Tangent at end of quadratic bezier Q(P0, P1, P2) at t=1 is direction P1->P2
      const midX = (fromX + endX) / 2
      const midY = (fromY + endY) / 2
      const perpX = -dy / len * 40
      const perpY = dx / len * 40
      const ctrlX = midX + perpX
      const ctrlY = midY + perpY
      arrowAngle = Math.atan2(endY - ctrlY, endX - ctrlX)
    } else {
      arrowAngle = Math.atan2(dy, dx)
    }

    // Arrowhead triangle points
    const arrowSize = 10
    const arrowAngle1 = arrowAngle + Math.PI * 0.8
    const arrowAngle2 = arrowAngle - Math.PI * 0.8
    const tipX = endX + Math.cos(arrowAngle) * arrowheadOffset
    const tipY = endY + Math.sin(arrowAngle) * arrowheadOffset
    const arrow1X = tipX + Math.cos(arrowAngle1) * arrowSize
    const arrow1Y = tipY + Math.sin(arrowAngle1) * arrowSize
    const arrow2X = tipX + Math.cos(arrowAngle2) * arrowSize
    const arrow2Y = tipY + Math.sin(arrowAngle2) * arrowSize

    const arrowheadPath = `M ${tipX} ${tipY} L ${arrow1X} ${arrow1Y} L ${arrow2X} ${arrow2Y} Z`

    return { path: pathD, arrowPath: arrowheadPath, totalLength: pathLength }
  }, [fromX, fromY, toX, toY, curved])

  // Style configuration based on order type
  // Patterns match existing DiplomacyMap styles for consistency
  const strokeDasharray = useMemo(() => {
    switch (type) {
      case 'move':
        return undefined // Solid line
      case 'support':
        return '5 5' // Dashed (matches DiplomacyMap support)
      case 'convoy':
        return '10 5' // Long dash (matches DiplomacyMap convoy)
    }
  }, [type])

  // Status-based styling
  const { strokeColor, opacity, glowFilter, animate } = useMemo(() => {
    switch (status) {
      case 'pending':
        return {
          strokeColor: color,
          opacity: 0.9,
          glowFilter: undefined,
          animate: true,
        }
      case 'success':
        return {
          strokeColor: '#22c55e', // Green
          opacity: 1,
          glowFilter: 'url(#order-arrow-glow-success)',
          animate: false,
        }
      case 'failed':
        return {
          strokeColor: '#ef4444', // Red
          opacity: 0.8,
          glowFilter: undefined,
          animate: false,
        }
    }
  }, [status, color])

  // Animation style for flowing effect
  const animationStyle = useMemo(() => {
    if (!animate) return {}

    // For dashed/dotted lines, animate the dash offset
    if (strokeDasharray) {
      return {
        animation: 'order-arrow-flow 1s linear infinite',
      }
    }

    // For solid lines, use a flowing dash animation
    return {
      strokeDasharray: `${totalLength}`,
      strokeDashoffset: totalLength,
      animation: 'order-arrow-draw 1.5s ease-out forwards, order-arrow-pulse 2s ease-in-out infinite 1.5s',
    }
  }, [animate, strokeDasharray, totalLength])

  return (
    <g className="order-arrow-group">
      {/* Glow filter definitions */}
      <defs>
        <filter id="order-arrow-glow-success" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Main path */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
        opacity={opacity}
        filter={glowFilter}
        style={animationStyle}
      />

      {/* Arrowhead (only for move orders) */}
      {type === 'move' && (
        <path
          d={arrowPath}
          fill={strokeColor}
          opacity={opacity}
          filter={glowFilter}
        />
      )}
    </g>
  )
}
