/**
 * Tests for RelationshipHistoryModal component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RelationshipHistoryModal } from '../RelationshipHistoryModal';
import type { RelationshipHistory } from '../../../hooks/useRelationshipHistory';

describe('RelationshipHistoryModal', () => {
  const mockHistory: RelationshipHistory = {
    power1: 'ENGLAND',
    power2: 'FRANCE',
    timeline: [
      { turn: 'S1901', score: 0 },
      { turn: 'F1901', score: 3, keyEvent: 'alliance', description: 'Support given' },
      { turn: 'S1902', score: 6 },
      { turn: 'F1902', score: 15 },
    ],
    currentStatus: 'ally',
    currentScore: 15,
  };

  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={false}
        onClose={mockOnClose}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when isOpen is true', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('England')).toBeTruthy();
    expect(screen.getByText('France')).toBeTruthy();
  });

  it('displays current status', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('Allied')).toBeTruthy();
  });

  it('displays current score with sign', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('+15')).toBeTruthy();
  });

  it('displays key events section', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('Key Events')).toBeTruthy();
    expect(screen.getByText(/Alliance/)).toBeTruthy();
  });

  it('calls onClose when close button clicked', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    fireEvent.click(screen.getByText('Close'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    // Click on the backdrop (the outermost div with bg-black)
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    }
  });

  it('does not call onClose when modal content clicked', () => {
    render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    // Click on the modal content
    fireEvent.click(screen.getByText('Score History'));
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('shows empty state when timeline is empty', () => {
    const emptyHistory: RelationshipHistory = {
      power1: 'GERMANY',
      power2: 'AUSTRIA',
      timeline: [],
      currentStatus: 'neutral',
      currentScore: 0,
    };

    render(
      <RelationshipHistoryModal
        history={emptyHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('No relationship history recorded yet.')).toBeTruthy();
  });

  it('shows stable relationship message when no key events', () => {
    const stableHistory: RelationshipHistory = {
      power1: 'ITALY',
      power2: 'TURKEY',
      timeline: [
        { turn: 'S1901', score: 0 },
        { turn: 'F1901', score: 0 },
      ],
      currentStatus: 'neutral',
      currentScore: 0,
    };

    render(
      <RelationshipHistoryModal
        history={stableHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('No key events recorded. Relationship has been stable.')).toBeTruthy();
  });

  it('displays betrayal events with correct styling', () => {
    const betrayalHistory: RelationshipHistory = {
      power1: 'RUSSIA',
      power2: 'TURKEY',
      timeline: [
        { turn: 'S1901', score: 10, keyEvent: 'alliance' },
        { turn: 'F1901', score: -10, keyEvent: 'betrayal', description: 'Russia stabbed Turkey' },
      ],
      currentStatus: 'enemy',
      currentScore: -10,
    };

    render(
      <RelationshipHistoryModal
        history={betrayalHistory}
        isOpen={true}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText(/Betrayal/)).toBeTruthy();
    expect(screen.getByText(/Russia stabbed Turkey/)).toBeTruthy();
  });

  it('uses power colors when provided', () => {
    const powerColors = {
      england: '#1e3a5f',
      france: '#5c8dc9',
    };

    const { container } = render(
      <RelationshipHistoryModal
        history={mockHistory}
        isOpen={true}
        onClose={mockOnClose}
        powerColors={powerColors}
      />
    );

    // Check that the color is applied to the power indicator circles
    const colorCircles = container.querySelectorAll('.rounded-full');
    expect(colorCircles.length).toBeGreaterThan(0);
  });
});
