import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths } from '../types.js';
import { parseVerificationCommand } from '../ralph.js';
import { buildTeamId, resolveTeamWorkerConfigPath } from '../team.js';
import { writeText } from '../utils/fs.js';
import { shellEscapeArg } from '../utils/process.js';

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

test('shellEscapeArg safely quotes shell values', () => {
  assert.equal(shellEscapeArg(''), "''");
  assert.equal(shellEscapeArg("a b$c'd"), "'a b$c'\\''d'");
});

test('buildTeamId derives a filesystem-safe identifier', () => {
  const teamId = buildTeamId('../Danger $(rm -rf /)', 123);
  assert.equal(teamId, 'danger-rm-rf-123');
  assert.match(teamId, /^[a-z0-9-]+$/);
});

test('resolveTeamWorkerConfigPath rejects paths outside .omg/team', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-security-'));
  const paths = fakePaths(root);
  const allowed = join(paths.projectOmgDir, 'team', 'demo', 'workers', 'worker-1', 'config.json');
  await mkdir(join(paths.projectOmgDir, 'team', 'demo', 'workers', 'worker-1'), { recursive: true });
  await writeFile(allowed, '{}', 'utf8');

  assert.equal(resolveTeamWorkerConfigPath(paths, allowed), allowed);
  assert.throws(
    () => resolveTeamWorkerConfigPath(paths, join(root, 'elsewhere.json')),
    /Team worker config path must stay within/,
  );

  await rm(root, { recursive: true, force: true });
});

test('parseVerificationCommand accepts safe package-manager commands only', () => {
  assert.deepEqual(parseVerificationCommand('npm run lint'), { command: 'npm', args: ['run', 'lint'] });
  assert.deepEqual(parseVerificationCommand('pnpm test'), { command: 'pnpm', args: ['test'] });
  assert.deepEqual(parseVerificationCommand('yarn build'), { command: 'yarn', args: ['build'] });
  assert.throws(() => parseVerificationCommand('npm run lint && rm -rf /'), /Unsafe verification command rejected/);
});

test('writeText replaces files without leaving temp artifacts behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-fs-'));
  const target = join(root, 'nested', 'state.json');

  await writeText(target, 'first');
  await writeText(target, 'second');

  assert.equal(await readFile(target, 'utf8'), 'second');
  assert.deepEqual((await readdir(join(root, 'nested'))).sort(), ['state.json']);

  await rm(root, { recursive: true, force: true });
});
