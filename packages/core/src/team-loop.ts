import type { TeamControllerDecision, TeamLoopResult } from './types.js';
import { shouldSpawnFixPass } from './team-controller.js';

export function decideTeamLoopAction(
  decision: TeamControllerDecision,
  tmuxSessionAlive: boolean,
): {
  status: TeamLoopResult['status'];
  shouldSpawnFixPass: boolean;
  message: string;
} {
  if (decision.phase === 'complete' || decision.status === 'completed') {
    return {
      status: 'complete',
      shouldSpawnFixPass: false,
      message: 'team is complete; review final evidence',
    };
  }

  if (shouldSpawnFixPass(decision, tmuxSessionAlive)) {
    return {
      status: 'waiting',
      shouldSpawnFixPass: true,
      message: 'spawn a follow-up fix pass team',
    };
  }

  return {
    status: tmuxSessionAlive ? 'waiting' : 'stopped',
    shouldSpawnFixPass: false,
    message: decision.nextAction,
  };
}
