import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConflictMarker, type Contender } from '../ConflictMarker';
import { POWER_COLORS } from '../../../spectator/types';

// Helper to render SVG component
function renderSvg(children: React.ReactNode) {
  return render(<svg>{children}</svg>);
}

describe('ConflictMarker', () => {
  const twoContenders: Contender[] = [
    { power: 'england', strength: 2 },
    { power: 'france', strength: 1 },
  ];

  it('renders pulsing overlay for unresolved conflict', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={false} />
    );

    // Check for the pulsing circle
    const circles = container.querySelectorAll('circle');
    const pulsingCircle = Array.from(circles).find(
      (c) => c.getAttribute('fill')?.includes('rgba(220, 38, 38')
    );

    expect(pulsingCircle).toBeTruthy();
    expect(pulsingCircle?.getAttribute('r')).toBe('30');
    expect(pulsingCircle?.style.animation).toContain('battle-pulse');
  });

  it('hides pulsing overlay when resolved', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={true} />
    );

    const circles = container.querySelectorAll('circle');
    const pulsingCircle = Array.from(circles).find(
      (c) => c.getAttribute('fill')?.includes('rgba(220, 38, 38')
    );

    expect(pulsingCircle).toBeFalsy();
  });

  it('renders strength badges for each contender', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={false} />
    );

    // Should have text elements for strength numbers
    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(2);

    const strengths = Array.from(texts).map((t) => t.textContent);
    expect(strengths).toContain('2');
    expect(strengths).toContain('1');
  });

  it('uses correct power colors for badges', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={false} />
    );

    const circles = container.querySelectorAll('circle[r="14"]');
    const colors = Array.from(circles).map((c) => c.getAttribute('fill'));

    expect(colors).toContain(POWER_COLORS.england);
    expect(colors).toContain(POWER_COLORS.france);
  });

  it('highlights winner with gold glow filter', () => {
    const resolvedContenders: Contender[] = [
      { power: 'england', strength: 2, isWinner: true },
      { power: 'france', strength: 1, isWinner: false },
    ];

    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={resolvedContenders} resolved={true} />
    );

    const groups = container.querySelectorAll('g.conflict-marker-group > g');
    const winnerGroup = Array.from(groups).find(
      (g) => g.getAttribute('filter') === 'url(#conflict-winner-glow)'
    );

    expect(winnerGroup).toBeTruthy();
  });

  it('dims loser with reduced opacity', () => {
    const resolvedContenders: Contender[] = [
      { power: 'england', strength: 2, isWinner: true },
      { power: 'france', strength: 1, isWinner: false },
    ];

    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={resolvedContenders} resolved={true} />
    );

    const groups = container.querySelectorAll('g.conflict-marker-group > g');
    const loserGroup = Array.from(groups).find(
      (g) => g.getAttribute('opacity') === '0.4'
    );

    expect(loserGroup).toBeTruthy();
  });

  it('positions badges in an arc around center', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={false} />
    );

    const badgeCircles = container.querySelectorAll('circle[r="14"]');
    expect(badgeCircles.length).toBe(2);

    // Badges should be positioned away from center (x=100, y=100)
    for (const circle of badgeCircles) {
      const cx = parseFloat(circle.getAttribute('cx') || '0');
      const cy = parseFloat(circle.getAttribute('cy') || '0');
      const distance = Math.sqrt((cx - 100) ** 2 + (cy - 100) ** 2);

      // Badges should be at radius ~35 from center
      expect(distance).toBeGreaterThan(30);
      expect(distance).toBeLessThan(40);
    }
  });

  it('renders correct number of badges for three contenders', () => {
    const threeContenders: Contender[] = [
      { power: 'england', strength: 2 },
      { power: 'france', strength: 2 },
      { power: 'germany', strength: 1 },
    ];

    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={threeContenders} resolved={false} />
    );

    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(3);
  });

  it('renders filter definitions for glow effects', () => {
    const { container } = renderSvg(
      <ConflictMarker x={100} y={100} contenders={twoContenders} resolved={false} />
    );

    const filter = container.querySelector('filter#conflict-winner-glow');
    expect(filter).toBeTruthy();
  });
});
