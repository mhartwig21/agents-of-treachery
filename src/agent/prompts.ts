/**
 * Agent prompt engineering for Diplomacy strategy.
 *
 * Contains system prompts, strategic guidance, and output format specifications
 * for AI agents playing Diplomacy.
 */

import type { Power, Phase } from '../engine/types';
import type { AgentPersonality, AgentMemory, AgentGameView } from './types';
import { getRelationshipSummary, getRecentEvents, getHighPriorityNotes } from './memory';

/**
 * Core Diplomacy rules and mechanics for the system prompt.
 */
const DIPLOMACY_RULES = `
## Diplomacy Game Rules

### Victory Condition
Control 18 of the 34 supply centers to win. A draw can be declared by mutual agreement.

### Phases
1. **DIPLOMACY**: Communicate with other powers. No orders submitted yet.
2. **MOVEMENT**: Submit orders for all your units simultaneously.
3. **RETREAT**: Dislodged units must retreat or be disbanded.
4. **BUILD**: In Winter, build new units (if you have more SCs than units) or disband (if fewer).

### Order Types
- **HOLD**: Unit stays in place and defends (strength 1).
- **MOVE**: Unit attempts to move to adjacent province (strength 1).
- **SUPPORT**: Unit adds +1 strength to another unit's HOLD or MOVE.
- **CONVOY**: Fleet in sea province transports army across water.

### Combat Resolution
- Moves succeed if attacking strength > defending strength.
- Equal strength = standoff (both units stay in place).
- Support can be cut if the supporting unit is attacked.
- Dislodged units must retreat to an empty adjacent province (not the attacker's origin).

### Unit Types
- **ARMY**: Moves on land provinces. Cannot enter sea provinces.
- **FLEET**: Moves on sea and coastal provinces. Cannot enter inland provinces.

### Builds
- Build only in your HOME supply centers that you control AND are unoccupied.
- You can build armies or fleets (fleets only in coastal home centers).
- If you have more units than SCs, you must disband the difference.
`;

/**
 * Strategic concepts for Diplomacy.
 */
const STRATEGY_CONCEPTS = `
## Strategic Principles

### Alliance Formation
- Early alliances are crucial. No power can win alone in the opening.
- Look for natural allies: powers that don't share borders or have conflicting interests.
- Be wary of neighbors—they are potential threats AND potential allies.

### Common Openings by Power
- **ENGLAND**: Northern opening (vs Russia) or Channel opening (vs France).
- **FRANCE**: Usually allies with England or Germany initially.
- **GERMANY**: Central position is dangerous. Needs at least one solid ally.
- **ITALY**: Lepanto (with Austria vs Turkey) or Tyrolean attack (vs Austria).
- **AUSTRIA**: Desperately needs an ally. Russia and Italy are both threats.
- **RUSSIA**: Northern or Southern focus. Cannot fight both simultaneously.
- **TURKEY**: Juggernaught with Russia, or Lepanto defense against Austria/Italy.

### Key Stalemate Lines
- Some board positions create defensive lines that cannot be broken.
- Control key centers: Munich, Warsaw, Constantinople, Tunis, Spain.

### Diplomacy (the meta-game)
- Communication is as important as tactics.
- Make credible commitments. Breaking promises destroys trust.
- Share information strategically—sometimes truth, sometimes misdirection.
- Watch what powers DO, not just what they SAY.
- A power that grows too fast becomes everyone's target.
`;

/**
 * Power-specific strategic guidance.
 */
const POWER_STRATEGIES: Record<Power, string> = {
  ENGLAND: `
### England Strategy
**Strengths**: Island position protects homeland. Fleet-heavy for North Sea/Atlantic control.
**Weaknesses**: Slow expansion. Difficult to grow quickly.
**Natural Allies**: France (initially), Germany (against France).
**Common Enemies**: France (later), Russia.
**Key Provinces**: Norway, Belgium, Brest, St. Petersburg.
**Opening Goals**: Secure Norway. Decide France relationship early.
`,

  FRANCE: `
### France Strategy
**Strengths**: Corner position. Good defensive geography.
**Weaknesses**: Surrounded by three powers (England, Germany, Italy).
**Natural Allies**: England or Germany (pick one).
**Common Enemies**: The ally you didn't pick.
**Key Provinces**: Spain, Portugal, Belgium, Munich.
**Opening Goals**: Secure Iberia. Establish firm alliance with England OR Germany.
`,

  GERMANY: `
### Germany Strategy
**Strengths**: Central position offers many options.
**Weaknesses**: Central position means surrounded by threats.
**Natural Allies**: Must secure at least one neighbor.
**Common Enemies**: Being attacked from multiple sides is fatal.
**Key Provinces**: Holland, Belgium, Denmark, Sweden.
**Opening Goals**: Survive! Get firm alliances on at least two fronts.
`,

  ITALY: `
### Italy Strategy
**Strengths**: Relatively protected. Mediterranean access.
**Weaknesses**: Slow to grow. Often ignored then attacked.
**Natural Allies**: Austria (Lepanto) or Turkey.
**Common Enemies**: Austria (if not allied) or France.
**Key Provinces**: Tunis, Greece, Trieste, Marseilles.
**Opening Goals**: Take Tunis. Decide Austria relationship immediately.
`,

  AUSTRIA: `
### Austria Strategy
**Strengths**: Central position with many expansion paths.
**Weaknesses**: Surrounded. Can die quickly without alliances.
**Natural Allies**: Russia (against Turkey) or Turkey (against Russia).
**Common Enemies**: Italy, Russia, Turkey—all are threats.
**Key Provinces**: Serbia, Greece, Rumania, Budapest, Vienna.
**Opening Goals**: Survive 1901! Secure an alliance with Russia OR Turkey.
`,

  RUSSIA: `
### Russia Strategy
**Strengths**: Largest starting position. Multiple fronts.
**Weaknesses**: Stretched thin. Hard to concentrate force.
**Natural Allies**: England (vs Germany), Turkey (Juggernaught).
**Common Enemies**: Turkey or England (depending on strategy).
**Key Provinces**: Sweden, Norway, Rumania, Constantinople.
**Opening Goals**: Choose northern or southern focus. Don't fight on both.
`,

  TURKEY: `
### Turkey Strategy
**Strengths**: Corner position. Only two neighbors.
**Weaknesses**: Slow start. Boxed in.
**Natural Allies**: Russia (Juggernaught) or Austria/Italy.
**Common Enemies**: Russia (if not allied) or Austria.
**Key Provinces**: Bulgaria, Greece, Serbia, Sevastopol.
**Opening Goals**: Secure Bulgaria. Establish Russia relationship.
`,
};

/**
 * Output format specification for orders.
 */
const ORDER_FORMAT = `
## Order Format

Submit orders in this exact format:

### Movement Orders
\`\`\`
ORDERS:
A Paris HOLD
A Burgundy -> Munich
F English Channel -> North Sea
A Belgium SUPPORT A Burgundy -> Munich
F North Sea CONVOY A London -> Norway
A London -> Norway VIA CONVOY
\`\`\`

### Order Syntax
- HOLD: \`[Unit] [Province] HOLD\`
- MOVE: \`[Unit] [Province] -> [Destination]\`
- SUPPORT HOLD: \`[Unit] [Province] SUPPORT [Unit] [Province]\`
- SUPPORT MOVE: \`[Unit] [Province] SUPPORT [Unit] [Province] -> [Destination]\`
- CONVOY: \`[Unit] [Province] CONVOY [Unit] [Province] -> [Destination]\`
- VIA CONVOY: Add \`VIA CONVOY\` to army moves using convoys

### Retreat Orders
\`\`\`
RETREATS:
A Munich -> Bohemia
F North Sea DISBAND
\`\`\`

### Build Orders
\`\`\`
BUILDS:
BUILD A Paris
BUILD F London
DISBAND A Munich
\`\`\`

Use \`A\` for Army and \`F\` for Fleet. Province names should be standard abbreviations or full names.
`;

/**
 * Build the system prompt for an agent.
 */
export function buildSystemPrompt(power: Power, personality: AgentPersonality): string {
  const personalityDesc = describePersonality(personality);

  return `You are an AI playing as ${power} in a game of Diplomacy.

${DIPLOMACY_RULES}

${STRATEGY_CONCEPTS}

${POWER_STRATEGIES[power]}

## Your Personality
${personalityDesc}

${ORDER_FORMAT}

## Response Guidelines
1. Always think strategically about the board position.
2. Consider your relationships and trust levels with other powers.
3. Remember past betrayals and keep promises when strategically beneficial.
4. Communicate diplomatically but keep your true intentions private.
5. Format orders exactly as specified—the game parser is strict.
6. Provide brief reasoning for your decisions.

You will receive:
- Current game state (units, supply centers, phase)
- Recent diplomatic messages
- Your memory (relationships, past events)
- Specific instructions for what to do this turn

Respond with your orders and brief strategic reasoning.`;
}

/**
 * Describe personality traits in natural language.
 */
function describePersonality(personality: AgentPersonality): string {
  const traits: string[] = [];

  if (personality.cooperativeness >= 0.7) {
    traits.push('You value alliances highly and prefer cooperative strategies.');
  } else if (personality.cooperativeness <= 0.3) {
    traits.push('You prefer to work alone and are skeptical of alliances.');
  }

  if (personality.aggression >= 0.7) {
    traits.push('You favor aggressive, attacking strategies.');
  } else if (personality.aggression <= 0.3) {
    traits.push('You prefer defensive, cautious play.');
  }

  if (personality.patience >= 0.7) {
    traits.push('You think long-term and are willing to sacrifice short-term gains.');
  } else if (personality.patience <= 0.3) {
    traits.push('You prefer immediate gains over long-term positioning.');
  }

  if (personality.trustworthiness >= 0.7) {
    traits.push('You honor your commitments and build reputation through reliability.');
  } else if (personality.trustworthiness <= 0.3) {
    traits.push('You break promises when advantageous, viewing them as tactical tools.');
  }

  if (personality.paranoia >= 0.7) {
    traits.push('You are highly suspicious of others and expect betrayal.');
  } else if (personality.paranoia <= 0.3) {
    traits.push('You generally trust others until given reason not to.');
  }

  if (personality.deceptiveness >= 0.7) {
    traits.push('You use deception and misdirection as key strategic tools.');
  } else if (personality.deceptiveness <= 0.3) {
    traits.push('You prefer honest diplomacy and straightforward communication.');
  }

  return traits.length > 0
    ? traits.join('\n')
    : 'You have a balanced, adaptable playstyle.';
}

/**
 * Build the turn prompt with current game state and context.
 */
export function buildTurnPrompt(
  gameView: AgentGameView,
  memory: AgentMemory,
  recentMessages: string[],
  phase: Phase
): string {
  const sections: string[] = [];

  // Current game state
  sections.push(buildGameStateSection(gameView));

  // Relationships and trust
  sections.push(`## Your Relationships\n${getRelationshipSummary(memory)}`);

  // Recent events
  const events = getRecentEvents(memory, 5);
  if (events.length > 0) {
    sections.push(`## Recent Events\n${events.map(e =>
      `- ${e.year} ${e.season}: ${e.description}`
    ).join('\n')}`);
  }

  // High priority notes
  const notes = getHighPriorityNotes(memory);
  if (notes.length > 0) {
    sections.push(`## Strategic Notes\n${notes.map(n =>
      `- [${n.priority}] ${n.content}`
    ).join('\n')}`);
  }

  // Recent diplomatic messages
  if (recentMessages.length > 0) {
    sections.push(`## Recent Diplomatic Messages\n${recentMessages.join('\n\n')}`);
  }

  // Phase-specific instructions
  sections.push(getPhaseInstructions(phase, gameView));

  return sections.join('\n\n');
}

/**
 * Build the game state section of the prompt.
 */
function buildGameStateSection(view: AgentGameView): string {
  const lines: string[] = [];

  lines.push(`## Current Game State`);
  lines.push(`**Year**: ${view.year} **Season**: ${view.season} **Phase**: ${view.phase}`);

  // Your units
  lines.push(`\n### Your Units (${view.myUnits.length})`);
  for (const unit of view.myUnits) {
    const coastStr = unit.coast ? ` (${unit.coast} coast)` : '';
    lines.push(`- ${unit.type === 'ARMY' ? 'A' : 'F'} ${unit.province}${coastStr}`);
  }

  // Supply centers
  const yourSCs = view.supplyCenters.get(view.viewingPower) ?? [];
  lines.push(`\n### Your Supply Centers (${yourSCs.length})`);
  lines.push(yourSCs.join(', ') || 'None');

  // Other powers' units and SCs
  lines.push(`\n### Other Powers`);
  for (const [power, units] of view.otherUnits) {
    const scs = view.supplyCenters.get(power) ?? [];
    lines.push(`**${power}**: ${units.length} units, ${scs.length} SCs`);
    if (units.length > 0) {
      lines.push(`  Units: ${units.map(u =>
        `${u.type === 'ARMY' ? 'A' : 'F'} ${u.province}`
      ).join(', ')}`);
    }
  }

  // Pending retreats
  if (view.pendingRetreats && view.pendingRetreats.length > 0) {
    lines.push(`\n### Units Requiring Retreat`);
    for (const retreat of view.pendingRetreats) {
      lines.push(`- ${retreat.unit.type === 'ARMY' ? 'A' : 'F'} ${retreat.unit.province}`);
      lines.push(`  Dislodged from: ${retreat.dislodgedFrom}`);
      lines.push(`  Can retreat to: ${retreat.retreatOptions.join(', ') || 'MUST DISBAND'}`);
    }
  }

  // Build count
  if (view.buildCount !== undefined) {
    if (view.buildCount > 0) {
      lines.push(`\n### Builds Available: ${view.buildCount}`);
      if (view.availableBuildLocations) {
        lines.push(`Can build in: ${view.availableBuildLocations.join(', ')}`);
      }
    } else if (view.buildCount < 0) {
      lines.push(`\n### Must Disband: ${Math.abs(view.buildCount)} unit(s)`);
    }
  }

  // Last order results
  if (view.lastOrderResults && view.lastOrderResults.length > 0) {
    lines.push(`\n### Last Turn Results`);
    for (const result of view.lastOrderResults) {
      const status = result.success ? '✓' : '✗';
      const reason = result.reason ? ` (${result.reason})` : '';
      lines.push(`${status} ${result.order}${reason}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get phase-specific instructions.
 */
function getPhaseInstructions(phase: Phase, view: AgentGameView): string {
  switch (phase) {
    case 'DIPLOMACY':
      return `## Your Task: Diplomacy Phase
Communicate with other powers to form alliances, share information, and coordinate strategies.

Respond with:
1. **MESSAGES**: Messages to send to other powers
2. **ANALYSIS**: Your assessment of the current situation
3. **INTENTIONS**: Your planned strategy (kept private from others)

Format messages as:
\`\`\`
TO [POWER]: [Your message]
\`\`\``;

    case 'MOVEMENT':
      return `## Your Task: Submit Orders
Submit orders for all ${view.myUnits.length} of your units.

Respond with:
1. **REASONING**: Brief explanation of your strategy
2. **ORDERS**: Your orders in the exact format specified

Remember: All orders are submitted simultaneously and revealed at once.`;

    case 'RETREAT':
      return `## Your Task: Submit Retreats
You have dislodged units that must retreat or disband.

Respond with:
1. **RETREATS**: Retreat orders for each dislodged unit

Format:
\`\`\`
RETREATS:
[Unit] [Province] -> [Destination]
[Unit] [Province] DISBAND
\`\`\``;

    case 'BUILD':
      if (view.buildCount && view.buildCount > 0) {
        return `## Your Task: Build Units
You may build ${view.buildCount} new unit(s) in your unoccupied home supply centers.

Available locations: ${view.availableBuildLocations?.join(', ') || 'None'}

Respond with:
1. **REASONING**: Which builds best support your strategy
2. **BUILDS**: Your build orders

Format:
\`\`\`
BUILDS:
BUILD [A/F] [Province]
\`\`\``;
      } else {
        return `## Your Task: Disband Units
You must disband ${Math.abs(view.buildCount ?? 0)} unit(s).

Respond with:
1. **REASONING**: Which units are least valuable
2. **BUILDS**: Your disband orders

Format:
\`\`\`
BUILDS:
DISBAND [A/F] [Province]
\`\`\``;
      }

    default:
      return '## Your Task\nAwait further instructions.';
  }
}

/**
 * Build a diplomatic message prompt.
 */
export function buildDiplomacyPrompt(
  _fromPower: Power,
  toPower: Power,
  memory: AgentMemory,
  context: string
): string {
  const relationship = memory.relationships.get(toPower);
  const trustLevel = memory.trustLevels.get(toPower) ?? 0;

  return `## Compose Message to ${toPower}

Your relationship with ${toPower}:
- Trust Level: ${trustLevel.toFixed(2)} (${getTrustLabel(trustLevel)})
- Status: ${relationship?.isAlly ? 'ALLY' : relationship?.isEnemy ? 'ENEMY' : 'NEUTRAL'}
${relationship?.commitments.filter(c => !c.fulfilled && !c.broken).length
    ? `- Active commitments: ${relationship.commitments.filter(c => !c.fulfilled && !c.broken).length}`
    : ''}

Context: ${context}

Compose your message. Remember:
- Be diplomatic but strategic
- Consider what information to share or withhold
- Your message history affects trust

Respond with just the message content.`;
}

/**
 * Get a human-readable trust label.
 */
function getTrustLabel(trust: number): string {
  if (trust >= 0.7) return 'Strong Trust';
  if (trust >= 0.3) return 'Moderate Trust';
  if (trust >= -0.3) return 'Neutral';
  if (trust >= -0.7) return 'Distrust';
  return 'Strong Distrust';
}

/**
 * Build a memory update prompt for after a turn.
 */
export function buildMemoryUpdatePrompt(
  _power: Power,
  turnEvents: string,
  orderResults: string
): string {
  return `## Update Your Memory

The turn has completed. Review what happened and update your strategic memory.

### Events This Turn
${turnEvents}

### Order Results
${orderResults}

Based on these events, provide updates to your memory:

1. **TRUST_UPDATES**: Which powers' trust levels should change and why?
2. **EVENTS**: What significant events should be recorded?
3. **STRATEGIC_NOTES**: Any new observations or plans?
4. **COMMITMENTS**: Any commitments fulfilled, broken, or made?

Format your response as:
\`\`\`
TRUST_UPDATES:
[POWER]: [+/-][amount] - [reason]

EVENTS:
- [description]

STRATEGIC_NOTES:
- [note]

COMMITMENTS:
- FULFILLED: [description]
- BROKEN: [description]
\`\`\``;
}
