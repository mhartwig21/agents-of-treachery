/**
 * Commentary System - Real-time AI commentary for spectators.
 *
 * This module provides live narrative generation as a Diplomacy game
 * unfolds. The AI commentator analyzes moves, predicts outcomes, and
 * highlights dramatic moments.
 *
 * Components:
 * - types.ts: Core type definitions
 * - generator.ts: LLM-powered commentary generation
 * - service.ts: Game event integration
 * - useCommentary.ts: React hook for consuming commentary
 * - CommentaryPanel.tsx: UI component for spectators
 *
 * Usage:
 *
 * 1. Server-side (with game store):
 * ```ts
 * import { CommentaryService } from './commentary';
 * const service = new CommentaryService(llmProvider);
 * service.attach(gameStore);
 * service.subscribe((entry) => {
 *   // Send to connected spectators
 *   broadcastCommentary(entry);
 * });
 * ```
 *
 * 2. Client-side (React component):
 * ```tsx
 * import { useCommentary, CommentaryPanel } from './commentary';
 *
 * function SpectatorView() {
 *   const commentary = useCommentary();
 *
 *   // Add entries from server
 *   useEffect(() => {
 *     socket.on('commentary', commentary.addEntry);
 *   }, []);
 *
 *   return (
 *     <CommentaryPanel
 *       entries={commentary.entries}
 *       currentEntry={commentary.currentEntry}
 *       isSpeaking={commentary.isSpeaking}
 *       config={commentary.config}
 *       isVoiceAvailable={commentary.isVoiceAvailable}
 *       onConfigChange={commentary.updateConfig}
 *       onSpeak={commentary.speak}
 *       onStopSpeaking={commentary.stopSpeaking}
 *       onClearHistory={commentary.clearHistory}
 *     />
 *   );
 * }
 * ```
 */

// Types
export type {
  CommentaryEntry,
  CommentaryTrigger,
  CommentaryConfig,
  CommentaryStyle,
  CommentaryState,
  CommentaryAction,
  CommentaryGenerationContext,
  EventDetails,
} from './types';

export {
  DEFAULT_COMMENTARY_CONFIG,
  initialCommentaryState,
  commentaryReducer,
} from './types';

// Generator
export { CommentaryGenerator } from './generator';

// Service
export type { CommentaryCallback, CommentaryServiceConfig } from './service';
export { CommentaryService, createMockCommentaryProvider } from './service';

// React hook
export type { UseCommentaryResult, CommentaryService as CommentaryServiceInterface } from './useCommentary';
export { useCommentary } from './useCommentary';
