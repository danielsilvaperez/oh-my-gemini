import { basename } from 'node:path';
import type { OmgPaths, RalphRuntimeContext, RalphState } from './types.js';
import { updateModeState } from './state.js';
import { appendTraceEvent } from './trace.js';
import { readJson, writeJson } from './utils/fs.js';

export async function readPersistedRalphState(statePath: string): Promise<RalphState | null> {
  return await readJson<RalphState | null>(statePath, null);
}

export async function writeRalphState(statePath: string, state: RalphState): Promise<void> {
  await writeJson(statePath, state);
}

export async function syncRalphRuntimeState(
  paths: OmgPaths,
  runtime: RalphRuntimeContext,
  state: RalphState,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await updateModeState(paths, 'ralph', {
    active: state.status === 'running',
    currentPhase: state.currentPhase,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    completedAt: state.status === 'running' ? undefined : state.updatedAt,
    task: runtime.task,
    sessionId: runtime.sessionId,
    metadata: {
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      status: state.status,
      statePath: runtime.statePath,
      ...metadata,
    },
  });
}

export async function appendRalphRuntimeTrace(
  paths: OmgPaths,
  runtime: RalphRuntimeContext,
  kind: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind,
    mode: 'ralph',
    sessionId: runtime.sessionId,
    task: runtime.task,
    detail,
  });
}

export function summarizeRalphState(state: RalphState | null): string {
  if (!state) return 'Ralph: idle';
  const stepAttempts = Object.values(state.stepAttempts ?? {});
  const maxAttempt = stepAttempts.length ? Math.max(...stepAttempts) : 0;
  return [
    `Ralph status=${state.status}`,
    `phase=${state.currentPhase}`,
    `iteration=${state.iteration}/${state.maxIterations}`,
    `max-step-attempt=${maxAttempt}`,
    `plan=${state.planPath ? basename(state.planPath) : 'unknown-plan'}`,
  ].join(' | ');
}

export async function readCurrentRalphSummary(paths: OmgPaths): Promise<string> {
  const state = await readPersistedRalphState(`${paths.projectArtifactsDir}/ralph-state.json`);
  return summarizeRalphState(state);
}
