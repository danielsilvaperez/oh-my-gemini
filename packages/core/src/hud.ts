import { join } from 'node:path';
import type { OmgPaths, TeamManifest } from './types.js';
import { readOperatorSummary, readRecentProjectSessions } from './session-history.js';
import { readModeState } from './state.js';
import { readRecentTrace } from './trace.js';
import { listFiles, readJson } from './utils/fs.js';

function renderProgressBar(current: number, total: number, width = 20): string {
  if (total <= 0) return `[${' '.repeat(width)}]`;
  const ratio = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${' '.repeat(empty)}] ${current}/${total}`;
}

export async function renderHud(paths: OmgPaths): Promise<string> {
  const session = await readJson<any>(join(paths.projectOmgDir, 'session.json'), null);
  const mode = await readJson<any>(join(paths.projectOmgDir, 'mode.json'), null);
  const ralphArtifact = await readJson<any>(join(paths.projectArtifactsDir, 'ralph-state.json'), null);
  const plan = await readJson<any>(paths.projectCurrentPlanJsonPath, null);
  const testSpec = await readJson<any>(paths.projectCurrentTestSpecJsonPath, null);
  const teamEntries = await listFiles(paths.projectTeamDir);
  const totalSteps = Array.isArray(plan?.steps) ? plan.steps.length : 0;
  const completedSteps = Array.isArray(plan?.steps) ? plan.steps.filter((step: any) => step.status === 'completed').length : 0;
  const activeStep = plan?.steps?.find?.((step: any) => step.status !== 'completed') ?? null;
  const planState = await readModeState(paths, 'plan');
  const ralphState = await readModeState(paths, 'ralph');
  const teamState = await readModeState(paths, 'team');
  const trace = await readRecentTrace(paths, 1);
  const lastTrace = trace[0];
  const recentSessions = await readRecentProjectSessions(paths, 1);
  const lastSession = recentSessions[0];
  const operatorSummary = await readOperatorSummary(paths);
  const ralph = ralphArtifact ?? ralphState;

  const lines = [
    '\x1b[1m\x1b[36m=== OMG HUD ===\x1b[0m',
    '',
    '\x1b[1mContext:\x1b[0m',
    session ? `  Session: ${session.sessionId} (${session.origin})` : lastSession ? `  Session: ${lastSession.sessionId} (${lastSession.origin})` : '  Session: none',
    mode ? `  Mode: ${mode.mode}` : ralphState?.active ? `  Mode: ${ralphState.mode}` : '  Mode: unknown',
    session?.task ? `  Task: ${session.task}` : (ralphState?.task ? `  Task: ${ralphState.task}` : '  Task: none'),
    '',
    '\x1b[1mPlan & Ralph:\x1b[0m',
    plan ? `  Plan progress: ${renderProgressBar(completedSteps, totalSteps)}` : '  Plan: none',
    activeStep ? `  Active step: ${activeStep.id} - ${activeStep.title}` : '',
    ralph ? `  Ralph loop: ${(ralph.status ?? (ralph.active ? 'running' : 'idle'))} | phase: ${ralph.currentPhase} | iteration: ${ralph.iteration ?? '-'}${ralph.maxIterations ? `/${ralph.maxIterations}` : ''}` : '  Ralph: idle',
    testSpec ? `  Test spec: ${testSpec.suites?.length ?? 0} suite(s)` : '',
    '',
  ];

  lines.push('\x1b[1mTeam Activity:\x1b[0m');
  if (teamState?.active && teamState.metadata?.teamId) {
    const activeTeamId = teamState.metadata.teamId as string;
    lines.push(`  Active Team: ${activeTeamId} (phase: ${teamState.currentPhase})`);
    try {
      const manifest = await readJson<TeamManifest>(join(paths.projectTeamDir, activeTeamId, 'manifest.json'), null as never);
      if (manifest?.workers) {
        for (const w of manifest.workers) {
          const color = w.status === 'completed' ? '\x1b[32m' : w.status === 'failed' ? '\x1b[31m' : w.status === 'running' ? '\x1b[33m' : '\x1b[90m';
          lines.push(`  ${color}- ${w.id} [${w.lane}]: ${w.status}\x1b[0m`);
          if (w.summary) lines.push(`      ${w.summary.slice(0, 80)}${w.summary.length > 80 ? '...' : ''}`);
        }
      }
    } catch {
      // Ignore read errors
    }
  } else {
    lines.push(teamEntries.length ? `  Idle Teams: ${teamEntries.length} workspace(s)` : '  Teams: idle');
  }

  lines.push('');
  lines.push('\x1b[1mSystem:\x1b[0m');
  lines.push(lastTrace ? `  Last Trace: ${lastTrace.kind}${lastTrace.mode ? ` (${lastTrace.mode})` : ''}` : '  Trace: none');
  
  if (operatorSummary.length > 0) {
    lines.push('');
    lines.push(...operatorSummary);
  }

  return lines.filter(line => line !== null).join('\n');
}
