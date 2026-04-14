import { join } from 'node:path';
import { z } from 'zod';
import type { OmgPaths, RalphIterationRecord, RalphState } from './types.js';
import { OmgContext } from './context.js';
import { GeminiRunner } from './gemini-runner.js';
import { buildRalphExecutePrompt, planToMarkdown } from './prompts.js';
import { appendRalphRuntimeTrace, readPersistedRalphState, syncRalphRuntimeState, writeRalphState } from './ralph-runtime.js';
import { detectRepoCommands } from './repo.js';
import { appendJsonl, writeJson, writeText } from './utils/fs.js';
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

  const statePath = join(paths.projectArtifactsDir, 'ralph-state.json');
  const runtime = { sessionId, task, statePath };
  const existingPlan = await context.readCurrentPlan();
  const planResult = existingPlan?.task === task
    ? {
      plan: existingPlan,
      markdownPath: paths.projectCurrentPlanMarkdownPath,
      jsonPath: paths.projectCurrentPlanJsonPath,
      testSpecMarkdownPath: paths.projectCurrentTestSpecMarkdownPath,
      testSpecJsonPath: paths.projectCurrentTestSpecJsonPath,
    }
    : await runPlan(paths, task, 'high');
  const plan = planResult.plan;
  const repoCommands = await detectRepoCommands(paths);
  const runner = new GeminiRunner(paths);

  const maxIterations = options.maxIterations ?? 20;
  const maxStepRetries = options.maxStepRetries ?? 2;
  const persistedState = await readPersistedRalphState(statePath);
  const ralphState: RalphState = persistedState?.task === task && persistedState.status === 'running'
    ? {
      ...persistedState,
      planPath: planResult.markdownPath,
      planJsonPath: planResult.jsonPath,
      testSpecPath: planResult.testSpecMarkdownPath,
      maxIterations,
      updatedAt: new Date().toISOString(),
    }
    : {
      task,
      planPath: planResult.markdownPath,
      planJsonPath: planResult.jsonPath,
      testSpecPath: planResult.testSpecMarkdownPath,
      iteration: 0,
      maxIterations,
      stepAttempts: {},
      status: 'running',
      currentPhase: 'planning',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };
  await writeRalphState(statePath, ralphState);
  await syncRalphRuntimeState(paths, runtime, ralphState, {
    planPath: planResult.markdownPath,
    resumed: Boolean(persistedState?.task === task && persistedState.status === 'running'),
  });
  await appendRalphRuntimeTrace(paths, runtime, 'ralph-start', {
    planPath: planResult.markdownPath,
    resumed: Boolean(persistedState?.task === task && persistedState.status === 'running'),
  });

  while (ralphState.iteration < maxIterations) {
    const nextStep = plan.steps.find((step) => step.status !== 'completed');
    if (!nextStep) {
      ralphState.currentPhase = 'verifying';
      ralphState.updatedAt = new Date().toISOString();
      await syncRalphRuntimeState(paths, runtime, ralphState, {
        finalVerification: repoCommands.defaultVerification,
      });
      const finalCommands = repoCommands.defaultVerification;
      const verification = finalCommands.length ? await verifyCommands(finalCommands, paths.projectRoot) : [];
      const allPassed = verification.every((result) => result.code === 0);
      ralphState.status = allPassed ? 'complete' : 'blocked';
      ralphState.currentPhase = allPassed ? 'complete' : 'blocked';
      ralphState.updatedAt = new Date().toISOString();
      await appendJsonl(join(paths.projectLogsDir, 'ralph.jsonl'), {
        at: ralphState.updatedAt,
        kind: 'final-verification',
        commands: finalCommands,
        ok: allPassed,
      });
      await appendRalphRuntimeTrace(paths, runtime, 'ralph-final-verification', {
        ok: allPassed,
        commands: finalCommands,
      });
      await syncRalphRuntimeState(paths, runtime, ralphState);
      await writeRalphState(statePath, ralphState);
      return ralphState;
    }

    ralphState.iteration += 1;
    nextStep.status = 'in_progress';
    ralphState.stepAttempts[nextStep.id] = (ralphState.stepAttempts[nextStep.id] ?? 0) + 1;
    ralphState.currentPhase = 'executing';
    ralphState.updatedAt = new Date().toISOString();
    await writeRalphState(statePath, ralphState);
    await syncRalphRuntimeState(paths, runtime, ralphState, {
      activeStepId: nextStep.id,
      activeStepTitle: nextStep.title,
    });
    await writeText(paths.projectCurrentPlanMarkdownPath, planToMarkdown(plan));
    await writeJson(paths.projectCurrentPlanJsonPath, plan);

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
      ralphState.currentPhase = 'blocked';
    } else {
      ralphState.currentPhase = 'verifying';
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
        ralphState.currentPhase = 'blocked';
        decision = 'blocked';
      } else {
        nextStep.status = 'pending';
        ralphState.currentPhase = 'executing';
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
    await appendJsonl(join(paths.projectLogsDir, 'ralph.jsonl'), record);
    await appendRalphRuntimeTrace(paths, runtime, 'ralph-iteration', {
      iteration: record.iteration,
      stepId: record.stepId,
      attempt: record.attempt,
      decision: record.decision,
      changedFiles: record.changedFiles,
    });
    await syncRalphRuntimeState(paths, runtime, ralphState, {
      activeStepId: record.stepId,
      attempt: record.attempt,
      decision: record.decision,
    });
    await writeRalphState(statePath, ralphState);

    if (decision === 'blocked') {
      await syncRalphRuntimeState(paths, runtime, ralphState, {
        blockedStepId: record.stepId,
      });
      return ralphState;
    }
  }

  ralphState.status = 'blocked';
  ralphState.currentPhase = 'blocked';
  ralphState.updatedAt = new Date().toISOString();
  await syncRalphRuntimeState(paths, runtime, ralphState, {
    reason: 'max-iterations-exhausted',
  });
  await writeRalphState(statePath, ralphState);
  return ralphState;
}
