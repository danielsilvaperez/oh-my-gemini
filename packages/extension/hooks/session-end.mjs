#!/usr/bin/env node
import path from 'node:path';
import { appendJsonl, appendTraceEvent, ensureProjectDirs, outputJson, readHookInput, resolveProjectRoot } from './shared.mjs';

const input = readHookInput();
const projectRoot = resolveProjectRoot(input);
const { logs } = ensureProjectDirs(projectRoot);
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'SessionEnd', input });
appendTraceEvent(projectRoot, {
  at: new Date().toISOString(),
  kind: 'hook-session-end',
  sessionId: input.session_id || null,
  detail: { cwd: projectRoot },
});
outputJson({ systemMessage: '[OMG] Session closed' });
