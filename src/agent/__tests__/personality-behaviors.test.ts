/**
 * Tests for personality-driven behavior differentiation (aot-2aq2u.3).
 *
 * Verifies that different personality configurations (high aggression vs low,
 * high trust vs low, etc.) produce measurably different prompt content that
 * would influence order patterns, diplomatic messages, alliance formation,
 * and message tone.
 *
 * Since LLM inference cannot be run in unit tests, we test the prompt
 * generation pipeline: personality traits → natural language descriptions →
 * system/turn prompts. Different personalities must produce distinct prompts
 * that would drive different agent behaviors.
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildTurnPrompt, buildDiplomacyPrompt } from '../prompts';
import { POWER_PERSONALITIES, POWER_PERSONALITY_PROMPTS, getPowerPersonality } from '../personalities';
import { createInitialMemory } from '../memory';
import type { AgentPersonality, AgentGameView, AgentMemory } from '../types';
import { DEFAULT_PERSONALITY } from '../types';
import type { Power, Phase } from '../../engine/types';
import { POWERS } from '../../engine/types';

// ---------------------------------------------------------------------------
// Test personality configurations — extreme opposites for each trait
// ---------------------------------------------------------------------------

/** Maximally aggressive personality */
const AGGRESSIVE: AgentPersonality = {
  cooperativeness: 0.1,
  aggression: 1.0,
  patience: 0.1,
  trustworthiness: 0.2,
  paranoia: 0.9,
  deceptiveness: 0.8,
};

/** Maximally peaceful/cooperative personality */
const PEACEFUL: AgentPersonality = {
  cooperativeness: 1.0,
  aggression: 0.0,
  patience: 1.0,
  trustworthiness: 1.0,
  paranoia: 0.0,
  deceptiveness: 0.0,
};

/** High aggression, low everything else */
const HIGH_AGGRESSION: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.9,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** Low aggression */
const LOW_AGGRESSION: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.1,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** High trust personality */
const HIGH_TRUST: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.9,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** Low trust personality */
const LOW_TRUST: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.1,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** High cooperativeness */
const HIGH_COOP: AgentPersonality = {
  cooperativeness: 0.9,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** Low cooperativeness */
const LOW_COOP: AgentPersonality = {
  cooperativeness: 0.1,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** High paranoia */
const HIGH_PARANOIA: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.9,
  deceptiveness: 0.5,
};

/** Low paranoia */
const LOW_PARANOIA: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.1,
  deceptiveness: 0.5,
};

/** High deceptiveness */
const HIGH_DECEPTION: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.9,
};

/** Low deceptiveness */
const LOW_DECEPTION: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.1,
};

/** High patience */
const HIGH_PATIENCE: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.9,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

/** Low patience */
const LOW_PATIENCE: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.1,
  trustworthiness: 0.5,
  paranoia: 0.5,
  deceptiveness: 0.5,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGameView(overrides: Partial<AgentGameView> = {}): AgentGameView {
  return {
    viewingPower: 'ENGLAND' as Power,
    year: 1901,
    season: 'SPRING',
    phase: 'MOVEMENT' as Phase,
    myUnits: [
      { type: 'FLEET', province: 'LON', adjacentProvinces: ['ENG', 'NTH', 'WAL'] },
      { type: 'FLEET', province: 'EDI', adjacentProvinces: ['NTH', 'NWG', 'YOR', 'CLY'] },
      { type: 'ARMY', province: 'LVP', adjacentProvinces: ['WAL', 'YOR', 'CLY', 'EDI'] },
    ],
    otherUnits: new Map([
      ['FRANCE' as Power, [
        { type: 'ARMY' as const, province: 'PAR' },
        { type: 'FLEET' as const, province: 'BRE' },
        { type: 'ARMY' as const, province: 'MAR' },
      ]],
      ['GERMANY' as Power, [
        { type: 'ARMY' as const, province: 'BER' },
        { type: 'ARMY' as const, province: 'MUN' },
        { type: 'FLEET' as const, province: 'KIE' },
      ]],
    ]),
    supplyCenters: new Map([
      ['ENGLAND' as Power, ['LON', 'EDI', 'LVP']],
      ['FRANCE' as Power, ['PAR', 'BRE', 'MAR']],
      ['GERMANY' as Power, ['BER', 'MUN', 'KIE']],
    ]),
    supplyCenterCounts: new Map([
      ['ENGLAND' as Power, 3],
      ['FRANCE' as Power, 3],
      ['GERMANY' as Power, 3],
    ]),
    unitCounts: new Map([
      ['ENGLAND' as Power, 3],
      ['FRANCE' as Power, 3],
      ['GERMANY' as Power, 3],
    ]),
    ...overrides,
  };
}

function makeMemory(power: Power = 'ENGLAND'): AgentMemory {
  return createInitialMemory(power, 'test-game');
}

// ---------------------------------------------------------------------------
// 1. Aggression trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Aggression trait differentiation', () => {
  it('high aggression prompt contains aggressive strategy language', () => {
    const prompt = buildSystemPrompt('ENGLAND', HIGH_AGGRESSION);
    expect(prompt).toContain('aggressive');
    expect(prompt).toContain('attacking');
  });

  it('low aggression prompt contains defensive strategy language', () => {
    const prompt = buildSystemPrompt('ENGLAND', LOW_AGGRESSION);
    expect(prompt).toContain('defensive');
    expect(prompt).toContain('cautious');
  });

  it('high and low aggression prompts are measurably different', () => {
    const highPrompt = buildSystemPrompt('ENGLAND', HIGH_AGGRESSION);
    const lowPrompt = buildSystemPrompt('ENGLAND', LOW_AGGRESSION);

    // Prompts must differ in personality section
    expect(highPrompt).not.toEqual(lowPrompt);

    // High aggression should NOT contain defensive language
    expect(highPrompt).not.toContain('defensive, cautious');
    // Low aggression should NOT contain aggressive language
    expect(lowPrompt).not.toContain('aggressive, attacking');
  });

  it('aggression trait is absent from balanced personality', () => {
    // Balanced aggression (0.5) should not trigger either extreme description
    const balanced: AgentPersonality = { ...DEFAULT_PERSONALITY, aggression: 0.5 };
    const prompt = buildSystemPrompt('ENGLAND', balanced);
    expect(prompt).not.toContain('aggressive, attacking');
    expect(prompt).not.toContain('defensive, cautious');
  });
});

// ---------------------------------------------------------------------------
// 2. Trustworthiness trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Trustworthiness trait differentiation', () => {
  it('high trustworthiness prompt emphasizes reliability', () => {
    const prompt = buildSystemPrompt('FRANCE', HIGH_TRUST);
    expect(prompt).toContain('commitments');
    expect(prompt).toContain('reliability');
  });

  it('low trustworthiness prompt emphasizes promise-breaking', () => {
    const prompt = buildSystemPrompt('FRANCE', LOW_TRUST);
    expect(prompt).toContain('break promises');
    expect(prompt).toContain('tactical');
  });

  it('high and low trust prompts are different', () => {
    const highPrompt = buildSystemPrompt('FRANCE', HIGH_TRUST);
    const lowPrompt = buildSystemPrompt('FRANCE', LOW_TRUST);
    expect(highPrompt).not.toEqual(lowPrompt);
  });
});

// ---------------------------------------------------------------------------
// 3. Cooperativeness trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Cooperativeness trait differentiation', () => {
  it('high cooperativeness prompt values alliances', () => {
    const prompt = buildSystemPrompt('GERMANY', HIGH_COOP);
    expect(prompt).toContain('alliances');
    expect(prompt).toContain('cooperative');
  });

  it('low cooperativeness prompt is skeptical of alliances', () => {
    const prompt = buildSystemPrompt('GERMANY', LOW_COOP);
    expect(prompt).toContain('work alone');
    expect(prompt).toContain('skeptical');
  });

  it('cooperative vs solo prompts are different', () => {
    const highPrompt = buildSystemPrompt('GERMANY', HIGH_COOP);
    const lowPrompt = buildSystemPrompt('GERMANY', LOW_COOP);
    expect(highPrompt).not.toEqual(lowPrompt);
  });
});

// ---------------------------------------------------------------------------
// 4. Paranoia trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Paranoia trait differentiation', () => {
  it('high paranoia prompt expects betrayal', () => {
    const prompt = buildSystemPrompt('TURKEY', HIGH_PARANOIA);
    expect(prompt).toContain('suspicious');
    expect(prompt).toContain('expect betrayal');
  });

  it('low paranoia prompt trusts others', () => {
    const prompt = buildSystemPrompt('TURKEY', LOW_PARANOIA);
    expect(prompt).toContain('trust others');
  });

  it('paranoid vs trusting prompts differ', () => {
    const highPrompt = buildSystemPrompt('TURKEY', HIGH_PARANOIA);
    const lowPrompt = buildSystemPrompt('TURKEY', LOW_PARANOIA);
    expect(highPrompt).not.toEqual(lowPrompt);
  });
});

// ---------------------------------------------------------------------------
// 5. Deceptiveness trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Deceptiveness trait differentiation', () => {
  it('high deceptiveness prompt uses misdirection', () => {
    const prompt = buildSystemPrompt('ITALY', HIGH_DECEPTION);
    expect(prompt).toContain('deception');
    expect(prompt).toContain('misdirection');
  });

  it('low deceptiveness prompt is honest', () => {
    const prompt = buildSystemPrompt('ITALY', LOW_DECEPTION);
    expect(prompt).toContain('honest diplomacy');
    expect(prompt).toContain('straightforward');
  });

  it('deceptive vs honest prompts differ', () => {
    const highPrompt = buildSystemPrompt('ITALY', HIGH_DECEPTION);
    const lowPrompt = buildSystemPrompt('ITALY', LOW_DECEPTION);
    expect(highPrompt).not.toEqual(lowPrompt);
  });
});

// ---------------------------------------------------------------------------
// 6. Patience trait produces distinct prompt content
// ---------------------------------------------------------------------------
describe('Patience trait differentiation', () => {
  it('high patience prompt values long-term play', () => {
    const prompt = buildSystemPrompt('RUSSIA', HIGH_PATIENCE);
    expect(prompt).toContain('long-term');
    expect(prompt).toContain('sacrifice short-term');
  });

  it('low patience prompt wants immediate gains', () => {
    const prompt = buildSystemPrompt('RUSSIA', LOW_PATIENCE);
    expect(prompt).toContain('immediate gains');
  });

  it('patient vs impatient prompts differ', () => {
    const highPrompt = buildSystemPrompt('RUSSIA', HIGH_PATIENCE);
    const lowPrompt = buildSystemPrompt('RUSSIA', LOW_PATIENCE);
    expect(highPrompt).not.toEqual(lowPrompt);
  });
});

// ---------------------------------------------------------------------------
// 7. Extreme opposite personalities produce maximally different prompts
// ---------------------------------------------------------------------------
describe('Extreme personality contrast', () => {
  it('AGGRESSIVE vs PEACEFUL personalities produce substantially different prompts', () => {
    const aggressivePrompt = buildSystemPrompt('ENGLAND', AGGRESSIVE);
    const peacefulPrompt = buildSystemPrompt('ENGLAND', PEACEFUL);

    // Both should still contain the power name and game rules
    expect(aggressivePrompt).toContain('ENGLAND');
    expect(peacefulPrompt).toContain('ENGLAND');
    expect(aggressivePrompt).toContain('Diplomacy');
    expect(peacefulPrompt).toContain('Diplomacy');

    // But personality sections should be completely different
    expect(aggressivePrompt).not.toEqual(peacefulPrompt);

    // Aggressive should have: aggressive, suspicious, deception, break promises
    expect(aggressivePrompt).toContain('aggressive');
    expect(aggressivePrompt).toContain('suspicious');
    expect(aggressivePrompt).toContain('deception');
    expect(aggressivePrompt).toContain('break promises');
    expect(aggressivePrompt).toContain('immediate gains');
    expect(aggressivePrompt).toContain('work alone');

    // Peaceful should have: cooperative, defensive, honest, trust, long-term
    expect(peacefulPrompt).toContain('alliances');
    expect(peacefulPrompt).toContain('defensive');
    expect(peacefulPrompt).toContain('honest diplomacy');
    expect(peacefulPrompt).toContain('trust others');
    expect(peacefulPrompt).toContain('long-term');
    expect(peacefulPrompt).toContain('commitments');
  });

  it('AGGRESSIVE personality has more trait descriptions than balanced', () => {
    const aggressivePrompt = buildSystemPrompt('FRANCE', AGGRESSIVE);
    const defaultPrompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY);

    // AGGRESSIVE has all 6 traits at extremes, so all 6 descriptions appear.
    // DEFAULT_PERSONALITY has trustworthiness=0.7, paranoia=0.3, deceptiveness=0.3
    // (3 traits at thresholds), so only 3 descriptions appear.
    // The aggressive prompt's personality section should be longer.
    const aggressiveTraitCount = countTraitDescriptions(aggressivePrompt);
    const defaultTraitCount = countTraitDescriptions(defaultPrompt);

    expect(aggressiveTraitCount).toBeGreaterThan(defaultTraitCount);
  });
});

/**
 * Count distinct personality traits described in a prompt.
 * Each trait (cooperativeness, aggression, etc.) can contribute at most 1
 * to the count — either its high or low description.
 * Uses unique phrases from describePersonality() that don't overlap.
 */
function countTraitDescriptions(prompt: string): number {
  // Each pair is [highPhrase, lowPhrase] for one trait dimension.
  // We count 1 per dimension if either extreme phrase is present.
  const traitPairs: [string, string][] = [
    ['alliances highly', 'work alone'],                          // cooperativeness
    ['aggressive, attacking', 'defensive, cautious'],            // aggression
    ['sacrifice short-term', 'immediate gains'],                 // patience
    ['honor your commitments', 'break promises'],                // trustworthiness
    ['highly suspicious', 'trust others'],                       // paranoia
    ['deception and misdirection', 'honest diplomacy'],          // deceptiveness
  ];
  return traitPairs.filter(([high, low]) =>
    prompt.includes(high) || prompt.includes(low)
  ).length;
}

// ---------------------------------------------------------------------------
// 8. Power-specific personality prompts produce distinct diplomatic voices
// ---------------------------------------------------------------------------
describe('Power personality prompts produce distinct diplomatic voices', () => {
  it('each power has a unique personality prompt', () => {
    const prompts = POWERS.map(p => POWER_PERSONALITY_PROMPTS[p]);
    // All prompts should be different from each other
    for (let i = 0; i < prompts.length; i++) {
      for (let j = i + 1; j < prompts.length; j++) {
        expect(prompts[i]).not.toEqual(prompts[j]);
      }
    }
  });

  it('England uses formal/indirect tone while Germany uses direct tone', () => {
    const englandPrompt = POWER_PERSONALITY_PROMPTS.ENGLAND;
    const germanyPrompt = POWER_PERSONALITY_PROMPTS.GERMANY;

    // England: formal, understated
    expect(englandPrompt).toContain('formal');
    expect(englandPrompt).toContain('understated');
    expect(englandPrompt).toContain('It strikes me');

    // Germany: direct, businesslike
    expect(germanyPrompt).toContain('Direct');
    expect(germanyPrompt).toContain('businesslike');
    expect(germanyPrompt).toContain('I propose');
  });

  it('France uses warm persuasive tone while Turkey uses proud cautious tone', () => {
    const francePrompt = POWER_PERSONALITY_PROMPTS.FRANCE;
    const turkeyPrompt = POWER_PERSONALITY_PROMPTS.TURKEY;

    expect(francePrompt).toContain('Warm');
    expect(francePrompt).toContain('persuasive');
    expect(francePrompt).toContain('my friend');

    expect(turkeyPrompt).toContain('Proud');
    expect(turkeyPrompt).toContain('cautious');
    expect(turkeyPrompt).toContain('Trust is earned');
  });

  it('Italy is evasive/non-committal while Austria is earnest/sincere', () => {
    const italyPrompt = POWER_PERSONALITY_PROMPTS.ITALY;
    const austriaPrompt = POWER_PERSONALITY_PROMPTS.AUSTRIA;

    expect(italyPrompt).toContain('non-threatening');
    expect(italyPrompt).toContain('options open');
    expect(italyPrompt).toContain('We shall see');

    expect(austriaPrompt).toContain('Earnest');
    expect(austriaPrompt).toContain('sincere');
    expect(austriaPrompt).toContain('my word');
  });

  it('Russia uses brief/weighty language', () => {
    const russiaPrompt = POWER_PERSONALITY_PROMPTS.RUSSIA;
    expect(russiaPrompt).toContain('Measured');
    expect(russiaPrompt).toContain('brevity');
    expect(russiaPrompt).toContain('few');
  });
});

// ---------------------------------------------------------------------------
// 9. Power default personalities have distinct numeric profiles
// ---------------------------------------------------------------------------
describe('Power default personalities are distinct', () => {
  it('no two powers share the exact same personality profile', () => {
    for (let i = 0; i < POWERS.length; i++) {
      for (let j = i + 1; j < POWERS.length; j++) {
        const p1 = POWER_PERSONALITIES[POWERS[i]];
        const p2 = POWER_PERSONALITIES[POWERS[j]];

        const isSame =
          p1.cooperativeness === p2.cooperativeness &&
          p1.aggression === p2.aggression &&
          p1.patience === p2.patience &&
          p1.trustworthiness === p2.trustworthiness &&
          p1.paranoia === p2.paranoia &&
          p1.deceptiveness === p2.deceptiveness;

        expect(isSame).toBe(false);
      }
    }
  });

  it('powers with similar strategic positions still have different personalities', () => {
    // Austria and Germany are both central but have different profiles
    const austria = POWER_PERSONALITIES.AUSTRIA;
    const germany = POWER_PERSONALITIES.GERMANY;

    // Austria is more cooperative and less aggressive
    expect(austria.cooperativeness).toBeGreaterThan(germany.cooperativeness);
    expect(austria.aggression).toBeLessThan(germany.aggression);
  });

  it('corner powers (England, Turkey) have higher patience than central powers', () => {
    const england = POWER_PERSONALITIES.ENGLAND;
    const turkey = POWER_PERSONALITIES.TURKEY;
    const germany = POWER_PERSONALITIES.GERMANY;

    expect(england.patience).toBeGreaterThan(germany.patience);
    expect(turkey.patience).toBeGreaterThan(germany.patience);
  });
});

// ---------------------------------------------------------------------------
// 10. System prompts integrate personality into full agent context
// ---------------------------------------------------------------------------
describe('System prompt personality integration', () => {
  it('same power with different personalities produces different system prompts', () => {
    const prompt1 = buildSystemPrompt('ENGLAND', AGGRESSIVE);
    const prompt2 = buildSystemPrompt('ENGLAND', PEACEFUL);
    const prompt3 = buildSystemPrompt('ENGLAND', DEFAULT_PERSONALITY);

    // All three prompts for same power should differ
    expect(prompt1).not.toEqual(prompt2);
    expect(prompt1).not.toEqual(prompt3);
    expect(prompt2).not.toEqual(prompt3);
  });

  it('personality descriptions appear in the Traits section of the prompt', () => {
    const prompt = buildSystemPrompt('ENGLAND', AGGRESSIVE);

    // Should have the personality section
    expect(prompt).toContain('Traits');
    // And the character section
    expect(prompt).toContain('Character');
  });

  it('all 6 trait descriptions appear for a fully extreme personality', () => {
    const prompt = buildSystemPrompt('FRANCE', AGGRESSIVE);
    const traitCount = countTraitDescriptions(prompt);
    expect(traitCount).toBe(6);
  });

  it('balanced personality produces generic playstyle description', () => {
    const balanced: AgentPersonality = {
      cooperativeness: 0.5,
      aggression: 0.5,
      patience: 0.5,
      trustworthiness: 0.5,
      paranoia: 0.5,
      deceptiveness: 0.5,
    };
    const prompt = buildSystemPrompt('ITALY', balanced);
    expect(prompt).toContain('balanced, adaptable');
  });
});

// ---------------------------------------------------------------------------
// 11. Diplomacy prompts reflect relationship context
// ---------------------------------------------------------------------------
describe('Diplomacy prompts reflect trust-influenced context', () => {
  it('high trust relationship shows Strong Trust label', () => {
    const memory = makeMemory('ENGLAND');
    memory.trustLevels.set('FRANCE', 0.8);
    const prompt = buildDiplomacyPrompt('ENGLAND', 'FRANCE', memory, 'Discuss alliance');
    expect(prompt).toContain('Strong Trust');
  });

  it('negative trust relationship shows Distrust label', () => {
    const memory = makeMemory('ENGLAND');
    memory.trustLevels.set('GERMANY', -0.5);
    const prompt = buildDiplomacyPrompt('ENGLAND', 'GERMANY', memory, 'Discuss borders');
    expect(prompt).toContain('Distrust');
  });

  it('different trust levels produce different diplomacy prompts', () => {
    const memoryHigh = makeMemory('FRANCE');
    memoryHigh.trustLevels.set('ENGLAND', 0.9);

    const memoryLow = makeMemory('FRANCE');
    memoryLow.trustLevels.set('ENGLAND', -0.8);

    const promptHigh = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memoryHigh, 'test');
    const promptLow = buildDiplomacyPrompt('FRANCE', 'ENGLAND', memoryLow, 'test');

    expect(promptHigh).toContain('Strong Trust');
    expect(promptLow).toContain('Strong Distrust');
    expect(promptHigh).not.toEqual(promptLow);
  });

  it('ally status is reflected in diplomacy prompt', () => {
    const memory = makeMemory('ENGLAND');
    memory.relationships.set('FRANCE', {
      power: 'FRANCE',
      trustLevel: 0.7,
      isAlly: true,
      isEnemy: false,
      lastInteraction: { year: 1901, season: 'SPRING' },
      commitments: [],
      notes: [],
    });
    const prompt = buildDiplomacyPrompt('ENGLAND', 'FRANCE', memory, 'test');
    expect(prompt).toContain('ALLY');
  });

  it('enemy status is reflected in diplomacy prompt', () => {
    const memory = makeMemory('ENGLAND');
    memory.relationships.set('GERMANY', {
      power: 'GERMANY',
      trustLevel: -0.7,
      isAlly: false,
      isEnemy: true,
      lastInteraction: { year: 1901, season: 'SPRING' },
      commitments: [],
      notes: [],
    });
    const prompt = buildDiplomacyPrompt('ENGLAND', 'GERMANY', memory, 'test');
    expect(prompt).toContain('ENEMY');
  });
});

// ---------------------------------------------------------------------------
// 12. Turn prompts incorporate personality-influenced game view correctly
// ---------------------------------------------------------------------------
describe('Turn prompts with different personalities and phases', () => {
  it('MOVEMENT phase prompt includes attack-encouraging language', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT');

    // Should encourage active play
    expect(prompt).toContain('ATTACK');
    expect(prompt).toContain('EXPAND');
    expect(prompt).toContain('18 supply centers');
  });

  it('DIPLOMACY phase prompt includes negotiation flow guidance', () => {
    const view = makeGameView({ phase: 'DIPLOMACY' });
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'DIPLOMACY');

    expect(prompt).toContain('OPENING');
    expect(prompt).toContain('COUNTER');
    expect(prompt).toContain('FINAL');
    expect(prompt).toContain('ACCEPT');
    expect(prompt).toContain('REJECT');
  });

  it('BUILD phase prompt varies based on build vs disband', () => {
    const buildView = makeGameView({
      phase: 'BUILD',
      buildCount: 2,
      availableBuildLocations: ['LON', 'EDI', 'LVP'],
    });
    const disbandView = makeGameView({
      phase: 'BUILD',
      buildCount: -1,
    });
    const memory = makeMemory();

    const buildPrompt = buildTurnPrompt(buildView, memory, [], 'BUILD');
    const disbandPrompt = buildTurnPrompt(disbandView, memory, [], 'BUILD');

    expect(buildPrompt).toContain('Build Units');
    expect(disbandPrompt).toContain('Disband');
    expect(buildPrompt).not.toEqual(disbandPrompt);
  });
});

// ---------------------------------------------------------------------------
// 13. Cross-power personality comparison: different powers get distinct voices
// ---------------------------------------------------------------------------
describe('Cross-power system prompt differentiation', () => {
  it('all 7 powers produce unique system prompts even with the same personality', () => {
    const prompts = POWERS.map(power =>
      buildSystemPrompt(power, DEFAULT_PERSONALITY)
    );

    for (let i = 0; i < prompts.length; i++) {
      for (let j = i + 1; j < prompts.length; j++) {
        expect(prompts[i]).not.toEqual(prompts[j]);
      }
    }
  });

  it('each power prompt contains its own name and strategy', () => {
    for (const power of POWERS) {
      const prompt = buildSystemPrompt(power, getPowerPersonality(power));
      expect(prompt).toContain(power);
    }
  });

  it('personality override changes the prompt even for the same power', () => {
    const defaultPrompt = buildSystemPrompt('ENGLAND', getPowerPersonality('ENGLAND'));
    const overriddenPrompt = buildSystemPrompt('ENGLAND', AGGRESSIVE);

    expect(defaultPrompt).not.toEqual(overriddenPrompt);
    // The aggressive override should inject aggressive traits
    expect(overriddenPrompt).toContain('aggressive');
    // The default England personality (aggression=0.4) should NOT have aggressive trait
    expect(defaultPrompt).not.toContain('favor aggressive');
  });
});

// ---------------------------------------------------------------------------
// 14. Personality trait threshold boundaries
// ---------------------------------------------------------------------------
describe('Personality trait threshold boundaries', () => {
  it('trait value exactly at 0.7 triggers high description', () => {
    const atThreshold: AgentPersonality = {
      ...DEFAULT_PERSONALITY,
      aggression: 0.7,
    };
    const prompt = buildSystemPrompt('ENGLAND', atThreshold);
    expect(prompt).toContain('aggressive');
  });

  it('trait value exactly at 0.3 triggers low description', () => {
    const atThreshold: AgentPersonality = {
      ...DEFAULT_PERSONALITY,
      aggression: 0.3,
    };
    const prompt = buildSystemPrompt('ENGLAND', atThreshold);
    expect(prompt).toContain('defensive');
  });

  it('trait value at 0.5 triggers neither extreme description', () => {
    const midRange: AgentPersonality = {
      cooperativeness: 0.5,
      aggression: 0.5,
      patience: 0.5,
      trustworthiness: 0.5,
      paranoia: 0.5,
      deceptiveness: 0.5,
    };
    const prompt = buildSystemPrompt('ENGLAND', midRange);

    // Should not contain any high/low trait descriptions
    expect(prompt).not.toContain('aggressive, attacking');
    expect(prompt).not.toContain('defensive, cautious');
    expect(prompt).not.toContain('alliances highly');
    expect(prompt).not.toContain('work alone');
    // Should have balanced description instead
    expect(prompt).toContain('balanced, adaptable');
  });
});
