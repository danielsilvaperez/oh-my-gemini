import { access, appendFile, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isWritableDir(path: string): Promise<boolean> {
  try {
    await ensureDir(path);
    const probe = join(path, `.omg-write-probe-${Date.now()}`);
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string, fallback = ''): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  const temp = `${path}.tmp-${Date.now()}`;
  await writeFile(temp, content, 'utf8');
  await rm(path, { force: true });
  await copyFile(temp, path);
  await rm(temp, { force: true });
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function appendText(path: string, text: string): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, text, 'utf8');
}

export async function copyRecursive(src: string, dest: string): Promise<void> {
  const sourceStat = await stat(src);
  if (sourceStat.isDirectory()) {
    await ensureDir(dest);
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(join(src, entry.name), join(dest, entry.name));
    }
    return;
  }
  await ensureDir(dirname(dest));
  await copyFile(src, dest);
}

export async function listFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    return entries.sort();
  } catch {
    return [];
  }
}

export async function tailFile(path: string, maxLines = 40): Promise<string> {
  const raw = await readText(path, '');
  const lines = raw.trimEnd().split(/\r?\n/);
  return lines.slice(-maxLines).join('\n');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'task';
}

export function renderSection(title: string, lines: string[]): string {
  return [`## ${title}`, '', ...lines, ''].join('\n');
}

export function safeBaseName(path: string): string {
  return basename(path).replace(/[^a-zA-Z0-9._-]/g, '_');
}
