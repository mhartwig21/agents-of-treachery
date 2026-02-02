import { useState, useRef, useCallback } from 'react'
import type { GameState, Power, Unit, Order } from '../types/game'
import { territories, getTerritory } from '../data/territories'

interface DiplomacyMapProps {
  gameState: GameState
  selectedTerritory: string | null
  onTerritorySelect: (id: string | null) => void
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

const VIEWBOX = { width: 900, height: 800 }

export function DiplomacyMap({
  gameState,
  selectedTerritory,
  onTerritorySelect,
}: DiplomacyMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: VIEWBOX.width, height: VIEWBOX.height })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
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

  // Handle zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x
    const mouseY = ((e.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
    const newWidth = Math.min(VIEWBOX.width * 2, Math.max(200, viewBox.width * zoomFactor))
    const newHeight = Math.min(VIEWBOX.height * 2, Math.max(160, viewBox.height * zoomFactor))

    // Keep mouse position fixed during zoom
    const newX = mouseX - (mouseX - viewBox.x) * (newWidth / viewBox.width)
    const newY = mouseY - (mouseY - viewBox.y) * (newHeight / viewBox.height)

    setViewBox({
      x: Math.max(-200, Math.min(VIEWBOX.width, newX)),
      y: Math.max(-200, Math.min(VIEWBOX.height, newY)),
      width: newWidth,
      height: newHeight,
    })
  }, [viewBox])

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) { // Middle or right click
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    const svg = svgRef.current
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const dx = ((e.clientX - panStart.x) / rect.width) * viewBox.width
    const dy = ((e.clientY - panStart.y) / rect.height) * viewBox.height

    setViewBox(prev => ({
      ...prev,
      x: Math.max(-200, Math.min(VIEWBOX.width, prev.x - dx)),
      y: Math.max(-200, Math.min(VIEWBOX.height, prev.y - dy)),
    }))
    setPanStart({ x: e.clientX, y: e.clientY })
  }, [isPanning, panStart, viewBox.width, viewBox.height])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Reset zoom
  const resetZoom = useCallback(() => {
    setViewBox({ x: 0, y: 0, width: VIEWBOX.width, height: VIEWBOX.height })
  }, [])

  // Render unit icon
  const renderUnit = (unit: Unit, x: number, y: number) => {
    const color = POWER_COLORS[unit.power]
    if (unit.type === 'army') {
      return (
        <g key={`unit-${unit.territory}`} transform={`translate(${x - 12}, ${y - 12})`}>
          <circle cx="12" cy="12" r="11" fill={color} stroke="#000" strokeWidth="1.5" />
          <text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">A</text>
        </g>
      )
    } else {
      return (
        <g key={`unit-${unit.territory}`} transform={`translate(${x - 12}, ${y - 12})`}>
          <circle cx="12" cy="12" r="11" fill={color} stroke="#000" strokeWidth="1.5" />
          <text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">F</text>
        </g>
      )
    }
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

    const unitTerritory = getTerritory(order.unit.split('_')[0]) || getTerritory(order.unit)
    if (!unitTerritory) return null

    const color = POWER_COLORS[unit.power]
    const fromX = unitTerritory.labelX
    const fromY = unitTerritory.labelY - 8

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
        const targetTerritory = getTerritory(order.target.split('_')[0]) || getTerritory(order.target)
        if (!targetTerritory) return null

        const toX = targetTerritory.labelX
        const toY = targetTerritory.labelY - 8

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
        const targetTerritory = getTerritory(order.target.split('_')[0]) || getTerritory(order.target)
        if (!targetTerritory) return null

        const toX = targetTerritory.labelX
        const toY = targetTerritory.labelY - 8

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
        const targetTerritory = getTerritory(order.target.split('_')[0]) || getTerritory(order.target)
        if (!targetTerritory) return null

        const toX = targetTerritory.labelX
        const toY = targetTerritory.labelY - 8

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
      {/* Zoom controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <button
          onClick={() => setViewBox(prev => ({
            ...prev,
            width: Math.max(200, prev.width * 0.8),
            height: Math.max(160, prev.height * 0.8),
          }))}
          className="bg-gray-700 hover:bg-gray-600 text-white w-8 h-8 rounded flex items-center justify-center"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setViewBox(prev => ({
            ...prev,
            width: Math.min(VIEWBOX.width * 2, prev.width * 1.25),
            height: Math.min(VIEWBOX.height * 2, prev.height * 1.25),
          }))}
          className="bg-gray-700 hover:bg-gray-600 text-white w-8 h-8 rounded flex items-center justify-center"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="bg-gray-700 hover:bg-gray-600 text-white w-8 h-8 rounded flex items-center justify-center text-xs"
          title="Reset zoom"
        >
          ⟲
        </button>
      </div>

      {/* Hovered territory tooltip */}
      {hoveredTerritory && (
        <div className="absolute top-4 left-4 z-10 bg-gray-900/90 px-3 py-2 rounded text-sm">
          {getTerritory(hoveredTerritory)?.name}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
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
        <rect x="-200" y="-200" width="1400" height="1200" fill="#a8c5d8" />

        {/* Territories */}
        {territories
          .filter(t => !t.id.includes('_')) // Skip coastal variants for rendering
          .map((territory) => {
            const isSelected = selectedTerritory === territory.id
            const isHovered = hoveredTerritory === territory.id
            const fill = getTerritoryFill(territory.id, territory.type)

            return (
              <path
                key={territory.id}
                d={territory.path}
                fill={fill}
                stroke={isSelected ? '#ffd700' : '#5c4a32'}
                strokeWidth={isSelected ? 2.5 : 1}
                opacity={isHovered ? 0.85 : 1}
                className="cursor-pointer transition-opacity duration-150"
                onClick={() => onTerritorySelect(isSelected ? null : territory.id)}
                onMouseEnter={() => setHoveredTerritory(territory.id)}
                onMouseLeave={() => setHoveredTerritory(null)}
              />
            )
          })}

        {/* Territory labels */}
        {territories
          .filter(t => !t.id.includes('_'))
          .map((territory) => (
            <text
              key={`label-${territory.id}`}
              x={territory.labelX}
              y={territory.labelY}
              textAnchor="middle"
              fill={territory.type === 'sea' ? '#4a6d8a' : '#5c4a32'}
              fontSize="10"
              fontWeight="500"
              className="pointer-events-none select-none"
            >
              {territory.id.toUpperCase()}
            </text>
          ))}

        {/* Supply center markers */}
        {territories
          .filter(t => t.supplyCenter && !t.id.includes('_'))
          .map((territory) => {
            const owner = gameState.supplyCenters[territory.id]
            return (
              <g key={`sc-${territory.id}`}>
                {renderSupplyCenter(territory.labelX, territory.labelY, owner)}
              </g>
            )
          })}

        {/* Units */}
        {gameState.units.map((unit) => {
          const baseId = unit.territory.split('_')[0]
          const territory = getTerritory(baseId) || getTerritory(unit.territory)
          if (!territory) return null
          return renderUnit(unit, territory.labelX, territory.labelY - 8)
        })}

        {/* Orders visualization */}
        {gameState.orders.map((order, index) => renderOrder(order, index))}
      </svg>
    </div>
  )
}
