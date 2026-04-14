import { chmod } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { OmgPaths, TeamAutoFixResult, TeamLoopResult, TeamManifest, TeamReconcileResult, TeamStatusReport, TeamWorkerAssignment, TeamWorkerStatus } from './types.js';
import { OmgContext } from './context.js';
import { updateModeState } from './state.js';
import { computeTeamControllerDecision, shouldSpawnFixPass } from './team-controller.js';
import { decideTeamLoopAction } from './team-loop.js';
import { appendTeamMailboxMessage, readRecentTeamMailbox, summarizeTeamWorkers } from './team-mailbox.js';
import { readTeamProgressEvidence, writeTeamProgressEvidence } from './team-progress.js';
import { appendTraceEvent } from './trace.js';
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

interface StartTeamOptions {
  parentTeamId?: string;
  fixIteration?: number;
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

export function deriveTeamPhase(
  workers: TeamWorkerStatus[],
  tmuxSessionAlive: boolean,
): TeamManifest['currentPhase'] {
  if (!workers.length) return tmuxSessionAlive ? 'planning' : 'stopped';
  if (workers.every((worker) => worker.status === 'completed')) return 'complete';
  if (workers.some((worker) => worker.status === 'failed')) return 'fixing';
  if (workers.some((worker) => worker.status === 'running' && worker.lane === 'verification')) return 'verifying';
  if (workers.some((worker) => worker.status === 'running')) return 'executing';
  if (tmuxSessionAlive) return 'planning';
  return 'stopped';
}

export function deriveTeamStatus(
  workers: TeamWorkerStatus[],
  tmuxSessionAlive: boolean,
): TeamManifest['status'] {
  if (workers.every((worker) => worker.status === 'completed')) return 'completed';
  if (workers.some((worker) => worker.status === 'failed')) return tmuxSessionAlive ? 'running' : 'failed';
  if (tmuxSessionAlive) return 'running';
  return 'stopped';
}

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

export function buildFixPassTask(manifest: TeamManifest): string {
  const failedWorkers = manifest.workers.filter((worker) => worker.status === 'failed');
  const failedSummary = failedWorkers.length
    ? failedWorkers.map((worker) => `${worker.id}(${worker.lane}): ${worker.summary ?? 'failed without summary'}`).join(' | ')
    : 'previous team stopped before completion';
  return [
    `Follow-up fix pass for team ${manifest.id}.`,
    `Original task: ${manifest.task}`,
    `Focus on unresolved issues from the previous run: ${failedSummary}.`,
    'Implement the needed fixes, then re-run verification and summarize remaining risks.',
  ].join(' ');
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

async function startTeamInternal(paths: OmgPaths, spec: string, task: string, options: StartTeamOptions = {}): Promise<TeamManifest> {
  const { count, role } = parseTeamSpec(spec);
  const context = new OmgContext(paths);
  const sessionId = `team-${Date.now()}`;
  await context.startSession({
    sessionId,
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
    parentTeamId: options.parentTeamId,
    fixIteration: options.fixIteration,
    currentPhase: 'planning',
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
  manifest.currentPhase = 'executing';
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
  await updateModeState(paths, 'team', {
    active: true,
    currentPhase: manifest.currentPhase,
    startedAt: manifest.startedAt,
    updatedAt: new Date().toISOString(),
    task,
    sessionId,
    metadata: { teamId, sessionName, workerCount: count, role },
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-started',
    mode: 'team',
    sessionId,
    task,
    detail: { teamId, sessionName, workerCount: count, role },
  });
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId,
    kind: 'team-started',
    message: `Team started with ${count} worker(s) for role ${role}.`,
  });
  const report = { manifest, tmuxSessionAlive: true };
  await writeTeamProgressEvidence(paths, report);
  return manifest;
}

export async function startTeam(paths: OmgPaths, spec: string, task: string): Promise<TeamManifest> {
  return await startTeamInternal(paths, spec, task);
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
  const decision = computeTeamControllerDecision(manifest, tmuxSessionAlive);
  manifest.currentPhase = decision.phase;
  manifest.status = decision.status;
  await writeJson(join(teamDir(paths, teamId), 'manifest.json'), manifest);
  await updateModeState(paths, 'team', {
    active: tmuxSessionAlive || manifest.status === 'running',
    currentPhase: manifest.currentPhase,
    updatedAt: new Date().toISOString(),
    task: manifest.task,
    metadata: {
      teamId,
      status: manifest.status,
      sessionName: manifest.sessionName,
      workerCount: manifest.workers.length,
    },
  });
  const report = { manifest, tmuxSessionAlive };
  await writeTeamProgressEvidence(paths, report);
  return report;
}

export async function reconcileTeam(paths: OmgPaths, teamId: string): Promise<TeamReconcileResult> {
  const report = await readTeamStatus(paths, teamId);
  const decision = computeTeamControllerDecision(report.manifest, report.tmuxSessionAlive);
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId,
    kind: 'handoff',
    message: `Reconciled team state. Phase=${decision.phase} status=${decision.status}. Next action: ${decision.nextAction}.`,
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-reconciled',
    mode: 'team',
    task: report.manifest.task,
    detail: {
      teamId,
      phase: decision.phase,
      status: decision.status,
      nextAction: decision.nextAction,
      shouldAttach: decision.shouldAttach,
    },
  });
  await writeTeamProgressEvidence(paths, report);
  return { report, decision };
}

export async function startTeamFixPass(paths: OmgPaths, teamId: string): Promise<TeamManifest> {
  const { report, decision } = await reconcileTeam(paths, teamId);
  const fixTask = buildFixPassTask(report.manifest);
  const fixManifest = await startTeamInternal(
    paths,
    `${report.manifest.count}:${report.manifest.role}`,
    fixTask,
    {
      parentTeamId: report.manifest.id,
      fixIteration: (report.manifest.fixIteration ?? 0) + 1,
    },
  );
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId: report.manifest.id,
    kind: 'handoff',
    message: `Started fix pass team ${fixManifest.id} from phase ${decision.phase}.`,
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-fix-pass-started',
    mode: 'team',
    task: fixTask,
    detail: {
      previousTeamId: report.manifest.id,
      fixTeamId: fixManifest.id,
      previousPhase: decision.phase,
      previousStatus: decision.status,
    },
  });
  return fixManifest;
}

export async function autofixTeam(paths: OmgPaths, teamId: string): Promise<TeamAutoFixResult> {
  const previous = await reconcileTeam(paths, teamId);
  if (!shouldSpawnFixPass(previous.decision, previous.report.tmuxSessionAlive)) {
    return {
      previous,
      fixManifest: null,
      message: `No automatic fix pass started. Next action: ${previous.decision.nextAction}`,
    };
  }
  const fixManifest = await startTeamFixPass(paths, teamId);
  return {
    previous,
    fixManifest,
    message: `Started fix pass team ${fixManifest.id} from ${teamId}.`,
  };
}

export async function runTeamLoop(
  paths: OmgPaths,
  teamId: string,
  maxPasses = 3,
): Promise<TeamLoopResult> {
  let currentTeamId = teamId;
  const iterations: TeamLoopResult['iterations'] = [];

  for (let index = 0; index < maxPasses; index += 1) {
    const reconciled = await reconcileTeam(paths, currentTeamId);
    const loopAction = decideTeamLoopAction(reconciled.decision, reconciled.report.tmuxSessionAlive);
    const iteration = {
      teamId: currentTeamId,
      phase: reconciled.decision.phase,
      status: reconciled.decision.status,
      nextAction: reconciled.decision.nextAction,
    };

    if (loopAction.shouldSpawnFixPass) {
      const fixManifest = await startTeamFixPass(paths, currentTeamId);
      iterations.push({ ...iteration, spawnedFixTeamId: fixManifest.id });
      currentTeamId = fixManifest.id;
      continue;
    }

    iterations.push(iteration);
    return {
      finalTeamId: currentTeamId,
      status: loopAction.status,
      iterations,
      message: loopAction.message,
    };
  }

  return {
    finalTeamId: currentTeamId,
    status: 'stopped',
    iterations,
    message: `Reached max passes (${maxPasses}) before the team reached a terminal state.`,
  };
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
  status.manifest.currentPhase = status.manifest.status === 'completed' ? 'complete' : 'stopped';
  for (const worker of status.manifest.workers) {
    await writeJson(join(teamDir(paths, teamId), 'workers', worker.id, 'status.json'), worker);
  }
  await writeJson(join(teamDir(paths, teamId), 'manifest.json'), status.manifest);
  await appendJsonl(join(teamDir(paths, teamId), 'events.jsonl'), { at: new Date().toISOString(), kind: 'team-shutdown', status: status.manifest.status });
  await updateModeState(paths, 'team', {
    active: false,
    currentPhase: status.manifest.currentPhase,
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    task: status.manifest.task,
    metadata: { teamId, status: status.manifest.status },
  });
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId,
    kind: 'team-shutdown',
    message: `Team shutdown with status ${status.manifest.status}.`,
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-shutdown',
    mode: 'team',
    task: status.manifest.task,
    detail: { teamId, status: status.manifest.status },
  });
  const finalReport = await readTeamStatus(paths, teamId);
  await writeTeamProgressEvidence(paths, finalReport);
  return finalReport;
}

export async function resumeTeam(paths: OmgPaths, teamId: string): Promise<TeamStatusReport> {
  const { report: status, decision } = await reconcileTeam(paths, teamId);
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId,
    kind: 'handoff',
    message: status.tmuxSessionAlive
      ? `Resuming live team session in phase ${status.manifest.currentPhase}. Next action: ${decision.nextAction}.`
      : `Team session not live; current status is ${status.manifest.status} in phase ${status.manifest.currentPhase}. Next action: ${decision.nextAction}.`,
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-resume-attempt',
    mode: 'team',
    task: status.manifest.task,
    detail: { teamId, tmuxSessionAlive: status.tmuxSessionAlive, phase: status.manifest.currentPhase },
  });
  await writeTeamProgressEvidence(paths, status);
  if (status.tmuxSessionAlive && decision.shouldAttach) {
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
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId: config.teamId,
    workerId: status.id,
    lane: status.lane,
    kind: 'worker-started',
    message: `${status.id} started in lane ${status.lane}.`,
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-worker-started',
    mode: 'team',
    task: config.task,
    detail: { teamId: config.teamId, workerId: status.id, lane: status.lane },
  });

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
  await appendTeamMailboxMessage(paths, {
    at: new Date().toISOString(),
    teamId: config.teamId,
    workerId: status.id,
    lane: status.lane,
    kind: status.status === 'failed' ? 'worker-failed' : 'worker-finished',
    message: `${status.id} ${status.status}. ${status.summary ?? ''}`.trim(),
  });
  await appendTraceEvent(paths, {
    at: new Date().toISOString(),
    kind: 'team-worker-finished',
    mode: 'team',
    task: config.task,
    detail: {
      teamId: config.teamId,
      workerId: status.id,
      lane: status.lane,
      status: status.status,
      summary: status.summary,
    },
  });
}

export async function renderTeamStatus(paths: OmgPaths, teamId: string): Promise<string> {
  const report = await readTeamStatus(paths, teamId);
  const mailbox = await readRecentTeamMailbox(paths, teamId, 3);
  const progress = await readTeamProgressEvidence(paths, teamId);
  const header = [
    `Team: ${report.manifest.id}`,
    `Session: ${report.manifest.sessionName}`,
    `Task: ${report.manifest.task}`,
    `Status: ${report.manifest.status}${report.tmuxSessionAlive ? ' (tmux alive)' : ' (tmux stopped)'} | phase: ${report.manifest.currentPhase}`,
    summarizeTeamWorkers(report.manifest.workers),
    progress ? `Next action: ${progress.nextAction}` : 'Next action: inspect team state',
    '',
  ];
  const lines = report.manifest.workers.flatMap((worker) => workerResultLines(worker));
  const mailboxLines = mailbox.length
    ? ['', 'Recent mailbox:', ...mailbox.map((entry) => `- [${entry.kind}] ${entry.message}`)]
    : [];
  return [...header, ...lines, ...mailboxLines].join('\n');
}

export async function tailWorkerLog(paths: OmgPaths, teamId: string, workerId: string): Promise<string> {
  return await tailFile(join(teamDir(paths, teamId), 'logs', `${workerId}.log`), 60);
}
