/**
 * React hook for consuming commentary in spectator components.
 *
 * Provides commentary state, voice synthesis, and controls for
 * spectator UI components.
 */

import { useReducer, useCallback, useEffect, useRef } from 'react';
import {
  type CommentaryEntry,
  type CommentaryConfig,
  type CommentaryState,
  commentaryReducer,
  initialCommentaryState,
} from './types';

/**
 * Hook return type.
 */
export interface UseCommentaryResult {
  /** Current commentary state */
  state: CommentaryState;
  /** All commentary entries */
  entries: CommentaryEntry[];
  /** Currently playing entry */
  currentEntry: CommentaryEntry | null;
  /** Whether voice is speaking */
  isSpeaking: boolean;
  /** Whether generation is in progress */
  isGenerating: boolean;
  /** Current configuration */
  config: CommentaryConfig;

  // Actions
  /** Add a new commentary entry */
  addEntry: (entry: CommentaryEntry) => void;
  /** Speak an entry using voice synthesis */
  speak: (entry: CommentaryEntry) => void;
  /** Stop current speech */
  stopSpeaking: () => void;
  /** Update configuration */
  updateConfig: (config: Partial<CommentaryConfig>) => void;
  /** Clear history */
  clearHistory: () => void;
  /** Clear queue and stop speaking */
  clearQueue: () => void;
  /** Check if voice synthesis is available */
  isVoiceAvailable: boolean;
}

/**
 * Hook for commentary state and voice synthesis.
 */
export function useCommentary(initialConfig?: Partial<CommentaryConfig>): UseCommentaryResult {
  const [state, dispatch] = useReducer(commentaryReducer, {
    ...initialCommentaryState,
    config: { ...initialCommentaryState.config, ...initialConfig },
  });

  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceAvailableRef = useRef<boolean>(typeof window !== 'undefined' && 'speechSynthesis' in window);

  // Process queue when speech ends
  useEffect(() => {
    if (!state.isSpeaking && state.queue.length > 0 && state.config.voiceEnabled) {
      const nextEntry = state.queue[0];
      dispatch({ type: 'DEQUEUE_ENTRY' });
      speakEntry(nextEntry);
    }
  }, [state.isSpeaking, state.queue, state.config.voiceEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceAvailableRef.current && speechSynthRef.current) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /**
   * Speak an entry using Web Speech API.
   */
  const speakEntry = useCallback((entry: CommentaryEntry) => {
    if (!voiceAvailableRef.current || !state.config.voiceEnabled) {
      return;
    }

    // Cancel any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(entry.text);
    utterance.rate = state.config.voiceSpeed;
    utterance.pitch = 1 + state.config.voicePitch;

    utterance.onstart = () => {
      dispatch({ type: 'SET_CURRENT', entry });
      dispatch({ type: 'SET_SPEAKING', isSpeaking: true });
    };

    utterance.onend = () => {
      dispatch({ type: 'SET_CURRENT', entry: null });
      dispatch({ type: 'SET_SPEAKING', isSpeaking: false });
    };

    utterance.onerror = () => {
      dispatch({ type: 'SET_CURRENT', entry: null });
      dispatch({ type: 'SET_SPEAKING', isSpeaking: false });
    };

    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [state.config.voiceEnabled, state.config.voiceSpeed, state.config.voicePitch]);

  /**
   * Add a new commentary entry.
   */
  const addEntry = useCallback((entry: CommentaryEntry) => {
    dispatch({ type: 'ADD_ENTRY', entry });

    // Handle voice based on queue mode
    if (state.config.voiceEnabled) {
      const intensityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      const minIntensityValue = intensityOrder[state.config.minIntensity];
      const entryIntensityValue = intensityOrder[entry.intensity];

      // Skip if below minimum intensity
      if (entryIntensityValue < minIntensityValue) {
        return;
      }

      switch (state.config.queueMode) {
        case 'queue':
          dispatch({ type: 'QUEUE_ENTRY', entry });
          break;
        case 'interrupt':
          dispatch({ type: 'CLEAR_QUEUE' });
          speakEntry(entry);
          break;
        case 'skip':
          if (!state.isSpeaking) {
            speakEntry(entry);
          }
          break;
      }
    }
  }, [state.config, state.isSpeaking, speakEntry]);

  /**
   * Speak a specific entry.
   */
  const speak = useCallback((entry: CommentaryEntry) => {
    speakEntry(entry);
  }, [speakEntry]);

  /**
   * Stop current speech and clear queue.
   */
  const stopSpeaking = useCallback(() => {
    if (voiceAvailableRef.current) {
      window.speechSynthesis.cancel();
    }
    dispatch({ type: 'SET_SPEAKING', isSpeaking: false });
    dispatch({ type: 'SET_CURRENT', entry: null });
  }, []);

  /**
   * Update configuration.
   */
  const updateConfig = useCallback((config: Partial<CommentaryConfig>) => {
    dispatch({ type: 'UPDATE_CONFIG', config });
  }, []);

  /**
   * Clear history.
   */
  const clearHistory = useCallback(() => {
    dispatch({ type: 'CLEAR_HISTORY' });
  }, []);

  /**
   * Clear queue and stop speaking.
   */
  const clearQueue = useCallback(() => {
    stopSpeaking();
    dispatch({ type: 'CLEAR_QUEUE' });
  }, [stopSpeaking]);

  return {
    state,
    entries: state.entries,
    currentEntry: state.currentEntry,
    isSpeaking: state.isSpeaking,
    isGenerating: state.isGenerating,
    config: state.config,
    addEntry,
    speak,
    stopSpeaking,
    updateConfig,
    clearHistory,
    clearQueue,
    isVoiceAvailable: voiceAvailableRef.current,
  };
}

/**
 * Hook for managing commentary generation with an LLM provider.
 * This is used by the server-side to generate commentary.
 */
export interface CommentaryService {
  /** Generate and add commentary */
  generateForEvent: (trigger: string, details: unknown) => Promise<CommentaryEntry | null>;
  /** Set generating state */
  setGenerating: (isGenerating: boolean) => void;
}
