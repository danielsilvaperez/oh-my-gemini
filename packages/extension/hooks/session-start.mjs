#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, appendTraceEvent, bootstrapProjectFiles, ensureProjectDirs, outputJson, readHookInput, resolveProjectRoot } from './shared.mjs';

const input = readHookInput();
const projectRoot = resolveProjectRoot(input);
const { projectOmg, logs } = ensureProjectDirs(projectRoot);
bootstrapProjectFiles(projectOmg, projectRoot);
const mode = process.env.OMG_MODE || 'smart';
const session = {
  sessionId: input.session_id || `hook-${Date.now()}`,
  mode,
  startedAt: new Date().toISOString(),
  cwd: projectRoot,
  origin: 'extension-session-start',
};
fs.writeFileSync(path.join(projectOmg, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
fs.writeFileSync(path.join(projectOmg, 'mode.json'), `${JSON.stringify({
  mode,
  sessionId: session.sessionId,
  task: input.user_prompt || null,
  updatedAt: new Date().toISOString(),
}, null, 2)}\n`);
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'SessionStart', input });
appendTraceEvent(projectRoot, {
  at: new Date().toISOString(),
  kind: 'hook-session-start',
  mode,
  sessionId: session.sessionId,
  detail: { cwd: projectRoot },
});
outputJson({
  systemMessage: `[OMG] ${mode.toUpperCase()} session initialized`,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `OMG mode: ${mode}. Use /plan, /ralph, /team, and /deep-interview for durable workflows. Persist important artifacts under .omg/, especially plan-current.*, test-spec-current.*, project-memory.json, and notepad.md.`,
  },
});
