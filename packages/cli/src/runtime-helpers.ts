import { GeminiRunner } from '../../core/src/gemini-runner.js';
import type { OmgMode, OmgPaths } from '../../core/src/types.js';
import { buildTaskPrompt } from '../../core/src/prompts.js';

export { GeminiRunner } from '../../core/src/gemini-runner.js';
export { OmgContext } from '../../core/src/context.js';
export { renderHud } from '../../core/src/hud.js';
export { resolveOmgPaths } from '../../core/src/paths.js';
export { runDeepInterview } from '../../core/src/deep-interview.js';
export { runDoctor } from '../../core/src/doctor.js';
export { runExplore } from '../../core/src/explore.js';
export { runPlan } from '../../core/src/plan.js';
export { runRalph } from '../../core/src/ralph.js';
export { runSetup } from '../../core/src/setup.js';
export { runSparkShell } from '../../core/src/sparkshell.js';

export async function runTaskPrompt(paths: OmgPaths, mode: OmgMode, task: string, planSummary?: string): Promise<string> {
  const runner = new GeminiRunner(paths);
  const result = await runner.runPrompt(buildTaskPrompt(mode, task, planSummary), { mode });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Gemini task prompt failed');
  }
  return result.stdout.trim();
}
