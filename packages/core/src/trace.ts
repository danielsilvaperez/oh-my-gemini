import { join } from 'node:path';
import type { OmgPaths, TraceEvent } from './types.js';
import { appendJsonl, readText } from './utils/fs.js';

function tracePath(paths: OmgPaths): string {
  return join(paths.projectLogsDir, 'trace.jsonl');
}

export async function appendTraceEvent(paths: OmgPaths, event: TraceEvent): Promise<void> {
  await appendJsonl(tracePath(paths), event);
}

export async function readRecentTrace(paths: OmgPaths, maxEntries = 5): Promise<TraceEvent[]> {
  const raw = await readText(tracePath(paths), '');
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .slice(-maxEntries)
    .map((line) => JSON.parse(line) as TraceEvent);
}
