/**
 * Sound effect definitions and audio utilities.
 *
 * Uses Web Audio API for low-latency playback of game event sounds.
 */

/** Available sound effect types */
export type SoundEffect =
  | 'order_resolve'      // Phase resolution
  | 'battle'             // Combat/conflict
  | 'retreat'            // Unit retreating
  | 'disband'            // Unit disbanded
  | 'build'              // New unit built
  | 'capture'            // Supply center captured
  | 'stab'               // Betrayal detected
  | 'elimination'        // Power eliminated
  | 'solo_victory'       // Someone won
  | 'draw'               // Game drawn
  | 'message_received';  // New press message

/** Sound configuration */
interface SoundConfig {
  /** Frequency in Hz for generated tones */
  frequency: number;
  /** Duration in seconds */
  duration: number;
  /** Wave type for oscillator */
  type: OscillatorType;
  /** Optional second frequency for complex sounds */
  frequency2?: number;
  /** Gain (volume) 0-1 */
  gain: number;
  /** Attack time in seconds */
  attack: number;
  /** Decay time in seconds */
  decay: number;
}

/** Sound configurations for each effect type */
const SOUND_CONFIGS: Record<SoundEffect, SoundConfig> = {
  order_resolve: {
    frequency: 440,
    duration: 0.15,
    type: 'sine',
    gain: 0.3,
    attack: 0.01,
    decay: 0.1,
  },
  battle: {
    frequency: 200,
    duration: 0.4,
    type: 'sawtooth',
    frequency2: 150,
    gain: 0.4,
    attack: 0.02,
    decay: 0.3,
  },
  retreat: {
    frequency: 300,
    duration: 0.3,
    type: 'triangle',
    frequency2: 200,
    gain: 0.25,
    attack: 0.01,
    decay: 0.25,
  },
  disband: {
    frequency: 150,
    duration: 0.5,
    type: 'sawtooth',
    gain: 0.3,
    attack: 0.01,
    decay: 0.45,
  },
  build: {
    frequency: 523,
    duration: 0.25,
    type: 'sine',
    frequency2: 659,
    gain: 0.3,
    attack: 0.02,
    decay: 0.2,
  },
  capture: {
    frequency: 392,
    duration: 0.3,
    type: 'sine',
    frequency2: 523,
    gain: 0.35,
    attack: 0.02,
    decay: 0.25,
  },
  stab: {
    frequency: 100,
    duration: 0.6,
    type: 'sawtooth',
    frequency2: 80,
    gain: 0.5,
    attack: 0.01,
    decay: 0.5,
  },
  elimination: {
    frequency: 120,
    duration: 1.0,
    type: 'sawtooth',
    gain: 0.4,
    attack: 0.05,
    decay: 0.9,
  },
  solo_victory: {
    frequency: 523,
    duration: 1.5,
    type: 'sine',
    frequency2: 784,
    gain: 0.4,
    attack: 0.1,
    decay: 1.3,
  },
  draw: {
    frequency: 392,
    duration: 0.8,
    type: 'triangle',
    gain: 0.3,
    attack: 0.05,
    decay: 0.7,
  },
  message_received: {
    frequency: 880,
    duration: 0.1,
    type: 'sine',
    gain: 0.15,
    attack: 0.01,
    decay: 0.08,
  },
};

/** Audio context singleton */
let audioContext: AudioContext | null = null;

/** Get or create the audio context */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Play a sound effect using Web Audio API.
 * Generates synthetic sounds for immediate playback.
 */
export function playSound(effect: SoundEffect): void {
  const config = SOUND_CONFIGS[effect];
  if (!config) return;

  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Create oscillator
    const oscillator = ctx.createOscillator();
    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.frequency, now);

    // Create gain node for envelope
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(config.gain, now + config.attack);
    gainNode.gain.linearRampToValueAtTime(0, now + config.attack + config.decay);

    // Connect and play
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + config.duration);

    // Add second oscillator for complex sounds
    if (config.frequency2) {
      const osc2 = ctx.createOscillator();
      osc2.type = config.type;
      osc2.frequency.setValueAtTime(config.frequency2, now);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(config.gain * 0.6, now + config.attack);
      gain2.gain.linearRampToValueAtTime(0, now + config.attack + config.decay);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + config.duration);
    }
  } catch (error) {
    // Silently fail - audio is non-critical
    console.debug('Audio playback failed:', error);
  }
}

/**
 * Resume audio context after user interaction.
 * Required by browsers that suspend audio until user gesture.
 */
export function resumeAudio(): void {
  if (audioContext?.state === 'suspended') {
    audioContext.resume();
  }
}

/**
 * Check if audio is enabled/available.
 */
export function isAudioAvailable(): boolean {
  return typeof AudioContext !== 'undefined';
}
