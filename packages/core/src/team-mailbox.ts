import { join } from 'node:path';
import type { OmgPaths, TeamMailboxMessage, TeamWorkerStatus } from './types.js';
import { appendJsonl, readText } from './utils/fs.js';

function mailboxPath(paths: OmgPaths, teamId: string): string {
  return join(paths.projectTeamDir, teamId, 'mailbox.jsonl');
}

export async function appendTeamMailboxMessage(
  paths: OmgPaths,
  message: TeamMailboxMessage,
): Promise<void> {
  await appendJsonl(mailboxPath(paths, message.teamId), message);
}

export async function readRecentTeamMailbox(
  paths: OmgPaths,
  teamId: string,
  maxEntries = 5,
): Promise<TeamMailboxMessage[]> {
  const raw = await readText(mailboxPath(paths, teamId), '');
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .slice(-maxEntries)
    .map((line) => JSON.parse(line) as TeamMailboxMessage);
}

export function summarizeTeamWorkers(workers: TeamWorkerStatus[]): string {
  const counts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
  };
  for (const worker of workers) {
    counts[worker.status] += 1;
  }
  return `workers pending=${counts.pending} running=${counts.running} completed=${counts.completed} failed=${counts.failed} stopped=${counts.stopped}`;
}
