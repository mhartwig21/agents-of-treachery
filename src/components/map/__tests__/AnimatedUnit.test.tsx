import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnimatedUnit } from '../AnimatedUnit'
import type { Unit } from '../../../types/game'

describe('AnimatedUnit', () => {
  const mockArmyUnit: Unit = {
    type: 'army',
    power: 'france',
    territory: 'par',
  }

  const mockFleetUnit: Unit = {
    type: 'fleet',
    power: 'england',
    territory: 'lon',
  }

  it('renders army unit with letter A', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#5c8dc9"
        />
      </svg>
    )

    const text = container.querySelector('text')
    expect(text).toBeInTheDocument()
    expect(text?.textContent).toBe('A')
  })

  it('renders fleet unit with letter F', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockFleetUnit}
          x={100}
          y={100}
          color="#1e3a5f"
        />
      </svg>
    )

    const text = container.querySelector('text')
    expect(text).toBeInTheDocument()
    expect(text?.textContent).toBe('F')
  })

  it('applies transform based on x and y props', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={200}
          y={150}
          color="#5c8dc9"
        />
      </svg>
    )

    const group = container.querySelector('g')
    expect(group).toHaveStyle({ transform: 'translate(188px, 138px)' })
  })

  it('applies battle-pulse animation class when isDislodged is true', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#5c8dc9"
          isDislodged={true}
        />
      </svg>
    )

    const group = container.querySelector('g')
    expect(group).toHaveClass('animate-battle-pulse')
  })

  it('does not apply battle-pulse animation when isDislodged is false', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#5c8dc9"
          isDislodged={false}
        />
      </svg>
    )

    const group = container.querySelector('g')
    expect(group).not.toHaveClass('animate-battle-pulse')
  })

  it('uses red stroke when isDislodged is true', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#5c8dc9"
          isDislodged={true}
        />
      </svg>
    )

    const circle = container.querySelector('circle')
    expect(circle).toHaveAttribute('stroke', '#ff0000')
    expect(circle).toHaveAttribute('stroke-width', '2.5')
  })

  it('uses black stroke when isDislodged is false', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#5c8dc9"
          isDislodged={false}
        />
      </svg>
    )

    const circle = container.querySelector('circle')
    expect(circle).toHaveAttribute('stroke', '#000')
    expect(circle).toHaveAttribute('stroke-width', '1.5')
  })

  it('applies the provided color to the circle fill', () => {
    const { container } = render(
      <svg>
        <AnimatedUnit
          unit={mockArmyUnit}
          x={100}
          y={100}
          color="#2e7d32"
        />
      </svg>
    )

    const circle = container.querySelector('circle')
    expect(circle).toHaveAttribute('fill', '#2e7d32')
  })
})
