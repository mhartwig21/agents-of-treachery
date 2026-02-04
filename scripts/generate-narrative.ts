/**
 * Generate Narrative Script
 *
 * Generates a story-style narrative report for a completed Diplomacy game.
 * Can output as plain markdown or use an LLM for enhanced storytelling.
 *
 * Usage:
 *   npx tsx scripts/generate-narrative.ts <gameId>
 *   npx tsx scripts/generate-narrative.ts <gameId> --output narrative.md
 *   npx tsx scripts/generate-narrative.ts <gameId> --llm  # Use LLM for generation
 *
 * Options:
 *   --output, -o <file>   Write narrative to file instead of stdout
 *   --llm                 Use LLM to generate enhanced narrative (requires API key)
 *   --json                Output raw context as JSON (for debugging)
 *   --help, -h            Show this help message
 */

import { basename } from 'path';
import { writeFileSync } from 'fs';
import {
  extractNarrativeContext,
  generateBasicNarrative,
  formatNarrativeAsMarkdown,
  formatContextForLLM,
  NARRATIVE_SYSTEM_PROMPT,
  type NarrativeReport,
} from '../src/analysis/narrative';
import { listGameLogs } from '../src/server/game-logger';

interface Options {
  gameId: string;
  output?: string;
  useLLM: boolean;
  jsonOutput: boolean;
}

function parseArgs(): Options | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return null;
  }

  const options: Options = {
    gameId: '',
    useLLM: false,
    jsonOutput: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--llm') {
      options.useLLM = true;
    } else if (arg === '--json') {
      options.jsonOutput = true;
    } else if (!arg.startsWith('-')) {
      // Handle full path input
      options.gameId = arg.includes('/') || arg.includes('\\') ? basename(arg, '.jsonl') : arg;
    }
  }

  return options.gameId ? options : null;
}

function showHelp() {
  console.log(`
Generate Narrative - Create story-style reports for Diplomacy games

Usage:
  npx tsx scripts/generate-narrative.ts <gameId> [options]

Options:
  --output, -o <file>   Write narrative to file instead of stdout
  --llm                 Use LLM to generate enhanced narrative (requires API key)
  --json                Output raw context as JSON (for debugging)
  --help, -h            Show this help message

Examples:
  npx tsx scripts/generate-narrative.ts game-123
  npx tsx scripts/generate-narrative.ts game-123 -o narrative.md
  npx tsx scripts/generate-narrative.ts game-123 --json

Available games:`);

  const games = listGameLogs();
  if (games.length === 0) {
    console.log('  (no games found in logs/games/)');
  } else {
    for (const game of games) {
      console.log(`  ${game.gameId} (${(game.size / 1024).toFixed(1)} KB)`);
    }
  }
}

async function generateWithLLM(context: ReturnType<typeof extractNarrativeContext>): Promise<NarrativeReport> {
  // Check for API key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!anthropicKey && !openaiKey) {
    console.error('Error: --llm requires ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
    console.error('Falling back to basic narrative generation...');
    return generateBasicNarrative(context);
  }

  const formattedContext = formatContextForLLM(context);

  try {
    let narrativeText: string;

    if (anthropicKey) {
      // Use Anthropic
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 4096,
          system: NARRATIVE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Please write a compelling narrative for this Diplomacy game:\n\n${formattedContext}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      narrativeText = data.content[0].text;
    } else if (openaiKey) {
      // Use OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 4096,
          messages: [
            { role: 'system', content: NARRATIVE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Please write a compelling narrative for this Diplomacy game:\n\n${formattedContext}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      narrativeText = data.choices[0].message.content;
    } else {
      throw new Error('No API key available');
    }

    // Generate title from basic narrative
    const basicReport = generateBasicNarrative(context);

    return {
      gameId: context.gameId,
      title: basicReport.title,
      narrative: narrativeText,
      keyEvents: context.events.filter((e) => e.importance >= 0.7),
      standings: basicReport.standings,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error(`LLM generation failed: ${error}`);
    console.error('Falling back to basic narrative generation...');
    return generateBasicNarrative(context);
  }
}

async function main() {
  const options = parseArgs();

  if (!options) {
    showHelp();
    process.exit(0);
  }

  console.error(`Generating narrative for game: ${options.gameId}`);

  try {
    // Extract context from game logs
    const context = extractNarrativeContext(options.gameId);

    console.error(`Found ${context.events.length} narrative events`);
    console.error(`Game ended: ${context.winner ? `${context.winner} won` : context.isDraw ? 'draw' : 'ongoing'}`);

    if (options.jsonOutput) {
      // Output raw context as JSON
      const output = JSON.stringify(context, null, 2);
      if (options.output) {
        writeFileSync(options.output, output);
        console.error(`Context written to: ${options.output}`);
      } else {
        console.log(output);
      }
      return;
    }

    // Generate narrative
    let report: NarrativeReport;
    if (options.useLLM) {
      console.error('Generating LLM-enhanced narrative...');
      report = await generateWithLLM(context);
    } else {
      report = generateBasicNarrative(context);
    }

    // Format as markdown
    const markdown = formatNarrativeAsMarkdown(report);

    // Output
    if (options.output) {
      writeFileSync(options.output, markdown);
      console.error(`Narrative written to: ${options.output}`);
    } else {
      console.log(markdown);
    }

    console.error(`\nKey events: ${report.keyEvents.length}`);
    console.error(`Generated at: ${report.generatedAt.toISOString()}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

main();
