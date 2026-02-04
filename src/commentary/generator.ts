/**
 * Commentary Generator - LLM-powered commentary generation.
 *
 * Generates engaging, contextual commentary for spectators watching
 * a Diplomacy game unfold in real-time.
 */

import type { LLMProvider, ConversationMessage } from '../agent/types';
import type {
  CommentaryEntry,
  CommentaryGenerationContext,
  CommentaryStyle,
  CommentaryTrigger,
  EventDetails,
} from './types';
import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';

/**
 * System prompts for different commentary styles.
 */
const STYLE_PROMPTS: Record<CommentaryStyle, string> = {
  neutral: `You are an objective Diplomacy game commentator. Provide clear, factual commentary on game events. Focus on what happened and its strategic implications. Avoid speculation or dramatic language.`,

  dramatic: `You are a dramatic Diplomacy commentator who loves the intrigue and betrayal of the game. Use vivid language to describe the tension, alliances forming and breaking, and the high stakes of each move. Build suspense and highlight dramatic moments.`,

  analytical: `You are an expert Diplomacy analyst providing strategic insights. Comment on the tactical wisdom of moves, evaluate power positions, predict likely outcomes, and explain the strategic implications of events. Reference historical game patterns when relevant.`,

  sportscaster: `You are an energetic sports commentator for Diplomacy. Bring excitement to every move! Use play-by-play style commentary with enthusiasm. Build hype for dramatic moments and create memorable calls for significant events.`,

  historian: `You are a historian documenting this Diplomacy game for posterity. Provide context about how events fit into the larger narrative of the game. Reference past betrayals and alliances, track the rise and fall of powers, and frame events in their historical context.`,
};

/**
 * Base system prompt for all commentary.
 */
const BASE_SYSTEM_PROMPT = `You are providing real-time commentary for spectators watching an AI Diplomacy game.

Rules:
- Keep commentary brief (1-3 sentences)
- Use present tense for ongoing events
- Reference specific powers and territories by name
- Highlight strategic significance
- Be engaging for spectators who may not know all the backstory
- Never break character or mention that you're an AI

The seven powers are: England, France, Germany, Italy, Austria, Russia, and Turkey.
Victory requires controlling 18 of 34 supply centers.`;

/**
 * Generates commentary for game events.
 */
export class CommentaryGenerator {
  private llmProvider: LLMProvider;
  private defaultStyle: CommentaryStyle;
  private entryCounter: number = 0;

  constructor(llmProvider: LLMProvider, style: CommentaryStyle = 'dramatic') {
    this.llmProvider = llmProvider;
    this.defaultStyle = style;
  }

  /**
   * Set the default commentary style.
   */
  setStyle(style: CommentaryStyle): void {
    this.defaultStyle = style;
  }

  /**
   * Get the current default style.
   */
  getStyle(): CommentaryStyle {
    return this.defaultStyle;
  }

  /**
   * Generate commentary for a game event.
   */
  async generateCommentary(context: CommentaryGenerationContext): Promise<CommentaryEntry> {
    const prompt = this.buildPrompt(context);
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${STYLE_PROMPTS[context.style]}`;

    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt, timestamp: new Date() },
      { role: 'user', content: prompt, timestamp: new Date() },
    ];

    const result = await this.llmProvider.complete({
      messages,
      temperature: 0.8, // Higher temperature for more varied commentary
      maxTokens: 150, // Keep it brief
    });

    const text = result.content.trim();
    const intensity = this.determineIntensity(context);
    const mentionedPowers = this.extractMentionedPowers(text);
    const mentionedTerritories = this.extractMentionedTerritories(text);

    return {
      id: this.generateEntryId(),
      text,
      timestamp: new Date(),
      context: {
        year: context.gameState.year,
        season: context.gameState.season,
        phase: context.gameState.phase,
      },
      trigger: context.trigger,
      intensity,
      mentionedPowers,
      mentionedTerritories,
      voiceDuration: this.estimateVoiceDuration(text),
    };
  }

  /**
   * Generate quick commentary without LLM (for high-frequency events).
   */
  generateQuickCommentary(
    trigger: CommentaryTrigger,
    details: EventDetails,
    gameContext: CommentaryGenerationContext['gameState']
  ): CommentaryEntry {
    const text = this.generateTemplatedCommentary(trigger, details);
    const intensity = this.determineIntensityFromDetails(trigger, details);

    return {
      id: this.generateEntryId(),
      text,
      timestamp: new Date(),
      context: {
        year: gameContext.year,
        season: gameContext.season,
        phase: gameContext.phase,
      },
      trigger,
      intensity,
      mentionedPowers: this.extractPowersFromDetails(details),
      mentionedTerritories: this.extractTerritoriesFromDetails(details),
      voiceDuration: this.estimateVoiceDuration(text),
    };
  }

  /**
   * Build the prompt for LLM commentary generation.
   */
  private buildPrompt(context: CommentaryGenerationContext): string {
    const { gameState, trigger, eventDetails } = context;

    let prompt = `Current game state: Year ${gameState.year}, ${gameState.season} ${gameState.phase}\n`;
    prompt += `Supply center counts: ${this.formatSupplyCounts(gameState.supplyCenterCounts)}\n`;

    if (gameState.eliminatedPowers.length > 0) {
      prompt += `Eliminated powers: ${gameState.eliminatedPowers.join(', ')}\n`;
    }

    prompt += `\nEvent to commentate: ${trigger}\n`;
    prompt += `Details: ${this.formatEventDetails(eventDetails)}\n`;

    if (context.recentHistory) {
      prompt += `\nRecent history:\n${context.recentHistory}\n`;
    }

    if (context.relationships) {
      prompt += `\nKnown relationships:\n${context.relationships}\n`;
    }

    prompt += `\nProvide brief, engaging commentary for this event:`;

    return prompt;
  }

  /**
   * Format supply center counts for the prompt.
   */
  private formatSupplyCounts(counts: Record<Power, number>): string {
    return POWERS
      .filter(p => counts[p] > 0)
      .map(p => `${p}: ${counts[p]}`)
      .join(', ');
  }

  /**
   * Format event details for the prompt.
   */
  private formatEventDetails(details: EventDetails): string {
    switch (details.type) {
      case 'phase_start':
        return `New phase: ${details.newSeason} ${details.newYear} ${details.newPhase}`;

      case 'orders_submitted':
        return `${details.power} submitted ${details.orderCount} orders`;

      case 'movement_resolved':
        let moveText = `${details.successes} successful moves, ${details.failures} failed`;
        if (details.dislodged.length > 0) {
          moveText += `. Dislodged: ${details.dislodged.map(d => `${d.power}'s unit from ${d.from}`).join(', ')}`;
        }
        return moveText;

      case 'retreat_resolved':
        return details.retreats.map(r =>
          r.to ? `${r.power} retreated from ${r.from} to ${r.to}` : `${r.power}'s unit in ${r.from} was destroyed`
        ).join('. ');

      case 'build_resolved':
        const parts: string[] = [];
        if (details.builds.length > 0) {
          parts.push(`Builds: ${details.builds.map(b => `${b.power} in ${b.province}`).join(', ')}`);
        }
        if (details.disbands.length > 0) {
          parts.push(`Disbands: ${details.disbands.map(d => `${d.power} in ${d.province}`).join(', ')}`);
        }
        return parts.join('. ');

      case 'supply_center_captured':
        return details.changes.map(c =>
          c.from ? `${c.to} captured ${c.territory} from ${c.from}` : `${c.to} captured neutral ${c.territory}`
        ).join('. ');

      case 'betrayal_detected':
        return `${details.betrayer} appears to have betrayed ${details.victim}! Evidence: ${details.evidence}`;

      case 'elimination':
        return details.eliminatedBy
          ? `${details.power} has been eliminated by ${details.eliminatedBy}!`
          : `${details.power} has been eliminated from the game!`;

      case 'near_victory':
        return `${details.leader} now controls ${details.supplyCenters} supply centers - only ${18 - details.supplyCenters} more needed for victory!`;

      case 'game_ended':
        return details.winner
          ? `${details.winner} has achieved solo victory!`
          : `The game has ended in a draw!`;

      case 'agent_thinking':
        return `${details.power} is considering their options...`;

      case 'dramatic_moment':
        return details.description;
    }
  }

  /**
   * Generate templated commentary without LLM.
   */
  private generateTemplatedCommentary(_trigger: CommentaryTrigger, details: EventDetails): string {
    switch (details.type) {
      case 'phase_start':
        return `The ${details.newSeason} of ${details.newYear} begins. The ${details.newPhase.toLowerCase()} phase is underway.`;

      case 'orders_submitted':
        return `${details.power} has submitted their orders. ${details.orderCount} units have received instructions.`;

      case 'agent_thinking':
        return `${details.power} deliberates their next move...`;

      case 'movement_resolved':
        if (details.dislodged.length > 0) {
          return `Combat resolved! ${details.dislodged.length} unit${details.dislodged.length > 1 ? 's' : ''} dislodged in the fighting.`;
        }
        return `Orders resolved. ${details.successes} moves successful, ${details.failures} bounced or failed.`;

      case 'supply_center_captured':
        if (details.changes.length === 1) {
          const c = details.changes[0];
          return c.from
            ? `${c.to} seizes ${c.territory} from ${c.from}!`
            : `${c.to} claims the neutral center at ${c.territory}.`;
        }
        return `${details.changes.length} supply centers change hands!`;

      case 'elimination':
        return details.eliminatedBy
          ? `${details.power} falls! Eliminated by ${details.eliminatedBy}.`
          : `${details.power} has been eliminated from the game!`;

      case 'near_victory':
        return `${details.leader} at ${details.supplyCenters} centers! Victory is within reach!`;

      case 'game_ended':
        return details.winner
          ? `${details.winner} achieves solo victory! The game is over.`
          : `The powers agree to a draw. The game ends.`;

      case 'betrayal_detected':
        return `Treachery! ${details.betrayer} has stabbed ${details.victim}!`;

      default:
        return `The game continues...`;
    }
  }

  /**
   * Determine commentary intensity based on context.
   */
  private determineIntensity(context: CommentaryGenerationContext): CommentaryEntry['intensity'] {
    return this.determineIntensityFromDetails(context.trigger, context.eventDetails);
  }

  /**
   * Determine intensity from trigger and details.
   */
  private determineIntensityFromDetails(
    trigger: CommentaryTrigger,
    details: EventDetails
  ): CommentaryEntry['intensity'] {
    // Critical events
    if (trigger === 'game_ended' || trigger === 'elimination' || trigger === 'near_victory') {
      return 'critical';
    }

    // High intensity events
    if (trigger === 'betrayal_detected') {
      return 'high';
    }

    if (details.type === 'movement_resolved' && details.dislodged.length > 0) {
      return 'high';
    }

    if (details.type === 'supply_center_captured' && details.changes.length >= 3) {
      return 'high';
    }

    // Medium intensity
    if (trigger === 'supply_center_captured' || trigger === 'movement_resolved') {
      return 'medium';
    }

    // Low intensity (routine events)
    return 'low';
  }

  /**
   * Extract power names mentioned in commentary text.
   */
  private extractMentionedPowers(text: string): Power[] {
    const mentioned: Power[] = [];
    const lowerText = text.toLowerCase();

    for (const power of POWERS) {
      if (lowerText.includes(power.toLowerCase())) {
        mentioned.push(power);
      }
    }

    return mentioned;
  }

  /**
   * Extract powers from event details.
   */
  private extractPowersFromDetails(details: EventDetails): Power[] {
    const powers: Set<Power> = new Set();

    switch (details.type) {
      case 'orders_submitted':
      case 'agent_thinking':
        powers.add(details.power);
        break;

      case 'movement_resolved':
        details.dislodged.forEach(d => powers.add(d.power));
        break;

      case 'retreat_resolved':
        details.retreats.forEach(r => powers.add(r.power));
        break;

      case 'build_resolved':
        details.builds.forEach(b => powers.add(b.power));
        details.disbands.forEach(d => powers.add(d.power));
        break;

      case 'supply_center_captured':
        details.changes.forEach(c => {
          powers.add(c.to);
          if (c.from) powers.add(c.from);
        });
        break;

      case 'betrayal_detected':
        powers.add(details.betrayer);
        powers.add(details.victim);
        break;

      case 'elimination':
        powers.add(details.power);
        if (details.eliminatedBy) powers.add(details.eliminatedBy);
        break;

      case 'near_victory':
        powers.add(details.leader);
        break;

      case 'game_ended':
        if (details.winner) powers.add(details.winner);
        break;
    }

    return Array.from(powers);
  }

  /**
   * Common territory names for extraction.
   */
  private static COMMON_TERRITORIES = [
    'munich', 'berlin', 'kiel', 'paris', 'marseilles', 'brest', 'london', 'liverpool',
    'edinburgh', 'rome', 'venice', 'naples', 'vienna', 'budapest', 'trieste',
    'moscow', 'st petersburg', 'warsaw', 'sevastopol', 'constantinople', 'ankara',
    'smyrna', 'belgium', 'holland', 'denmark', 'sweden', 'norway', 'spain', 'portugal',
    'tunis', 'greece', 'serbia', 'rumania', 'bulgaria',
  ];

  /**
   * Extract territory names mentioned in text.
   */
  private extractMentionedTerritories(text: string): string[] {
    const mentioned: string[] = [];
    const lowerText = text.toLowerCase();

    for (const territory of CommentaryGenerator.COMMON_TERRITORIES) {
      if (lowerText.includes(territory)) {
        mentioned.push(territory);
      }
    }

    return mentioned;
  }

  /**
   * Extract territories from event details.
   */
  private extractTerritoriesFromDetails(details: EventDetails): string[] {
    const territories: Set<string> = new Set();

    switch (details.type) {
      case 'movement_resolved':
        details.dislodged.forEach(d => territories.add(d.from));
        break;

      case 'retreat_resolved':
        details.retreats.forEach(r => {
          territories.add(r.from);
          if (r.to) territories.add(r.to);
        });
        break;

      case 'build_resolved':
        details.builds.forEach(b => territories.add(b.province));
        details.disbands.forEach(d => territories.add(d.province));
        break;

      case 'supply_center_captured':
        details.changes.forEach(c => territories.add(c.territory));
        break;
    }

    return Array.from(territories);
  }

  /**
   * Estimate voice duration for a text (rough approximation).
   */
  private estimateVoiceDuration(text: string): number {
    // Average speaking rate: ~150 words per minute = ~2.5 words per second
    const words = text.split(/\s+/).length;
    return Math.ceil((words / 2.5) * 1000); // milliseconds
  }

  /**
   * Generate a unique entry ID.
   */
  private generateEntryId(): string {
    return `commentary-${Date.now()}-${++this.entryCounter}`;
  }
}
