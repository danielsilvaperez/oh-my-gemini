#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export function readHookInput() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function resolveProjectRoot(input) {
  return input.cwd || process.env.OMG_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.cwd();
}

export function ensureProjectDirs(projectRoot) {
  const projectOmg = path.join(projectRoot, '.omg');
  const logs = path.join(projectOmg, 'logs');
  const artifacts = path.join(projectOmg, 'artifacts');
  for (const dir of [projectOmg, logs, artifacts]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { projectOmg, logs, artifacts };
}

export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export function outputJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
