import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
    globalHomeDir: join(root, '.global-omg'),
    globalLogsDir: join(root, '.global-omg', 'logs'),
    globalSessionsDir: join(root, '.global-omg', 'sessions'),
    globalSkillsDir: join(root, '.global-omg', 'skills'),
    globalArtifactsDir: join(root, '.global-omg', 'artifacts'),
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
    generatedAt: new Date().toISOString(),
  }, '# demo');
  assert.ok(result.jsonPath.includes('.omg/plans/'));
  await rm(root, { recursive: true, force: true });
});
