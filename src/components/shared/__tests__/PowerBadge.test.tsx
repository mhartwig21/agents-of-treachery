import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PowerBadge, PowerBadgeRow, PowerStat } from '../PowerBadge';
import { POWER_COLORS } from '../../../spectator/types';

describe('PowerBadge', () => {
  it('renders a colored badge for a power', () => {
    render(<PowerBadge power="england" />);
    const badge = screen.getByTitle('England');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ backgroundColor: POWER_COLORS.england });
  });

  it('displays full label when showLabel is true', () => {
    render(<PowerBadge power="france" showLabel />);
    expect(screen.getByText('France')).toBeInTheDocument();
  });

  it('displays abbreviation when showAbbrev is true', () => {
    render(<PowerBadge power="germany" showAbbrev />);
    expect(screen.getByText('GER')).toBeInTheDocument();
  });

  it('prefers label over abbreviation when both are true', () => {
    render(<PowerBadge power="italy" showLabel showAbbrev />);
    expect(screen.getByText('Italy')).toBeInTheDocument();
    expect(screen.queryByText('ITA')).not.toBeInTheDocument();
  });

  it('applies size classes correctly', () => {
    const { container: sm } = render(<PowerBadge power="austria" size="sm" />);
    const { container: lg } = render(<PowerBadge power="russia" size="lg" />);

    expect(sm.querySelector('span > span')).toHaveClass('w-3', 'h-3');
    expect(lg.querySelector('span > span')).toHaveClass('w-6', 'h-6');
  });

  it('applies custom className', () => {
    render(<PowerBadge power="turkey" className="custom-class" />);
    expect(screen.getByTitle('Turkey').parentElement).toHaveClass('custom-class');
  });
});

describe('PowerBadgeRow', () => {
  it('renders badges for all seven powers', () => {
    render(<PowerBadgeRow />);

    const powers = ['England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];
    for (const power of powers) {
      expect(screen.getByTitle(power)).toBeInTheDocument();
    }
  });

  it('passes size to all badges', () => {
    const { container } = render(<PowerBadgeRow size="lg" />);
    const badges = container.querySelectorAll('span > span > span');
    badges.forEach((badge) => {
      expect(badge).toHaveClass('w-6', 'h-6');
    });
  });
});

describe('PowerStat', () => {
  it('renders power badge with count', () => {
    render(<PowerStat power="england" count={5} />);
    expect(screen.getByTitle('England')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders optional label', () => {
    render(<PowerStat power="france" count={3} label="SCs" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('SCs')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    render(<PowerStat power="germany" count={4} />);
    expect(screen.queryByText('SCs')).not.toBeInTheDocument();
  });
});
