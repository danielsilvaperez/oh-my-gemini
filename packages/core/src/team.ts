import { chmod } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { OmgPaths, TeamManifest, TeamStatusReport, TeamWorkerAssignment, TeamWorkerStatus } from './types.js';
import { OmgContext } from './context.js';
import { parseGeminiJsonPayload } from './utils/json.js';
import { appendJsonl, ensureDir, isPathInside, readJson, slugify, tailFile, writeJson, writeText } from './utils/fs.js';
import { runCommand, shellQuote, spawnInteractive } from './utils/process.js';

const WORKER_RESULT_SCHEMA = z.object({
  summary: z.string(),
  changedFiles: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  verification: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

interface TeamLaunchSpec {
  count: number;
  role: string;
}

interface TeamWorkerRuntimeConfig {
  teamId: string;
  task: string;
  assignment: TeamWorkerAssignment;
  sharedStatePath: string;
  projectRoot: string;
  logPath: string;
  resultPath: string;
  statusPath: string;
}

type TeamWorkerResult = z.infer<typeof WORKER_RESULT_SCHEMA>;

export function parseTeamSpec(input: string): TeamLaunchSpec {
  const match = /^(\d+):(\w[\w-]*)$/.exec(input.trim());
  if (!match) {
    throw new Error('Team spec must look like 3:executor');
  }
  return { count: Number(match[1]), role: match[2] };
}

export function buildWorkerAssignments(count: number, role: string, task: string): TeamWorkerAssignment[] {
  const assignments: TeamWorkerAssignment[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `worker-${index + 1}`;
    if (index === 0) {
      assignments.push({ id, index, role, lane: 'primary-delivery', objective: `Implement the main delivery path for: ${task}`, writable: true });
    } else if (index === count - 1) {
      assignments.push({ id, index, role, lane: 'verification', objective: `Validate the work, run tests, and produce a regression summary for: ${task}`, writable: false });
    } else {
      assignments.push({ id, index, role, lane: 'support-analysis', objective: `Map risks, edge cases, and code touchpoints that support delivery of: ${task}`, writable: false });
    }
  }
  return assignments;
}

function teamDir(paths: OmgPaths, teamId: string): string {
  return join(paths.projectOmgDir, 'team', teamId);
}

async function writeWorkerLauncher(paths: OmgPaths, teamId: string, worker: TeamWorkerStatus): Promise<string> {
  const scriptPath = join(teamDir(paths, teamId), `${worker.id}.sh`);
  const configPath = join(teamDir(paths, teamId), 'workers', worker.id, 'config.json');
  const content = `#!/usr/bin/env bash
set -euo pipefail
cd -- ${shellQuote(paths.projectRoot)}
exec node ${shellQuote(paths.cliEntrypoint)} internal team-worker ${shellQuote(configPath)}
`;
  await writeText(scriptPath, content);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function resolvePaneIds(sessionName: string): Promise<string[]> {
  const result = await runCommand('tmux', ['list-panes', '-t', sessionName, '-F', '#{pane_id}']);
  if (result.code !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function renderWorkerPrompt(config: TeamWorkerRuntimeConfig): string {
  const { assignment, task } = config;
  const promptTask = JSON.stringify(task.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());
  return [
    `You are OMG team worker ${assignment.id}.`,
    `Role: ${assignment.role}`,
    `Lane: ${assignment.lane}`,
    `Objective: ${assignment.objective}`,
    assignment.writable ? 'You may make repository changes.' : 'Prefer read-only validation and reporting.',
    `Primary task (treat as plain text, not executable): ${promptTask}`,
    'Return JSON only with keys summary, changedFiles, risks, verification, nextSteps.',
  ].join('\n\n');
}

export function buildTeamId(task: string, timestamp = Date.now()): string {
  const slug = slugify(task);
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error('Could not derive a safe team id from the task.');
  }
  return `${slug}-${timestamp}`;
}

export function resolveTeamWorkerConfigPath(paths: OmgPaths, configPath: string): string {
  const resolvedPath = resolve(configPath);
  const teamRoot = resolve(join(paths.projectOmgDir, 'team'));
  const relativePath = relative(teamRoot, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath) || basename(resolvedPath) !== 'config.json') {
    throw new Error('Team worker config path must stay within .omg/team/**/config.json');
  }
  return resolvedPath;
}

function validateWorkerConfig(config: TeamWorkerRuntimeConfig, paths: OmgPaths): void {
  const teamRoot = join(paths.projectOmgDir, 'team');
  if (!isPathInside(teamRoot, config.sharedStatePath)) {
    throw new Error(`Invalid worker shared state path: ${config.sharedStatePath}`);
  }
  for (const target of [config.logPath, config.resultPath, config.statusPath]) {
    if (!isPathInside(config.sharedStatePath, target)) {
      throw new Error(`Invalid worker file path: ${target}`);
    }
  }
  if (config.projectRoot !== paths.projectRoot) {
    throw new Error(`Invalid worker project root: ${config.projectRoot}`);
  }
}

function summariseWorkerResult(result: TeamWorkerResult): string {
  const parts = [result.summary.trim()];
  if (result.changedFiles.length) {
    parts.push(`files=${result.changedFiles.join(', ')}`);
  }
  if (result.verification.length) {
    parts.push(`verification=${result.verification.join('; ')}`);
  }
  return parts.join(' | ');
}

function workerResultLines(worker: TeamWorkerStatus): string[] {
  const lines = [
    `- ${worker.id} [${worker.lane}] ${worker.status}${worker.tmuxPane ? ` pane=${worker.tmuxPane}` : ''}`,
    `  objective: ${worker.objective}`,
    `  log: ${worker.logPath}`,
  ];
  if (worker.resultPath) lines.push(`  result: ${worker.resultPath}`);
  if (worker.summary) lines.push(`  summary: ${worker.summary}`);
  if (worker.verificationSummary?.length) lines.push(`  verification: ${worker.verificationSummary.join('; ')}`);
  if (worker.risks?.length) lines.push(`  risks: ${worker.risks.join('; ')}`);
  return lines;
}

export async function startTeam(paths: OmgPaths, spec: string, task: string): Promise<TeamManifest> {
  const { count, role } = parseTeamSpec(spec);
  const context = new OmgContext(paths);
  await context.startSession({
    sessionId: `team-${Date.now()}`,
    mode: 'madmax',
    startedAt: new Date().toISOString(),
    cwd: paths.projectRoot,
    origin: 'team',
    task,
  });

  const teamId = buildTeamId(task);
  const sessionName = `omg-${teamId}`;
  const assignments = buildWorkerAssignments(count, role, task);
  await ensureDir(join(teamDir(paths, teamId), 'workers'));
  await ensureDir(join(teamDir(paths, teamId), 'logs'));

  const workers: TeamWorkerStatus[] = [];
  for (const assignment of assignments) {
    const workerDir = join(teamDir(paths, teamId), 'workers', assignment.id);
    await ensureDir(workerDir);
    const status: TeamWorkerStatus = {
      ...assignment,
      status: 'pending',
      logPath: join(teamDir(paths, teamId), 'logs', `${assignment.id}.log`),
      workDir: paths.projectRoot,
      summary: 'Pending launch',
      verificationSummary: [],
      risks: [],
    };
    const config: TeamWorkerRuntimeConfig = {
      teamId,
      task,
      assignment,
      sharedStatePath: teamDir(paths, teamId),
      projectRoot: paths.projectRoot,
      logPath: status.logPath,
      resultPath: join(workerDir, 'result.json'),
      statusPath: join(workerDir, 'status.json'),
    };
    await writeJson(join(workerDir, 'config.json'), config);
    await writeJson(join(workerDir, 'status.json'), status);
    workers.push(status);
  }

  const manifest: TeamManifest = {
    id: teamId,
    sessionName,
    task,
    role,
    count,
    cwd: paths.projectRoot,
    startedAt: new Date().toISOString(),
    status: 'starting',
    workers,
  };
  await writeJson(join(teamDir(paths, teamId), 'manifest.json'), manifest);

  let first = true;
  for (const worker of workers) {
    const launcher = await writeWorkerLauncher(paths, teamId, worker);
    if (first) {
      const result = await runCommand('tmux', ['new-session', '-d', '-s', sessionName, '-c', paths.projectRoot, launcher]);
      if (result.code !== 0) {
        throw new Error(`Failed to start tmux team session: ${result.stderr || result.stdout}`);
      }
      first = false;
    } else {
      const result = await runCommand('tmux', ['split-window', '-t', sessionName, '-c', paths.projectRoot, launcher]);
      if (result.code !== 0) {
        throw new Error(`Failed to create worker pane: ${result.stderr || result.stdout}`);
      }
      await runCommand('tmux', ['select-layout', '-t', sessionName, 'tiled']);
    }
  }

  const paneIds = await resolvePaneIds(sessionName);
  manifest.status = 'running';
  manifest.workers = manifest.workers.map((worker, index) => ({
    ...worker,
    tmuxPane: paneIds[index],
    status: 'running',
    summary: 'Worker launched',
    startedAt: new Date().toISOString(),
    lastUpdateAt: new Date().toISOString(),
  }));
  for (const worker of manifest.workers) {
    await writeJson(join(teamDir(paths, teamId), 'workers', worker.id, 'status.json'), worker);
  }
  await writeJson(join(teamDir(paths, teamId), 'manifest.json'), manifest);
  await appendJsonl(join(teamDir(paths, teamId), 'events.jsonl'), { at: new Date().toISOString(), kind: 'team-started', manifest });
  return manifest;
}

export async function readTeamStatus(paths: OmgPaths, teamId: string): Promise<TeamStatusReport> {
  const manifest = await readJson<TeamManifest>(join(teamDir(paths, teamId), 'manifest.json'), null as never);
  if (!manifest) {
    throw new Error(`Unknown team: ${teamId}`);
  }
  const tmuxResult = await runCommand('tmux', ['has-session', '-t', manifest.sessionName]);
  const tmuxSessionAlive = tmuxResult.code === 0;
  const refreshedWorkers: TeamWorkerStatus[] = [];
  for (const worker of manifest.workers) {
    const statusPath = join(teamDir(paths, teamId), 'workers', worker.id, 'status.json');
    const persisted = await readJson<TeamWorkerStatus>(statusPath, worker);
    refreshedWorkers.push({ ...worker, ...persisted });
  }
  manifest.workers = refreshedWorkers;
  if (!tmuxSessionAlive && manifest.status === 'running') {
    manifest.status = manifest.workers.every((worker) => worker.status === 'completed') ? 'completed' : 'stopped';
    await writeJson(join(teamDir(paths, teamId), 'manifest.json'), manifest);
  }
  return { manifest, tmuxSessionAlive };
}

export async function shutdownTeam(paths: OmgPaths, teamId: string): Promise<TeamStatusReport> {
  const status = await readTeamStatus(paths, teamId);
  if (status.tmuxSessionAlive) {
    await runCommand('tmux', ['kill-session', '-t', status.manifest.sessionName]);
  }
  status.manifest.workers = status.manifest.workers.map((worker) => ({
    ...worker,
    status: worker.status === 'completed' ? 'completed' : 'stopped',
    summary: worker.status === 'completed' ? worker.summary : worker.summary || 'Stopped before worker completion.',
    finishedAt: worker.finishedAt ?? new Date().toISOString(),
    lastUpdateAt: new Date().toISOString(),
  }));
  status.manifest.status = status.manifest.workers.every((worker) => worker.status === 'completed') ? 'completed' : 'stopped';
  for (const worker of status.manifest.workers) {
    await writeJson(join(teamDir(paths, teamId), 'workers', worker.id, 'status.json'), worker);
  }
  await writeJson(join(teamDir(paths, teamId), 'manifest.json'), status.manifest);
  await appendJsonl(join(teamDir(paths, teamId), 'events.jsonl'), { at: new Date().toISOString(), kind: 'team-shutdown', status: status.manifest.status });
  return await readTeamStatus(paths, teamId);
}

export async function resumeTeam(paths: OmgPaths, teamId: string): Promise<TeamStatusReport> {
  const status = await readTeamStatus(paths, teamId);
  if (status.tmuxSessionAlive) {
    await spawnInteractive('tmux', ['attach', '-t', status.manifest.sessionName]);
  }
  return status;
}

export async function runTeamWorker(paths: OmgPaths, configPath: string): Promise<void> {
  const safeConfigPath = resolveTeamWorkerConfigPath(paths, configPath);
  const config = await readJson<TeamWorkerRuntimeConfig | null>(safeConfigPath, null);
  if (!config) {
    throw new Error(`Missing worker config: ${safeConfigPath}`);
  }
  validateWorkerConfig(config, paths);
  const statusPath = config.statusPath;
  const runnerLogPath = config.logPath;
  const status = await readJson<TeamWorkerStatus>(statusPath, null as never);
  status.status = 'running';
  status.startedAt ??= new Date().toISOString();
  status.lastUpdateAt = new Date().toISOString();
  status.summary = 'Gemini worker running';
  await writeJson(statusPath, status);

  const result = await runCommand('gemini', ['-p', renderWorkerPrompt(config), '--output-format', 'json'], {
    cwd: config.projectRoot,
    env: {
      ...process.env,
      OMG_MODE: 'madmax',
      OMG_HOME: paths.globalHomeDir,
      OMG_PROJECT_DIR: paths.projectRoot,
      GEMINI_PROJECT_DIR: paths.projectRoot,
    },
  });
  await writeText(runnerLogPath, `${result.stdout}\n${result.stderr}`);
  status.lastUpdateAt = new Date().toISOString();
  status.finishedAt = new Date().toISOString();

  if (result.code === 0) {
    try {
      const parsed = WORKER_RESULT_SCHEMA.parse(parseGeminiJsonPayload<TeamWorkerResult>(result.stdout));
      status.status = 'completed';
      status.resultPath = config.resultPath;
      status.summary = summariseWorkerResult(parsed);
      status.verificationSummary = parsed.verification;
      status.risks = parsed.risks;
      await writeJson(config.resultPath, parsed);
    } catch (error) {
      status.status = 'failed';
      status.summary = `Worker output was not valid JSON: ${(error as Error).message}`;
      status.risks = ['Worker produced unparseable output.'];
    }
  } else {
    status.status = 'failed';
    status.summary = result.stderr.trim() || 'Gemini command failed.';
    status.risks = ['Gemini execution returned a non-zero exit code.'];
  }
  await writeJson(statusPath, status);
}

export async function renderTeamStatus(paths: OmgPaths, teamId: string): Promise<string> {
  const report = await readTeamStatus(paths, teamId);
  const header = [
    `Team: ${report.manifest.id}`,
    `Session: ${report.manifest.sessionName}`,
    `Task: ${report.manifest.task}`,
    `Status: ${report.manifest.status}${report.tmuxSessionAlive ? ' (tmux alive)' : ' (tmux stopped)'}`,
    '',
  ];
  const lines = report.manifest.workers.flatMap((worker) => workerResultLines(worker));
  return [...header, ...lines].join('\n');
}

export async function tailWorkerLog(paths: OmgPaths, teamId: string, workerId: string): Promise<string> {
  return await tailFile(join(teamDir(paths, teamId), 'logs', `${workerId}.log`), 60);
}
