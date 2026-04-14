import type { TeamControllerDecision, TeamManifest } from './types.js';
import { countTeamWorkers } from './team-progress.js';

export function computeTeamControllerDecision(
  manifest: Pick<TeamManifest, 'workers' | 'currentPhase' | 'status'>,
  tmuxSessionAlive: boolean,
): TeamControllerDecision {
  const counts = countTeamWorkers(manifest.workers);

  if (counts.failed > 0) {
    return {
      phase: 'fixing',
      status: tmuxSessionAlive ? 'running' : 'failed',
      nextAction: tmuxSessionAlive
        ? 'inspect failed worker output and coordinate a fix pass'
        : 'review failed worker output before resuming the team',
      shouldAttach: tmuxSessionAlive,
    };
  }

  if (counts.running > 0 && manifest.workers.some((worker) => worker.lane === 'verification' && worker.status === 'running')) {
    return {
      phase: 'verifying',
      status: 'running',
      nextAction: 'wait for verification lane to finish or inspect verifier logs',
      shouldAttach: tmuxSessionAlive,
    };
  }

  if (counts.running > 0) {
    return {
      phase: 'executing',
      status: 'running',
      nextAction: 'wait for active workers or inspect worker logs',
      shouldAttach: tmuxSessionAlive,
    };
  }

  if (counts.completed === manifest.workers.length && manifest.workers.length > 0) {
    return {
      phase: 'complete',
      status: 'completed',
      nextAction: 'review final evidence and close the loop',
      shouldAttach: false,
    };
  }

  if (tmuxSessionAlive) {
    return {
      phase: 'planning',
      status: 'running',
      nextAction: 'attach to the tmux session and inspect startup progress',
      shouldAttach: true,
    };
  }

  return {
    phase: 'stopped',
    status: 'stopped',
    nextAction: 'resume or restart the team session',
    shouldAttach: false,
  };
}

export function shouldSpawnFixPass(
  decision: TeamControllerDecision,
  tmuxSessionAlive: boolean,
): boolean {
  return decision.phase === 'fixing' && !tmuxSessionAlive;
}
