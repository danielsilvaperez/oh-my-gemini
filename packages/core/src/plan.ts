import { z } from 'zod';
import type { GeneratedPlan, OmgMode, OmgPaths } from './types.js';
import { OmgContext } from './context.js';
import { GeminiRunner } from './gemini-runner.js';
import { buildPlanPrompt, planToMarkdown } from './prompts.js';
import { detectRepoCommands } from './repo.js';
import { readText, slugify } from './utils/fs.js';

const PLAN_SCHEMA = z.object({
  task: z.string(),
  summary: z.string(),
  assumptions: z.array(z.string()),
  successCriteria: z.array(z.string()),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    verificationCommands: z.array(z.string()),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'blocked']).optional(),
    notes: z.array(z.string()).optional(),
  })),
  risks: z.array(z.string()),
  verificationCommands: z.array(z.string()),
  generatedAt: z.string(),
});

export async function runPlan(paths: OmgPaths, task: string, mode: OmgMode = 'smart'): Promise<{ plan: GeneratedPlan; markdownPath: string; jsonPath: string }> {
  const repoCommands = await detectRepoCommands(paths);
  const currentInterview = await readText(paths.projectOmgDir + '/artifacts/latest-deep-interview.md', '');
  const runner = new GeminiRunner(paths);
  const plan = await runner.runPromptJson(
    buildPlanPrompt(task, currentInterview, repoCommands),
    PLAN_SCHEMA,
    { mode },
  );
  for (const step of plan.steps) {
    step.status ??= 'pending';
  }
  const markdown = planToMarkdown(plan);
  const context = new OmgContext(paths);
  const slug = slugify(task);
  const output = await context.writePlan(slug, plan, markdown);
  return { plan, ...output };
}
