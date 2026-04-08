import type { OmgPaths } from './types.js';
import { GeminiRunner } from './gemini-runner.js';

export async function runExplore(paths: OmgPaths, prompt: string): Promise<string> {
  const runner = new GeminiRunner(paths);
  const result = await runner.runPrompt(`You are OMG explore mode. Stay read-only and repository-grounded.\n\nPrompt: ${prompt}`, { mode: 'smart' });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Explore failed');
  }
  return result.stdout.trim();
}
