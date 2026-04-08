import { join } from 'node:path';
import type { DoctorCheck, OmgPaths } from './types.js';
import { copyRecursive, ensureDir, pathExists, readText, writeJson, writeText } from './utils/fs.js';
import { runCommand } from './utils/process.js';
import { OmgContext } from './context.js';

function projectGeminiTemplate(): string {
  return `# OMG Project Context\n\nThis project is using OMG (oh-my-gemini) as its workflow/runtime layer.\n\n## Operator expectations\n- Prefer canonical OMG commands for durable workflows: /plan, /ralph, /team, /deep-interview.\n- Persist durable plans under .omg/plan-current.md and .omg/plan-current.json when you formalize work.\n- Keep major artifacts under .omg/plans/, .omg/artifacts/, and .omg/team/.\n- In HIGH mode, work step-by-step and verify every meaningful change before claiming completion.\n`;
}

export async function runSetup(paths: OmgPaths): Promise<DoctorCheck[]> {
  const context = new OmgContext(paths);
  await context.ensureLayout();
  await ensureDir(paths.projectGeminiDir);

  const geminiMdPath = join(paths.projectGeminiDir, 'GEMINI.md');
  if (!(await pathExists(geminiMdPath))) {
    await writeText(geminiMdPath, projectGeminiTemplate());
  }

  await writeJson(join(paths.globalHomeDir, 'config.json'), {
    installedAt: new Date().toISOString(),
    extensionRoot: paths.extensionRoot,
    workspaceRoot: paths.workspaceRoot,
  });

  const linkCommand = `gemini extensions link ${JSON.stringify(paths.extensionRoot)}`;
  const linkHelperPath = join(paths.globalHomeDir, 'link-extension.sh');
  await writeText(linkHelperPath, `#!/usr/bin/env bash
set -euo pipefail
${linkCommand}
`);
  let linkDetail = `Extension bundle staged locally. To enable it in Gemini CLI, run: ${linkCommand}`;
  let linkOk = false;


  const extensionMirror = join(paths.globalHomeDir, 'extension');
  await ensureDir(extensionMirror);
  await copyRecursive(paths.extensionRoot, extensionMirror);

  return [
    { name: 'Project .omg/ layout', ok: true, detail: paths.projectOmgDir },
    { name: 'Project .gemini/GEMINI.md', ok: true, detail: geminiMdPath },
    { name: 'Extension mirror', ok: true, detail: extensionMirror },
    { name: 'Extension link helper', ok: true, detail: linkHelperPath },
    { name: 'Gemini extension link', ok: linkOk, detail: linkDetail, severity: linkOk ? 'info' : 'warning' },
  ];
}
