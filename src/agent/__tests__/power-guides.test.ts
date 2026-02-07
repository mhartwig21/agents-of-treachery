import { describe, it, expect } from 'vitest';
import {
  POWER_GUIDES,
  getPowerGuide,
  formatPowerGuideMarkdown,
  getOpeningAdvice,
} from '../power-guides';
import type { Power } from '../../engine/types';
import { POWERS } from '../../engine/types';

describe('POWER_GUIDES', () => {
  it('should have guides for all 7 powers', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power]).toBeDefined();
    }
  });

  it('should have at least 2 openings per power', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power].openings.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should have named openings with spring orders', () => {
    for (const power of POWERS) {
      for (const opening of POWER_GUIDES[power].openings) {
        expect(opening.name).toBeTruthy();
        expect(opening.description).toBeTruthy();
        expect(opening.springOrders.length).toBeGreaterThan(0);
        expect(opening.followUp).toBeTruthy();
      }
    }
  });

  it('should have non-empty earlyDecisions for all powers', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power].earlyDecisions.length).toBeGreaterThan(100);
    }
  });

  it('should have non-empty openingPhasePriorities for all powers', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power].openingPhasePriorities.length).toBeGreaterThan(100);
    }
  });

  it('should have non-empty diplomaticPosture for all powers', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power].diplomaticPosture.length).toBeGreaterThan(100);
    }
  });

  it('should have non-empty pitfalls for all powers', () => {
    for (const power of POWERS) {
      expect(POWER_GUIDES[power].pitfalls.length).toBeGreaterThan(50);
    }
  });

  it('should reference correct home provinces in spring orders', () => {
    // England starts with units in LON, EDI, LVP
    const engOrders = POWER_GUIDES.ENGLAND.openings[0].springOrders;
    const engText = engOrders.join(' ');
    expect(engText).toMatch(/LON|EDI|LVP/);

    // France starts with units in PAR, MAR, BRE
    const fraOrders = POWER_GUIDES.FRANCE.openings[0].springOrders;
    const fraText = fraOrders.join(' ');
    expect(fraText).toMatch(/PAR|MAR|BRE/);

    // Germany starts with units in BER, MUN, KIE
    const gerOrders = POWER_GUIDES.GERMANY.openings[0].springOrders;
    const gerText = gerOrders.join(' ');
    expect(gerText).toMatch(/BER|MUN|KIE/);

    // Russia starts with units in STP, MOS, WAR, SEV
    const rusOrders = POWER_GUIDES.RUSSIA.openings[0].springOrders;
    const rusText = rusOrders.join(' ');
    expect(rusText).toMatch(/STP|MOS|WAR|SEV/);

    // Turkey starts with units in CON, ANK, SMY
    const turOrders = POWER_GUIDES.TURKEY.openings[0].springOrders;
    const turText = turOrders.join(' ');
    expect(turText).toMatch(/CON|ANK|SMY/);
  });
});

describe('getPowerGuide', () => {
  it('should return the guide for each power', () => {
    for (const power of POWERS) {
      const guide = getPowerGuide(power);
      expect(guide).toBe(POWER_GUIDES[power]);
    }
  });
});

describe('formatPowerGuideMarkdown', () => {
  it('should produce markdown with power name header', () => {
    const md = formatPowerGuideMarkdown('ENGLAND');
    expect(md).toContain('## ENGLAND Opening Guide');
  });

  it('should include named openings section', () => {
    const md = formatPowerGuideMarkdown('FRANCE');
    expect(md).toContain('### Named Openings');
    expect(md).toContain('Maginot');
  });

  it('should include early decisions section', () => {
    const md = formatPowerGuideMarkdown('GERMANY');
    expect(md).toContain('### Early Decisions');
  });

  it('should include opening phase priorities', () => {
    const md = formatPowerGuideMarkdown('ITALY');
    expect(md).toContain('### Opening Phase Priorities');
  });

  it('should include diplomatic posture', () => {
    const md = formatPowerGuideMarkdown('AUSTRIA');
    expect(md).toContain('### Diplomatic Posture');
  });

  it('should include pitfalls', () => {
    const md = formatPowerGuideMarkdown('RUSSIA');
    expect(md).toContain('### Common Mistakes to Avoid');
  });

  it('should include spring order code blocks for each opening', () => {
    const md = formatPowerGuideMarkdown('TURKEY');
    // Should have code blocks with orders
    expect(md).toContain('```');
    expect(md).toContain('A CON -> BUL');
  });

  it('should produce 200+ words for each power', () => {
    for (const power of POWERS) {
      const md = formatPowerGuideMarkdown(power);
      const wordCount = md.split(/\s+/).length;
      expect(wordCount).toBeGreaterThan(200);
    }
  });
});

describe('getOpeningAdvice', () => {
  it('should return advice for year 1901', () => {
    for (const power of POWERS) {
      const advice = getOpeningAdvice(power, 1901);
      expect(advice).not.toBeNull();
      expect(advice!.length).toBeGreaterThan(50);
    }
  });

  it('should return advice for year 1902', () => {
    for (const power of POWERS) {
      const advice = getOpeningAdvice(power, 1902);
      expect(advice).not.toBeNull();
      expect(advice!.length).toBeGreaterThan(50);
    }
  });

  it('should return null for year 1903+', () => {
    expect(getOpeningAdvice('ENGLAND', 1903)).toBeNull();
    expect(getOpeningAdvice('FRANCE', 1905)).toBeNull();
    expect(getOpeningAdvice('GERMANY', 1910)).toBeNull();
  });

  it('should reference opening name for 1901', () => {
    const advice = getOpeningAdvice('ENGLAND', 1901);
    expect(advice).toContain('Churchill');
  });

  it('should include early decisions for 1901', () => {
    const advice = getOpeningAdvice('FRANCE', 1901);
    expect(advice).toContain('Alliance Choice');
  });
});
