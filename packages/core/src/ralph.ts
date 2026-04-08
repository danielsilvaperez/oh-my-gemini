import { join } from 'node:path';
import { z } from 'zod';
import type { GeneratedPlan, OmgMode, OmgPaths, RalphIterationRecord, RalphState } from './types.js';
import { OmgContext } from './context.js';
import { GeminiRunner } from './gemini-runner.js';
import { buildRalphExecutePrompt, planToMarkdown } from './prompts.js';
import { detectRepoCommands } from './repo.js';
import { appendJsonl, readJson, writeJson, writeText } from './utils/fs.js';
import { runCommand } from './utils/process.js';
import { runPlan } from './plan.js';

const EXECUTION_SCHEMA = z.object({
  summary: z.string(),
  changedFiles: z.array(z.string()),
  decision: z.enum(['ready_for_verification', 'blocked']),
  blocker: z.string().nullable(),
  notes: z.array(z.string()),
});

export interface RalphOptions {
  maxIterations?: number;
  maxStepRetries?: number;
}

export function parseVerificationCommand(command: string): { command: string; args: string[] } {
  const trimmed = command.trim();
  let match = /^npm\s+run\s+([\w:-]+)$/.exec(trimmed);
  if (match) {
    return { command: 'npm', args: ['run', match[1]] };
  }
  match = /^pnpm\s+([\w:-]+)$/.exec(trimmed);
  if (match) {
    return { command: 'pnpm', args: [match[1]] };
  }
  match = /^yarn\s+([\w:-]+)$/.exec(trimmed);
  if (match) {
    return { command: 'yarn', args: [match[1]] };
  }
  throw new Error(`Unsafe verification command rejected: ${command}`);
}

async function verifyCommands(commands: string[], cwd: string) {
  const results = [];
  for (const command of commands) {
    try {
      const parsed = parseVerificationCommand(command);
      results.push(await runCommand(parsed.command, parsed.args, { cwd }));
    } catch (error) {
      results.push({
        command,
        code: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

function selectVerificationCommands(requested: string[], allowed: string[]): string[] | null {
  const safeRequested = requested.filter((command) => allowed.includes(command));
  if (safeRequested.length) {
    return safeRequested;
  }
  if (!requested.length && allowed.length) {
    return allowed;
  }
  return null;
}

export async function runRalph(paths: OmgPaths, task: string, options: RalphOptions = {}): Promise<RalphState> {
  const context = new OmgContext(paths);
  const sessionId = `ralph-${Date.now()}`;
  await context.startSession({
    sessionId,
    mode: 'high',
    startedAt: new Date().toISOString(),
    cwd: paths.projectRoot,
    origin: 'ralph',
    task,
  });

  const planResult = await runPlan(paths, task, 'high');
  const plan = planResult.plan;
  const repoCommands = await detectRepoCommands(paths);
  const runner = new GeminiRunner(paths);

  const statePath = join(paths.projectOmgDir, 'artifacts', 'ralph-state.json');
  const maxIterations = options.maxIterations ?? 20;
  const maxStepRetries = options.maxStepRetries ?? 2;
  const ralphState: RalphState = {
    task,
    planPath: planResult.markdownPath,
    planJsonPath: planResult.jsonPath,
    iteration: 0,
    maxIterations,
    stepAttempts: {},
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
  await writeJson(statePath, ralphState);

  while (ralphState.iteration < maxIterations) {
    const nextStep = plan.steps.find((step) => step.status !== 'completed');
    if (!nextStep) {
      const finalCommands = repoCommands.defaultVerification;
      const verification = finalCommands.length ? await verifyCommands(finalCommands, paths.projectRoot) : [];
      const allPassed = verification.every((result) => result.code === 0);
      ralphState.status = allPassed ? 'complete' : 'blocked';
      ralphState.updatedAt = new Date().toISOString();
      await appendJsonl(join(paths.projectOmgDir, 'logs', 'ralph.jsonl'), {
        at: ralphState.updatedAt,
        kind: 'final-verification',
        commands: finalCommands,
        ok: allPassed,
      });
      await writeJson(statePath, ralphState);
      return ralphState;
    }

    ralphState.iteration += 1;
    nextStep.status = 'in_progress';
    ralphState.stepAttempts[nextStep.id] = (ralphState.stepAttempts[nextStep.id] ?? 0) + 1;
    ralphState.updatedAt = new Date().toISOString();
    await writeJson(statePath, ralphState);
    await writeText(join(paths.projectOmgDir, 'plan-current.md'), planToMarkdown(plan));
    await writeJson(join(paths.projectOmgDir, 'plan-current.json'), plan);

    const execution = await runner.runPromptJson(
      buildRalphExecutePrompt(task, plan, nextStep, repoCommands, ralphState.iteration),
      EXECUTION_SCHEMA,
      { mode: 'high', retries: 1 },
    );

    let verification: import('./types.js').CommandResult[] = [];
    let decision: RalphIterationRecord['decision'] = 'continue';
    if (execution.decision === 'blocked') {
      nextStep.status = 'blocked';
      decision = 'blocked';
      ralphState.status = 'blocked';
    } else {
      const commands = selectVerificationCommands(nextStep.verificationCommands, repoCommands.defaultVerification);
      verification = commands
        ? await verifyCommands(commands, paths.projectRoot)
        : [{
          command: nextStep.verificationCommands.join(', ') || '(none)',
          code: 1,
          stdout: '',
          stderr: 'No safe verification commands were available for this step.',
        }];
      const passed = verification.every((result) => result.code === 0);
      if (passed) {
        nextStep.status = 'completed';
        decision = plan.steps.every((step) => step.id === nextStep.id || step.status === 'completed') ? 'continue' : 'continue';
      } else if (ralphState.stepAttempts[nextStep.id] >= maxStepRetries) {
        nextStep.status = 'failed';
        ralphState.status = 'failed';
        decision = 'blocked';
      } else {
        nextStep.status = 'pending';
        decision = 'retry';
      }
    }

    const record: RalphIterationRecord = {
      iteration: ralphState.iteration,
      stepId: nextStep.id,
      stepTitle: nextStep.title,
      attempt: ralphState.stepAttempts[nextStep.id],
      executionSummary: execution.summary,
      changedFiles: execution.changedFiles,
      verification,
      decision,
      createdAt: new Date().toISOString(),
    };
    ralphState.history.push(record);
    ralphState.updatedAt = record.createdAt;
    await appendJsonl(join(paths.projectOmgDir, 'logs', 'ralph.jsonl'), record);
    await writeJson(statePath, ralphState);

    if (decision === 'blocked') {
      return ralphState;
    }
  }

  ralphState.status = 'blocked';
  ralphState.updatedAt = new Date().toISOString();
  await writeJson(statePath, ralphState);
  return ralphState;
}
