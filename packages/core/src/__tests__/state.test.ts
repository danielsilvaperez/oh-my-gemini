import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths } from '../types.js';
import { ensureDir } from '../utils/fs.js';
import { readModeState, updateModeState } from '../state.js';
import { appendTraceEvent, readRecentTrace } from '../trace.js';

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

test('mode state helpers round-trip runtime state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-state-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectStateDir);

  await updateModeState(paths, 'ralph', {
    active: true,
    currentPhase: 'executing',
    task: 'ship it',
    sessionId: 'abc',
  });
  const state = await readModeState(paths, 'ralph');
  assert.equal(state?.mode, 'ralph');
  assert.equal(state?.currentPhase, 'executing');
  assert.equal(state?.task, 'ship it');

  await rm(root, { recursive: true, force: true });
});

test('trace helpers append and read recent events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-trace-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectLogsDir);

  await appendTraceEvent(paths, { at: '2026-01-01T00:00:00.000Z', kind: 'first', mode: 'plan' });
  await appendTraceEvent(paths, { at: '2026-01-01T00:00:01.000Z', kind: 'second', mode: 'ralph' });

  const events = await readRecentTrace(paths, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'second');

  await rm(root, { recursive: true, force: true });
});
