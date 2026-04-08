import type { OmgPaths } from './types.js';
import { GeminiRunner } from './gemini-runner.js';
import { runShell } from './utils/process.js';

export async function runSparkShell(paths: OmgPaths, command: string): Promise<{ shell: string; analysis: string }> {
  const shell = await runShell(command, { cwd: paths.projectRoot });
  const runner = new GeminiRunner(paths);
  const analysis = await runner.runPrompt(`Summarize this shell command result concisely for an operator.\n\nCommand: ${command}\nExit: ${shell.code}\nSTDOUT:\n${shell.stdout}\nSTDERR:\n${shell.stderr}`, { mode: 'smart' });
  if (analysis.code !== 0) {
    throw new Error(analysis.stderr || analysis.stdout || 'SparkShell analysis failed');
  }
  return { shell: shell.stdout || shell.stderr, analysis: analysis.stdout.trim() };
}
