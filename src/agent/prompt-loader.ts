/**
 * External prompt file loader with model-specific overrides and hot-reload support.
 *
 * Loads prompts from the prompts/ directory with the following hierarchy:
 * 1. Base prompts (prompts/base/)
 * 2. Model-specific overrides (prompts/claude/, prompts/gpt4/, etc.)
 * 3. Power-specific personalities (prompts/powers/)
 *
 * Supports template variables using {{variable}} syntax.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Power } from '../engine/types';

/**
 * Supported model families for prompt optimization.
 */
export type ModelFamily = 'claude' | 'gpt4' | 'llama' | 'base';

/**
 * Template variables that can be substituted in prompts.
 */
export interface PromptVariables {
  [key: string]: string | number | undefined;
}

/**
 * Prompt cache entry with metadata for hot-reload.
 */
interface CacheEntry {
  content: string;
  mtime: number;
}

/**
 * Configuration for the prompt loader.
 */
export interface PromptLoaderConfig {
  /** Base directory for prompts (default: ./prompts) */
  promptsDir?: string;
  /** Enable hot-reload in development (default: process.env.NODE_ENV === 'development') */
  hotReload?: boolean;
  /** Model family for model-specific overrides */
  modelFamily?: ModelFamily;
}

/**
 * Loads and manages external prompt files.
 */
export class PromptLoader {
  private readonly promptsDir: string;
  private readonly hotReload: boolean;
  private readonly modelFamily: ModelFamily;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(config: PromptLoaderConfig = {}) {
    this.promptsDir = config.promptsDir ?? path.join(process.cwd(), 'prompts');
    this.hotReload = config.hotReload ?? (process.env.NODE_ENV === 'development');
    this.modelFamily = config.modelFamily ?? 'base';
  }

  /**
   * Load a prompt file with model-specific override support.
   *
   * Resolution order:
   * 1. prompts/{modelFamily}/{relativePath} (if exists)
   * 2. prompts/base/{relativePath} (fallback)
   *
   * @param relativePath - Path relative to base/model directory (e.g., 'rules.md')
   * @param variables - Optional template variables to substitute
   */
  load(relativePath: string, variables?: PromptVariables): string {
    const content = this.loadRaw(relativePath);
    return variables ? this.substitute(content, variables) : content;
  }

  /**
   * Load a power-specific personality prompt.
   *
   * Resolution order:
   * 1. prompts/{modelFamily}/powers/{power}.md (if exists)
   * 2. prompts/powers/{power}.md (fallback)
   *
   * @param power - The power to load personality for
   */
  loadPowerPersonality(power: Power): string {
    const filename = `${power.toLowerCase()}.md`;

    // Try model-specific first
    if (this.modelFamily !== 'base') {
      const modelPath = path.join(this.promptsDir, this.modelFamily, 'powers', filename);
      if (this.fileExists(modelPath)) {
        return this.loadFile(modelPath);
      }
    }

    // Fall back to base powers directory
    const basePath = path.join(this.promptsDir, 'powers', filename);
    if (this.fileExists(basePath)) {
      return this.loadFile(basePath);
    }

    // Ultimate fallback - return empty string (caller should handle)
    return '';
  }

  /**
   * Load a power-specific strategy prompt from base/powers/.
   *
   * @param power - The power to load strategy for
   */
  loadPowerStrategy(power: Power): string {
    const filename = `${power.toLowerCase()}.md`;
    const relativePath = path.join('powers', filename);
    return this.loadRaw(relativePath);
  }

  /**
   * Load a phase-specific instruction prompt.
   *
   * @param phase - The game phase (lowercase: diplomacy, movement, retreat, build, disband)
   * @param variables - Template variables to substitute
   */
  loadPhaseInstructions(phase: string, variables?: PromptVariables): string {
    const relativePath = path.join('phases', `${phase.toLowerCase()}.md`);
    return this.load(relativePath, variables);
  }

  /**
   * Load raw content without variable substitution.
   */
  private loadRaw(relativePath: string): string {
    // Try model-specific first
    if (this.modelFamily !== 'base') {
      const modelPath = path.join(this.promptsDir, this.modelFamily, relativePath);
      if (this.fileExists(modelPath)) {
        return this.loadFile(modelPath);
      }
    }

    // Fall back to base
    const basePath = path.join(this.promptsDir, 'base', relativePath);
    return this.loadFile(basePath);
  }

  /**
   * Load a file with caching and optional hot-reload.
   */
  private loadFile(filePath: string): string {
    const cached = this.cache.get(filePath);

    if (cached) {
      if (!this.hotReload) {
        return cached.content;
      }

      // Check if file was modified
      const stats = this.getStats(filePath);
      if (stats && stats.mtimeMs === cached.mtime) {
        return cached.content;
      }
    }

    // Load fresh
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = this.getStats(filePath);

    this.cache.set(filePath, {
      content,
      mtime: stats?.mtimeMs ?? 0,
    });

    return content;
  }

  /**
   * Substitute template variables in content.
   * Variables use {{variableName}} syntax.
   */
  private substitute(content: string, variables: PromptVariables): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = variables[key];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Check if a file exists.
   */
  private fileExists(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file stats or null if not accessible.
   */
  private getStats(filePath: string): fs.Stats | null {
    try {
      return fs.statSync(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Clear the prompt cache (useful for testing or forced reload).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current model family.
   */
  getModelFamily(): ModelFamily {
    return this.modelFamily;
  }

  /**
   * Create a new loader with a different model family.
   */
  withModelFamily(modelFamily: ModelFamily): PromptLoader {
    return new PromptLoader({
      promptsDir: this.promptsDir,
      hotReload: this.hotReload,
      modelFamily,
    });
  }
}

/**
 * Default prompt loader instance.
 */
let defaultLoader: PromptLoader | null = null;

/**
 * Get the default prompt loader instance.
 */
export function getPromptLoader(): PromptLoader {
  if (!defaultLoader) {
    defaultLoader = new PromptLoader();
  }
  return defaultLoader;
}

/**
 * Set a custom default prompt loader (useful for testing).
 */
export function setPromptLoader(loader: PromptLoader | null): void {
  defaultLoader = loader;
}

/**
 * Convenience function to load a prompt with the default loader.
 */
export function loadPrompt(relativePath: string, variables?: PromptVariables): string {
  return getPromptLoader().load(relativePath, variables);
}
