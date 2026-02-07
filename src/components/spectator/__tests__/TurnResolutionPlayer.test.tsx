import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnResolutionPlayer } from '../TurnResolutionPlayer';
import type {
  ResolutionAnimationState,
  ResolutionAnimationControls,
} from '../../../hooks/useResolutionAnimation';

/**
 * Create a mock ResolutionAnimationState with sensible defaults.
 */
function createMockState(
  overrides: Partial<ResolutionAnimationState> = {}
): ResolutionAnimationState {
  return {
    phase: 'idle',
    visibleOrders: [],
    conflictTerritories: [],
    currentBattle: null,
    unitPositions: new Map(),
    failedOrders: new Map(),
    dislodgedUnits: new Set(),
    progress: 0,
    phaseProgress: 0,
    ...overrides,
  };
}

/**
 * Create mock controls with vi.fn() for each method.
 */
function createMockControls(): ResolutionAnimationControls {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    skip: vi.fn(),
    setSpeed: vi.fn(),
  };
}

describe('TurnResolutionPlayer', () => {
  describe('phase display', () => {
    it('shows "Ready" label when idle', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );
      // "Ready" appears in both the phase label and the segmented progress bar
      expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Showing Orders" during show_orders phase', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Showing Orders')).toBeInTheDocument();
    });

    it('shows "Highlighting Conflicts" during highlight_conflicts phase', () => {
      const state = createMockState({ phase: 'highlight_conflicts', phaseProgress: 30 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Highlighting Conflicts')).toBeInTheDocument();
    });

    it('shows "Resolving Battles" during resolve_battles phase', () => {
      const state = createMockState({ phase: 'resolve_battles', phaseProgress: 60 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Resolving Battles')).toBeInTheDocument();
    });

    it('shows "Moving Units" during animate_moves phase', () => {
      const state = createMockState({ phase: 'animate_moves', phaseProgress: 80 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Moving Units')).toBeInTheDocument();
    });

    it('shows "Failed Orders" during show_failures phase', () => {
      const state = createMockState({ phase: 'show_failures', phaseProgress: 40 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Failed Orders')).toBeInTheDocument();
    });

    it('shows "Dislodged Units" during show_dislodged phase', () => {
      const state = createMockState({ phase: 'show_dislodged', phaseProgress: 70 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );
      expect(screen.getByText('Dislodged Units')).toBeInTheDocument();
    });

    it('shows "Complete" when animation is complete', () => {
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );
      // "Complete" appears in both the phase label and the segmented progress bar
      expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('play/pause button', () => {
    it('calls play when clicked in idle state', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      const playButton = screen.getByTitle('Play');
      fireEvent.click(playButton);
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('calls pause when clicked while playing', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
        />
      );

      const pauseButton = screen.getByTitle('Pause');
      fireEvent.click(pauseButton);
      expect(controls.pause).toHaveBeenCalledTimes(1);
    });

    it('calls play when clicked while paused mid-animation', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'animate_moves', phaseProgress: 30 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      const playButton = screen.getByTitle('Play');
      fireEvent.click(playButton);
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('shows "Replay" title when complete', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      expect(screen.getByTitle('Replay')).toBeInTheDocument();
    });

    it('calls play when clicked in complete state (replay)', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      const replayButton = screen.getByTitle('Replay');
      fireEvent.click(replayButton);
      expect(controls.play).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset button', () => {
    it('calls reset when clicked', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
        />
      );

      const resetButton = screen.getByTitle('Reset');
      fireEvent.click(resetButton);
      expect(controls.reset).toHaveBeenCalledTimes(1);
    });

    it('is disabled when in idle state', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      const resetButton = screen.getByTitle('Reset');
      expect(resetButton).toBeDisabled();
    });

    it('is enabled when not idle', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 20 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      const resetButton = screen.getByTitle('Reset');
      expect(resetButton).not.toBeDisabled();
    });
  });

  describe('skip button', () => {
    it('calls skip when clicked', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
        />
      );

      const skipButton = screen.getByTitle('Skip to End');
      fireEvent.click(skipButton);
      expect(controls.skip).toHaveBeenCalledTimes(1);
    });

    it('is disabled when complete', () => {
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      const skipButton = screen.getByTitle('Skip to End');
      expect(skipButton).toBeDisabled();
    });

    it('is enabled during animation', () => {
      const state = createMockState({ phase: 'animate_moves', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      const skipButton = screen.getByTitle('Skip to End');
      expect(skipButton).not.toBeDisabled();
    });
  });

  describe('speed selector', () => {
    it('renders all three speed options', () => {
      const state = createMockState();
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      expect(screen.getByText('Slow')).toBeInTheDocument();
      expect(screen.getByText('Normal')).toBeInTheDocument();
      expect(screen.getByText('Fast')).toBeInTheDocument();
    });

    it('highlights the current speed', () => {
      const state = createMockState();
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="fast"
          isPlaying={false}
        />
      );

      const fastButton = screen.getByText('Fast');
      expect(fastButton.className).toContain('bg-blue-600');

      const normalButton = screen.getByText('Normal');
      expect(normalButton.className).not.toContain('bg-blue-600');
    });

    it('calls setSpeed when a speed option is clicked', () => {
      const controls = createMockControls();
      const state = createMockState();
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      fireEvent.click(screen.getByText('Slow'));
      expect(controls.setSpeed).toHaveBeenCalledWith('slow');

      fireEvent.click(screen.getByText('Fast'));
      expect(controls.setSpeed).toHaveBeenCalledWith('fast');
    });
  });

  describe('segmented progress bar', () => {
    it('shows "Ready" text when idle', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      // Progress bar area shows "Ready" text
      expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1);
    });

    it('shows phase count during animation', () => {
      const state = createMockState({ phase: 'highlight_conflicts', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      // Phase 2 of 6
      expect(screen.getByText('Phase 2/6')).toBeInTheDocument();
    });

    it('shows "Complete" text when complete', () => {
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      // "Complete" in phase label and progress bar
      expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(2);
    });

    it('shows 100% when complete', () => {
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('shows 0% when idle', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
        />
      );

      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('shows intermediate percentage during animation', () => {
      // Phase 3 (resolve_battles) at 50% phaseProgress
      // Overall: ((2 + 0.5) / 6) * 100 = 42%
      const state = createMockState({ phase: 'resolve_battles', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      expect(screen.getByText('42%')).toBeInTheDocument();
    });
  });

  describe('battle indicator', () => {
    it('shows battle info during resolve_battles phase', () => {
      const state = createMockState({
        phase: 'resolve_battles',
        phaseProgress: 50,
        currentBattle: { territory: 'north_sea', winner: undefined },
      });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      expect(screen.getByText('Battle at')).toBeInTheDocument();
      expect(screen.getByText('north sea')).toBeInTheDocument();
    });

    it('shows winner when battle is resolved', () => {
      const state = createMockState({
        phase: 'resolve_battles',
        phaseProgress: 80,
        currentBattle: { territory: 'burgundy', winner: 'FRANCE' as any },
      });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      expect(screen.getByText('burgundy')).toBeInTheDocument();
      expect(screen.getByText(/FRANCE/)).toBeInTheDocument();
    });

    it('does not show battle indicator when not in resolve_battles phase', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      expect(screen.queryByText('Battle at')).not.toBeInTheDocument();
    });

    it('does not show battle indicator when currentBattle is null', () => {
      const state = createMockState({
        phase: 'resolve_battles',
        phaseProgress: 10,
        currentBattle: null,
      });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
        />
      );

      expect(screen.queryByText('Battle at')).not.toBeInTheDocument();
    });
  });

  describe('keyboard shortcuts', () => {
    it('Space key calls play when idle', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      fireEvent.keyDown(window, { code: 'Space' });
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('Space key calls pause when playing', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
        />
      );

      fireEvent.keyDown(window, { code: 'Space' });
      expect(controls.pause).toHaveBeenCalledTimes(1);
    });

    it('Space key calls play when paused mid-animation', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'animate_moves', phaseProgress: 30 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      fireEvent.keyDown(window, { code: 'Space' });
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('Space key calls play when complete (replay)', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      fireEvent.keyDown(window, { code: 'Space' });
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('ArrowRight key calls skip during animation', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 20 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
        />
      );

      fireEvent.keyDown(window, { code: 'ArrowRight' });
      expect(controls.skip).toHaveBeenCalledTimes(1);
    });

    it('ArrowRight key does not call skip when complete', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'complete', progress: 100 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      fireEvent.keyDown(window, { code: 'ArrowRight' });
      expect(controls.skip).not.toHaveBeenCalled();
    });

    it('ignores keyboard events when typing in an input', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      const { container } = render(
        <div>
          <TurnResolutionPlayer
            state={state}
            controls={controls}
            speed="normal"
            isPlaying={true}
          />
          <input data-testid="text-input" />
        </div>
      );

      const input = screen.getByTestId('text-input');
      fireEvent.keyDown(input, { code: 'Space' });
      expect(controls.pause).not.toHaveBeenCalled();
    });

    it('cleans up keyboard listener on unmount', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'idle' });
      const { unmount } = render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
        />
      );

      unmount();

      fireEvent.keyDown(window, { code: 'Space' });
      expect(controls.play).not.toHaveBeenCalled();
    });
  });

  describe('compact mode', () => {
    it('renders compact layout with play/pause button', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
          compact={true}
        />
      );

      // Compact mode has Play/Pause button with "Play Resolution" title
      expect(screen.getByTitle('Play Resolution')).toBeInTheDocument();
    });

    it('renders compact layout with reset button', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
          compact={true}
        />
      );

      expect(screen.getByTitle('Reset')).toBeInTheDocument();
    });

    it('does not render speed selector in compact mode', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
          compact={true}
        />
      );

      expect(screen.queryByText('Slow')).not.toBeInTheDocument();
      expect(screen.queryByText('Normal')).not.toBeInTheDocument();
      expect(screen.queryByText('Fast')).not.toBeInTheDocument();
    });

    it('does not render skip button in compact mode', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
          compact={true}
        />
      );

      expect(screen.queryByTitle('Skip to End')).not.toBeInTheDocument();
    });

    it('shows progress bar in compact mode', () => {
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50, progress: 25 });
      const { container } = render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={true}
          compact={true}
        />
      );

      // Progress bar has inline style width
      const progressBar = container.querySelector('[style*="width"]');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar?.getAttribute('style')).toContain('25%');
    });

    it('compact play button calls play on click', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={false}
          compact={true}
        />
      );

      fireEvent.click(screen.getByTitle('Play Resolution'));
      expect(controls.play).toHaveBeenCalledTimes(1);
    });

    it('compact pause button shows when playing', () => {
      const controls = createMockControls();
      const state = createMockState({ phase: 'show_orders', phaseProgress: 50 });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={controls}
          speed="normal"
          isPlaying={true}
          compact={true}
        />
      );

      expect(screen.getByTitle('Pause')).toBeInTheDocument();
      fireEvent.click(screen.getByTitle('Pause'));
      expect(controls.pause).toHaveBeenCalledTimes(1);
    });

    it('compact reset button is disabled when idle', () => {
      const state = createMockState({ phase: 'idle' });
      render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
          compact={true}
        />
      );

      expect(screen.getByTitle('Reset')).toBeDisabled();
    });
  });

  describe('className prop', () => {
    it('applies custom className in normal mode', () => {
      const state = createMockState();
      const { container } = render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
          className="my-custom-class"
        />
      );

      expect(container.firstChild).toHaveClass('my-custom-class');
    });

    it('applies custom className in compact mode', () => {
      const state = createMockState();
      const { container } = render(
        <TurnResolutionPlayer
          state={state}
          controls={createMockControls()}
          speed="normal"
          isPlaying={false}
          compact={true}
          className="compact-custom"
        />
      );

      expect(container.firstChild).toHaveClass('compact-custom');
    });
  });
});
