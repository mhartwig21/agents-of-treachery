/**
 * Phase reflection system for betrayal detection.
 *
 * After each phase resolution, generates a reflection that:
 * 1. Compares promises made to actions taken
 * 2. Identifies betrayals and cooperation
 * 3. Updates trust levels with reasoning
 * 4. Records strategic observations
 *
 * Inspired by GoodStartLabs/AI_Diplomacy generate_phase_result_diary_entry().
 */

import type { Power, Season, Order, OrderResolution } from '../engine/types';
import { POWERS } from '../engine/types';
import type { Message } from '../press/types';
import type {
  AgentMemory,
  PhaseReflection,
  TrustUpdate,
  PhaseObservation,
  LLMProvider,
  TrustLevel,
} from './types';
import { addReflectionEntry } from './diary';

/**
 * Format orders for display in the reflection prompt.
 */
function formatOrders(orders: Order[]): string {
  return orders.map(order => {
    switch (order.type) {
      case 'HOLD':
        return `${order.unit} HOLD`;
      case 'MOVE':
        return `${order.unit} -> ${order.destination}`;
      case 'SUPPORT':
        return order.destination
          ? `${order.unit} SUPPORT ${order.supportedUnit} -> ${order.destination}`
          : `${order.unit} SUPPORT ${order.supportedUnit}`;
      case 'CONVOY':
        return `${order.unit} CONVOY ${order.convoyedUnit} -> ${order.destination}`;
    }
  }).join('\n');
}

/**
 * Extract relevant messages between the reflecting power and another power.
 */
function getRelevantMessages(
  messages: Message[],
  reflectingPower: Power,
  otherPower: Power
): Message[] {
  return messages.filter(m =>
    (m.sender === reflectingPower && m.recipients?.includes(otherPower)) ||
    (m.sender === otherPower && m.recipients?.includes(reflectingPower)) ||
    (m.sender === otherPower && (!m.recipients || m.recipients.length === 0))
  );
}

/**
 * Convert trust level to human-readable description.
 */
function getTrustDescription(trust: TrustLevel): string {
  if (trust >= 0.8) return 'Very High';
  if (trust >= 0.5) return 'High';
  if (trust >= 0.2) return 'Moderate';
  if (trust >= -0.2) return 'Neutral';
  if (trust >= -0.5) return 'Low';
  if (trust >= -0.8) return 'Very Low';
  return 'Hostile';
}

/**
 * Build the reflection prompt for the LLM.
 */
export function buildReflectionPrompt(
  power: Power,
  year: number,
  season: Season,
  ordersSubmitted: Map<Power, Order[]>,
  orderResults: OrderResolution[],
  messagesThisPhase: Message[],
  memory: AgentMemory
): string {
  const sections: string[] = [];

  sections.push(`You are ${power}, reflecting on what happened during ${season} ${year}.`);
  sections.push('Analyze what each power did compared to what they promised or implied.');
  sections.push('');

  // Your orders and results
  const myOrders = ordersSubmitted.get(power) || [];
  const myResults = orderResults.filter(r => {
    const orderUnit = 'unit' in r.order ? r.order.unit : '';
    return myOrders.some(o => o.unit === orderUnit);
  });

  sections.push('## YOUR ORDERS AND RESULTS:');
  if (myOrders.length > 0) {
    sections.push(formatOrders(myOrders));
    sections.push('');
    sections.push('Results:');
    for (const result of myResults) {
      const orderUnit = 'unit' in result.order ? result.order.unit : 'unknown';
      const status = result.success ? 'SUCCESS' : 'FAILED';
      const reason = result.reason ? ` (${result.reason})` : '';
      sections.push(`- ${orderUnit}: ${status}${reason}`);
    }
  } else {
    sections.push('No orders submitted.');
  }
  sections.push('');

  // Analyze each other power
  sections.push('## OTHER POWERS\' ACTIONS:');
  sections.push('');

  for (const otherPower of POWERS) {
    if (otherPower === power) continue;

    const theirOrders = ordersSubmitted.get(otherPower) || [];
    const trustLevel = memory.trustLevels.get(otherPower) ?? 0;
    const relationship = memory.relationships.get(otherPower);
    const relevantMessages = getRelevantMessages(messagesThisPhase, power, otherPower);

    sections.push(`### ${otherPower}`);
    sections.push(`Current trust: ${trustLevel.toFixed(2)} (${getTrustDescription(trustLevel)})`);
    sections.push(`Status: ${relationship?.isAlly ? 'ALLY' : relationship?.isEnemy ? 'ENEMY' : 'NEUTRAL'}`);
    sections.push('');

    // Messages exchanged
    if (relevantMessages.length > 0) {
      sections.push('Messages this phase:');
      for (const msg of relevantMessages.slice(-5)) {
        const direction = msg.sender === power ? 'YOU ->' : '<-';
        sections.push(`  ${direction} ${msg.sender}: "${msg.content.slice(0, 150)}${msg.content.length > 150 ? '...' : ''}"`);
      }
      sections.push('');
    }

    // Their orders
    if (theirOrders.length > 0) {
      sections.push('Their orders:');
      sections.push(formatOrders(theirOrders));
    } else {
      sections.push('No orders observed.');
    }
    sections.push('');
  }

  // Instructions
  sections.push(`## YOUR TASK

Analyze what happened and identify:
1. Who kept their promises? Who broke them?
2. Did anyone attack you unexpectedly?
3. Did anyone provide support as promised?
4. Were there any "lies of omission" (actions not mentioned but harmful to you)?

BETRAYAL INDICATORS:
- Promised support but didn't give it
- Promised not to attack but did
- Promised to move one way but attacked you instead
- Coordinated with your enemy despite alliance with you

Format your response EXACTLY as:

TRUST_UPDATES:
[POWER]: [+/-delta] - [reason]
(Example: FRANCE: -0.3 - Promised support into MUN but attacked BUR instead)

OBSERVATIONS:
[POWER]: [promised | nothing] => [actual action] | [classification]
(Classification: cooperation, betrayal, neutral, surprise_attack, lie_of_omission)

STRATEGIC_SUMMARY:
[2-3 sentences summarizing the key developments this turn]

Be specific about what was promised vs what happened. Only include powers where something notable occurred.`);

  return sections.join('\n');
}

/**
 * Parse the LLM's reflection response.
 */
export function parseReflectionResponse(
  response: string,
  power: Power,
  year: number,
  season: Season
): PhaseReflection {
  const trustUpdates: TrustUpdate[] = [];
  const observations: PhaseObservation[] = [];
  let strategicSummary = '';

  // Parse TRUST_UPDATES section
  const trustMatch = response.match(/TRUST_UPDATES:\s*([\s\S]*?)(?=OBSERVATIONS:|STRATEGIC_SUMMARY:|$)/i);
  if (trustMatch) {
    const trustLines = trustMatch[1].trim().split('\n').filter(l => l.trim());
    for (const line of trustLines) {
      // Match: POWER: +/-0.X - reason
      const match = line.match(/(\w+):\s*([+-]?\d*\.?\d+)\s*-\s*(.+)/);
      if (match) {
        const targetPower = match[1].toUpperCase() as Power;
        const delta = parseFloat(match[2]);
        const reason = match[3].trim();

        if (POWERS.includes(targetPower) && !isNaN(delta)) {
          trustUpdates.push({
            power: targetPower,
            delta: Math.max(-1, Math.min(1, delta)),
            reason,
            isBetrayal: delta < -0.2 || reason.toLowerCase().includes('betray'),
          });
        }
      }
    }
  }

  // Parse OBSERVATIONS section
  const obsMatch = response.match(/OBSERVATIONS:\s*([\s\S]*?)(?=STRATEGIC_SUMMARY:|$)/i);
  if (obsMatch) {
    const obsLines = obsMatch[1].trim().split('\n').filter(l => l.trim());
    for (const line of obsLines) {
      // Match: POWER: promised => actual | classification
      const match = line.match(/(\w+):\s*(.+?)\s*=>\s*(.+?)\s*\|\s*(\w+)/);
      if (match) {
        const targetPower = match[1].toUpperCase() as Power;
        const promised = match[2].trim();
        const actual = match[3].trim();
        const classification = match[4].toLowerCase();

        if (POWERS.includes(targetPower)) {
          const validClassifications = ['cooperation', 'betrayal', 'neutral', 'surprise_attack', 'lie_of_omission'];
          observations.push({
            power: targetPower,
            promised: promised === 'nothing' ? undefined : promised,
            actual,
            classification: validClassifications.includes(classification)
              ? classification as PhaseObservation['classification']
              : 'neutral',
          });
        }
      }
    }
  }

  // Parse STRATEGIC_SUMMARY section
  const summaryMatch = response.match(/STRATEGIC_SUMMARY:\s*([\s\S]*?)$/i);
  if (summaryMatch) {
    strategicSummary = summaryMatch[1].trim();
  }

  // Fallback if no summary extracted
  if (!strategicSummary) {
    strategicSummary = `${season} ${year} reflection completed.`;
  }

  return {
    power,
    year,
    season,
    trustUpdates,
    observations,
    strategicSummary,
    timestamp: new Date(),
  };
}

/**
 * Generate a phase reflection for a power.
 * Uses LLM to analyze what happened vs what was promised.
 */
export async function generatePhaseReflection(
  power: Power,
  year: number,
  season: Season,
  ordersSubmitted: Map<Power, Order[]>,
  orderResults: OrderResolution[],
  messagesThisPhase: Message[],
  memory: AgentMemory,
  llmProvider: LLMProvider
): Promise<PhaseReflection> {
  const prompt = buildReflectionPrompt(
    power,
    year,
    season,
    ordersSubmitted,
    orderResults,
    messagesThisPhase,
    memory
  );

  try {
    const response = await llmProvider.complete({
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
      ],
      maxTokens: 800,
      temperature: 0.3, // Lower temperature for consistent analysis
    });

    return parseReflectionResponse(response.content, power, year, season);
  } catch (error) {
    console.warn(`Phase reflection failed for ${power}:`, error);
    return createFallbackReflection(power, year, season);
  }
}

/**
 * Create a fallback reflection when LLM fails.
 */
function createFallbackReflection(
  power: Power,
  year: number,
  season: Season
): PhaseReflection {
  return {
    power,
    year,
    season,
    trustUpdates: [],
    observations: [],
    strategicSummary: `${season} ${year}: Reflection could not be completed.`,
    timestamp: new Date(),
  };
}

/**
 * Apply reflection trust updates to agent memory.
 */
export function applyReflectionToMemory(
  memory: AgentMemory,
  reflection: PhaseReflection
): void {
  // Apply trust updates
  for (const update of reflection.trustUpdates) {
    const currentTrust = memory.trustLevels.get(update.power) ?? 0;
    const newTrust = Math.max(-1, Math.min(1, currentTrust + update.delta));
    memory.trustLevels.set(update.power, newTrust);

    // Update relationship
    const relationship = memory.relationships.get(update.power);
    if (relationship) {
      relationship.trustLevel = newTrust;
      relationship.lastInteraction = {
        year: reflection.year,
        season: reflection.season,
      };
      relationship.isAlly = newTrust >= 0.5;
      relationship.isEnemy = newTrust <= -0.5;
    }

    // Record betrayal event if applicable
    if (update.isBetrayal) {
      memory.events.push({
        year: reflection.year,
        season: reflection.season,
        type: 'BETRAYAL',
        powers: [update.power],
        description: update.reason,
        impactOnTrust: update.delta,
      });
    }
  }

  // Update allies/enemies lists
  memory.currentAllies = POWERS.filter(p => {
    const rel = memory.relationships.get(p);
    return rel?.isAlly === true;
  });
  memory.currentEnemies = POWERS.filter(p => {
    const rel = memory.relationships.get(p);
    return rel?.isEnemy === true;
  });
}

/**
 * Record reflection in agent's diary.
 */
export function recordReflectionInDiary(
  memory: AgentMemory,
  reflection: PhaseReflection
): void {
  // Build reflection content
  const parts: string[] = [];

  if (reflection.trustUpdates.length > 0) {
    parts.push('Trust changes: ' + reflection.trustUpdates
      .map(u => `${u.power} ${u.delta > 0 ? '+' : ''}${u.delta.toFixed(2)}`)
      .join(', '));
  }

  const betrayals = reflection.observations.filter(o => o.classification === 'betrayal');
  if (betrayals.length > 0) {
    parts.push('BETRAYALS: ' + betrayals.map(b => `${b.power}: ${b.actual}`).join('; '));
  }

  parts.push(reflection.strategicSummary);

  const content = parts.join(' | ');

  addReflectionEntry(
    memory,
    reflection.year,
    reflection.season,
    'MOVEMENT', // Reflections happen after movement resolution
    content
  );
}

/**
 * Format a phase reflection for logging/display.
 */
export function formatReflectionForLog(reflection: PhaseReflection): string {
  const lines: string[] = [];

  lines.push(`[${reflection.power}] Phase Reflection ${reflection.season} ${reflection.year}`);

  if (reflection.trustUpdates.length > 0) {
    lines.push('Trust updates:');
    for (const update of reflection.trustUpdates) {
      const sign = update.delta > 0 ? '+' : '';
      const betrayalTag = update.isBetrayal ? ' [BETRAYAL]' : '';
      lines.push(`  ${update.power}: ${sign}${update.delta.toFixed(2)}${betrayalTag} - ${update.reason}`);
    }
  }

  if (reflection.observations.length > 0) {
    lines.push('Observations:');
    for (const obs of reflection.observations) {
      lines.push(`  ${obs.power}: ${obs.classification} - ${obs.actual}`);
    }
  }

  lines.push(`Summary: ${reflection.strategicSummary}`);

  return lines.join('\n');
}

/**
 * Generate reflections for all powers in parallel.
 */
export async function generateAllReflections(
  year: number,
  season: Season,
  ordersSubmitted: Map<Power, Order[]>,
  orderResults: OrderResolution[],
  messagesThisPhase: Message[],
  memories: Map<Power, AgentMemory>,
  llmProvider: LLMProvider
): Promise<Map<Power, PhaseReflection>> {
  const reflections = new Map<Power, PhaseReflection>();

  const promises = POWERS.map(async (power) => {
    const memory = memories.get(power);
    if (!memory) return;

    const reflection = await generatePhaseReflection(
      power,
      year,
      season,
      ordersSubmitted,
      orderResults,
      messagesThisPhase,
      memory,
      llmProvider
    );

    reflections.set(power, reflection);
  });

  await Promise.all(promises);
  return reflections;
}
