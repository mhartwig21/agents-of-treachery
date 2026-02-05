/**
 * Tests for RelationshipGraphPanel component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RelationshipGraphPanel } from '../RelationshipGraphPanel';
import type { Message } from '../../../press/types';
import type { GameEvent, MovementResolvedEvent } from '../../../store/events';

describe('RelationshipGraphPanel', () => {
  // Helper to create test messages
  const createMessage = (
    sender: string,
    channelId: string,
    intent?: string
  ): Message => ({
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channelId,
    sender: sender as Message['sender'],
    content: 'Test message',
    timestamp: new Date(),
    metadata: intent ? { intent: intent as Message['metadata']['intent'] } : undefined,
  });

  it('renders all 7 power nodes', () => {
    render(<RelationshipGraphPanel messages={[]} />);

    // Check for all power abbreviations
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('FRA')).toBeInTheDocument();
    expect(screen.getByText('GER')).toBeInTheDocument();
    expect(screen.getByText('ITA')).toBeInTheDocument();
    expect(screen.getByText('AUS')).toBeInTheDocument();
    expect(screen.getByText('RUS')).toBeInTheDocument();
    expect(screen.getByText('TUR')).toBeInTheDocument();
  });

  it('shows empty state message when no messages', () => {
    render(<RelationshipGraphPanel messages={[]} />);

    expect(screen.getByText('No diplomatic messages yet.')).toBeInTheDocument();
  });

  it('renders legend with relationship types', () => {
    render(<RelationshipGraphPanel messages={[]} />);

    expect(screen.getByText('Allied')).toBeInTheDocument();
    expect(screen.getByText('Hostile')).toBeInTheDocument();
    expect(screen.getByText('Neutral')).toBeInTheDocument();
  });

  it('calls onPowerClick when a power node is clicked', () => {
    const onPowerClick = vi.fn();
    render(<RelationshipGraphPanel messages={[]} onPowerClick={onPowerClick} />);

    // Click on England node
    fireEvent.click(screen.getByText('ENG'));

    expect(onPowerClick).toHaveBeenCalledWith('england');
  });

  it('shows power info when a power is selected', () => {
    render(<RelationshipGraphPanel messages={[]} selectedPower="england" />);

    expect(screen.getByText('England')).toBeInTheDocument();
    expect(screen.getByText('Messages:')).toBeInTheDocument();
  });

  it('computes relationships from messages', () => {
    const messages: Message[] = [
      createMessage('ENGLAND', 'ENGLAND-FRANCE', 'PROPOSAL'),
      createMessage('FRANCE', 'ENGLAND-FRANCE', 'ACCEPTANCE'),
      createMessage('ENGLAND', 'ENGLAND-FRANCE', 'INFORMATION'),
      createMessage('FRANCE', 'ENGLAND-FRANCE', 'PROPOSAL'),
    ];

    render(<RelationshipGraphPanel messages={messages} selectedPower="england" />);

    // Should show the message count
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('handles case-insensitive channel IDs', () => {
    const messages: Message[] = [
      createMessage('ENGLAND', 'england-france', 'PROPOSAL'),
      createMessage('FRANCE', 'ENGLAND-FRANCE', 'ACCEPTANCE'),
    ];

    render(<RelationshipGraphPanel messages={messages} selectedPower="england" />);

    // Should handle mixed case gracefully
    expect(screen.getByText('England')).toBeInTheDocument();
  });

  it('identifies allies based on positive message intents', () => {
    const messages: Message[] = [
      createMessage('ENGLAND', 'ENGLAND-FRANCE', 'PROPOSAL'),
      createMessage('FRANCE', 'ENGLAND-FRANCE', 'ACCEPTANCE'),
      createMessage('ENGLAND', 'ENGLAND-FRANCE', 'INFORMATION'),
      createMessage('FRANCE', 'ENGLAND-FRANCE', 'PROPOSAL'),
    ];

    render(<RelationshipGraphPanel messages={messages} selectedPower="england" />);

    // The "Allies:" label should be present with France listed
    expect(screen.getByText(/Allies:/)).toBeInTheDocument();
    // Check that FRA appears in the green-colored allies section
    const alliesSection = screen.getByText(/Allies:/).parentElement;
    expect(alliesSection?.textContent).toContain('FRA');
  });

  it('identifies enemies based on negative message intents', () => {
    const messages: Message[] = [
      createMessage('ENGLAND', 'ENGLAND-GERMANY', 'THREAT'),
      createMessage('GERMANY', 'ENGLAND-GERMANY', 'REJECTION'),
    ];

    render(<RelationshipGraphPanel messages={messages} selectedPower="england" />);

    // The "Enemies:" label should be present
    expect(screen.getByText(/Enemies:/)).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <RelationshipGraphPanel messages={[]} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  describe('Analysis Mode', () => {
    it('renders mode toggle buttons', () => {
      render(<RelationshipGraphPanel messages={[]} />);

      expect(screen.getByText('Messages')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByText('Combined')).toBeInTheDocument();
    });

    it('highlights active mode button', () => {
      render(<RelationshipGraphPanel messages={[]} analysisMode="messages" />);

      const messagesButton = screen.getByText('Messages');
      expect(messagesButton).toHaveClass('bg-blue-600');
    });

    it('disables action modes when no game events', () => {
      render(<RelationshipGraphPanel messages={[]} />);

      const actionsButton = screen.getByText('Actions');
      const combinedButton = screen.getByText('Combined');

      expect(actionsButton).toBeDisabled();
      expect(combinedButton).toBeDisabled();
    });

    it('enables action modes when game events are provided', () => {
      const gameEvents: GameEvent[] = [
        {
          id: 'evt-1',
          timestamp: new Date(),
          gameId: 'game-1',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: 'SPRING',
            results: [],
            unitMoves: [],
            dislodged: [],
          },
        } as MovementResolvedEvent,
      ];

      render(<RelationshipGraphPanel messages={[]} gameEvents={gameEvents} />);

      const actionsButton = screen.getByText('Actions');
      const combinedButton = screen.getByText('Combined');

      expect(actionsButton).not.toBeDisabled();
      expect(combinedButton).not.toBeDisabled();
    });

    it('calls onAnalysisModeChange when mode is changed', () => {
      const onModeChange = vi.fn();
      const gameEvents: GameEvent[] = [
        {
          id: 'evt-1',
          timestamp: new Date(),
          gameId: 'game-1',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: 'SPRING',
            results: [],
            unitMoves: [],
            dislodged: [],
          },
        } as MovementResolvedEvent,
      ];

      render(
        <RelationshipGraphPanel
          messages={[]}
          gameEvents={gameEvents}
          analysisMode="messages"
          onAnalysisModeChange={onModeChange}
        />
      );

      fireEvent.click(screen.getByText('Actions'));

      expect(onModeChange).toHaveBeenCalledWith('actions');
    });

    it('shows betrayal legend in actions mode', () => {
      const gameEvents: GameEvent[] = [
        {
          id: 'evt-1',
          timestamp: new Date(),
          gameId: 'game-1',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: 'SPRING',
            results: [],
            unitMoves: [],
            dislodged: [],
          },
        } as MovementResolvedEvent,
      ];

      render(
        <RelationshipGraphPanel
          messages={[]}
          gameEvents={gameEvents}
          analysisMode="actions"
        />
      );

      expect(screen.getByText('Betrayal')).toBeInTheDocument();
    });

    it('does not show betrayal legend in messages mode', () => {
      render(<RelationshipGraphPanel messages={[]} analysisMode="messages" />);

      expect(screen.queryByText('Betrayal')).not.toBeInTheDocument();
    });
  });

  describe('Combined Mode Scoring', () => {
    it('shows score badge for selected power in combined mode', () => {
      const messages: Message[] = [
        createMessage('ENGLAND', 'ENGLAND-FRANCE', 'PROPOSAL'),
        createMessage('FRANCE', 'ENGLAND-FRANCE', 'ACCEPTANCE'),
        createMessage('ENGLAND', 'ENGLAND-FRANCE', 'INFORMATION'),
      ];

      const gameEvents: GameEvent[] = [
        {
          id: 'evt-1',
          timestamp: new Date(),
          gameId: 'game-1',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: 'SPRING',
            results: [],
            unitMoves: [],
            dislodged: [],
          },
        } as MovementResolvedEvent,
      ];

      render(
        <RelationshipGraphPanel
          messages={messages}
          gameEvents={gameEvents}
          analysisMode="combined"
          selectedPower="england"
        />
      );

      // Should show England's info panel
      expect(screen.getByText('England')).toBeInTheDocument();
    });
  });
});
