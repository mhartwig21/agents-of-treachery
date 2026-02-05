/**
 * Tests for RelationshipSparkline component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RelationshipSparkline, SparklineTooltip } from '../RelationshipSparkline';
import type { TimelinePoint } from '../../../hooks/useRelationshipHistory';

describe('RelationshipSparkline', () => {
  const mockTimeline: TimelinePoint[] = [
    { turn: 'S1901', score: 0 },
    { turn: 'F1901', score: 3 },
    { turn: 'S1902', score: 6, keyEvent: 'alliance', description: 'Alliance formed' },
    { turn: 'F1902', score: 15 },
  ];

  it('renders without crashing', () => {
    const { container } = render(
      <RelationshipSparkline timeline={mockTimeline} />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders no history message when timeline is empty', () => {
    render(<RelationshipSparkline timeline={[]} />);
    expect(screen.getByText('No history')).toBeTruthy();
  });

  it('renders with custom dimensions', () => {
    const { container } = render(
      <RelationshipSparkline timeline={mockTimeline} width={200} height={60} />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('60');
  });

  it('renders event markers when showEvents is true', () => {
    const { container } = render(
      <RelationshipSparkline timeline={mockTimeline} showEvents={true} />
    );
    // Should have circles for event markers (alliance event)
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('hides event markers when showEvents is false', () => {
    const { container } = render(
      <RelationshipSparkline timeline={mockTimeline} showEvents={false} />
    );
    // Should only have the current value dot
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(1); // Only the end dot
  });
});

describe('SparklineTooltip', () => {
  const mockTimeline: TimelinePoint[] = [
    { turn: 'S1901', score: 0 },
    { turn: 'F1901', score: 10 },
  ];

  it('renders power names', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="England"
        power2="France"
        status="ally"
        score={10}
      />
    );
    expect(screen.getByText(/England/)).toBeTruthy();
    expect(screen.getByText(/France/)).toBeTruthy();
  });

  it('displays allied status correctly', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="England"
        power2="France"
        status="ally"
        score={10}
      />
    );
    expect(screen.getByText('Allied')).toBeTruthy();
  });

  it('displays hostile status correctly', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="Germany"
        power2="Russia"
        status="enemy"
        score={-15}
      />
    );
    expect(screen.getByText('Hostile')).toBeTruthy();
  });

  it('displays neutral status correctly', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="Italy"
        power2="Turkey"
        status="neutral"
        score={0}
      />
    );
    expect(screen.getByText('Neutral')).toBeTruthy();
  });

  it('shows positive score with plus sign', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="England"
        power2="France"
        status="ally"
        score={15}
      />
    );
    expect(screen.getByText(/\+15/)).toBeTruthy();
  });

  it('shows turn count', () => {
    render(
      <SparklineTooltip
        timeline={mockTimeline}
        power1="England"
        power2="France"
        status="ally"
        score={10}
      />
    );
    expect(screen.getByText('2 turns tracked')).toBeTruthy();
  });
});
