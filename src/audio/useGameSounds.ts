/**
 * React hook for playing game event sounds.
 *
 * Watches game state changes and plays appropriate sound effects
 * when events occur (battles, builds, captures, etc.)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { GameSnapshot } from '../spectator/types';
import type { LowercasePower } from '../spectator/types';
import { playSound, resumeAudio, type SoundEffect } from './sounds';

/** Events detected from state changes */
export interface DetectedGameEvent {
  type: SoundEffect;
  power?: LowercasePower;
  territory?: string;
  details?: string;
}

/** Options for the hook */
export interface UseGameSoundsOptions {
  /** Whether sounds are enabled */
  enabled?: boolean;
  /** Volume multiplier (0-1) */
  volume?: number;
}

/**
 * Detect dramatic events by comparing snapshots.
 */
function detectEvents(
  prevSnapshot: GameSnapshot | null,
  currentSnapshot: GameSnapshot
): DetectedGameEvent[] {
  const events: DetectedGameEvent[] = [];
  if (!prevSnapshot) return events;

  const prevState = prevSnapshot.gameState;
  const currState = currentSnapshot.gameState;

  // Detect phase changes
  if (
    prevSnapshot.phase !== currentSnapshot.phase ||
    prevSnapshot.year !== currentSnapshot.year ||
    prevSnapshot.season !== currentSnapshot.season
  ) {
    events.push({ type: 'order_resolve' });
  }

  // Detect battles (units that disappeared from contested territories)
  const prevUnitPositions = new Map<string, LowercasePower>();
  for (const unit of prevState.units) {
    prevUnitPositions.set(unit.territory, unit.power);
  }

  const currUnitPositions = new Map<string, LowercasePower>();
  for (const unit of currState.units) {
    currUnitPositions.set(unit.territory, unit.power);
  }

  // Check for battles (position changed hands or unit disappeared)
  for (const [territory, prevPower] of prevUnitPositions) {
    const currPower = currUnitPositions.get(territory);
    if (currPower && currPower !== prevPower) {
      // Position changed hands - battle!
      events.push({ type: 'battle', territory, power: currPower });
    }
  }

  // Detect retreats (units that moved due to dislodgement)
  // This is tricky to detect without events, so we'll rely on phase changes
  if (prevSnapshot.phase === 'RETREAT' && currentSnapshot.phase !== 'RETREAT') {
    const disbanded = prevState.units.length - currState.units.length;
    if (disbanded > 0) {
      events.push({ type: 'disband' });
    }
    if (currState.units.some(u => !prevUnitPositions.has(u.territory))) {
      events.push({ type: 'retreat' });
    }
  }

  // Detect builds
  if (prevSnapshot.phase === 'BUILD' && currentSnapshot.phase !== 'BUILD') {
    const newUnits = currState.units.length - prevState.units.length;
    if (newUnits > 0) {
      events.push({ type: 'build' });
    }
    if (newUnits < 0) {
      events.push({ type: 'disband' });
    }
  }

  // Detect supply center captures
  for (const [territory, currOwner] of Object.entries(currState.supplyCenters)) {
    const prevOwner = prevState.supplyCenters[territory];
    if (currOwner && prevOwner !== currOwner) {
      events.push({
        type: 'capture',
        territory,
        power: currOwner as LowercasePower,
        details: prevOwner ? `from ${prevOwner}` : 'neutral',
      });
    }
  }

  // Detect stabs (betrayals)
  // A stab is when an ally attacks another ally
  // We detect this by looking for support cuts against recent message partners
  // For now, just detect any attack on a power you recently messaged
  const stabEvents = detectStabs(prevSnapshot, currentSnapshot);
  events.push(...stabEvents);

  // Detect eliminations (powers with 0 supply centers)
  const prevCounts = countSupplyCenters(prevState.supplyCenters);
  const currCounts = countSupplyCenters(currState.supplyCenters);

  for (const power of Object.keys(prevCounts) as LowercasePower[]) {
    if (prevCounts[power] > 0 && currCounts[power] === 0) {
      events.push({ type: 'elimination', power });
    }
  }

  // Detect solo victory (18+ supply centers)
  for (const power of Object.keys(currCounts) as LowercasePower[]) {
    if (currCounts[power] >= 18) {
      events.push({ type: 'solo_victory', power });
    }
  }

  return events;
}

/**
 * Count supply centers per power.
 */
function countSupplyCenters(
  supplyCenters: Record<string, LowercasePower | undefined>
): Record<LowercasePower, number> {
  const counts: Record<LowercasePower, number> = {
    england: 0,
    france: 0,
    germany: 0,
    italy: 0,
    austria: 0,
    russia: 0,
    turkey: 0,
  };

  for (const owner of Object.values(supplyCenters)) {
    if (owner) {
      counts[owner]++;
    }
  }

  return counts;
}

/**
 * Detect stabs by analyzing message history and unit movements.
 * A stab is when a power attacks someone they recently sent friendly messages to.
 */
function detectStabs(
  prevSnapshot: GameSnapshot,
  currentSnapshot: GameSnapshot
): DetectedGameEvent[] {
  const events: DetectedGameEvent[] = [];

  // Get messages from previous snapshot (messages sent during that turn's diplomacy phase)
  const recentMessages = prevSnapshot.messages;

  // Build a map of who messaged whom
  const messagePairs = new Set<string>();
  for (const msg of recentMessages) {
    // Extract recipient from channel (bilateral channels are like "bilateral:ENGLAND:FRANCE")
    const channelParts = msg.channelId.split(':');
    if (channelParts[0] === 'bilateral' && channelParts.length >= 3) {
      const [, p1, p2] = channelParts;
      const senderLower = msg.sender.toLowerCase();
      const p1Lower = p1.toLowerCase();
      const p2Lower = p2.toLowerCase();
      if (p1Lower !== p2Lower) {
        const recipient = p1Lower === senderLower ? p2Lower : p1Lower;
        messagePairs.add(`${senderLower}-${recipient}`);
      }
    }
  }

  // Check for attacks between messaging partners
  const prevUnits = new Map<string, LowercasePower>();
  for (const unit of prevSnapshot.gameState.units) {
    prevUnits.set(unit.territory, unit.power);
  }

  const currUnits = new Map<string, LowercasePower>();
  for (const unit of currentSnapshot.gameState.units) {
    currUnits.set(unit.territory, unit.power);
  }

  // Check each messaging pair for attacks
  for (const pair of messagePairs) {
    const [sender, recipient] = pair.split('-') as [LowercasePower, LowercasePower];

    // Check if sender's units are now where recipient's units were
    for (const [territory, prevOwner] of prevUnits) {
      if (prevOwner === recipient) {
        const currOwner = currUnits.get(territory);
        if (currOwner === sender) {
          // Sender took recipient's territory - could be a stab!
          events.push({
            type: 'stab',
            power: sender,
            territory,
            details: `${sender} attacked ${recipient}`,
          });
        }
      }
    }
  }

  return events;
}

/**
 * Hook to play game sounds in response to state changes.
 */
export function useGameSounds(
  currentSnapshot: GameSnapshot | null,
  options: UseGameSoundsOptions = {}
): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  lastEvents: DetectedGameEvent[];
} {
  const { enabled: initialEnabled = true } = options;
  const [enabled, setEnabled] = useState(initialEnabled);
  const prevSnapshotRef = useRef<GameSnapshot | null>(null);
  const [lastEvents, setLastEvents] = useState<DetectedGameEvent[]>([]);
  const hasInteracted = useRef(false);

  // Resume audio on first interaction
  const handleInteraction = useCallback(() => {
    if (!hasInteracted.current) {
      hasInteracted.current = true;
      resumeAudio();
    }
  }, []);

  // Set up interaction listeners
  useEffect(() => {
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [handleInteraction]);

  // Detect and play sounds for game events
  useEffect(() => {
    if (!enabled || !currentSnapshot) return;

    const events = detectEvents(prevSnapshotRef.current, currentSnapshot);
    prevSnapshotRef.current = currentSnapshot;

    if (events.length === 0) return;

    setLastEvents(events);

    // Play sounds with staggered timing to avoid cacophony
    let delay = 0;
    for (const event of events) {
      setTimeout(() => {
        playSound(event.type);
      }, delay);
      delay += 150; // 150ms between sounds
    }
  }, [enabled, currentSnapshot]);

  return {
    enabled,
    setEnabled,
    lastEvents,
  };
}
