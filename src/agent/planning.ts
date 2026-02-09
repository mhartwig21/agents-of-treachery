/**
 * Strategic planning system for pre-turn deliberation.
 *
 * Before order generation, agents create a strategic manifesto:
 * "This turn I will: secure Munich, probe Russian intentions, honor French alliance."
 *
 * The plan informs both diplomatic messaging AND order generation,
 * creating coherent strategy across the turn's phases.
 */

import type { Power, Season, GameState } from '../engine/types';
import { POWERS } from '../engine/types';
import type {
  AgentMemory,
  StrategicPlan,
  LLMProvider,
} from './types';
import { addDiaryEntry, createDiaryEntry } from './diary';
import {
  generatePowerStrategicContext,
  formatStrategicContextMarkdown,
} from './pathfinding';
import { getRelationshipSummary, getRecentEvents } from './memory';
import { getContextDiary } from './diary';

/**
 * Build the planning prompt for the LLM.
 * Provides the agent with full strategic context to generate a manifesto.
 */
export function buildPlanningPrompt(
  power: Power,
  year: number,
  season: Season,
  memory: AgentMemory,
  gameState: GameState
): string {
  const sections: string[] = [];

  sections.push(`You are ${power} at the start of ${season} ${year}.`);
  sections.push('Before taking any actions, create a STRATEGIC PLAN for this turn.');
  sections.push('This plan will guide your diplomacy AND your orders.\n');

  // Board position
  sections.push('## Current Board Position');
  const myUnits = gameState.units.filter(u => u.power === power);
  const mySCs: string[] = [];
  for (const [prov, owner] of gameState.supplyCenters) {
    if (owner === power) mySCs.push(prov);
  }
  sections.push(`Your units (${myUnits.length}): ${myUnits.map(u => `${u.type === 'ARMY' ? 'A' : 'F'} ${u.province}`).join(', ')}`);
  sections.push(`Your SCs (${mySCs.length}/18 needed): ${mySCs.join(', ')}`);
  sections.push('');

  // Other powers' positions
  sections.push('Other powers:');
  for (const p of POWERS) {
    if (p === power) continue;
    const units = gameState.units.filter(u => u.power === p);
    const scs: string[] = [];
    for (const [prov, owner] of gameState.supplyCenters) {
      if (owner === p) scs.push(prov);
    }
    sections.push(`- ${p}: ${units.length}u/${scs.length}sc`);
  }
  sections.push('');

  // Strategic analysis
  const strategicContext = generatePowerStrategicContext(power, gameState);
  sections.push(formatStrategicContextMarkdown(strategicContext));

  // Relationships and trust
  sections.push(`## Relationships\n${getRelationshipSummary(memory)}`);

  // Recent events
  const events = getRecentEvents(memory, 5);
  if (events.length > 0) {
    sections.push('## Recent Events');
    for (const e of events) {
      sections.push(`- ${e.year} ${e.season}: ${e.description}`);
    }
    sections.push('');
  }

  // Diary context for historical awareness
  const diaryContext = getContextDiary(memory);
  if (diaryContext) {
    sections.push(diaryContext);
  }

  // Previous plan (if any, for continuity)
  if (memory.currentTurnPlan) {
    sections.push('## Previous Turn Plan');
    sections.push(`Objectives: ${memory.currentTurnPlan.objectives.join('; ')}`);
    sections.push(`Result context: Review what happened since this plan was made.`);
    sections.push('');
  }

  // Instructions
  sections.push(`## YOUR TASK: Create Strategic Plan for ${season} ${year}

Generate a strategic manifesto for this turn. Think about:
1. What are your 2-4 key objectives this turn?
2. Which 1-2 powers should you focus diplomacy on? What deals to propose?
3. What military moves advance your position? Which SCs to target?
4. What if your main plan fails? What's the backup?

Format your response EXACTLY as:

OBJECTIVES:
- [objective 1]
- [objective 2]
- [objective 3]

DIPLOMATIC_STRATEGY:
[Who to talk to, what to propose, what information to share/withhold.
Be specific: "Propose France a DMZ in Burgundy in exchange for support into Belgium."]

MILITARY_PLAN:
[Where to move units, which SCs to target, what supports to arrange.
Be specific: "Move A PAR -> BUR, use F MAO to threaten SPA."]

CONTINGENCIES:
[What if key moves fail? What if an ally betrays you?
Be specific: "If France moves to BUR, fall back to defensive line at PAR-MAR."]

Keep each section concise (2-4 sentences). Be SPECIFIC with province names and power names.`);

  return sections.join('\n');
}

/**
 * Parse the LLM's planning response into a structured plan.
 */
export function parsePlanResponse(
  response: string,
  power: Power,
  year: number,
  season: Season
): StrategicPlan {
  const objectives: string[] = [];
  let diplomaticStrategy = '';
  let militaryPlan = '';
  let contingencies = '';

  // Parse OBJECTIVES section
  const objMatch = response.match(/OBJECTIVES:\s*([\s\S]*?)(?=DIPLOMATIC_STRATEGY:|MILITARY_PLAN:|CONTINGENCIES:|$)/i);
  if (objMatch) {
    const lines = objMatch[1].trim().split('\n').filter(l => l.trim());
    for (const line of lines) {
      const cleaned = line.replace(/^[-*\d.)\s]+/, '').trim();
      if (cleaned) {
        objectives.push(cleaned);
      }
    }
  }

  // Parse DIPLOMATIC_STRATEGY section
  const dipMatch = response.match(/DIPLOMATIC_STRATEGY:\s*([\s\S]*?)(?=MILITARY_PLAN:|CONTINGENCIES:|$)/i);
  if (dipMatch) {
    diplomaticStrategy = dipMatch[1].trim();
  }

  // Parse MILITARY_PLAN section
  const milMatch = response.match(/MILITARY_PLAN:\s*([\s\S]*?)(?=CONTINGENCIES:|$)/i);
  if (milMatch) {
    militaryPlan = milMatch[1].trim();
  }

  // Parse CONTINGENCIES section
  const contMatch = response.match(/CONTINGENCIES:\s*([\s\S]*?)$/i);
  if (contMatch) {
    contingencies = contMatch[1].trim();
  }

  // Fallbacks
  if (objectives.length === 0) {
    objectives.push('Maintain current position and evaluate threats');
  }
  if (!diplomaticStrategy) {
    diplomaticStrategy = 'Engage with neighboring powers.';
  }
  if (!militaryPlan) {
    militaryPlan = 'Hold current positions and look for expansion opportunities.';
  }
  if (!contingencies) {
    contingencies = 'Fall back to defensive positions if threatened.';
  }

  return {
    power,
    year,
    season,
    objectives,
    diplomaticStrategy,
    militaryPlan,
    contingencies,
    manifesto: response,
    timestamp: new Date(),
  };
}

/**
 * Generate a strategic plan for a power.
 * Uses LLM to create a manifesto that will guide the entire turn.
 */
export async function generateStrategicPlan(
  power: Power,
  year: number,
  season: Season,
  memory: AgentMemory,
  gameState: GameState,
  llmProvider: LLMProvider
): Promise<StrategicPlan> {
  const prompt = buildPlanningPrompt(power, year, season, memory, gameState);

  try {
    const response = await llmProvider.complete({
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
      ],
      maxTokens: 600,
      temperature: 0.5, // Moderate temperature for creative but focused planning
    });

    return parsePlanResponse(response.content, power, year, season);
  } catch (error) {
    console.warn(`Strategic planning failed for ${power}:`, error);
    return createFallbackPlan(power, year, season);
  }
}

/**
 * Create a fallback plan when LLM fails.
 */
function createFallbackPlan(
  power: Power,
  year: number,
  season: Season
): StrategicPlan {
  return {
    power,
    year,
    season,
    objectives: ['Maintain current position', 'Evaluate threats and opportunities'],
    diplomaticStrategy: 'Engage with neighboring powers to assess intentions.',
    militaryPlan: 'Hold current positions.',
    contingencies: 'Fall back to defensive positions if threatened.',
    manifesto: `[Planning failed - using default strategy for ${season} ${year}]`,
    timestamp: new Date(),
  };
}

/**
 * Record a strategic plan in the agent's diary.
 */
export function recordPlanInDiary(
  memory: AgentMemory,
  plan: StrategicPlan
): void {
  const content = [
    `PLAN: ${plan.objectives.join('; ')}`,
    `DIP: ${plan.diplomaticStrategy.slice(0, 150)}`,
    `MIL: ${plan.militaryPlan.slice(0, 150)}`,
  ].join(' | ');

  const entry = createDiaryEntry(
    plan.year,
    plan.season,
    'DIPLOMACY',
    'planning',
    content
  );
  addDiaryEntry(memory, entry);
}

/**
 * Format a strategic plan for inclusion in agent turn prompts.
 * This is the key integration point - the plan appears in both
 * diplomacy and movement prompts to ensure coherent strategy.
 */
export function formatPlanForPrompt(plan: StrategicPlan): string {
  const lines: string[] = [];

  lines.push('## Your Strategic Plan (generated at start of turn)');
  lines.push('');
  lines.push('**Objectives:**');
  for (const obj of plan.objectives) {
    lines.push(`- ${obj}`);
  }
  lines.push('');
  lines.push(`**Diplomatic Strategy:** ${plan.diplomaticStrategy}`);
  lines.push('');
  lines.push(`**Military Plan:** ${plan.militaryPlan}`);
  lines.push('');
  lines.push(`**Contingencies:** ${plan.contingencies}`);
  lines.push('');
  lines.push('**IMPORTANT:** Execute this plan. Your diplomacy should advance these objectives. Your orders should implement this military plan. Deviate only if new information makes the plan clearly wrong.');

  return lines.join('\n');
}
