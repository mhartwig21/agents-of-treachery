import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DiplomacyMap, type ResolutionAnimationState } from '../DiplomacyMap'
import type { GameState, Order, Unit } from '../../types/game'

// Mock territory data so tests don't depend on real map geometry
vi.mock('../../data/territories', () => {
  const centers: Record<string, { x: number; y: number }> = {
    par: { x: 500, y: 600 },
    bur: { x: 550, y: 550 },
    mar: { x: 480, y: 650 },
    lon: { x: 400, y: 400 },
    eng: { x: 380, y: 450 },
    bre: { x: 420, y: 560 },
    mun: { x: 600, y: 520 },
    ber: { x: 620, y: 480 },
    kie: { x: 590, y: 460 },
    nth: { x: 450, y: 350 },
    nwy: { x: 500, y: 300 },
    mos: { x: 750, y: 450 },
    war: { x: 680, y: 500 },
    vie: { x: 640, y: 560 },
    tri: { x: 620, y: 590 },
    ven: { x: 580, y: 610 },
    rom: { x: 570, y: 650 },
    nap: { x: 590, y: 700 },
    con: { x: 780, y: 620 },
    ank: { x: 820, y: 600 },
    smy: { x: 800, y: 650 },
  }

  return {
    territories: [],
    getTerritory: (id: string) => {
      if (centers[id]) {
        return { id, name: id.toUpperCase(), type: 'land', supplyCenter: true, path: 'M0 0', labelX: 0, labelY: 0, neighbors: [] }
      }
      return undefined
    },
    getTerritoryCenter: (id: string) => centers[id] || undefined,
  }
})

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'spring',
    year: 1901,
    units: [],
    orders: [],
    supplyCenters: {},
    ...overrides,
  }
}

function army(power: GameState['units'][0]['power'], territory: string): Unit {
  return { type: 'army', power, territory }
}

function fleet(power: GameState['units'][0]['power'], territory: string): Unit {
  return { type: 'fleet', power, territory }
}

const noop = () => {}

describe('DiplomacyMap - Order Display Accuracy', () => {
  describe('static mode - HOLD orders', () => {
    it('renders a circle indicator for HOLD orders', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'hold', unit: 'par' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      // HOLD = circle with r=18, stroke = power color, fill = none
      const holdCircles = container.querySelectorAll('circle[r="18"]')
      expect(holdCircles.length).toBe(1)
      expect(holdCircles[0].getAttribute('fill')).toBe('none')
      expect(holdCircles[0].getAttribute('stroke-width')).toBe('3')
    })

    it('uses correct power color for HOLD indicator', () => {
      const gs = makeGameState({
        units: [army('england', 'lon')],
        orders: [{ type: 'hold', unit: 'lon' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const holdCircle = container.querySelector('circle[r="18"]')
      // England's color is #1e3a5f
      expect(holdCircle?.getAttribute('stroke')).toBe('#1e3a5f')
    })

    it('positions HOLD circle at the unit territory center', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'hold', unit: 'par' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const holdCircle = container.querySelector('circle[r="18"]')
      // PAR center is (500, 600) per mock
      expect(holdCircle?.getAttribute('cx')).toBe('500')
      expect(holdCircle?.getAttribute('cy')).toBe('600')
    })
  })

  describe('static mode - MOVE orders', () => {
    it('renders a line from unit to target for MOVE orders', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const lines = container.querySelectorAll('line')
      const moveLine = Array.from(lines).find(l =>
        l.getAttribute('x1') === '500' && l.getAttribute('y1') === '600'
      )
      expect(moveLine).toBeTruthy()
      // Should use arrowhead marker
      expect(moveLine?.getAttribute('marker-end')).toBe('url(#arrowhead)')
    })

    it('uses correct power color for MOVE arrow', () => {
      const gs = makeGameState({
        units: [army('germany', 'mun')],
        orders: [{ type: 'move', unit: 'mun', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const lines = container.querySelectorAll('line')
      const moveLine = Array.from(lines).find(l =>
        l.getAttribute('marker-end') === 'url(#arrowhead)'
      )
      // Germany's color is #4a4a4a
      expect(moveLine?.getAttribute('stroke')).toBe('#4a4a4a')
    })

    it('shortens MOVE arrow to stop before destination', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const lines = container.querySelectorAll('line')
      const moveLine = Array.from(lines).find(l =>
        l.getAttribute('x1') === '500' && l.getAttribute('y1') === '600'
      )

      // Arrow should not reach the exact target center (550, 550)
      const x2 = parseFloat(moveLine?.getAttribute('x2') || '0')
      const y2 = parseFloat(moveLine?.getAttribute('y2') || '0')

      // The endpoint should be closer than the target but not at it
      expect(x2).not.toBe(550)
      expect(y2).not.toBe(550)
      // Should be between source and target
      expect(x2).toBeGreaterThan(500)
      expect(x2).toBeLessThan(550)
    })

    it('does not render MOVE if target is missing', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par' }], // No target
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const moveLines = container.querySelectorAll('line[marker-end]')
      expect(moveLines.length).toBe(0)
    })
  })

  describe('static mode - SUPPORT orders', () => {
    it('renders a dashed line for SUPPORT orders', () => {
      const gs = makeGameState({
        units: [army('france', 'par'), army('france', 'mar')],
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'support', unit: 'mar', target: 'bur' },
        ],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const dashedLines = container.querySelectorAll('line[stroke-dasharray="5,5"]')
      expect(dashedLines.length).toBe(1)
    })

    it('has no arrowhead on SUPPORT lines', () => {
      const gs = makeGameState({
        units: [army('france', 'mar')],
        orders: [{ type: 'support', unit: 'mar', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const dashedLines = container.querySelectorAll('line[stroke-dasharray="5,5"]')
      expect(dashedLines.length).toBe(1)
      expect(dashedLines[0].getAttribute('marker-end')).toBeNull()
    })

    it('connects SUPPORT line from supporting unit to the support target territory', () => {
      const gs = makeGameState({
        units: [army('france', 'mar')],
        orders: [{ type: 'support', unit: 'mar', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const supportLine = container.querySelector('line[stroke-dasharray="5,5"]')
      // MAR center: (480, 650), BUR center: (550, 550)
      expect(supportLine?.getAttribute('x1')).toBe('480')
      expect(supportLine?.getAttribute('y1')).toBe('650')
      expect(supportLine?.getAttribute('x2')).toBe('550')
      expect(supportLine?.getAttribute('y2')).toBe('550')
    })

    it('uses reduced opacity for SUPPORT lines', () => {
      const gs = makeGameState({
        units: [army('france', 'mar')],
        orders: [{ type: 'support', unit: 'mar', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const supportLine = container.querySelector('line[stroke-dasharray="5,5"]')
      expect(supportLine?.getAttribute('opacity')).toBe('0.7')
    })
  })

  describe('static mode - CONVOY orders', () => {
    it('renders a long-dash line for CONVOY orders', () => {
      const gs = makeGameState({
        units: [fleet('england', 'eng')],
        orders: [{ type: 'convoy', unit: 'eng', target: 'bre' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const convoyLines = container.querySelectorAll('line[stroke-dasharray="10,5"]')
      expect(convoyLines.length).toBe(1)
    })

    it('has no arrowhead on CONVOY lines', () => {
      const gs = makeGameState({
        units: [fleet('england', 'eng')],
        orders: [{ type: 'convoy', unit: 'eng', target: 'bre' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const convoyLines = container.querySelectorAll('line[stroke-dasharray="10,5"]')
      expect(convoyLines[0].getAttribute('marker-end')).toBeNull()
    })
  })

  describe('static mode - multiple simultaneous orders', () => {
    it('renders correct visual type for each order in a mixed set', () => {
      const gs = makeGameState({
        units: [
          army('france', 'par'),
          army('france', 'mar'),
          fleet('england', 'eng'),
          army('germany', 'mun'),
        ],
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'support', unit: 'mar', target: 'bur' },
          { type: 'convoy', unit: 'eng', target: 'bre' },
          { type: 'hold', unit: 'mun' },
        ],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      // 1 MOVE line (with arrowhead)
      const moveLines = container.querySelectorAll('line[marker-end="url(#arrowhead)"]')
      expect(moveLines.length).toBe(1)

      // 1 SUPPORT dashed line
      const supportLines = container.querySelectorAll('line[stroke-dasharray="5,5"]')
      expect(supportLines.length).toBe(1)

      // 1 CONVOY long-dash line
      const convoyLines = container.querySelectorAll('line[stroke-dasharray="10,5"]')
      expect(convoyLines.length).toBe(1)

      // 1 HOLD circle
      const holdCircles = container.querySelectorAll('circle[r="18"]')
      expect(holdCircles.length).toBe(1)
    })

    it('each order uses the correct power color', () => {
      const gs = makeGameState({
        units: [
          army('france', 'par'),
          army('germany', 'mun'),
        ],
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'hold', unit: 'mun' },
        ],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const moveLine = container.querySelector('line[marker-end="url(#arrowhead)"]')
      expect(moveLine?.getAttribute('stroke')).toBe('#5c8dc9') // France

      const holdCircle = container.querySelector('circle[r="18"]')
      expect(holdCircle?.getAttribute('stroke')).toBe('#4a4a4a') // Germany
    })
  })

  describe('static mode - orders without matching units', () => {
    it('does not render an order if the unit is not in game state', () => {
      const gs = makeGameState({
        units: [], // No units
        orders: [{ type: 'hold', unit: 'par' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const holdCircles = container.querySelectorAll('circle[r="18"]')
      expect(holdCircles.length).toBe(0)
    })
  })

  describe('animation mode - OrderArrow integration', () => {
    const baseAnimState: ResolutionAnimationState = {
      dislodgedUnits: new Set(),
      unitPositions: new Map(),
      failedOrders: new Map(),
      conflictTerritories: [],
    }

    it('uses OrderArrow component for MOVE orders in animation mode', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={baseAnimState}
        />
      )

      // In animation mode, OrderArrow renders SVG <path> not <line>
      const arrowGroup = container.querySelector('g.order-arrow-group')
      expect(arrowGroup).toBeInTheDocument()
    })

    it('still renders HOLD circle in animation mode (no OrderArrow for hold)', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'hold', unit: 'par' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={baseAnimState}
        />
      )

      // Hold should still render as static circle, not as OrderArrow
      const holdCircles = container.querySelectorAll('circle[r="18"]')
      expect(holdCircles.length).toBe(1)
    })

    it('shows failed status for orders in failedOrders map', () => {
      const animState: ResolutionAnimationState = {
        ...baseAnimState,
        failedOrders: new Map([[0, 'Bounced: equal strength']]),
      }

      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      // Failed orders should have red stroke color (#ef4444)
      const arrowPath = container.querySelector('g.order-arrow-group path')
      expect(arrowPath?.getAttribute('stroke')).toBe('#ef4444')
    })

    it('shows pending status for orders not in failedOrders map', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={baseAnimState}
        />
      )

      // Pending orders use power color, not red/green
      const arrowPath = container.querySelector('g.order-arrow-group path')
      expect(arrowPath?.getAttribute('stroke')).toBe('#5c8dc9') // France
    })
  })

  describe('animation mode - FailedOrderMarker', () => {
    it('renders FailedOrderMarker at target territory for failed MOVE orders', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(),
        unitPositions: new Map(),
        failedOrders: new Map([[0, 'Bounced']]),
        conflictTerritories: [],
      }

      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      // FailedOrderMarker renders a red X (two crossed lines)
      const failedMarker = container.querySelector('g.failed-order-marker')
      expect(failedMarker).toBeInTheDocument()

      // The red lines should be at BUR center (550, 550)
      const redLines = failedMarker?.querySelectorAll('line')
      expect(redLines?.length).toBe(2)
      expect(redLines?.[0].getAttribute('stroke')).toBe('#ef4444')
    })

    it('includes failure reason as title for tooltip', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(),
        unitPositions: new Map(),
        failedOrders: new Map([[0, 'Bounced: equal strength']]),
        conflictTerritories: [],
      }

      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      // FailedOrderMarker renders a <title> with the reason
      const title = container.querySelector('g.failed-order-marker title')
      expect(title?.textContent).toBe('Bounced: equal strength')
    })

    it('does not render FailedOrderMarker for successful orders', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={{
            dislodgedUnits: new Set(),
            unitPositions: new Map(),
            failedOrders: new Map(), // No failures
            conflictTerritories: [],
          }}
        />
      )

      const failedMarker = container.querySelector('g.failed-order-marker')
      expect(failedMarker).toBeNull()
    })
  })

  describe('animation mode - ConflictMarker integration', () => {
    it('renders ConflictMarker for contested territories', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(),
        unitPositions: new Map(),
        failedOrders: new Map(),
        conflictTerritories: [{
          territory: 'bur',
          contenders: [
            { power: 'france', strength: 2 },
            { power: 'germany', strength: 1 },
          ],
          resolved: false,
        }],
      }

      const gs = makeGameState({
        units: [army('france', 'par'), army('germany', 'mun')],
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'move', unit: 'mun', target: 'bur' },
        ],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      const conflictGroup = container.querySelector('g.conflict-marker-group')
      expect(conflictGroup).toBeInTheDocument()
    })

    it('does not render ConflictMarker when not in animation mode', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(),
        unitPositions: new Map(),
        failedOrders: new Map(),
        conflictTerritories: [{
          territory: 'bur',
          contenders: [
            { power: 'france', strength: 2 },
            { power: 'germany', strength: 1 },
          ],
          resolved: false,
        }],
      }

      const gs = makeGameState({
        units: [army('france', 'par'), army('germany', 'mun')],
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'move', unit: 'mun', target: 'bur' },
        ],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={false}
          animationState={animState}
        />
      )

      const conflictGroup = container.querySelector('g.conflict-marker-group')
      expect(conflictGroup).toBeNull()
    })
  })

  describe('animation mode - AnimatedUnit with dislodged state', () => {
    it('renders dislodged unit with red stroke', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(['bur']),
        unitPositions: new Map(),
        failedOrders: new Map(),
        conflictTerritories: [],
      }

      const gs = makeGameState({
        units: [army('germany', 'bur')],
        orders: [],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      // AnimatedUnit renders a circle with red stroke when dislodged
      const unitCircle = container.querySelector('circle[r="11"]')
      expect(unitCircle?.getAttribute('stroke')).toBe('#ff0000')
      expect(unitCircle?.getAttribute('stroke-width')).toBe('2.5')
    })

    it('uses animated position from unitPositions when available', () => {
      const animState: ResolutionAnimationState = {
        dislodgedUnits: new Set(),
        unitPositions: new Map([['par', { x: 525, y: 575 }]]), // Midway to BUR
        failedOrders: new Map(),
        conflictTerritories: [],
      }

      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap
          gameState={gs}
          selectedTerritory={null}
          onTerritorySelect={noop}
          animationMode={true}
          animationState={animState}
        />
      )

      // AnimatedUnit uses CSS transform based on animatedPos
      const unitGroup = container.querySelector('g[style]')
      const transform = unitGroup?.getAttribute('style') || unitGroup?.style?.transform || ''
      // The transform should use the animated position (525-12=513, 575-12=563)
      expect(transform).toContain('513')
      expect(transform).toContain('563')
    })
  })

  describe('arrowhead marker definition', () => {
    it('defines the arrowhead SVG marker', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const marker = container.querySelector('marker#arrowhead')
      expect(marker).toBeInTheDocument()
      expect(marker?.getAttribute('orient')).toBe('auto')

      const polygon = marker?.querySelector('polygon')
      expect(polygon).toBeInTheDocument()
    })
  })

  describe('unit rendering', () => {
    it('renders army as circle with "A" text', () => {
      const gs = makeGameState({
        units: [army('france', 'par')],
        orders: [],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const texts = container.querySelectorAll('text')
      const armyText = Array.from(texts).find(t => t.textContent === 'A')
      expect(armyText).toBeTruthy()
    })

    it('renders fleet as circle with "F" text', () => {
      const gs = makeGameState({
        units: [fleet('england', 'lon')],
        orders: [],
      })

      const { container } = render(
        <DiplomacyMap gameState={gs} selectedTerritory={null} onTerritorySelect={noop} />
      )

      const texts = container.querySelectorAll('text')
      const fleetText = Array.from(texts).find(t => t.textContent === 'F')
      expect(fleetText).toBeTruthy()
    })
  })
})
