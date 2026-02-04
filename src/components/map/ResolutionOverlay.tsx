import { useState } from 'react'

export interface FailedOrderMarkerProps {
  x: number
  y: number
  reason: string
  visible: boolean
}

/**
 * Red X marker indicating a failed/bounced move order.
 * Displays at the target territory the unit couldn't reach.
 */
export function FailedOrderMarker({
  x,
  y,
  reason,
  visible,
}: FailedOrderMarkerProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (!visible) return null

  const size = 12 // Half-size of the X marker
  const strokeWidth = 4

  return (
    <g
      className="failed-order-marker"
      style={{ animation: 'fail-bounce 0.3s ease-out forwards' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Red X marker - two crossed lines */}
      <line
        x1={x - size}
        y1={y - size}
        x2={x + size}
        y2={y + size}
        stroke="#ef4444"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1={x + size}
        y1={y - size}
        x2={x - size}
        y2={y + size}
        stroke="#ef4444"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Native SVG tooltip */}
      <title>{reason}</title>

      {/* Custom styled tooltip on hover */}
      {showTooltip && (
        <foreignObject
          x={x + size + 8}
          y={y - 14}
          width={200}
          height={40}
          style={{ overflow: 'visible' }}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.85)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            {reason}
          </div>
        </foreignObject>
      )}
    </g>
  )
}
