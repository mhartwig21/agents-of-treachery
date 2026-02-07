/**
 * Agent memory and persistence system.
 *
 * Manages persistent memory for AI agents including trust levels,
 * alliance history, betrayals, and strategic notes.
 */

import type { Power, Season, Phase } from '../engine/types';
import { POWERS } from '../engine/types';
import type {
  AgentMemory,
  TrustLevel,
  MemoryEvent,
  Commitment,
  StrategicNote,
  PowerRelationship,
  TurnSummary,
  DiaryEntry,
  YearSummary,
  ConsolidatedBlock,
} from './types';

/**
 * Create initial memory for a new agent.
 */
export function createInitialMemory(power: Power, gameId: string): AgentMemory {
  const trustLevels = new Map<Power, TrustLevel>();
  const relationships = new Map<Power, PowerRelationship>();

  for (const p of POWERS) {
    if (p !== power) {
      trustLevels.set(p, 0); // Neutral initial trust
      relationships.set(p, {
        power: p,
        trustLevel: 0,
        isAlly: false,
        isEnemy: false,
        lastInteraction: null,
        commitments: [],
        notes: [],
      });
    }
  }

  return {
    power,
    gameId,
    lastUpdated: { year: 1901, season: 'SPRING', phase: 'DIPLOMACY' },
    trustLevels,
    relationships,
    events: [],
    activeCommitments: [],
    strategicNotes: [],
    strategicGoals: [],
    territoryPriorities: [],
    currentAllies: [],
    currentEnemies: [],
    turnSummaries: [],
    consolidatedBlocks: [],
    fullPrivateDiary: [],
    yearSummaries: [],
    currentYearDiary: [],
  };
}

/**
 * Update trust level for a power.
 */
export function updateTrust(
  memory: AgentMemory,
  targetPower: Power,
  delta: number,
  year: number,
  season: Season
): void {
  const currentTrust = memory.trustLevels.get(targetPower) ?? 0;
  const newTrust = Math.max(-1, Math.min(1, currentTrust + delta));
  memory.trustLevels.set(targetPower, newTrust);

  const relationship = memory.relationships.get(targetPower);
  if (relationship) {
    relationship.trustLevel = newTrust;
    relationship.lastInteraction = { year, season };

    // Update ally/enemy status based on trust thresholds
    relationship.isAlly = newTrust >= 0.5;
    relationship.isEnemy = newTrust <= -0.5;
  }

  // Update current allies/enemies lists
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
 * Record a significant event in memory.
 */
export function recordEvent(
  memory: AgentMemory,
  event: Omit<MemoryEvent, 'impactOnTrust'>,
  trustImpact: number
): void {
  const fullEvent: MemoryEvent = {
    ...event,
    impactOnTrust: trustImpact,
  };
  memory.events.push(fullEvent);

  // Apply trust impact to involved powers
  for (const power of event.powers) {
    if (power !== memory.power) {
      updateTrust(memory, power, trustImpact, event.year, event.season);
    }
  }
}

/**
 * Add a commitment to memory.
 */
export function addCommitment(
  memory: AgentMemory,
  commitment: Omit<Commitment, 'id'>
): Commitment {
  const id = `commitment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fullCommitment: Commitment = { ...commitment, id };

  memory.activeCommitments.push(fullCommitment);

  const relationship = memory.relationships.get(commitment.toPower);
  if (relationship) {
    relationship.commitments.push(fullCommitment);
  }

  return fullCommitment;
}

/**
 * Mark a commitment as fulfilled.
 */
export function fulfillCommitment(
  memory: AgentMemory,
  commitmentId: string,
  year: number,
  season: Season
): void {
  const commitment = memory.activeCommitments.find(c => c.id === commitmentId);
  if (commitment) {
    commitment.fulfilled = true;

    // Increase trust for honoring commitment
    recordEvent(memory, {
      year,
      season,
      type: 'PROMISE_KEPT',
      powers: [commitment.fromPower, commitment.toPower],
      description: `Commitment fulfilled: ${commitment.description}`,
    }, 0.1);
  }
}

/**
 * Mark a commitment as broken.
 */
export function breakCommitment(
  memory: AgentMemory,
  commitmentId: string,
  year: number,
  season: Season
): void {
  const commitment = memory.activeCommitments.find(c => c.id === commitmentId);
  if (commitment) {
    commitment.broken = true;

    // Decrease trust for breaking commitment
    recordEvent(memory, {
      year,
      season,
      type: 'PROMISE_BROKEN',
      powers: [commitment.fromPower, commitment.toPower],
      description: `Commitment broken: ${commitment.description}`,
    }, -0.3);
  }
}

/**
 * Add a strategic note.
 */
export function addStrategicNote(
  memory: AgentMemory,
  note: Omit<StrategicNote, 'id'>
): StrategicNote {
  const id = `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fullNote: StrategicNote = { ...note, id };
  memory.strategicNotes.push(fullNote);
  return fullNote;
}

/**
 * Remove expired commitments.
 */
export function cleanupExpiredCommitments(
  memory: AgentMemory,
  currentYear: number,
  currentSeason: Season
): void {
  memory.activeCommitments = memory.activeCommitments.filter(c => {
    if (c.fulfilled || c.broken) return false;
    if (c.expiresYear === undefined) return true;

    const seasonOrder = { SPRING: 0, FALL: 1, WINTER: 2 };
    const currentOrder = currentYear * 3 + seasonOrder[currentSeason];
    const expiresOrder = c.expiresYear * 3 + seasonOrder[c.expiresSeason ?? 'WINTER'];

    return currentOrder <= expiresOrder;
  });
}

/**
 * Add a turn summary to memory.
 *
 * Turn summaries accumulate until consolidation is triggered.
 * Consolidation is handled by the consolidation module (consolidateTurnSummaries)
 * which should be called periodically by the runtime. This function only appends.
 */
export function addTurnSummary(memory: AgentMemory, summary: TurnSummary): void {
  memory.turnSummaries.push(summary);

  // Initialize consolidatedBlocks if missing (backward compatibility)
  if (!memory.consolidatedBlocks) {
    memory.consolidatedBlocks = [];
  }
}

/**
 * Update the memory's last updated timestamp.
 */
export function updateMemoryTimestamp(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase
): void {
  memory.lastUpdated = { year, season, phase };
}

/**
 * Get a summary of the agent's current relationships for prompting.
 */
export function getRelationshipSummary(memory: AgentMemory): string {
  const lines: string[] = [];

  for (const [power, rel] of memory.relationships) {
    const trustDesc = getTrustDescription(rel.trustLevel);
    const status = rel.isAlly ? ' (ALLY)' : rel.isEnemy ? ' (ENEMY)' : '';
    lines.push(`- ${power}: Trust ${rel.trustLevel.toFixed(2)} (${trustDesc})${status}`);

    if (rel.commitments.filter(c => !c.fulfilled && !c.broken).length > 0) {
      lines.push(`  Active commitments: ${rel.commitments.filter(c => !c.fulfilled && !c.broken).length}`);
    }
  }

  return lines.join('\n');
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
 * Get recent events for context.
 */
export function getRecentEvents(memory: AgentMemory, count: number = 10): MemoryEvent[] {
  return memory.events.slice(-count);
}

/**
 * Get high-priority strategic notes.
 */
export function getHighPriorityNotes(memory: AgentMemory): StrategicNote[] {
  return memory.strategicNotes.filter(
    n => n.priority === 'HIGH' || n.priority === 'CRITICAL'
  );
}

/**
 * Serialize memory for persistence.
 */
export function serializeMemory(memory: AgentMemory): string {
  const serializable = {
    ...memory,
    trustLevels: Object.fromEntries(memory.trustLevels),
    relationships: Object.fromEntries(
      Array.from(memory.relationships.entries()).map(([k, v]) => [k, v])
    ),
    // Diary entries have Date objects that need to be serialized
    fullPrivateDiary: memory.fullPrivateDiary.map(e => ({
      ...e,
      timestamp: e.timestamp.toISOString(),
    })),
    yearSummaries: memory.yearSummaries.map(s => ({
      ...s,
      consolidatedAt: s.consolidatedAt.toISOString(),
    })),
    consolidatedBlocks: (memory.consolidatedBlocks || []).map(b => ({
      ...b,
      consolidatedAt: b.consolidatedAt.toISOString(),
    })),
    currentYearDiary: memory.currentYearDiary.map(e => ({
      ...e,
      timestamp: e.timestamp.toISOString(),
    })),
  };
  return JSON.stringify(serializable, null, 2);
}

/**
 * Deserialize memory from storage.
 */
export function deserializeMemory(json: string): AgentMemory {
  const parsed = JSON.parse(json);

  // Helper to deserialize diary entries with Date objects
  const deserializeDiaryEntry = (e: any): DiaryEntry => ({
    ...e,
    timestamp: new Date(e.timestamp),
  });

  // Helper to deserialize year summaries with Date objects
  const deserializeYearSummary = (s: any): YearSummary => ({
    ...s,
    consolidatedAt: new Date(s.consolidatedAt),
  });

  // Helper to deserialize consolidated blocks with Date objects
  const deserializeConsolidatedBlock = (b: any): ConsolidatedBlock => ({
    ...b,
    consolidatedAt: new Date(b.consolidatedAt),
  });

  return {
    ...parsed,
    trustLevels: new Map(Object.entries(parsed.trustLevels)),
    relationships: new Map(Object.entries(parsed.relationships)),
    // Deserialize diary fields (handle missing fields for backwards compatibility)
    fullPrivateDiary: (parsed.fullPrivateDiary || []).map(deserializeDiaryEntry),
    yearSummaries: (parsed.yearSummaries || []).map(deserializeYearSummary),
    currentYearDiary: (parsed.currentYearDiary || []).map(deserializeDiaryEntry),
    consolidatedBlocks: (parsed.consolidatedBlocks || []).map(deserializeConsolidatedBlock),
  };
}

/**
 * Memory persistence interface.
 */
export interface MemoryStore {
  save(memory: AgentMemory): Promise<void>;
  load(power: Power, gameId: string): Promise<AgentMemory | null>;
  exists(power: Power, gameId: string): Promise<boolean>;
  delete(power: Power, gameId: string): Promise<void>;
}

/**
 * In-memory store for testing.
 */
export class InMemoryStore implements MemoryStore {
  private memories = new Map<string, AgentMemory>();

  private getKey(power: Power, gameId: string): string {
    return `${gameId}:${power}`;
  }

  async save(memory: AgentMemory): Promise<void> {
    const key = this.getKey(memory.power, memory.gameId);
    this.memories.set(key, structuredClone(memory));
  }

  async load(power: Power, gameId: string): Promise<AgentMemory | null> {
    const key = this.getKey(power, gameId);
    const memory = this.memories.get(key);
    return memory ? structuredClone(memory) : null;
  }

  async exists(power: Power, gameId: string): Promise<boolean> {
    return this.memories.has(this.getKey(power, gameId));
  }

  async delete(power: Power, gameId: string): Promise<void> {
    this.memories.delete(this.getKey(power, gameId));
  }

  clear(): void {
    this.memories.clear();
  }
}

/**
 * File-based memory store for production use.
 */
export class FileMemoryStore implements MemoryStore {
  constructor(private baseDir: string) {}

  private getFilePath(power: Power, gameId: string): string {
    return `${this.baseDir}/${gameId}/${power}.json`;
  }

  async save(memory: AgentMemory): Promise<void> {
    const filePath = this.getFilePath(memory.power, memory.gameId);
    // Note: In production, would need to ensure directory exists
    const serialized = serializeMemory(memory);

    // In a real implementation, use fs.promises.writeFile
    // For now, store in localStorage if in browser or use node fs
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(filePath, serialized);
    } else {
      // Node.js environment - would use fs
      throw new Error('File storage requires Node.js fs module');
    }
  }

  async load(power: Power, gameId: string): Promise<AgentMemory | null> {
    const filePath = this.getFilePath(power, gameId);

    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem(filePath);
      if (data) {
        return deserializeMemory(data);
      }
    }

    return null;
  }

  async exists(power: Power, gameId: string): Promise<boolean> {
    const filePath = this.getFilePath(power, gameId);

    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(filePath) !== null;
    }

    return false;
  }

  async delete(power: Power, gameId: string): Promise<void> {
    const filePath = this.getFilePath(power, gameId);

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(filePath);
    }
  }
}

/**
 * Manager for agent memories with automatic persistence.
 */
export class MemoryManager {
  private memories = new Map<string, AgentMemory>();
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  private getKey(power: Power, gameId: string): string {
    return `${gameId}:${power}`;
  }

  /**
   * Get or create memory for a power.
   */
  async getMemory(power: Power, gameId: string): Promise<AgentMemory> {
    const key = this.getKey(power, gameId);

    // Check cache first
    if (this.memories.has(key)) {
      return this.memories.get(key)!;
    }

    // Try to load from store
    const stored = await this.store.load(power, gameId);
    if (stored) {
      this.memories.set(key, stored);
      return stored;
    }

    // Create new memory
    const memory = createInitialMemory(power, gameId);
    this.memories.set(key, memory);
    return memory;
  }

  /**
   * Save memory to persistent storage.
   */
  async saveMemory(memory: AgentMemory): Promise<void> {
    const key = this.getKey(memory.power, memory.gameId);
    this.memories.set(key, memory);
    await this.store.save(memory);
  }

  /**
   * Save all memories in cache.
   */
  async saveAll(): Promise<void> {
    const promises = Array.from(this.memories.values()).map(m => this.store.save(m));
    await Promise.all(promises);
  }

  /**
   * Clear memory cache (does not affect persistent storage).
   */
  clearCache(): void {
    this.memories.clear();
  }
}
