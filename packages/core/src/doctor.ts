import { join } from 'node:path';
import type { DoctorCheck, OmgPaths } from './types.js';
import { isWritableDir, pathExists, readJson } from './utils/fs.js';

export async function runDoctor(paths: OmgPaths): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const commands = [
    ['Node.js', 'node', ['--version']],
    ['npm', 'npm', ['--version']],
    ['Gemini CLI', 'gemini', ['--version']],
    ['tmux', 'tmux', ['-V']],
  ] as const;

  for (const [label, command, args] of commands) {
    try {
      const result = await import('./utils/process.js').then((m) => m.runCommand(command, [...args]));
      checks.push({
        name: label,
        ok: result.code === 0,
        detail: (result.stdout || result.stderr || '').trim() || `${command} exited ${result.code}`,
        severity: result.code === 0 ? 'info' : 'warning',
      });
    } catch {
      checks.push({ name: label, ok: false, detail: `${command} is not installed or not on PATH`, severity: 'error' });
    }
  }

  const repoChecks: Array<[string, string]> = [
    ['Extension manifest', join(paths.extensionRoot, 'gemini-extension.json')],
    ['Extension hooks', join(paths.extensionRoot, 'hooks', 'hooks.json')],
    ['Project state dir', paths.projectOmgDir],
    ['Global OMG home', paths.globalHomeDir],
  ];
  for (const [label, target] of repoChecks) {
    const ok = await pathExists(target);
    checks.push({ name: label, ok, detail: target, severity: ok ? 'info' : 'warning' });
  }

  checks.push({ name: 'Project state writable', ok: await isWritableDir(paths.projectOmgDir), detail: paths.projectOmgDir, severity: 'info' });
  checks.push({ name: 'Global state writable', ok: await isWritableDir(paths.globalHomeDir), detail: paths.globalHomeDir, severity: 'info' });

  const config = await readJson<{ extensionRoot?: string } | null>(join(paths.globalHomeDir, 'config.json'), null);
  checks.push({
    name: 'OMG config',
    ok: Boolean(config?.extensionRoot),
    detail: config?.extensionRoot ? `Configured extension root: ${config.extensionRoot}` : 'Run `omg setup` to create config and link the extension.',
    severity: config?.extensionRoot ? 'info' : 'warning',
  });

  return checks;
}
