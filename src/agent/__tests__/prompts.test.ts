import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildTurnPrompt,
  buildDiplomacyPrompt,
  buildMemoryUpdatePrompt,
} from '../prompts';
import type { AgentPersonality, AgentMemory, AgentGameView } from '../types';
import { DEFAULT_PERSONALITY } from '../types';
import type { Power, Phase } from '../../engine/types';

// ---------------------------------------------------------------------------
// Helpers to create minimal mock objects
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    power: 'FRANCE' as Power,
    gameId: 'test-game',
    lastUpdated: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
    trustLevels: new Map<Power, number>([
      ['ENGLAND', 0.5],
      ['GERMANY', -0.2],
      ['ITALY', 0],
      ['AUSTRIA', 0],
      ['RUSSIA', 0],
      ['TURKEY', 0],
    ]),
    relationships: new Map(),
    events: [],
    activeCommitments: [],
    strategicNotes: [],
    strategicGoals: ['Expand east into Burgundy'],
    territoryPriorities: ['BUR', 'BEL'],
    currentAllies: [],
    currentEnemies: [],
    turnSummaries: [],
    fullPrivateDiary: [],
    yearSummaries: [],
    currentYearDiary: [],
    ...overrides,
  } as AgentMemory;
}

function makeGameView(overrides: Partial<AgentGameView> = {}): AgentGameView {
  return {
    viewingPower: 'FRANCE' as Power,
    year: 1901,
    season: 'SPRING',
    phase: 'MOVEMENT' as Phase,
    myUnits: [
      { type: 'ARMY', province: 'PAR', adjacentProvinces: ['BUR', 'PIC', 'GAS'] },
      { type: 'FLEET', province: 'BRE', adjacentProvinces: ['ENG', 'MAO', 'PIC', 'GAS'] },
      { type: 'ARMY', province: 'MAR', adjacentProvinces: ['BUR', 'GAS', 'PIE', 'SPA'] },
    ],
    otherUnits: new Map([
      ['ENGLAND' as Power, [
        { type: 'FLEET' as const, province: 'LON' },
        { type: 'FLEET' as const, province: 'EDI' },
        { type: 'ARMY' as const, province: 'LVP' },
      ]],
      ['GERMANY' as Power, [
        { type: 'ARMY' as const, province: 'BER' },
        { type: 'ARMY' as const, province: 'MUN' },
        { type: 'FLEET' as const, province: 'KIE' },
      ]],
    ]),
    supplyCenters: new Map([
      ['FRANCE' as Power, ['PAR', 'BRE', 'MAR']],
      ['ENGLAND' as Power, ['LON', 'EDI', 'LVP']],
      ['GERMANY' as Power, ['BER', 'MUN', 'KIE']],
    ]),
    supplyCenterCounts: new Map([
      ['FRANCE' as Power, 3],
      ['ENGLAND' as Power, 3],
      ['GERMANY' as Power, 3],
    ]),
    unitCounts: new Map([
      ['FRANCE' as Power, 3],
      ['ENGLAND' as Power, 3],
      ['GERMANY' as Power, 3],
    ]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------
describe('buildSystemPrompt', () => {
  it('should include the power name', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY);
    expect(prompt).toContain('FRANCE');
    expect(prompt).toContain('Diplomacy');
  });

  it('should include personality description for high cooperativeness', () => {
    const personality: AgentPersonality = {
      ...DEFAULT_PERSONALITY,
      cooperativeness: 0.9,
    };
    const prompt = buildSystemPrompt('ENGLAND', personality);
    expect(prompt).toContain('alliances');
  });

  it('should include personality description for high aggression', () => {
    const personality: AgentPersonality = {
      ...DEFAULT_PERSONALITY,
      aggression: 0.9,
    };
    const prompt = buildSystemPrompt('GERMANY', personality);
    expect(prompt).toContain('aggressive');
  });

  it('should include personality description for low patience', () => {
    const personality: AgentPersonality = {
      ...DEFAULT_PERSONALITY,
      patience: 0.1,
    };
    const prompt = buildSystemPrompt('ITALY', personality);
    expect(prompt).toContain('immediate gains');
  });

  it('should produce balanced description for default personality', () => {
    // Default personality has mid-range values (0.3-0.7) for most traits
    // and 0.7 trustworthiness, 0.3 paranoia/deceptiveness
    const prompt = buildSystemPrompt('AUSTRIA', DEFAULT_PERSONALITY);
    // Should contain trustworthiness trait (0.7 >= 0.7)
    expect(prompt).toContain('commitments');
    // Should contain paranoia trait (0.3 <= 0.3)
    expect(prompt).toContain('trust others');
    // Should contain deceptiveness trait (0.3 <= 0.3)
    expect(prompt).toContain('honest diplomacy');
  });

  it('should work for all 7 powers', () => {
    const powers: Power[] = [
      'ENGLAND',
      'FRANCE',
      'GERMANY',
      'ITALY',
      'AUSTRIA',
      'RUSSIA',
      'TURKEY',
    ];
    for (const power of powers) {
      const prompt = buildSystemPrompt(power, DEFAULT_PERSONALITY);
      expect(prompt).toContain(power);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it('should include order format instructions', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY);
    // Should contain order format guidance (MOVE, HOLD, SUPPORT, CONVOY)
    expect(prompt.toLowerCase()).toContain('hold');
    expect(prompt.toLowerCase()).toContain('support');
  });

  it('should include game rules', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY);
    // Should reference supply centers and victory
    expect(prompt.toLowerCase()).toMatch(/supply center|victory|18/);
  });

  it('should include strategy concepts', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY);
    // Should include strategic guidance
    expect(prompt.toLowerCase()).toMatch(/alliance|stab|negotiat/);
  });
});

// ---------------------------------------------------------------------------
// buildTurnPrompt
// ---------------------------------------------------------------------------
describe('buildTurnPrompt', () => {
  it('should include current game state', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Current Game State');
    expect(prompt).toContain('1901');
    expect(prompt).toContain('SPRING');
  });

  it('should list your units', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('A PAR');
    expect(prompt).toContain('F BRE');
    expect(prompt).toContain('A MAR');
  });

  it('should include supply center information', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Supply Centers');
    expect(prompt).toContain('PAR');
    expect(prompt).toContain('BRE');
    expect(prompt).toContain('MAR');
  });

  it('should include other powers information', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('ENGLAND');
    expect(prompt).toContain('GERMANY');
  });

  it('should include relationships section', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Relationships');
  });

  it('should include recent diplomatic messages when provided', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const messages = [
      'FROM ENGLAND: "Let us form an alliance"',
      'FROM GERMANY: "Stay out of Burgundy"',
    ];
    const prompt = buildTurnPrompt(view, memory, messages, 'MOVEMENT');

    expect(prompt).toContain('Diplomatic Messages');
    expect(prompt).toContain('Let us form an alliance');
    expect(prompt).toContain('Stay out of Burgundy');
  });

  it('should not include messages section when empty', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).not.toContain('Recent Diplomatic Messages');
  });

  it('should include phase-specific MOVEMENT instructions', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Submit Orders');
    expect(prompt).toContain('ORDERS:');
    expect(prompt).toContain('18 supply centers');
  });

  it('should include DIPLOMACY phase instructions', () => {
    const view = makeGameView({ phase: 'DIPLOMACY' });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'DIPLOMACY');

    expect(prompt).toContain('Diplomacy Phase');
    expect(prompt).toContain('SEND');
    expect(prompt).toContain('OPENING');
    expect(prompt).toContain('COUNTER');
    expect(prompt).toContain('FINAL');
  });

  it('should include RETREAT phase instructions', () => {
    const view = makeGameView({
      phase: 'RETREAT',
      pendingRetreats: [
        {
          unit: { type: 'ARMY', province: 'BUR' },
          retreatOptions: ['PAR', 'GAS'],
          dislodgedFrom: 'MUN',
        },
      ],
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'RETREAT');

    expect(prompt).toContain('Submit Retreats');
    expect(prompt).toContain('DISBAND');
  });

  it('should include BUILD phase instructions with positive build count', () => {
    const view = makeGameView({
      phase: 'BUILD',
      buildCount: 2,
      availableBuildLocations: ['PAR', 'BRE'],
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'BUILD');

    expect(prompt).toContain('Build Units');
    expect(prompt).toContain('2');
  });

  it('should include DISBAND phase instructions with negative build count', () => {
    const view = makeGameView({
      phase: 'BUILD',
      buildCount: -1,
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'BUILD');

    expect(prompt).toContain('Disband');
    expect(prompt).toContain('1');
  });

  it('should include unit adjacent provinces in MOVEMENT', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    // Adjacent provinces from our mock
    expect(prompt).toContain('BUR');
    expect(prompt).toContain('PIC');
    expect(prompt).toContain('GAS');
  });

  it('should show recent events when present', () => {
    const memory = makeMemory({
      events: [
        {
          year: 1901,
          season: 'SPRING',
          type: 'BETRAYAL',
          powers: ['GERMANY'],
          description: 'GERMANY attacked Burgundy despite alliance',
          impactOnTrust: -0.3,
        },
      ],
    });
    const view = makeGameView();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Recent Events');
    expect(prompt).toContain('GERMANY attacked Burgundy');
  });

  it('should show high priority strategic notes', () => {
    const memory = makeMemory({
      strategicNotes: [
        {
          id: 'note-1',
          year: 1901,
          season: 'SPRING',
          subject: 'German threat',
          content: 'Germany is massing forces near Burgundy',
          priority: 'HIGH',
        },
      ],
    });
    const view = makeGameView();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Strategic Notes');
    expect(prompt).toContain('Germany is massing forces near Burgundy');
  });

  it('should display pending retreats in game state', () => {
    const view = makeGameView({
      pendingRetreats: [
        {
          unit: { type: 'ARMY', province: 'BUR' },
          retreatOptions: ['PAR', 'GAS'],
          dislodgedFrom: 'MUN',
        },
      ],
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'RETREAT');

    expect(prompt).toContain('Requiring Retreat');
    expect(prompt).toContain('A BUR');
    expect(prompt).toContain('MUN');
    expect(prompt).toContain('PAR, GAS');
  });

  it('should show MUST DISBAND for retreat with no options', () => {
    const view = makeGameView({
      pendingRetreats: [
        {
          unit: { type: 'FLEET', province: 'NTH' },
          retreatOptions: [],
          dislodgedFrom: 'NWG',
        },
      ],
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'RETREAT');

    expect(prompt).toContain('MUST DISBAND');
  });

  it('should show last order results when available', () => {
    const view = makeGameView({
      lastOrderResults: [
        { order: 'A PAR -> BUR', success: true },
        { order: 'F BRE -> ENG', success: false, reason: 'Bounced' },
      ],
    });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    expect(prompt).toContain('Last Turn Results');
    expect(prompt).toMatch(/✓.*A PAR -> BUR/);
    expect(prompt).toMatch(/✗.*F BRE -> ENG.*Bounced/);
  });
});

// ---------------------------------------------------------------------------
// buildDiplomacyPrompt
// ---------------------------------------------------------------------------
describe('buildDiplomacyPrompt', () => {
  it('should include target power name', () => {
    const memory = makeMemory();
    const prompt = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memory, 'Discuss Channel');

    expect(prompt).toContain('ENGLAND');
  });

  it('should include trust level with label', () => {
    const memory = makeMemory({
      trustLevels: new Map([['ENGLAND' as Power, 0.5]]),
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memory, 'test');

    expect(prompt).toContain('0.50');
    expect(prompt).toContain('Moderate Trust');
  });

  it('should show Neutral for zero trust', () => {
    const memory = makeMemory({
      trustLevels: new Map([['GERMANY' as Power, 0]]),
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'GERMANY', memory, 'test');

    expect(prompt).toContain('Neutral');
  });

  it('should show Distrust for negative trust', () => {
    const memory = makeMemory({
      trustLevels: new Map([['GERMANY' as Power, -0.5]]),
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'GERMANY', memory, 'test');

    expect(prompt).toContain('Distrust');
  });

  it('should show Strong Distrust for very negative trust', () => {
    const memory = makeMemory({
      trustLevels: new Map([['GERMANY' as Power, -0.8]]),
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'GERMANY', memory, 'test');

    expect(prompt).toContain('Strong Distrust');
  });

  it('should show Strong Trust for high trust', () => {
    const memory = makeMemory({
      trustLevels: new Map([['ENGLAND' as Power, 0.9]]),
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memory, 'test');

    expect(prompt).toContain('Strong Trust');
  });

  it('should include the provided context', () => {
    const memory = makeMemory();
    const prompt = buildDiplomacyPrompt(
      'FRANCE',
      'ENGLAND',
      memory,
      'We need to discuss the Channel situation'
    );

    expect(prompt).toContain('We need to discuss the Channel situation');
  });

  it('should show NEUTRAL status for no relationship', () => {
    const memory = makeMemory();
    // No relationships set
    const prompt = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memory, 'test');

    expect(prompt).toContain('NEUTRAL');
  });

  it('should handle missing trust level gracefully', () => {
    const memory = makeMemory({
      trustLevels: new Map(), // empty
    });
    const prompt = buildDiplomacyPrompt('FRANCE', 'TURKEY', memory, 'test');

    // Should use default 0 trust → Neutral
    expect(prompt).toContain('Neutral');
  });
});

// ---------------------------------------------------------------------------
// buildMemoryUpdatePrompt
// ---------------------------------------------------------------------------
describe('buildMemoryUpdatePrompt', () => {
  it('should include turn events', () => {
    const prompt = buildMemoryUpdatePrompt(
      'FRANCE',
      'Germany attacked Burgundy. England moved to Channel.',
      'A PAR -> BUR: Success. F BRE -> ENG: Failed (bounced).'
    );

    expect(prompt).toContain('Germany attacked Burgundy');
    expect(prompt).toContain('England moved to Channel');
  });

  it('should include order results', () => {
    const prompt = buildMemoryUpdatePrompt(
      'FRANCE',
      'Events here',
      'A PAR -> BUR: Success.'
    );

    expect(prompt).toContain('A PAR -> BUR: Success');
  });

  it('should include memory update format sections', () => {
    const prompt = buildMemoryUpdatePrompt('FRANCE', 'events', 'results');

    expect(prompt).toContain('TRUST_UPDATES');
    expect(prompt).toContain('EVENTS');
    expect(prompt).toContain('STRATEGIC_NOTES');
    expect(prompt).toContain('COMMITMENTS');
  });

  it('should include fulfilled and broken commitment labels', () => {
    const prompt = buildMemoryUpdatePrompt('FRANCE', 'events', 'results');

    expect(prompt).toContain('FULFILLED');
    expect(prompt).toContain('BROKEN');
  });

  it('should include Update Your Memory header', () => {
    const prompt = buildMemoryUpdatePrompt('FRANCE', 'events', 'results');
    expect(prompt).toContain('Update Your Memory');
  });
});
