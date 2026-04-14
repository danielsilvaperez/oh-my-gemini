import { join } from 'node:path';
import type { ModeRuntimeState, OmgPaths, OmgRuntimeMode } from './types.js';
import { readJson, writeJson } from './utils/fs.js';

function modeFilePath(paths: OmgPaths, mode: OmgRuntimeMode): string {
  return join(paths.projectStateDir, `${mode}.json`);
}

export async function readModeState(paths: OmgPaths, mode: OmgRuntimeMode): Promise<ModeRuntimeState | null> {
  return await readJson<ModeRuntimeState | null>(modeFilePath(paths, mode), null);
}

export async function writeModeState(paths: OmgPaths, state: ModeRuntimeState): Promise<void> {
  await writeJson(modeFilePath(paths, state.mode), state);
}

export async function updateModeState(
  paths: OmgPaths,
  mode: OmgRuntimeMode,
  patch: Omit<Partial<ModeRuntimeState>, 'mode'>,
): Promise<ModeRuntimeState> {
  const current = await readModeState(paths, mode);
  const next: ModeRuntimeState = {
    mode,
    active: patch.active ?? current?.active ?? true,
    currentPhase: patch.currentPhase ?? current?.currentPhase ?? 'active',
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    startedAt: patch.startedAt ?? current?.startedAt,
    completedAt: patch.completedAt ?? current?.completedAt,
    task: patch.task ?? current?.task,
    sessionId: patch.sessionId ?? current?.sessionId,
    metadata: {
      ...(current?.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
  };
  await writeModeState(paths, next);
  return next;
}
