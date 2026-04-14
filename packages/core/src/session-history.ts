import { join } from 'node:path';
import type { OmgPaths, SessionState } from './types.js';
import { readCurrentRalphSummary } from './ralph-runtime.js';
import { readText } from './utils/fs.js';

export async function readRecentProjectSessions(paths: OmgPaths, maxEntries = 10): Promise<SessionState[]> {
  const raw = await readText(join(paths.projectSessionsDir, 'history.jsonl'), '');
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .slice(-maxEntries)
    .map((line) => JSON.parse(line) as SessionState);
}

export async function readOperatorSummary(paths: OmgPaths): Promise<string[]> {
  const sessions = await readRecentProjectSessions(paths, 1);
  const lastSession = sessions[0];
  const ralphSummary = await readCurrentRalphSummary(paths);
  return [
    lastSession ? `Recent session: ${lastSession.origin} @ ${lastSession.startedAt}` : 'Recent session: none',
    ralphSummary,
  ];
}
