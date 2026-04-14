import { computeTeamControllerDecision } from './team-controller.js';
import { join } from 'node:path';
import type { OmgPaths, TeamManifest, TeamStatusReport, TeamWorkerStatus } from './types.js';
import { readRecentTeamMailbox } from './team-mailbox.js';
import { readJson, writeJson } from './utils/fs.js';

export interface TeamProgressEvidence {
  teamId: string;
  task: string;
  sessionName: string;
  status: TeamManifest['status'];
  currentPhase: TeamManifest['currentPhase'];
  tmuxSessionAlive: boolean;
  workerCounts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    stopped: number;
  };
  recentMailbox: string[];
  nextAction: string;
  updatedAt: string;
}

export function countTeamWorkers(workers: TeamWorkerStatus[]): TeamProgressEvidence['workerCounts'] {
  return workers.reduce<TeamProgressEvidence['workerCounts']>((counts, worker) => {
    counts[worker.status] += 1;
    return counts;
  }, {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
  });
}

export async function buildTeamProgressEvidence(
  paths: OmgPaths,
  report: TeamStatusReport,
): Promise<TeamProgressEvidence> {
  const mailbox = await readRecentTeamMailbox(paths, report.manifest.id, 5);
  const workerCounts = countTeamWorkers(report.manifest.workers);
  const nextAction = computeTeamControllerDecision(report.manifest, report.tmuxSessionAlive).nextAction;
  return {
    teamId: report.manifest.id,
    task: report.manifest.task,
    sessionName: report.manifest.sessionName,
    status: report.manifest.status,
    currentPhase: report.manifest.currentPhase,
    tmuxSessionAlive: report.tmuxSessionAlive,
    workerCounts,
    recentMailbox: mailbox.map((entry) => `[${entry.kind}] ${entry.message}`),
    nextAction,
    updatedAt: new Date().toISOString(),
  };
}

export async function writeTeamProgressEvidence(
  paths: OmgPaths,
  report: TeamStatusReport,
): Promise<TeamProgressEvidence> {
  const evidence = await buildTeamProgressEvidence(paths, report);
  await writeJson(join(paths.projectTeamDir, report.manifest.id, 'progress.json'), evidence);
  return evidence;
}

export async function readTeamProgressEvidence(
  paths: OmgPaths,
  teamId: string,
): Promise<TeamProgressEvidence | null> {
  return await readJson<TeamProgressEvidence | null>(join(paths.projectTeamDir, teamId, 'progress.json'), null);
}
