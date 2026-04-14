import { z } from 'zod';
import type { GeneratedPlan, OmgMode, OmgPaths } from './types.js';
import { OmgContext } from './context.js';
import { GeminiRunner } from './gemini-runner.js';
import { buildPlanPrompt, planToMarkdown, testSpecToMarkdown } from './prompts.js';
import { detectRepoCommands } from './repo.js';
import { updateModeState } from './state.js';
import { appendTraceEvent } from './trace.js';
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
  testSpec: z.object({
    summary: z.string(),
    suites: z.array(z.object({
      id: z.string(),
      title: z.string(),
      objective: z.string(),
      commands: z.array(z.string()),
      checks: z.array(z.string()),
    })),
    regressionRisks: z.array(z.string()),
    generatedAt: z.string(),
  }),
  generatedAt: z.string(),
});

export async function runPlan(paths: OmgPaths, task: string, mode: OmgMode = 'smart'): Promise<{
  plan: GeneratedPlan;
  markdownPath: string;
  jsonPath: string;
  testSpecMarkdownPath: string;
  testSpecJsonPath: string;
}> {
  await updateModeState(paths, 'plan', {
    active: true,
    currentPhase: 'planning',
    updatedAt: new Date().toISOString(),
    task,
    metadata: { mode },
  });
  const repoCommands = await detectRepoCommands(paths);
  const currentInterview = await readText(`${paths.projectArtifactsDir}/latest-deep-interview.md`, '');
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
  const testSpecMarkdown = testSpecToMarkdown(plan);
  const context = new OmgContext(paths);
  const slug = slugify(task);
  const output = await context.writePlan(slug, plan, markdown);
  const testSpecOutput = await context.writeTestSpec(slug, plan, testSpecMarkdown);
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'plan-generated',
    mode: 'plan',
    task,
    detail: {
      mode,
      planJsonPath: output.jsonPath,
      planMarkdownPath: output.markdownPath,
      testSpecJsonPath: testSpecOutput.jsonPath,
      testSpecMarkdownPath: testSpecOutput.markdownPath,
      steps: plan.steps.length,
    },
  });
  await updateModeState(paths, 'plan', {
    active: false,
    currentPhase: 'complete',
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    task,
    metadata: { currentPlan: output.markdownPath, currentTestSpec: testSpecOutput.markdownPath },
  });
  return { plan, ...output, testSpecMarkdownPath: testSpecOutput.markdownPath, testSpecJsonPath: testSpecOutput.jsonPath };
}
