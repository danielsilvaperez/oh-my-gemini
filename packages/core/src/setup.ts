import { chmod, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheck, OmgPaths } from './types.js';
import { copyRecursive, ensureDir, pathExists, readJson, writeJson, writeText } from './utils/fs.js';
import { runCommand, runTrustedShell, shellEscapeArg } from './utils/process.js';
import { OmgContext } from './context.js';

interface GeminiExtensionManifest {
  name?: string;
}

interface GeminiLinkStatus {
  manifestName?: string;
  linkedExtensionPath?: string;
  extensionMirror: string;
  linkOk: boolean;
  detail: string;
}

interface SetupOptions {
  linkExtension?: boolean;
}

function projectGeminiTemplate(): string {
  return `# OMG Project Context\n\nThis project is using OMG (oh-my-gemini) as its workflow/runtime layer.\n\n## Operator expectations\n- Prefer canonical OMG commands for durable workflows: /plan, /ralph, /team, /deep-interview.\n- Persist durable plans under .omg/plan-current.md and .omg/plan-current.json when you formalize work.\n- Persist durable test intent under .omg/test-spec-current.md and .omg/test-spec-current.json.\n- Keep major artifacts under .omg/plans/, .omg/artifacts/, .omg/context/, .omg/state/, and .omg/team/.\n- Use .omg/project-memory.json and .omg/notepad.md for durable project/session context.\n- In HIGH mode, work step-by-step and verify every meaningful change before claiming completion.\n`;
}

async function readLinkStatus(paths: OmgPaths, extensionMirror: string): Promise<GeminiLinkStatus> {
  const manifest = await readJson<GeminiExtensionManifest>(join(paths.extensionRoot, 'gemini-extension.json'), {});
  const linkedExtensionPath = manifest.name ? join(homedir(), '.gemini', 'extensions', manifest.name) : undefined;
  if (!linkedExtensionPath) {
    return {
      manifestName: manifest.name,
      linkedExtensionPath,
      extensionMirror,
      linkOk: false,
      detail: 'Extension manifest is missing a name, so OMG cannot verify the Gemini extension link.',
    };
  }

  let detail = `Extension bundle staged locally. To enable it in Gemini CLI, run: gemini extensions link ${extensionMirror}`;
  let linkOk = false;
  if (await pathExists(linkedExtensionPath)) {
    try {
      const resolvedLink = await realpath(linkedExtensionPath);
      linkOk = resolvedLink === extensionMirror;
      detail = linkOk
        ? `Gemini CLI extension linked at ${linkedExtensionPath}`
        : `Gemini CLI points to ${resolvedLink}; expected ${extensionMirror}. Re-run: gemini extensions link ${extensionMirror}`;
    } catch (error) {
      detail = `Unable to inspect Gemini CLI link at ${linkedExtensionPath}: ${(error as Error).message}`;
    }
  }

  return { manifestName: manifest.name, linkedExtensionPath, extensionMirror, linkOk, detail };
}

async function attemptGeminiExtensionLink(extensionMirror: string): Promise<DoctorCheck[]> {
  async function safeRun(args: string[], input?: string): Promise<DoctorCheck> {
    try {
      const result = await runCommand('gemini', args, { input });
      return {
        name: `Gemini ${args.slice(0, 2).join(' ')}`,
        ok: result.code === 0,
        detail: (result.stdout || result.stderr || '').trim() || `gemini ${args.join(' ')} exited ${result.code}`,
        severity: result.code === 0 ? 'info' : 'warning',
      };
    } catch (error) {
      return {
        name: `Gemini ${args.slice(0, 2).join(' ')}`,
        ok: false,
        detail: `gemini is not installed or failed to start: ${(error as Error).message}`,
        severity: 'warning',
      };
    }
  }

  const checks: DoctorCheck[] = [];
  const validate = await safeRun(['extensions', 'validate', extensionMirror]);
  checks.push(validate);
  if (!validate.ok) {
    return checks;
  }

  const linkResult = await runTrustedShell(`printf 'y\\n' | gemini extensions link ${shellEscapeArg(extensionMirror)}`);
  const link: DoctorCheck = {
    name: 'Gemini extensions link',
    ok: linkResult.code === 0,
    detail: (linkResult.stdout || linkResult.stderr || '').trim() || `gemini extensions link exited ${linkResult.code}`,
    severity: linkResult.code === 0 ? 'info' : 'warning',
  };
  checks.push(link);
  if (!link.ok) {
    return checks;
  }

  const list = await safeRun(['extensions', 'list']);
  checks.push(list);

  return checks;
}

export async function inspectGeminiExtensionLink(paths: OmgPaths): Promise<DoctorCheck> {
  const config = await readJson<{ extensionMirror?: string } | null>(paths.globalConfigPath, null);
  const extensionMirror = config?.extensionMirror ?? join(paths.globalHomeDir, 'extension');
  const status = await readLinkStatus(paths, extensionMirror);
  if (!status.linkOk) {
    try {
      const list = await runCommand('gemini', ['extensions', 'list']);
      const combined = `${list.stdout}\n${list.stderr}`;
      if (list.code === 0 && (combined.includes(`Path: ${extensionMirror}`) || combined.includes(`Source: ${extensionMirror}`))) {
        return {
          name: 'Gemini extension link',
          ok: true,
          detail: `Gemini CLI reports the extension is linked from ${extensionMirror}`,
          severity: 'info',
        };
      }
    } catch {
      // Fall back to filesystem-based inspection.
    }
  }
  return {
    name: 'Gemini extension link',
    ok: status.linkOk,
    detail: status.detail,
    severity: status.linkOk ? 'info' : 'warning',
  };
}

export async function runSetup(paths: OmgPaths, options: SetupOptions = {}): Promise<DoctorCheck[]> {
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
  await chmod(linkHelperPath, 0o755);

  const checks: DoctorCheck[] = [
    { name: 'Project .omg/ layout', ok: true, detail: paths.projectOmgDir },
    { name: 'Project .gemini/GEMINI.md', ok: true, detail: geminiMdPath },
    { name: 'Project memory', ok: true, detail: paths.projectMemoryPath },
    { name: 'Project notepad', ok: true, detail: paths.projectNotepadPath },
    { name: 'Extension mirror', ok: true, detail: extensionMirror },
    { name: 'Extension link helper', ok: true, detail: linkHelperPath },
  ];

  if (options.linkExtension ?? true) {
    checks.push(...await attemptGeminiExtensionLink(extensionMirror));
  }

  checks.push(await inspectGeminiExtensionLink(paths));

  return checks;
}
