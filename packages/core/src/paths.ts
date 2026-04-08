import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OmgPaths } from './types.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);

function findProjectRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(join(current, '.git')) ||
      existsSync(join(current, 'project.md')) ||
      existsSync(join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

export function resolveOmgPaths(cwd = process.cwd()): OmgPaths {
  const workspaceRoot = findProjectRoot(THIS_DIR);
  const projectRoot = findProjectRoot(cwd);
  const globalHomeDir = join(homedir(), '.omg');
  return {
    workspaceRoot,
    projectRoot,
    projectOmgDir: join(projectRoot, '.omg'),
    projectGeminiDir: join(projectRoot, '.gemini'),
    globalHomeDir,
    globalLogsDir: join(globalHomeDir, 'logs'),
    globalSessionsDir: join(globalHomeDir, 'sessions'),
    globalSkillsDir: join(globalHomeDir, 'skills'),
    globalArtifactsDir: join(globalHomeDir, 'artifacts'),
    extensionRoot: join(workspaceRoot, 'packages', 'extension'),
    cliEntrypoint: join(workspaceRoot, 'dist', 'packages', 'cli', 'bin', 'omg.js'),
  };
}
