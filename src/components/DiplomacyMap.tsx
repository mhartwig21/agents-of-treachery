import { useState } from 'react'
import type { GameState, Power, Unit, Order } from '../types/game'
import { territories, getTerritory, getTerritoryCenter } from '../data/territories'
import { AnimatedUnit } from './map/AnimatedUnit'
import { OrderArrow } from './map/OrderArrow'
import { ConflictMarker, type Contender } from './map/ConflictMarker'
import { FailedOrderMarker } from './map/ResolutionOverlay'

/**
 * Animation state provided by useResolutionAnimation hook.
 * Contains all the state needed for animating turn resolution.
 */
export interface ResolutionAnimationState {
  /** Set of unit territories that are dislodged */
  dislodgedUnits: Set<string>
  /** Map of unit territory to current animated position */
  unitPositions: Map<string, { x: number; y: number }>
  /** Map of order index to failure reason (if failed) */
  failedOrders: Map<number, string>
  /** Array of conflict data for contested territories */
  conflictTerritories: Array<{
    territory: string
    contenders: Contender[]
    resolved: boolean
  }>
}

interface DiplomacyMapProps {
  gameState: GameState
  selectedTerritory: string | null
  onTerritorySelect: (id: string | null) => void
  /** When true, disables click handlers for spectator mode */
  readOnly?: boolean
  /** Territories to highlight (e.g., for a selected power) */
  highlightedTerritories?: string[]
  /** Animation state from useResolutionAnimation hook */
  animationState?: ResolutionAnimationState
  /** When true, shows animated components instead of static */
  animationMode?: boolean
  /** Override orders to display (e.g., accumulated orders from live + snapshot) */
  orders?: Order[]
}

const POWER_COLORS: Record<Power, string> = {
  england: '#1e3a5f',
  france: '#5c8dc9',
  germany: '#4a4a4a',
  italy: '#2e7d32',
  austria: '#c62828',
  russia: '#7b1fa2',
  turkey: '#f9a825',
}


export function DiplomacyMap({
  gameState,
  selectedTerritory,
  onTerritorySelect,
  readOnly = false,
  highlightedTerritories,
  animationState,
  animationMode = false,
  orders: ordersProp,
}: DiplomacyMapProps) {
  // Use provided orders or fall back to gameState.orders
  const displayOrders = ordersProp ?? gameState.orders
  const [hoveredTerritory, setHoveredTerritory] = useState<string | null>(null)

  // Get territory fill color based on owner
  const getTerritoryFill = (territoryId: string, type: string) => {
    if (type === 'sea') return '#a8c5d8'

    // Check if owned
    const baseId = territoryId.split('_')[0] // Handle coastal variants
    const owner = gameState.supplyCenters[baseId]
    if (owner) {
      return POWER_COLORS[owner]
    }
    return '#e8dcc4' // Neutral land
  }

  // Render unit icon
  const renderUnit = (unit: Unit, x: number, y: number) => {
    const color = POWER_COLORS[unit.power]
    const label = unit.type === 'army' ? 'A' : 'F'
    const typeName = unit.type === 'army' ? 'Army' : 'Fleet'
    const powerName = unit.power.charAt(0).toUpperCase() + unit.power.slice(1)
    const territoryName = getTerritory(unit.territory.split('_')[0])?.name || unit.territory.toUpperCase()
    const tooltip = `${powerName} ${typeName} - ${territoryName}`

    return (
      <g key={`unit-${unit.territory}`} transform={`translate(${x - 12}, ${y - 12})`}>
        <title>{tooltip}</title>
        <circle cx="12" cy="12" r="11" fill={color} stroke="#000" strokeWidth="1.5" />
        <text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">{label}</text>
      </g>
    )
  }

  // Render supply center marker
  const renderSupplyCenter = (x: number, y: number, owner?: Power) => {
    return (
      <circle
        cx={x}
        cy={y + 15}
        r="4"
        fill={owner ? POWER_COLORS[owner] : '#9e9e9e'}
        stroke="#000"
        strokeWidth="1"
      />
    )
  }

  // Get unit's power for an order
  const getOrderUnit = (order: Order): Unit | undefined => {
    return gameState.units.find(u => u.territory === order.unit)
  }

  // Render order visualization
  const renderOrder = (order: Order, index: number) => {
    const unit = getOrderUnit(order)
    if (!unit) return null

    const unitBaseId = order.unit.split('_')[0]
    const unitCenter = getTerritoryCenter(unitBaseId) || getTerritoryCenter(order.unit)
    if (!unitCenter) return null

    const color = POWER_COLORS[unit.power]
    const fromX = unitCenter.x
    const fromY = unitCenter.y

    switch (order.type) {
      case 'hold': {
        // Circle around unit
        return (
          <circle
            key={`order-${index}`}
            cx={fromX}
            cy={fromY}
            r="18"
            fill="none"
            stroke={color}
            strokeWidth="3"
            opacity="0.8"
          />
        )
      }
      case 'move': {
        if (!order.target) return null
        const targetBaseId = order.target.split('_')[0]
        const targetCenter = getTerritoryCenter(targetBaseId) || getTerritoryCenter(order.target)
        if (!targetCenter) return null

        const toX = targetCenter.x
        const toY = targetCenter.y

        // Calculate arrow end point (stop before destination)
        const dx = toX - fromX
        const dy = toY - fromY
        const len = Math.sqrt(dx * dx + dy * dy)
        const endX = fromX + dx * ((len - 20) / len)
        const endY = fromY + dy * ((len - 20) / len)

        return (
          <line
            key={`order-${index}`}
            x1={fromX}
            y1={fromY}
            x2={endX}
            y2={endY}
            stroke={color}
            strokeWidth="3"
            markerEnd="url(#arrowhead)"
            style={{ color }}
          />
        )
      }
      case 'support': {
        if (!order.target) return null
        const supportTargetId = order.target.split('_')[0]
        const supportCenter = getTerritoryCenter(supportTargetId) || getTerritoryCenter(order.target)
        if (!supportCenter) return null

        const toX = supportCenter.x
        const toY = supportCenter.y

        return (
          <line
            key={`order-${index}`}
            x1={fromX}
            y1={fromY}
            x2={toX}
            y2={toY}
            stroke={color}
            strokeWidth="2"
            strokeDasharray="5,5"
            opacity="0.7"
          />
        )
      }
      case 'convoy': {
        if (!order.target) return null
        const convoyTargetId = order.target.split('_')[0]
        const convoyCenter = getTerritoryCenter(convoyTargetId) || getTerritoryCenter(order.target)
        if (!convoyCenter) return null

        const toX = convoyCenter.x
        const toY = convoyCenter.y

        return (
          <line
            key={`order-${index}`}
            x1={fromX}
            y1={fromY}
            x2={toX}
            y2={toY}
            stroke={color}
            strokeWidth="2"
            strokeDasharray="10,5"
            opacity="0.7"
          />
        )
      }
      default:
        return null
    }
  }

  return (
    <div className="absolute inset-0 bg-gray-800">
      {/* Hovered territory tooltip */}
      {hoveredTerritory && (() => {
        const territory = getTerritory(hoveredTerritory)
        const baseId = hoveredTerritory.split('_')[0]
        const owner = gameState.supplyCenters[baseId]
        const unit = gameState.units.find(u => u.territory === hoveredTerritory || u.territory.split('_')[0] === baseId)
        const isSC = territory?.supplyCenter
        return (
          <div className="absolute top-4 left-4 z-10 bg-gray-900/90 px-3 py-2 rounded text-sm space-y-1">
            <div className="font-medium text-white">{territory?.name}</div>
            {owner && (
              <div className="text-gray-300">
                Owner: <span className="capitalize" style={{ color: POWER_COLORS[owner] }}>{owner}</span>
              </div>
            )}
            {unit && (
              <div className="text-gray-300">
                {unit.type === 'army' ? 'Army' : 'Fleet'} (<span className="capitalize" style={{ color: POWER_COLORS[unit.power] }}>{unit.power}</span>)
              </div>
            )}
            {isSC && !owner && (
              <div className="text-gray-400">Neutral supply center</div>
            )}
          </div>
        )
      })()}

      <svg
        viewBox="150 50 1835 1360"
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
        role="img"
        aria-label="Diplomacy game map showing territories, units, and orders"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>

        {/* Background */}
        <rect x="-200" y="-200" width="2400" height="1800" fill="#a8c5d8" />

        {/* Territories - render sea first, then land on top */}
        {territories
          .filter(t => !t.id.includes('_')) // Skip coastal variants for rendering
          .filter(t => t.path.startsWith('M')) // Skip territories with invalid/placeholder paths
          .sort((a, b) => (a.type === 'sea' ? 0 : 1) - (b.type === 'sea' ? 0 : 1)) // Sea first, land on top
          .map((territory) => {
            const isSelected = selectedTerritory === territory.id
            const isHovered = hoveredTerritory === territory.id
            const isHighlighted = highlightedTerritories?.includes(territory.id)
            const fill = getTerritoryFill(territory.id, territory.type)

            return (
              <path
                key={territory.id}
                id={territory.id}
                d={territory.path}
                fill={fill}
                stroke={isSelected ? '#ffd700' : isHighlighted ? '#60a5fa' : '#5c4a32'}
                strokeWidth={isSelected ? 2.5 : isHighlighted ? 2 : 1}
                opacity={isHovered ? 0.85 : highlightedTerritories && !isHighlighted ? 0.6 : 1}
                role={readOnly ? 'graphics-symbol' : 'button'}
                aria-label={`${getTerritory(territory.id)?.name || territory.id.toUpperCase()} territory${gameState.supplyCenters[territory.id] ? `, owned by ${gameState.supplyCenters[territory.id]}` : ''}`}
                className={readOnly ? 'transition-opacity duration-150' : 'cursor-pointer transition-opacity duration-150'}
                onClick={readOnly ? undefined : () => {
                  onTerritorySelect(isSelected ? null : territory.id)
                }}
                onMouseEnter={() => setHoveredTerritory(territory.id)}
                onMouseLeave={() => setHoveredTerritory(null)}
              />
            )
          })}

        {/* Territory labels - outlined text for readability */}
        {territories
          .filter(t => !t.id.includes('_'))
          .filter(t => t.path.startsWith('M')) // Skip territories with invalid paths
          .map((territory) => {
            const center = getTerritoryCenter(territory.id)
            if (!center) return null
            return (
              <text
                key={`label-${territory.id}`}
                x={center.x}
                y={center.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={territory.type === 'sea' ? '#1a3a5a' : '#2a2016'}
                fontSize="11"
                fontWeight="600"
                stroke={territory.type === 'sea' ? 'rgba(168, 197, 216, 0.8)' : 'rgba(255, 255, 255, 0.7)'}
                strokeWidth="2.5"
                paintOrder="stroke fill"
                className="pointer-events-none select-none"
              >
                {territory.id.toUpperCase()}
              </text>
            )
          })}

        {/* Supply center markers */}
        {territories
          .filter(t => t.supplyCenter && !t.id.includes('_'))
          .filter(t => t.path.startsWith('M')) // Skip territories with invalid paths
          .map((territory) => {
            const center = getTerritoryCenter(territory.id)
            if (!center) return null
            const owner = gameState.supplyCenters[territory.id]
            return (
              <g key={`sc-${territory.id}`}>
                {renderSupplyCenter(center.x, center.y, owner)}
              </g>
            )
          })}

        {/* Units */}
        {gameState.units.map((unit) => {
          const baseId = unit.territory.split('_')[0]
          const defaultCenter = getTerritoryCenter(baseId) || getTerritoryCenter(unit.territory)
          if (!defaultCenter) return null

          // In animation mode, use animated position if available
          if (animationMode && animationState) {
            const animatedPos = animationState.unitPositions.get(unit.territory)
            const x = animatedPos?.x ?? defaultCenter.x
            const y = animatedPos?.y ?? defaultCenter.y
            const isDislodged = animationState.dislodgedUnits.has(unit.territory)
            const isMoving = animatedPos !== undefined

            return (
              <AnimatedUnit
                key={`unit-${unit.territory}`}
                unit={unit}
                x={x}
                y={y}
                color={POWER_COLORS[unit.power]}
                isDislodged={isDislodged}
                isMoving={isMoving}
              />
            )
          }

          // Static mode: use original renderUnit
          return renderUnit(unit, defaultCenter.x, defaultCenter.y)
        })}

        {/* Orders visualization */}
        {displayOrders.map((order, index) => {
          // In animation mode, use OrderArrow component
          if (animationMode && animationState) {
            const unit = getOrderUnit(order)
            if (!unit) return null

            const unitBaseId = order.unit.split('_')[0]
            const unitCenter = getTerritoryCenter(unitBaseId) || getTerritoryCenter(order.unit)
            if (!unitCenter) return null

            // Hold orders don't need arrows in animation mode
            if (order.type === 'hold') {
              return renderOrder(order, index) // Use existing hold circle
            }

            // Move/support/convoy orders need target
            if (!order.target) return null
            const targetBaseId = order.target.split('_')[0]
            const targetCenter = getTerritoryCenter(targetBaseId) || getTerritoryCenter(order.target)
            if (!targetCenter) return null

            const failureReason = animationState.failedOrders.get(index)
            const status = failureReason ? 'failed' : 'pending'

            return (
              <OrderArrow
                key={`order-${index}`}
                fromX={unitCenter.x}
                fromY={unitCenter.y}
                toX={targetCenter.x}
                toY={targetCenter.y}
                type={order.type as 'move' | 'support' | 'convoy'}
                status={status}
                color={POWER_COLORS[unit.power]}
              />
            )
          }

          // Static mode: use original renderOrder
          return renderOrder(order, index)
        })}

        {/* Conflict markers - only in animation mode */}
        {animationMode && animationState?.conflictTerritories.map((conflict) => {
          const baseId = conflict.territory.split('_')[0]
          const center = getTerritoryCenter(baseId) || getTerritoryCenter(conflict.territory)
          if (!center) return null

          return (
            <ConflictMarker
              key={`conflict-${conflict.territory}`}
              x={center.x}
              y={center.y}
              contenders={conflict.contenders}
              resolved={conflict.resolved}
              scale={1}
            />
          )
        })}

        {/* Failed order markers - only in animation mode */}
        {animationMode && animationState && Array.from(animationState.failedOrders.entries()).map(([orderIndex, reason]) => {
          const order = displayOrders[orderIndex]
          if (!order || !order.target) return null

          const targetBaseId = order.target.split('_')[0]
          const targetCenter = getTerritoryCenter(targetBaseId) || getTerritoryCenter(order.target)
          if (!targetCenter) return null

          return (
            <FailedOrderMarker
              key={`failed-${orderIndex}`}
              x={targetCenter.x}
              y={targetCenter.y}
              reason={reason}
              visible={true}
            />
          )
        })}
      </svg>
    </div>
  )
}
