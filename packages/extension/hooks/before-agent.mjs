#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, ensureProjectDirs, outputJson, readHookInput, readTextPreview, resolveProjectRoot } from './shared.mjs';

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
const testSpecPath = path.join(projectOmg, 'test-spec-current.md');
const notepadPath = path.join(projectOmg, 'notepad.md');
const projectMemoryPath = path.join(projectOmg, 'project-memory.json');

if (fs.existsSync(projectMemoryPath)) {
  const memoryPreview = readTextPreview(projectMemoryPath, 4096, 50);
  extra += `\n\nProject memory (conventions & directives):\n${memoryPreview}`;
}
if (fs.existsSync(notepadPath)) {
  const notepadPreview = readTextPreview(notepadPath, 4096, 50);
  extra += `\n\nTransient session notepad:\n${notepadPreview}`;
}
if (fs.existsSync(planPath)) {
  const planPreview = readTextPreview(planPath, 4096, 20);
  extra += `\n\nCurrent plan preview:\n${planPreview}`;
}
if (fs.existsSync(testSpecPath)) {
  const testSpecPreview = readTextPreview(testSpecPath, 4096, 14);
  extra += `\n\nCurrent test spec preview:\n${testSpecPreview}`;
}
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'BeforeAgent', input });
outputJson({
  hookSpecificOutput: {
    hookEventName: 'BeforeAgent',
    additionalContext: extra,
  },
});
