import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths, RalphState } from '../types.js';
import { appendRalphRuntimeTrace, readPersistedRalphState, syncRalphRuntimeState, writeRalphState } from '../ralph-runtime.js';
import { ensureDir, readJson } from '../utils/fs.js';

function fakePaths(root: string): OmgPaths {
  return {
    workspaceRoot: root,
    projectRoot: root,
    projectOmgDir: join(root, '.omg'),
    projectGeminiDir: join(root, '.gemini'),
    projectContextDir: join(root, '.omg', 'context'),
    projectStateDir: join(root, '.omg', 'state'),
    projectPlansDir: join(root, '.omg', 'plans'),
    projectLogsDir: join(root, '.omg', 'logs'),
    projectTeamDir: join(root, '.omg', 'team'),
    projectArtifactsDir: join(root, '.omg', 'artifacts'),
    projectSkillsDir: join(root, '.omg', 'skills'),
    projectSessionsDir: join(root, '.omg', 'sessions'),
    projectCurrentPlanJsonPath: join(root, '.omg', 'plan-current.json'),
    projectCurrentPlanMarkdownPath: join(root, '.omg', 'plan-current.md'),
    projectCurrentTestSpecJsonPath: join(root, '.omg', 'test-spec-current.json'),
    projectCurrentTestSpecMarkdownPath: join(root, '.omg', 'test-spec-current.md'),
    projectMemoryPath: join(root, '.omg', 'project-memory.json'),
    projectNotepadPath: join(root, '.omg', 'notepad.md'),
    globalHomeDir: join(root, '.global-omg'),
    globalLogsDir: join(root, '.global-omg', 'logs'),
    globalSessionsDir: join(root, '.global-omg', 'sessions'),
    globalSkillsDir: join(root, '.global-omg', 'skills'),
    globalArtifactsDir: join(root, '.global-omg', 'artifacts'),
    globalStateDir: join(root, '.global-omg', 'state'),
    globalConfigPath: join(root, '.global-omg', 'config.json'),
    extensionRoot: join(root, 'packages', 'extension'),
    cliEntrypoint: join(root, 'dist', 'packages', 'cli', 'bin', 'omg.js'),
  };
}

function sampleRalphState(): RalphState {
  return {
    task: 'ship it',
    planPath: 'plan.md',
    planJsonPath: 'plan.json',
    testSpecPath: 'test-spec.md',
    iteration: 1,
    maxIterations: 5,
    stepAttempts: { s1: 1 },
    status: 'running',
    currentPhase: 'executing',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

test('ralph-runtime writes and reads persistent state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-ralph-runtime-'));
  const statePath = join(root, 'ralph-state.json');
  const state = sampleRalphState();
  await writeRalphState(statePath, state);
  const readBack = await readPersistedRalphState(statePath);
  assert.equal(readBack?.task, 'ship it');
  assert.equal(readBack?.currentPhase, 'executing');
  await rm(root, { recursive: true, force: true });
});

test('ralph-runtime syncs mode state and trace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-ralph-runtime-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectStateDir);
  await ensureDir(paths.projectLogsDir);
  const state = sampleRalphState();
  const runtime = { sessionId: 'ralph-1', task: state.task, statePath: join(root, 'ralph-state.json') };
  await syncRalphRuntimeState(paths, runtime, state, { activeStepId: 's1' });
  await appendRalphRuntimeTrace(paths, runtime, 'ralph-iteration', { iteration: 1 });
  const modeState = await readJson(join(paths.projectStateDir, 'ralph.json'), null as any);
  assert.equal(modeState.mode, 'ralph');
  assert.equal(modeState.metadata.activeStepId, 's1');
  const trace = await readFile(join(paths.projectLogsDir, 'trace.jsonl'), 'utf8');
  assert.match(trace, /ralph-iteration/);
  await rm(root, { recursive: true, force: true });
});
