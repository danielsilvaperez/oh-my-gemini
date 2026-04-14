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

function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'package.json')) ||
      fs.existsSync(path.join(current, '.omg'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start);
    }
    current = parent;
  }
}

function safeRealDir(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const resolved = path.resolve(candidate);
    if (!path.isAbsolute(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return null;
    return fs.realpathSync(resolved);
  } catch {
    return null;
  }
}

export function resolveProjectRoot(input) {
  const runtimeRoot = findProjectRoot(fs.realpathSync(process.cwd()));
  const hintedCandidates = [
    safeRealDir(input.cwd),
    safeRealDir(process.env.OMG_PROJECT_DIR),
    safeRealDir(process.env.GEMINI_PROJECT_DIR),
  ].filter(Boolean);
  for (const candidate of hintedCandidates) {
    const candidateRoot = findProjectRoot(candidate);
    if (candidateRoot === runtimeRoot) {
      return candidateRoot;
    }
  }
  return runtimeRoot;
}

export function ensureProjectDirs(projectRoot) {
  const projectOmg = path.join(projectRoot, '.omg');
  const logs = path.join(projectOmg, 'logs');
  const artifacts = path.join(projectOmg, 'artifacts');
  const context = path.join(projectOmg, 'context');
  const state = path.join(projectOmg, 'state');
  for (const dir of [projectOmg, logs, artifacts, context, state]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { projectOmg, logs, artifacts, context, state };
}

export function bootstrapProjectFiles(projectOmg, projectRoot) {
  const memoryPath = path.join(projectOmg, 'project-memory.json');
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot,
      techStack: [],
      conventions: [],
      directives: [],
      notes: [],
    }, null, 2)}\n`);
  }
  const notepadPath = path.join(projectOmg, 'notepad.md');
  if (!fs.existsSync(notepadPath)) {
    fs.writeFileSync(notepadPath, '# OMG Notepad\n\n## Priority Context\n\n## Working Notes\n\n## Manual Notes\n');
  }
}

export function readTextPreview(file, maxBytes = 4096, maxLines = 20) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead).split(/\r?\n/).slice(0, maxLines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export function appendTraceEvent(projectRoot, event) {
  const traceFile = path.join(projectRoot, '.omg', 'logs', 'trace.jsonl');
  appendJsonl(traceFile, event);
}

export function outputJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
