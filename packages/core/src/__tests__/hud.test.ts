import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths } from '../types.js';
import { renderHud } from '../hud.js';
import { ensureDir, writeJson, writeText } from '../utils/fs.js';

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

test('renderHud includes task, plan, and test spec summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-hud-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectArtifactsDir);
  await ensureDir(paths.projectTeamDir);
  await ensureDir(paths.projectSessionsDir);
  await writeJson(join(paths.projectOmgDir, 'session.json'), {
    sessionId: 'demo',
    origin: 'ralph',
    task: 'ship parity',
  });
  await writeJson(join(paths.projectOmgDir, 'mode.json'), { mode: 'high' });
  await writeJson(paths.projectCurrentPlanJsonPath, {
    steps: [
      { id: 's1', title: 'Plan', status: 'completed' },
      { id: 's2', title: 'Execute', status: 'in_progress' },
    ],
  });
  await writeJson(paths.projectCurrentTestSpecJsonPath, { suites: [{ id: 't1' }, { id: 't2' }] });
  await writeJson(join(paths.projectArtifactsDir, 'ralph-state.json'), {
    status: 'running',
    currentPhase: 'executing',
    iteration: 2,
    maxIterations: 5,
  });
  await writeText(join(paths.projectTeamDir, 'sample.txt'), 'team');
  await writeText(join(paths.projectSessionsDir, 'history.jsonl'), `${JSON.stringify({
    sessionId: 'prior',
    mode: 'smart',
    startedAt: '2026-01-01T00:00:00.000Z',
    cwd: root,
    origin: 'cli',
  })}\n`);

  const hud = await renderHud(paths);
  assert.match(hud, /Task: ship parity/);
  assert.match(hud, /Plan: 1\/2 complete/);
  assert.match(hud, /Test spec: 2 suite\(s\)/);
  assert.match(hud, /Ralph: running \| phase executing \| iteration 2\/5/);
  assert.match(hud, /Recent session: cli @ 2026-01-01T00:00:00.000Z/);

  await rm(root, { recursive: true, force: true });
});
