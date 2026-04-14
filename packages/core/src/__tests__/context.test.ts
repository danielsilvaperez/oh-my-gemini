import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmgContext } from '../context.js';
import type { OmgPaths } from '../types.js';

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

test('context writes current plan artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-context-'));
  const context = new OmgContext(fakePaths(root));
  await context.ensureLayout();
  const result = await context.writePlan('demo', {
    task: 'demo',
    summary: 'summary',
    assumptions: [],
    successCriteria: ['it works'],
    steps: [],
    risks: [],
    verificationCommands: [],
    testSpec: {
      summary: 'validate it',
      suites: [],
      regressionRisks: [],
      generatedAt: new Date().toISOString(),
    },
    generatedAt: new Date().toISOString(),
  }, '# demo');
  assert.ok(result.jsonPath.includes('.omg/plans/'));
  const currentPlan = await readFile(join(root, '.omg', 'plan-current.md'), 'utf8');
  assert.equal(currentPlan, '# demo');
  await rm(root, { recursive: true, force: true });
});

test('context bootstraps durable memory artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-context-'));
  const context = new OmgContext(fakePaths(root));
  await context.ensureLayout();
  const memory = await readFile(join(root, '.omg', 'project-memory.json'), 'utf8');
  const notepad = await readFile(join(root, '.omg', 'notepad.md'), 'utf8');
  assert.match(memory, /"schemaVersion": 1/);
  assert.match(notepad, /# OMG Notepad/);
  await rm(root, { recursive: true, force: true });
});

test('context records project-local session history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-context-'));
  const context = new OmgContext(fakePaths(root));
  await context.startSession({
    sessionId: 'session-1',
    mode: 'smart',
    startedAt: new Date().toISOString(),
    cwd: root,
    origin: 'cli',
    task: 'demo',
  });
  const history = await readFile(join(root, '.omg', 'sessions', 'history.jsonl'), 'utf8');
  assert.match(history, /"sessionId":"session-1"/);
  await rm(root, { recursive: true, force: true });
});
