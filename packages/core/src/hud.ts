import { join } from 'node:path';
import type { OmgPaths } from './types.js';
import { readJson } from './utils/fs.js';

export async function renderHud(paths: OmgPaths): Promise<string> {
  const session = await readJson<any>(join(paths.projectOmgDir, 'session.json'), null);
  const mode = await readJson<any>(join(paths.projectOmgDir, 'mode.json'), null);
  const ralph = await readJson<any>(join(paths.projectOmgDir, 'artifacts', 'ralph-state.json'), null);
  return [
    'OMG HUD',
    '=======',
    session ? `Session: ${session.sessionId} (${session.origin})` : 'Session: none',
    mode ? `Mode: ${mode.mode}` : 'Mode: unknown',
    ralph ? `Ralph: ${ralph.status} iteration ${ralph.iteration}/${ralph.maxIterations}` : 'Ralph: idle',
  ].join('\n');
}
