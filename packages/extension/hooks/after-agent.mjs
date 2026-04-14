#!/usr/bin/env node
import path from 'node:path';
import { appendJsonl, appendTraceEvent, ensureProjectDirs, outputJson, readHookInput, resolveProjectRoot } from './shared.mjs';

const input = readHookInput();
const projectRoot = resolveProjectRoot(input);
const { logs, state } = ensureProjectDirs(projectRoot);
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'AfterAgent', input });
const lastTurn = {
  updatedAt: new Date().toISOString(),
  event: 'AfterAgent',
  sessionId: input.session_id || null,
  cwd: projectRoot,
};
await import('node:fs').then((fs) => {
  fs.writeFileSync(path.join(state, 'last-turn.json'), `${JSON.stringify(lastTurn, null, 2)}\n`);
});
appendTraceEvent(projectRoot, {
  at: new Date().toISOString(),
  kind: 'hook-after-agent',
  sessionId: input.session_id || null,
  detail: { cwd: projectRoot },
});
outputJson({});
