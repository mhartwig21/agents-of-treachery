import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { OrderArrow } from '../OrderArrow'

describe('OrderArrow', () => {
  describe('straight line path calculation', () => {
    it('renders a straight line path from source to destination', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={100}
            fromY={100}
            toX={200}
            toY={100}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path).toBeInTheDocument()
      // Straight line with arrowhead offset (12px)
      // Length = 100, so endpoint = 100 + (200-100) * ((100-12)/100) = 188
      expect(path?.getAttribute('d')).toMatch(/^M 100 100 L \d+/)
    })

    it('calculates correct endpoint for horizontal line', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={50}
            toX={100}
            toY={50}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // Length = 100, arrowheadOffset = 12
      // endX = 0 + 100 * ((100-12)/100) = 88
      // endY = 50 + 0 * ((100-12)/100) = 50
      expect(d).toBe('M 0 50 L 88 50')
    })

    it('calculates correct endpoint for vertical line', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={50}
            fromY={0}
            toX={50}
            toY={100}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // Length = 100, arrowheadOffset = 12
      // endX = 50 + 0 * ((100-12)/100) = 50
      // endY = 0 + 100 * ((100-12)/100) = 88
      expect(d).toBe('M 50 0 L 50 88')
    })

    it('calculates correct endpoint for diagonal line', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={100}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // Length = sqrt(100^2 + 100^2) = 141.42...
      // ratio = (141.42 - 12) / 141.42 = 0.9151...
      // endX = 0 + 100 * 0.9151 = 91.51...
      // endY = 0 + 100 * 0.9151 = 91.51...
      const match = d.match(/M 0 0 L ([\d.]+) ([\d.]+)/)
      expect(match).toBeTruthy()
      const endX = parseFloat(match![1])
      const endY = parseFloat(match![2])
      // Should be approximately 91.5
      expect(endX).toBeCloseTo(91.51, 0)
      expect(endY).toBeCloseTo(91.51, 0)
    })

    it('handles very short distances', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={100}
            fromY={100}
            toX={120}
            toY={100}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path).toBeInTheDocument()
      // Length = 20, arrowheadOffset = 12
      // endX = 100 + 20 * ((20-12)/20) = 108
      const d = path?.getAttribute('d') || ''
      expect(d).toBe('M 100 100 L 108 100')
    })
  })

  describe('curved path calculation', () => {
    it('renders a quadratic bezier curve when curved=true', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
            curved={true}
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // Should be a Q (quadratic bezier) path
      expect(d).toMatch(/^M .+ Q .+ .+ .+ .+$/)
    })

    it('calculates control point perpendicular to midpoint', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
            curved={true}
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // For horizontal line: dx=100, dy=0, len=100
      // endX = 0 + 100 * ((100-12)/100) = 88
      // midX = (0 + 88) / 2 = 44
      // midY = (0 + 0) / 2 = 0
      // perpX = -0/100 * 40 = 0
      // perpY = 100/100 * 40 = 40
      // ctrlX = 44 + 0 = 44
      // ctrlY = 0 + 40 = 40
      const match = d.match(/M 0 0 Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/)
      expect(match).toBeTruthy()
      const ctrlX = parseFloat(match![1])
      const ctrlY = parseFloat(match![2])
      expect(ctrlX).toBe(44)
      expect(ctrlY).toBe(40)
    })

    it('curves in opposite direction for vertical line', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={0}
            toY={100}
            type="move"
            status="pending"
            color="#ff0000"
            curved={true}
          />
        </svg>
      )

      const path = container.querySelector('path')
      const d = path?.getAttribute('d') || ''
      // For vertical line: dx=0, dy=100, len=100
      // endY = 0 + 100 * ((100-12)/100) = 88
      // midX = (0 + 0) / 2 = 0
      // midY = (0 + 88) / 2 = 44
      // perpX = -100/100 * 40 = -40
      // perpY = 0/100 * 40 = 0
      // ctrlX = 0 + (-40) = -40
      // ctrlY = 44 + 0 = 44
      const match = d.match(/M 0 0 Q (-?[\d.]+) ([\d.]+) (-?[\d.]+) ([\d.]+)/)
      expect(match).toBeTruthy()
      const ctrlX = parseFloat(match![1])
      const ctrlY = parseFloat(match![2])
      expect(ctrlX).toBe(-40)
      expect(ctrlY).toBe(44)
    })
  })

  describe('arrowhead positioning', () => {
    it('renders arrowhead polygon for move orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={50}
            toX={100}
            toY={50}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const paths = container.querySelectorAll('path')
      // Should have main path and arrowhead path
      expect(paths.length).toBe(2)
      // Arrowhead is a closed path (ends with Z)
      const arrowheadPath = paths[1]
      expect(arrowheadPath?.getAttribute('d')).toMatch(/Z$/)
    })

    it('calculates arrowhead tip at correct position', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={50}
            toX={100}
            toY={50}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const paths = container.querySelectorAll('path')
      const arrowheadPath = paths[1]?.getAttribute('d') || ''
      // For horizontal line pointing right:
      // endX = 88, endY = 50
      // tipX = endX + cos(0) * 12 = 88 + 12 = 100
      // tipY = endY + sin(0) * 12 = 50 + 0 = 50
      expect(arrowheadPath).toMatch(/^M 100 50/)
    })

    it('does not render arrowhead for support orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={50}
            toX={100}
            toY={50}
            type="support"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const paths = container.querySelectorAll('path')
      // Should only have main path, no arrowhead
      expect(paths.length).toBe(1)
    })

    it('does not render arrowhead for convoy orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={50}
            toX={100}
            toY={50}
            type="convoy"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const paths = container.querySelectorAll('path')
      // Should only have main path, no arrowhead
      expect(paths.length).toBe(1)
    })
  })

  describe('order type styling', () => {
    it('renders solid stroke for move orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      // Solid line has no stroke-dasharray
      expect(path?.getAttribute('stroke-dasharray')).toBeNull()
    })

    it('renders dashed stroke for support orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="support"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke-dasharray')).toBe('5 5')
    })

    it('renders long dash stroke for convoy orders', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="convoy"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke-dasharray')).toBe('10 5')
    })
  })

  describe('status variants', () => {
    it('applies custom color for pending status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke')).toBe('#ff0000')
      expect(path?.getAttribute('opacity')).toBe('0.9')
    })

    it('applies green color and glow filter for success status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="success"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke')).toBe('#22c55e')
      expect(path?.getAttribute('opacity')).toBe('1')
      expect(path?.getAttribute('filter')).toBe('url(#order-arrow-glow-success)')
    })

    it('applies red color for failed status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="failed"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke')).toBe('#ef4444')
      expect(path?.getAttribute('opacity')).toBe('0.8')
      expect(path?.getAttribute('filter')).toBeNull()
    })

    it('applies animation for pending status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const style = path?.getAttribute('style') || ''
      expect(style).toContain('animation')
    })

    it('does not apply animation for success status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="success"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const style = path?.getAttribute('style') || ''
      expect(style).not.toContain('animation')
    })

    it('does not apply animation for failed status', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="failed"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      const style = path?.getAttribute('style') || ''
      expect(style).not.toContain('animation')
    })
  })

  describe('SVG structure', () => {
    it('renders a group element containing paths', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const group = container.querySelector('g.order-arrow-group')
      expect(group).toBeInTheDocument()
    })

    it('includes filter definitions for glow effect', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const filter = container.querySelector('filter#order-arrow-glow-success')
      expect(filter).toBeInTheDocument()
    })

    it('applies correct stroke properties', () => {
      const { container } = render(
        <svg>
          <OrderArrow
            fromX={0}
            fromY={0}
            toX={100}
            toY={0}
            type="move"
            status="pending"
            color="#ff0000"
          />
        </svg>
      )

      const path = container.querySelector('path')
      expect(path?.getAttribute('fill')).toBe('none')
      expect(path?.getAttribute('stroke-width')).toBe('3')
      expect(path?.getAttribute('stroke-linecap')).toBe('round')
      expect(path?.getAttribute('stroke-linejoin')).toBe('round')
    })
  })
})
