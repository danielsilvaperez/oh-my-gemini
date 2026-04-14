import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths } from '../types.js';
import { readCurrentRalphSummary, summarizeRalphState } from '../ralph-runtime.js';
import { readOperatorSummary } from '../session-history.js';
import { ensureDir } from '../utils/fs.js';

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

test('summarizeRalphState renders operator-readable summary', () => {
  const summary = summarizeRalphState({
    task: 'ship',
    planPath: '/tmp/plan.md',
    planJsonPath: '/tmp/plan.json',
    testSpecPath: '/tmp/test.md',
    iteration: 2,
    maxIterations: 5,
    stepAttempts: { a: 1, b: 3 },
    status: 'running',
    currentPhase: 'executing',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  });
  assert.match(summary, /Ralph status=running/);
  assert.match(summary, /max-step-attempt=3/);
  assert.match(summary, /plan=plan.md/);
});

test('readOperatorSummary includes recent session and ralph summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-ralph-operator-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectSessionsDir);
  await ensureDir(paths.projectArtifactsDir);
  await writeFile(join(paths.projectSessionsDir, 'history.jsonl'), `${JSON.stringify({
    sessionId: 's1',
    mode: 'smart',
    startedAt: '2026-01-01T00:00:00.000Z',
    cwd: root,
    origin: 'cli',
  })}\n`);
  await writeFile(join(paths.projectArtifactsDir, 'ralph-state.json'), `${JSON.stringify({
    task: 'ship',
    planPath: '/tmp/plan.md',
    planJsonPath: '/tmp/plan.json',
    testSpecPath: '/tmp/test.md',
    iteration: 1,
    maxIterations: 4,
    stepAttempts: { a: 1 },
    status: 'running',
    currentPhase: 'verifying',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  }, null, 2)}\n`);
  const summary = await readOperatorSummary(paths);
  assert.match(summary[0]!, /Recent session: cli/);
  assert.match(summary[1]!, /Ralph status=running/);
  await rm(root, { recursive: true, force: true });
});

test('readCurrentRalphSummary returns idle without state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-ralph-operator-'));
  const paths = fakePaths(root);
  await ensureDir(paths.projectArtifactsDir);
  const summary = await readCurrentRalphSummary(paths);
  assert.equal(summary, 'Ralph: idle');
  await rm(root, { recursive: true, force: true });
});
