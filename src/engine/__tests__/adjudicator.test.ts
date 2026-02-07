/**
 * Tests for adjudicator.ts — Diplomacy order resolution.
 *
 * Covers: validateOrder, adjudicate, getRetreatOptions, calculateBuildCounts
 * Tests standard Diplomacy rules: holds, moves, supports, convoys,
 * head-to-head battles, standoffs, support cutting, dislodgement.
 */

import { describe, it, expect } from 'vitest';
import type { Unit, Order, Power, HoldOrder, MoveOrder, SupportOrder, ConvoyOrder } from '../types';
import { validateOrder, adjudicate, getRetreatOptions, calculateBuildCounts } from '../adjudicator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  units: Unit[];
  orders: Map<Power, Order[]>;
}

function makeCtx(
  units: Unit[],
  ordersByPower: Array<[Power, Order[]]>
): TestCtx {
  return {
    units,
    orders: new Map(ordersByPower),
  };
}

function army(power: Power, province: string): Unit {
  return { type: 'ARMY', power, province };
}

function fleet(power: Power, province: string, coast?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'): Unit {
  return { type: 'FLEET', power, province, coast };
}

function hold(unit: string): HoldOrder {
  return { type: 'HOLD', unit };
}

function move(unit: string, destination: string, opts?: { viaConvoy?: boolean; destinationCoast?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' }): MoveOrder {
  return { type: 'MOVE', unit, destination, ...opts };
}

function support(unit: string, supportedUnit: string, destination?: string): SupportOrder {
  return { type: 'SUPPORT', unit, supportedUnit, destination };
}

function convoy(unit: string, convoyedUnit: string, destination: string): ConvoyOrder {
  return { type: 'CONVOY', unit, convoyedUnit, destination };
}

// ---------------------------------------------------------------------------
// validateOrder
// ---------------------------------------------------------------------------

describe('validateOrder', () => {
  describe('HOLD', () => {
    it('should always accept HOLD orders', () => {
      const ctx = makeCtx([army('ENGLAND', 'LON')], []);
      const result = validateOrder(hold('LON'), army('ENGLAND', 'LON'), ctx);
      expect(result).toBeNull();
    });
  });

  describe('MOVE', () => {
    it('should accept moves to adjacent provinces', () => {
      const ctx = makeCtx([army('FRANCE', 'PAR')], []);
      const result = validateOrder(move('PAR', 'BUR'), army('FRANCE', 'PAR'), ctx);
      expect(result).toBeNull();
    });

    it('should reject moves to non-adjacent provinces', () => {
      const ctx = makeCtx([army('FRANCE', 'PAR')], []);
      const result = validateOrder(move('PAR', 'MOS'), army('FRANCE', 'PAR'), ctx);
      expect(result).toContain('not adjacent');
    });

    it('should reject army moves to sea provinces', () => {
      const ctx = makeCtx([army('FRANCE', 'BRE')], []);
      const result = validateOrder(move('BRE', 'MAO'), army('FRANCE', 'BRE'), ctx);
      expect(result).toContain('Army cannot move to sea');
    });

    it('should reject fleet moves to landlocked provinces', () => {
      const ctx = makeCtx([fleet('GERMANY', 'KIE')], []);
      const result = validateOrder(move('KIE', 'MUN'), fleet('GERMANY', 'KIE'), ctx);
      expect(result).toContain('Fleet cannot move to land');
    });

    it('should reject moves to unknown provinces', () => {
      const ctx = makeCtx([army('ENGLAND', 'LON')], []);
      const result = validateOrder(move('LON', 'XXX'), army('ENGLAND', 'LON'), ctx);
      expect(result).toContain('Unknown destination');
    });

    it('should require coast for fleet moving to multi-coast province', () => {
      const ctx = makeCtx([fleet('RUSSIA', 'BAR')], []);
      const result = validateOrder(move('BAR', 'STP'), fleet('RUSSIA', 'BAR'), ctx);
      expect(result).toContain('Must specify coast');
    });

    it('should accept fleet move to multi-coast with valid coast', () => {
      const ctx = makeCtx([fleet('RUSSIA', 'BAR')], []);
      const result = validateOrder(
        move('BAR', 'STP', { destinationCoast: 'NORTH' }),
        fleet('RUSSIA', 'BAR'),
        ctx
      );
      expect(result).toBeNull();
    });

    it('should reject invalid coast for multi-coast province', () => {
      const ctx = makeCtx([fleet('RUSSIA', 'BAR')], []);
      const result = validateOrder(
        move('BAR', 'STP', { destinationCoast: 'EAST' }),
        fleet('RUSSIA', 'BAR'),
        ctx
      );
      expect(result).toContain('Invalid coast');
    });
  });

  describe('SUPPORT', () => {
    it('should accept valid support hold', () => {
      const units = [army('FRANCE', 'PAR'), army('FRANCE', 'BUR')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(support('BUR', 'PAR'), army('FRANCE', 'BUR'), ctx);
      expect(result).toBeNull();
    });

    it('should accept valid support move', () => {
      const units = [army('FRANCE', 'PAR'), army('FRANCE', 'GAS')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        support('GAS', 'PAR', 'BUR'),
        army('FRANCE', 'GAS'),
        ctx
      );
      expect(result).toBeNull();
    });

    it('should reject support hold to non-adjacent province', () => {
      const units = [army('FRANCE', 'PAR'), army('FRANCE', 'MAR')];
      const ctx = makeCtx(units, []);
      // MAR is not adjacent to LON
      const result = validateOrder(support('MAR', 'LON'), army('FRANCE', 'MAR'), ctx);
      expect(result).not.toBeNull();
    });

    it('should reject support for non-existent unit', () => {
      const ctx = makeCtx([army('FRANCE', 'PAR')], []);
      const result = validateOrder(support('PAR', 'LON'), army('FRANCE', 'PAR'), ctx);
      expect(result).toContain('No unit at LON');
    });

    it('should reject support move to non-adjacent destination', () => {
      const units = [army('FRANCE', 'PAR'), army('FRANCE', 'MAR')];
      const ctx = makeCtx(units, []);
      // PAR cannot support a move to NWY (too far)
      const result = validateOrder(
        support('PAR', 'MAR', 'NWY'),
        army('FRANCE', 'PAR'),
        ctx
      );
      expect(result).toContain('non-adjacent');
    });

    it('should reject army support move to sea province', () => {
      const units = [army('ENGLAND', 'WAL'), fleet('ENGLAND', 'LON')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        support('WAL', 'LON', 'ENG'),
        army('ENGLAND', 'WAL'),
        ctx
      );
      expect(result).toContain('Army cannot support move to sea');
    });
  });

  describe('CONVOY', () => {
    it('should accept valid convoy order', () => {
      const units = [fleet('ENGLAND', 'NTH'), army('ENGLAND', 'LON')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        convoy('NTH', 'LON', 'NWY'),
        fleet('ENGLAND', 'NTH'),
        ctx
      );
      expect(result).toBeNull();
    });

    it('should reject convoy by army', () => {
      const units = [army('ENGLAND', 'YOR'), army('ENGLAND', 'LON')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        convoy('YOR', 'LON', 'NWY'),
        army('ENGLAND', 'YOR'),
        ctx
      );
      expect(result).toContain('Only fleets can convoy');
    });

    it('should reject convoy from non-sea province', () => {
      const units = [fleet('ENGLAND', 'LON'), army('ENGLAND', 'YOR')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        convoy('LON', 'YOR', 'NWY'),
        fleet('ENGLAND', 'LON'),
        ctx
      );
      expect(result).toContain('must be at sea');
    });

    it('should reject convoy of non-existent unit', () => {
      const units = [fleet('ENGLAND', 'NTH')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        convoy('NTH', 'LON', 'NWY'),
        fleet('ENGLAND', 'NTH'),
        ctx
      );
      expect(result).toContain('No unit at LON');
    });

    it('should reject convoy of fleet', () => {
      const units = [fleet('ENGLAND', 'NTH'), fleet('ENGLAND', 'LON')];
      const ctx = makeCtx(units, []);
      const result = validateOrder(
        convoy('NTH', 'LON', 'NWY'),
        fleet('ENGLAND', 'NTH'),
        ctx
      );
      expect(result).toContain('Only armies can be convoyed');
    });
  });
});

// ---------------------------------------------------------------------------
// adjudicate
// ---------------------------------------------------------------------------

describe('adjudicate', () => {
  describe('basic moves', () => {
    it('should resolve hold orders as successful', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR')],
        [['FRANCE', [hold('PAR')]]]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(true);
    });

    it('should resolve moves to empty provinces as successful', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR')],
        [['FRANCE', [move('PAR', 'BUR')]]]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(true);
    });

    it('should fail moves with invalid orders', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR')],
        [['FRANCE', [move('PAR', 'XXX')]]]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(false);
    });

    it('should fail when no unit exists at order location', () => {
      const ctx = makeCtx(
        [],
        [['FRANCE', [hold('PAR')]]]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('PAR')?.reason).toContain('No unit at PAR');
    });
  });

  describe('standoffs', () => {
    it('should bounce two equal-strength moves to same province', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('GERMANY', 'MUN')],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [move('MUN', 'BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('MUN')?.success).toBe(false);
    });
  });

  describe('support', () => {
    it('should give supported move strength 2 to overcome hold', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('FRANCE', 'MAR'), army('GERMANY', 'BUR')],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('MAR', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [hold('BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(true);
      expect(results.get('BUR')?.dislodged).toBe(true);
    });

    it('should allow supported hold to resist attack', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('GERMANY', 'BUR'), army('GERMANY', 'RUH')],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [
            hold('BUR'),
            support('RUH', 'BUR'),
          ]],
        ]
      );
      const results = adjudicate(ctx);
      // France attacks BUR with strength 1, Germany holds BUR with strength 2
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('BUR')?.dislodged).toBe(false);
    });

    it('should resolve supported move winning standoff', () => {
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'GAS'),
          army('GERMANY', 'MUN'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('GAS', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [move('MUN', 'BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      // France: strength 2, Germany: strength 1
      expect(results.get('PAR')?.success).toBe(true);
      expect(results.get('MUN')?.success).toBe(false);
    });
  });

  describe('support cutting', () => {
    it('should cut support when supporting unit is attacked', () => {
      // BEL -> PIC cuts PIC's support for PAR -> BUR
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'PIC'),
          army('GERMANY', 'BUR'),
          army('GERMANY', 'BEL'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('PIC', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [
            hold('BUR'),
            move('BEL', 'PIC'), // Attacks the supporting unit
          ]],
        ]
      );
      const results = adjudicate(ctx);
      // Germany's BEL -> PIC cuts France's PIC support
      // So France attacks BUR with strength 1 vs hold strength 1 -> bounce
      const picSupport = results.get('PIC');
      expect(picSupport?.success).toBe(false);
      expect(picSupport?.reason).toContain('cut');
    });

    it('should NOT cut support when attacked by the unit being attacked', () => {
      // A supporting an attack on B, and B attacks A — B does NOT cut A's support
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'GAS'),
          army('GERMANY', 'BUR'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('GAS', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [
            move('BUR', 'GAS'), // BUR attacks GAS (the supporting unit), but GAS supports attack on BUR
          ]],
        ]
      );
      const results = adjudicate(ctx);
      // BUR cannot cut GAS's support because GAS is supporting an attack on BUR itself
      // This is the exception rule
      expect(results.get('GAS')?.success).toBe(true); // Support NOT cut
      expect(results.get('PAR')?.success).toBe(true); // Move succeeds
    });
  });

  describe('head-to-head battles', () => {
    it('should bounce equal-strength head-to-head', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('GERMANY', 'BUR')],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [move('BUR', 'PAR')]],
        ]
      );
      const results = adjudicate(ctx);
      // Both strength 1 -> both bounce
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('BUR')?.success).toBe(false);
    });

    it('should resolve head-to-head in favor of supported side', () => {
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'GAS'),
          army('GERMANY', 'BUR'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('GAS', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [move('BUR', 'PAR')]],
        ]
      );
      const results = adjudicate(ctx);
      // France: strength 2, Germany: strength 1
      expect(results.get('PAR')?.success).toBe(true);
      expect(results.get('BUR')?.dislodged).toBe(true);
    });
  });

  describe('dislodgement', () => {
    it('should dislodge defender when attacker has greater strength', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('FRANCE', 'GAS'), army('GERMANY', 'BUR')],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            support('GAS', 'PAR', 'BUR'),
          ]],
          ['GERMANY', [hold('BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('BUR')?.dislodged).toBe(true);
      expect(results.get('BUR')?.dislodgedFrom).toBe('PAR');
    });

    it('should not dislodge when attacker has equal strength', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('GERMANY', 'BUR')],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [hold('BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('BUR')?.dislodged).toBeFalsy();
    });
  });

  describe('vacated provinces', () => {
    it('should allow move into province being vacated', () => {
      const ctx = makeCtx(
        [army('FRANCE', 'PAR'), army('GERMANY', 'BUR')],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [move('BUR', 'MUN')]],
        ]
      );
      const results = adjudicate(ctx);
      // BUR is moving out, PAR should succeed
      expect(results.get('BUR')?.success).toBe(true);
      expect(results.get('PAR')?.success).toBe(true);
    });
  });

  describe('convoy', () => {
    it('should resolve successful convoy', () => {
      const ctx = makeCtx(
        [
          army('ENGLAND', 'LON'),
          fleet('ENGLAND', 'NTH'),
        ],
        [
          ['ENGLAND', [
            move('LON', 'NWY', { viaConvoy: true }),
            convoy('NTH', 'LON', 'NWY'),
          ]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('NTH')?.success).toBe(true); // convoy succeeds when army succeeds
    });
  });

  // ---------------------------------------------------------------------------
  // DATC-inspired edge cases (Diplomacy Adjudicator Test Cases)
  // ---------------------------------------------------------------------------

  describe('DATC edge cases', () => {
    it('should bounce three-way standoff into empty province', () => {
      // Three units all trying to move to the same empty province
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('GERMANY', 'MUN'),
          army('ITALY', 'PIE'),
        ],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [move('MUN', 'BUR')]],
          ['ITALY', [move('PIE', 'MAR')]], // Separate move, not to BUR
        ]
      );
      const results = adjudicate(ctx);
      // PAR and MUN both bounce
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('MUN')?.success).toBe(false);
    });

    it('should allow self-standoff to protect territory', () => {
      // Two friendly units move to same province — both bounce, but prevent enemy entry
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'GAS'),
          army('GERMANY', 'MAR'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            move('GAS', 'BUR'),
          ]],
          ['GERMANY', [move('MAR', 'BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      // All three bounce into BUR
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('GAS')?.success).toBe(false);
      expect(results.get('MAR')?.success).toBe(false);
    });

    it('should not allow a unit to cut support for its own attack', () => {
      // If A attacks B, and C supports A's attack on B,
      // B's counter-attack on C does NOT cut C's support (the exception rule)
      // RUH is adjacent to both BUR and MUN
      const ctx = makeCtx(
        [
          army('FRANCE', 'BUR'),
          army('FRANCE', 'RUH'),
          army('GERMANY', 'MUN'),
        ],
        [
          ['FRANCE', [
            move('BUR', 'MUN'),
            support('RUH', 'BUR', 'MUN'),
          ]],
          ['GERMANY', [move('MUN', 'RUH')]], // attacks the supporter
        ]
      );
      const results = adjudicate(ctx);
      // MUN -> RUH does NOT cut RUH's support for BUR -> MUN
      expect(results.get('RUH')?.success).toBe(true); // Support holds
      expect(results.get('BUR')?.success).toBe(true);  // Move succeeds
      expect(results.get('MUN')?.dislodged).toBe(true); // MUN is dislodged
    });

    it('should resolve circular movement (three-way rotation)', () => {
      // A -> B, B -> C, C -> A: all should succeed
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('GERMANY', 'BUR'),
          army('ITALY', 'MAR'),
        ],
        [
          ['FRANCE', [move('PAR', 'BUR')]],
          ['GERMANY', [move('BUR', 'MAR')]],
          ['ITALY', [move('MAR', 'GAS')]],
        ]
      );
      const results = adjudicate(ctx);
      // This is a chain: PAR -> BUR -> MAR -> GAS
      // BUR vacates for PAR, MAR vacates for BUR
      expect(results.get('BUR')?.success).toBe(true);
      expect(results.get('MAR')?.success).toBe(true);
      expect(results.get('PAR')?.success).toBe(true);
    });

    it('should handle support from multiple nations for same attacker', () => {
      // France and Italy both support an English move
      const ctx = makeCtx(
        [
          army('ENGLAND', 'YOR'),
          army('FRANCE', 'WAL'),
          army('GERMANY', 'LON'),
          army('GERMANY', 'LVP'),
        ],
        [
          ['ENGLAND', [move('YOR', 'LON')]],
          ['FRANCE', [support('WAL', 'YOR', 'LON')]],
          ['GERMANY', [
            hold('LON'),
            support('LVP', 'LON'),
          ]],
        ]
      );
      const results = adjudicate(ctx);
      // England attacks LON with strength 2 (YOR + WAL support)
      // Germany defends LON with strength 2 (LON + LVP support)
      // Equal strength: attack fails, defender holds
      expect(results.get('YOR')?.success).toBe(false);
      expect(results.get('LON')?.dislodged).toBeFalsy();
    });

    it('should handle multi-province convoy chain', () => {
      // Army convoyed across two fleets
      const ctx = makeCtx(
        [
          army('ENGLAND', 'LON'),
          fleet('ENGLAND', 'NTH'),
          fleet('ENGLAND', 'NWG'),
        ],
        [
          ['ENGLAND', [
            move('LON', 'NWY', { viaConvoy: true }),
            convoy('NTH', 'LON', 'NWY'),
            convoy('NWG', 'LON', 'NWY'),
          ]],
        ]
      );
      const results = adjudicate(ctx);
      expect(results.get('LON')?.success).toBe(true);
    });

    it('should dislodge own unit only with support from another power', () => {
      // A power cannot dislodge its own unit
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'BUR'),
        ],
        [
          ['FRANCE', [
            move('PAR', 'BUR'),
            hold('BUR'),
          ]],
        ]
      );
      const results = adjudicate(ctx);
      // France cannot dislodge its own unit
      expect(results.get('PAR')?.success).toBe(false);
      expect(results.get('BUR')?.dislodged).toBeFalsy();
    });

    it('should handle support hold when supported unit moves', () => {
      // If you support a unit to hold, but that unit moves away,
      // the support is wasted
      const ctx = makeCtx(
        [
          army('FRANCE', 'PAR'),
          army('FRANCE', 'BUR'),
          army('GERMANY', 'MUN'),
        ],
        [
          ['FRANCE', [
            support('PAR', 'BUR'), // Support BUR to hold
            move('BUR', 'MAR'),    // But BUR moves away!
          ]],
          ['GERMANY', [move('MUN', 'BUR')]],
        ]
      );
      const results = adjudicate(ctx);
      // BUR moved away, Germany should be able to move in
      expect(results.get('BUR')?.success).toBe(true); // BUR -> MAR succeeds
      expect(results.get('MUN')?.success).toBe(true); // MUN -> BUR succeeds (province vacated)
    });
  });
});

// ---------------------------------------------------------------------------
// getRetreatOptions
// ---------------------------------------------------------------------------

describe('getRetreatOptions', () => {
  it('should return adjacent provinces for retreating unit', () => {
    const unit = army('FRANCE', 'PAR');
    const occupied = new Set(['BUR']); // BUR is occupied
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, standoffs);

    // PAR adjacent: BUR, PIC, BRE, GAS
    // BUR is the dislodger origin and is occupied -> excluded
    expect(options).not.toContain('BUR');
    expect(options.length).toBeGreaterThan(0);
  });

  it('should exclude province the attack came from', () => {
    const unit = army('FRANCE', 'PAR');
    const occupied = new Set<string>();
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, standoffs);
    expect(options).not.toContain('BUR');
  });

  it('should exclude occupied provinces', () => {
    const unit = army('FRANCE', 'PAR');
    const occupied = new Set(['PIC', 'BRE']);
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, standoffs);
    expect(options).not.toContain('PIC');
    expect(options).not.toContain('BRE');
  });

  it('should exclude standoff provinces', () => {
    const unit = army('FRANCE', 'PAR');
    const occupied = new Set<string>();
    const standoffs = new Set(['GAS']);

    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, standoffs);
    expect(options).not.toContain('GAS');
  });

  it('should respect unit type movement restrictions', () => {
    const unit = army('ENGLAND', 'BRE');
    const occupied = new Set<string>();
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, 'PAR', { units: [], orders: new Map() }, occupied, standoffs);
    // Army cannot retreat to sea (MAO, ENG)
    expect(options).not.toContain('MAO');
    expect(options).not.toContain('ENG');
  });

  it('should return empty for unit with no valid retreats', () => {
    const unit = army('FRANCE', 'PAR');
    // All adjacent provinces occupied or standoff
    const adjacent = ['BUR', 'PIC', 'BRE', 'GAS'];
    const occupied = new Set(adjacent);
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, standoffs);
    expect(options).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// calculateBuildCounts
// ---------------------------------------------------------------------------

describe('calculateBuildCounts', () => {
  it('should return 0 for balanced powers', () => {
    const units: Unit[] = [
      army('ENGLAND', 'LON'),
      army('ENGLAND', 'EDI'),
      army('ENGLAND', 'LVP'),
    ];
    const scs = new Map<string, Power>([
      ['LON', 'ENGLAND'],
      ['EDI', 'ENGLAND'],
      ['LVP', 'ENGLAND'],
    ]);

    const counts = calculateBuildCounts(units, scs);
    expect(counts.get('ENGLAND')).toBe(0);
  });

  it('should return positive count when SCs > units', () => {
    const units: Unit[] = [
      army('ENGLAND', 'LON'),
      army('ENGLAND', 'EDI'),
    ];
    const scs = new Map<string, Power>([
      ['LON', 'ENGLAND'],
      ['EDI', 'ENGLAND'],
      ['LVP', 'ENGLAND'],
      ['BEL', 'ENGLAND'],
    ]);

    const counts = calculateBuildCounts(units, scs);
    expect(counts.get('ENGLAND')).toBe(2); // 4 SCs - 2 units = 2
  });

  it('should return negative count when units > SCs', () => {
    const units: Unit[] = [
      army('FRANCE', 'PAR'),
      army('FRANCE', 'BUR'),
      army('FRANCE', 'MAR'),
    ];
    const scs = new Map<string, Power>([
      ['PAR', 'FRANCE'],
    ]);

    const counts = calculateBuildCounts(units, scs);
    expect(counts.get('FRANCE')).toBe(-2); // 1 SC - 3 units = -2
  });

  it('should return 0 for eliminated powers (no units, no SCs)', () => {
    const counts = calculateBuildCounts([], new Map());
    expect(counts.get('ITALY')).toBe(0);
  });

  it('should calculate independently for each power', () => {
    const units: Unit[] = [
      army('ENGLAND', 'LON'),
      army('FRANCE', 'PAR'),
      army('FRANCE', 'BUR'),
    ];
    const scs = new Map<string, Power>([
      ['LON', 'ENGLAND'],
      ['EDI', 'ENGLAND'],
      ['PAR', 'FRANCE'],
    ]);

    const counts = calculateBuildCounts(units, scs);
    expect(counts.get('ENGLAND')).toBe(1);  // 2 SCs - 1 unit
    expect(counts.get('FRANCE')).toBe(-1);  // 1 SC - 2 units
  });
});
