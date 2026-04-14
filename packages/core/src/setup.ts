import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheck, OmgPaths } from './types.js';
import { copyRecursive, ensureDir, pathExists, readJson, writeJson, writeText } from './utils/fs.js';
import { OmgContext } from './context.js';

interface GeminiExtensionManifest {
  name?: string;
}

function projectGeminiTemplate(): string {
  return `# OMG Project Context\n\nThis project is using OMG (oh-my-gemini) as its workflow/runtime layer.\n\n## Operator expectations\n- Prefer canonical OMG commands for durable workflows: /plan, /ralph, /team, /deep-interview.\n- Persist durable plans under .omg/plan-current.md and .omg/plan-current.json when you formalize work.\n- Persist durable test intent under .omg/test-spec-current.md and .omg/test-spec-current.json.\n- Keep major artifacts under .omg/plans/, .omg/artifacts/, .omg/context/, .omg/state/, and .omg/team/.\n- Use .omg/project-memory.json and .omg/notepad.md for durable project/session context.\n- In HIGH mode, work step-by-step and verify every meaningful change before claiming completion.\n`;
}

export async function runSetup(paths: OmgPaths): Promise<DoctorCheck[]> {
  const context = new OmgContext(paths);
  await context.ensureLayout();
  await ensureDir(paths.projectGeminiDir);

  const geminiMdPath = join(paths.projectGeminiDir, 'GEMINI.md');
  if (!(await pathExists(geminiMdPath))) {
    await writeText(geminiMdPath, projectGeminiTemplate());
  }

  const extensionMirror = join(paths.globalHomeDir, 'extension');
  await ensureDir(extensionMirror);
  await copyRecursive(paths.extensionRoot, extensionMirror);

  await writeJson(paths.globalConfigPath, {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    extensionRoot: paths.extensionRoot,
    extensionMirror,
    workspaceRoot: paths.workspaceRoot,
    projectStateLayout: [
      '.omg/context',
      '.omg/state',
      '.omg/plans',
      '.omg/artifacts',
      '.omg/team',
      '.omg/project-memory.json',
      '.omg/notepad.md',
      '.omg/test-spec-current.md',
      '.omg/test-spec-current.json',
    ],
  });

  const linkHelperPath = join(paths.globalHomeDir, 'link-extension.sh');
  await writeText(linkHelperPath, `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
exec gemini extensions link "$SCRIPT_DIR/extension"
`);

  const manifest = await readJson<GeminiExtensionManifest>(join(paths.extensionRoot, 'gemini-extension.json'), {});
  const linkedExtensionPath = manifest.name ? join(homedir(), '.gemini', 'extensions', manifest.name) : undefined;
  let linkOk = false;
  let linkDetail = `Extension bundle staged locally. To enable it in Gemini CLI, run: ${linkHelperPath}`;
  if (linkedExtensionPath && await pathExists(linkedExtensionPath)) {
    try {
      const resolvedLink = await realpath(linkedExtensionPath);
      linkOk = resolvedLink === extensionMirror;
      linkDetail = linkOk
        ? `Gemini CLI extension linked at ${linkedExtensionPath}`
        : `Gemini CLI points to ${resolvedLink}; expected ${extensionMirror}. Re-run: ${linkHelperPath}`;
    } catch (error) {
      linkDetail = `Unable to inspect Gemini CLI link at ${linkedExtensionPath}: ${(error as Error).message}`;
    }
  }

  return [
    { name: 'Project .omg/ layout', ok: true, detail: paths.projectOmgDir },
    { name: 'Project .gemini/GEMINI.md', ok: true, detail: geminiMdPath },
    { name: 'Project memory', ok: true, detail: paths.projectMemoryPath },
    { name: 'Project notepad', ok: true, detail: paths.projectNotepadPath },
    { name: 'Extension mirror', ok: true, detail: extensionMirror },
    { name: 'Extension link helper', ok: true, detail: linkHelperPath },
    { name: 'Gemini extension link', ok: linkOk, detail: linkDetail, severity: linkOk ? 'info' : 'warning' },
  ];
}
