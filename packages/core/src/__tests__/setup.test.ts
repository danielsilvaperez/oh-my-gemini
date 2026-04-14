import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmgPaths } from '../types.js';
import { runSetup } from '../setup.js';

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

test('runSetup stages and links the Gemini extension when gemini is available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omg-setup-'));
  const paths = fakePaths(root);
  const binDir = join(root, 'bin');
  const homeDir = join(root, 'home');
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;

  try {
    await mkdir(paths.extensionRoot, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });

    await writeFile(join(paths.extensionRoot, 'gemini-extension.json'), JSON.stringify({ name: 'oh-my-gemini' }, null, 2));
    await writeFile(join(paths.extensionRoot, 'GEMINI.md'), '# test extension\n');

    const fakeGeminiPath = join(binDir, 'gemini');
    await writeFile(fakeGeminiPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "extensions" && "\${2:-}" == "validate" ]]; then
  [[ -f "\${3:-}/gemini-extension.json" ]] || exit 1
  echo "validated"
  exit 0
fi
if [[ "\${1:-}" == "extensions" && "\${2:-}" == "link" ]]; then
  ext_path="\${3:-}"
  mkdir -p "$HOME/.gemini/extensions"
  target="$HOME/.gemini/extensions/oh-my-gemini"
  rm -rf "$target"
  ln -s "$ext_path" "$target"
  echo "linked"
  exit 0
fi
if [[ "\${1:-}" == "extensions" && "\${2:-}" == "list" ]]; then
  echo "oh-my-gemini"
  exit 0
fi
echo "unsupported gemini invocation: $*" >&2
exit 1
`, 'utf8');
    await chmod(fakeGeminiPath, 0o755);

    process.env.HOME = homeDir;
    process.env.PATH = `${binDir}:${previousPath ?? ''}`;

    const checks = await runSetup(paths);
    const linkCheck = checks.find((check) => check.name === 'Gemini extension link');
    assert.equal(linkCheck?.ok, true);

    const linkedTarget = await realpath(join(homeDir, '.gemini', 'extensions', 'oh-my-gemini'));
    assert.equal(linkedTarget, join(paths.globalHomeDir, 'extension'));

    const helperScript = await readFile(join(paths.globalHomeDir, 'link-extension.sh'), 'utf8');
    assert.match(helperScript, /gemini extensions link/);
  } finally {
    process.env.HOME = previousHome;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});
