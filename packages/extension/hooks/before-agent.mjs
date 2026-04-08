#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, ensureProjectDirs, outputJson, readHookInput, resolveProjectRoot } from './shared.mjs';

const input = readHookInput();
const projectRoot = resolveProjectRoot(input);
const { projectOmg, logs } = ensureProjectDirs(projectRoot);
const mode = process.env.OMG_MODE || 'smart';
let extra = `OMG mode: ${mode}. `;
if (mode === 'high') {
  extra += 'Plan first, execute one bounded step at a time, and verify before claiming completion. ';
} else if (mode === 'madmax') {
  extra += 'Plan before non-trivial work, minimize interruptions, and keep moving through recoverable failures. ';
} else {
  extra += 'Use lightweight planning when the task is non-trivial and verify important changes. ';
}
const planPath = path.join(projectOmg, 'plan-current.md');
if (fs.existsSync(planPath)) {
  const planPreview = fs.readFileSync(planPath, 'utf8').split(/\r?\n/).slice(0, 20).join('\n');
  extra += `Current plan preview:\n${planPreview}`;
}
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'BeforeAgent', input });
outputJson({
  hookSpecificOutput: {
    hookEventName: 'BeforeAgent',
    additionalContext: extra,
  },
});
