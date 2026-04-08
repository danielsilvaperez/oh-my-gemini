#!/usr/bin/env node
import path from 'node:path';
import { appendJsonl, ensureProjectDirs, outputJson, readHookInput, resolveProjectRoot } from './shared.mjs';

const input = readHookInput();
const projectRoot = resolveProjectRoot(input);
const { logs } = ensureProjectDirs(projectRoot);
appendJsonl(path.join(logs, 'hooks.jsonl'), { at: new Date().toISOString(), event: 'SessionEnd', input });
outputJson({ systemMessage: '[OMG] Session closed' });
