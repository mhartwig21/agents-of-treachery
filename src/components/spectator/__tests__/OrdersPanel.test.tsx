import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdersPanel, OrdersSummary } from '../OrdersPanel'
import type { Order, Power } from '../../../types/game'

function makeUnit(power: Power, territory: string) {
  return { power, territory }
}

describe('OrdersPanel - Order Display Accuracy', () => {
  describe('order text formatting', () => {
    it('formats HOLD orders as "TERRITORY HOLD"', () => {
      const orders: Order[] = [{ type: 'hold', unit: 'par' }]
      const units = [makeUnit('france', 'par')]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('PAR HOLD')).toBeInTheDocument()
    })

    it('formats MOVE orders as "TERRITORY -> TARGET"', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('PAR → BUR')).toBeInTheDocument()
    })

    it('formats SUPPORT-to-move as "UNIT S TARGET -> DESTINATION"', () => {
      const orders: Order[] = [
        { type: 'support', unit: 'mar', target: 'par', supportTarget: 'bur' },
      ]
      const units = [makeUnit('france', 'mar')]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('MAR S PAR → BUR')).toBeInTheDocument()
    })

    it('formats SUPPORT-to-hold as "UNIT S TARGET H"', () => {
      const orders: Order[] = [
        { type: 'support', unit: 'mar', target: 'par' },
      ]
      const units = [makeUnit('france', 'mar')]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('MAR S PAR H')).toBeInTheDocument()
    })

    it('formats CONVOY orders as "UNIT C TARGET -> DESTINATION"', () => {
      const orders: Order[] = [
        { type: 'convoy', unit: 'nth', target: 'lon', supportTarget: 'nwy' },
      ]
      const units = [makeUnit('england', 'nth')]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('NTH C LON → NWY')).toBeInTheDocument()
    })

    it('uppercases territory names in formatted output', () => {
      const orders: Order[] = [{ type: 'hold', unit: 'con' }]
      const units = [makeUnit('turkey', 'con')]

      render(<OrdersPanel orders={orders} units={units} />)

      // Should be uppercase CON, not lowercase con
      expect(screen.getByText('CON HOLD')).toBeInTheDocument()
    })
  })

  describe('resolution display', () => {
    it('shows success indicator for resolved successful orders', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]
      const resolutions = new Map([['par', { success: true }]])

      render(
        <OrdersPanel orders={orders} units={units} resolved={true} resolutions={resolutions} />
      )

      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('shows failure indicator for resolved failed orders', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]
      const resolutions = new Map([['par', { success: false, reason: 'Bounced' }]])

      render(
        <OrdersPanel orders={orders} units={units} resolved={true} resolutions={resolutions} />
      )

      expect(screen.getByText('✗')).toBeInTheDocument()
    })

    it('does not show success/failure indicators when not resolved', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]

      render(<OrdersPanel orders={orders} units={units} resolved={false} />)

      expect(screen.queryByText('✓')).not.toBeInTheDocument()
      expect(screen.queryByText('✗')).not.toBeInTheDocument()
    })

    it('applies green background for successful resolved orders', () => {
      const orders: Order[] = [{ type: 'hold', unit: 'par' }]
      const units = [makeUnit('france', 'par')]
      const resolutions = new Map([['par', { success: true }]])

      const { container } = render(
        <OrdersPanel orders={orders} units={units} resolved={true} resolutions={resolutions} />
      )

      const row = container.querySelector('.bg-green-900\\/20')
      expect(row).toBeInTheDocument()
    })

    it('applies red background for failed resolved orders', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]
      const resolutions = new Map([['par', { success: false, reason: 'Bounced' }]])

      const { container } = render(
        <OrdersPanel orders={orders} units={units} resolved={true} resolutions={resolutions} />
      )

      const row = container.querySelector('.bg-red-900\\/20')
      expect(row).toBeInTheDocument()
    })

    it('includes failure reason as title attribute for tooltip', () => {
      const orders: Order[] = [{ type: 'move', unit: 'par', target: 'bur' }]
      const units = [makeUnit('france', 'par')]
      const resolutions = new Map([['par', { success: false, reason: 'Bounced: equal strength' }]])

      const { container } = render(
        <OrdersPanel orders={orders} units={units} resolved={true} resolutions={resolutions} />
      )

      const row = container.querySelector('[title="Bounced: equal strength"]')
      expect(row).toBeInTheDocument()
    })
  })

  describe('power filtering', () => {
    it('shows all orders when no filter is applied', () => {
      const orders: Order[] = [
        { type: 'hold', unit: 'par' },
        { type: 'hold', unit: 'lon' },
      ]
      const units = [
        makeUnit('france', 'par'),
        makeUnit('england', 'lon'),
      ]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('PAR HOLD')).toBeInTheDocument()
      expect(screen.getByText('LON HOLD')).toBeInTheDocument()
    })

    it('filters orders to selected power', () => {
      const orders: Order[] = [
        { type: 'hold', unit: 'par' },
        { type: 'hold', unit: 'lon' },
      ]
      const units = [
        makeUnit('france', 'par'),
        makeUnit('england', 'lon'),
      ]

      render(<OrdersPanel orders={orders} units={units} filterPower="france" />)

      expect(screen.getByText('PAR HOLD')).toBeInTheDocument()
      expect(screen.queryByText('LON HOLD')).not.toBeInTheDocument()
    })

    it('shows "No orders submitted" when filter yields no results', () => {
      const orders: Order[] = [{ type: 'hold', unit: 'par' }]
      const units = [makeUnit('france', 'par')]

      render(<OrdersPanel orders={orders} units={units} filterPower="germany" />)

      expect(screen.getByText('No orders submitted')).toBeInTheDocument()
    })
  })

  describe('power grouping', () => {
    it('associates orders with correct power based on unit territory', () => {
      const orders: Order[] = [
        { type: 'move', unit: 'par', target: 'bur' },
        { type: 'move', unit: 'mun', target: 'bur' },
      ]
      const units = [
        makeUnit('france', 'par'),
        makeUnit('germany', 'mun'),
      ]

      // Filter to France - should only see PAR order
      render(<OrdersPanel orders={orders} units={units} filterPower="france" />)

      expect(screen.getByText('PAR → BUR')).toBeInTheDocument()
      expect(screen.queryByText('MUN → BUR')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message when no orders exist', () => {
      render(<OrdersPanel orders={[]} units={[]} />)

      expect(screen.getByText('No orders submitted')).toBeInTheDocument()
    })
  })

  describe('multiple orders for same power', () => {
    it('renders all orders for a power correctly', () => {
      const orders: Order[] = [
        { type: 'move', unit: 'par', target: 'bur' },
        { type: 'support', unit: 'mar', target: 'par', supportTarget: 'bur' },
        { type: 'hold', unit: 'bre' },
      ]
      const units = [
        makeUnit('france', 'par'),
        makeUnit('france', 'mar'),
        makeUnit('france', 'bre'),
      ]

      render(<OrdersPanel orders={orders} units={units} />)

      expect(screen.getByText('PAR → BUR')).toBeInTheDocument()
      expect(screen.getByText('MAR S PAR → BUR')).toBeInTheDocument()
      expect(screen.getByText('BRE HOLD')).toBeInTheDocument()
    })
  })
})

describe('OrdersSummary', () => {
  it('shows total order count', () => {
    const orders: Order[] = [
      { type: 'hold', unit: 'par' },
      { type: 'hold', unit: 'lon' },
      { type: 'hold', unit: 'mun' },
    ]
    const units = [
      makeUnit('france', 'par'),
      makeUnit('england', 'lon'),
      makeUnit('germany', 'mun'),
    ]

    render(<OrdersSummary orders={orders} units={units} />)

    expect(screen.getByText('3 orders')).toBeInTheDocument()
  })

  it('shows per-power count with colored indicators', () => {
    const orders: Order[] = [
      { type: 'hold', unit: 'par' },
      { type: 'hold', unit: 'mar' },
      { type: 'hold', unit: 'lon' },
    ]
    const units = [
      makeUnit('france', 'par'),
      makeUnit('france', 'mar'),
      makeUnit('england', 'lon'),
    ]

    render(<OrdersSummary orders={orders} units={units} />)

    // France has 2, England has 1
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
