import { spawn } from 'node:child_process';
import type { CommandResult } from '../types.js';

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  timeoutMs?: number;
  stdio?: 'inherit' | 'pipe';
}

export async function runCommand(command: string, args: string[] = [], options: RunOptions = {}): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ command: [command, ...args].join(' '), code: code ?? 1, stdout, stderr });
    });
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }
  });
}

export async function runShell(command: string, options: Omit<RunOptions, 'shell'> = {}): Promise<CommandResult> {
  return await runCommand(command, [], { ...options, shell: true });
}

export async function spawnInteractive(command: string, args: string[] = [], options: Omit<RunOptions, 'stdio'> = {}): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function commandVersion(name: string): Promise<CommandResult> {
  return await runCommand(name, ['--version']);
}
