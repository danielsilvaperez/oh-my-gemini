import { join } from 'node:path';
import type { OmgPaths } from './types.js';
import { readOperatorSummary, readRecentProjectSessions } from './session-history.js';
import { readModeState } from './state.js';
import { readRecentTrace } from './trace.js';
import { listFiles, readJson } from './utils/fs.js';

export async function renderHud(paths: OmgPaths): Promise<string> {
  const session = await readJson<any>(join(paths.projectOmgDir, 'session.json'), null);
  const mode = await readJson<any>(join(paths.projectOmgDir, 'mode.json'), null);
  const ralphArtifact = await readJson<any>(join(paths.projectArtifactsDir, 'ralph-state.json'), null);
  const plan = await readJson<any>(paths.projectCurrentPlanJsonPath, null);
  const testSpec = await readJson<any>(paths.projectCurrentTestSpecJsonPath, null);
  const teamEntries = await listFiles(paths.projectTeamDir);
  const activeStep = plan?.steps?.find?.((step: any) => step.status !== 'completed') ?? null;
  const completedSteps = Array.isArray(plan?.steps) ? plan.steps.filter((step: any) => step.status === 'completed').length : 0;
  const planState = await readModeState(paths, 'plan');
  const ralphState = await readModeState(paths, 'ralph');
  const teamState = await readModeState(paths, 'team');
  const trace = await readRecentTrace(paths, 1);
  const lastTrace = trace[0];
  const recentSessions = await readRecentProjectSessions(paths, 1);
  const lastSession = recentSessions[0];
  const operatorSummary = await readOperatorSummary(paths);
  const ralph = ralphArtifact ?? ralphState;
  return [
    'OMG HUD',
    '=======',
    session ? `Session: ${session.sessionId} (${session.origin})` : lastSession ? `Session: ${lastSession.sessionId} (${lastSession.origin})` : 'Session: none',
    mode ? `Mode: ${mode.mode}` : ralphState?.active ? `Mode: ${ralphState.mode}` : 'Mode: unknown',
    session?.task ? `Task: ${session.task}` : (ralphState?.task ? `Task: ${ralphState.task}` : 'Task: none'),
    plan
      ? `Plan: ${completedSteps}/${plan.steps.length} complete${activeStep ? ` | active: ${activeStep.id} ${activeStep.title}` : ''}`
      : 'Plan: none',
    testSpec
      ? `Test spec: ${testSpec.suites?.length ?? 0} suite(s)`
      : 'Test spec: none',
    planState?.currentPhase ? `Plan state: ${planState.currentPhase}` : 'Plan state: idle',
    ralph
      ? `Ralph: ${(ralph.status ?? (ralph.active ? 'running' : 'idle'))} | phase ${ralph.currentPhase} | iteration ${ralph.iteration ?? '-'}${ralph.maxIterations ? `/${ralph.maxIterations}` : ''}`
      : 'Ralph: idle',
    teamEntries.length
      ? `Teams: ${teamEntries.length} workspace(s)${teamState?.currentPhase ? ` | phase ${teamState.currentPhase}` : ''}`
      : 'Teams: idle',
    lastTrace ? `Trace: ${lastTrace.kind}${lastTrace.mode ? ` (${lastTrace.mode})` : ''}` : 'Trace: none',
    ...operatorSummary,
  ].join('\n');
}
