import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTeamControllerDecision, shouldSpawnFixPass } from '../team-controller.js';
import { decideTeamLoopAction } from '../team-loop.js';
import type { TeamWorkerStatus } from '../types.js';
import { buildTeamProgressEvidence, countTeamWorkers } from '../team-progress.js';
import { buildFixPassTask, buildWorkerAssignments, deriveTeamPhase, deriveTeamStatus, parseTeamSpec } from '../team.js';
import { summarizeTeamWorkers } from '../team-mailbox.js';

test('parseTeamSpec validates count and role', () => {
  assert.deepEqual(parseTeamSpec('3:executor'), { count: 3, role: 'executor' });
});

test('buildWorkerAssignments creates a verification lane', () => {
  const assignments = buildWorkerAssignments(3, 'executor', 'ship the feature');
  assert.equal(assignments[0]?.lane, 'primary-delivery');
  assert.equal(assignments[2]?.lane, 'verification');
});

test('parseTeamSpec rejects malformed specs', () => {
  assert.throws(() => parseTeamSpec('executor:3'), /Team spec must look like 3:executor/);
});

test('deriveTeamPhase recognizes completion and fixing states', () => {
  const completed: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker) => ({ ...worker, status: 'completed', logPath: 'x', workDir: '.' }));
  assert.equal(deriveTeamPhase(completed, false), 'complete');

  const failed: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker, index) => ({
    ...worker,
    status: index === 1 ? 'failed' : 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(deriveTeamPhase(failed, true), 'fixing');
});

test('deriveTeamPhase recognizes verification and execution states', () => {
  const workers: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker) => ({
    ...worker,
    status: worker.lane === 'verification' ? 'running' : 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(deriveTeamPhase(workers, true), 'verifying');

  const executing: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker) => ({
    ...worker,
    status: worker.lane === 'primary-delivery' ? 'running' : 'pending',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(deriveTeamPhase(executing, true), 'executing');
});

test('summarizeTeamWorkers reports worker state counts', () => {
  const workers: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker, index) => ({
    ...worker,
    status: index === 0 ? 'running' : index === 1 ? 'pending' : 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(
    summarizeTeamWorkers(workers),
    'workers pending=1 running=1 completed=1 failed=0 stopped=0',
  );
  assert.deepEqual(countTeamWorkers(workers), {
    pending: 1,
    running: 1,
    completed: 1,
    failed: 0,
    stopped: 0,
  });
});

test('deriveTeamStatus reflects worker outcomes and tmux state', () => {
  const completed: TeamWorkerStatus[] = buildWorkerAssignments(2, 'executor', 'ship').map((worker) => ({
    ...worker,
    status: 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(deriveTeamStatus(completed, false), 'completed');

  const failed: TeamWorkerStatus[] = buildWorkerAssignments(2, 'executor', 'ship').map((worker, index) => ({
    ...worker,
    status: index === 0 ? 'failed' : 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  assert.equal(deriveTeamStatus(failed, false), 'failed');
  assert.equal(deriveTeamStatus(failed, true), 'running');
});

test('buildTeamProgressEvidence suggests next actions', async () => {
  const workers: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker, index) => ({
    ...worker,
    status: index === 2 ? 'failed' : 'completed',
    logPath: 'x',
    workDir: '.',
  }));
  const evidence = await buildTeamProgressEvidence({
    projectTeamDir: '/tmp',
  } as any, {
    manifest: {
      id: 'team-1',
      task: 'ship',
      sessionName: 'session',
      status: 'failed',
      currentPhase: 'fixing',
      workers,
    },
    tmuxSessionAlive: false,
  } as any);
  assert.equal(evidence.nextAction, 'review failed worker output before resuming the team');
});

test('computeTeamControllerDecision returns attach guidance for live teams', () => {
  const workers: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker) => ({
    ...worker,
    status: worker.lane === 'primary-delivery' ? 'running' : 'pending',
    logPath: 'x',
    workDir: '.',
  }));
  const decision = computeTeamControllerDecision({
    workers,
    currentPhase: 'executing',
    status: 'running',
  }, true);
  assert.equal(decision.phase, 'executing');
  assert.equal(decision.status, 'running');
  assert.equal(decision.shouldAttach, true);
});

test('shouldSpawnFixPass only triggers for non-live fixing teams', () => {
  assert.equal(shouldSpawnFixPass({
    phase: 'fixing',
    status: 'failed',
    nextAction: 'fix it',
    shouldAttach: false,
  }, false), true);
  assert.equal(shouldSpawnFixPass({
    phase: 'fixing',
    status: 'running',
    nextAction: 'inspect live team',
    shouldAttach: true,
  }, true), false);
  assert.equal(shouldSpawnFixPass({
    phase: 'executing',
    status: 'running',
    nextAction: 'wait',
    shouldAttach: true,
  }, false), false);
});

test('decideTeamLoopAction requests fix pass only for offline fixing teams', () => {
  const fix = decideTeamLoopAction({
    phase: 'fixing',
    status: 'failed',
    nextAction: 'review failed worker output before resuming the team',
    shouldAttach: false,
  }, false);
  assert.equal(fix.shouldSpawnFixPass, true);
  assert.equal(fix.status, 'waiting');

  const live = decideTeamLoopAction({
    phase: 'executing',
    status: 'running',
    nextAction: 'wait for active workers or inspect worker logs',
    shouldAttach: true,
  }, true);
  assert.equal(live.shouldSpawnFixPass, false);
  assert.equal(live.status, 'waiting');
});

test('buildFixPassTask includes failed worker summaries', () => {
  const workers: TeamWorkerStatus[] = buildWorkerAssignments(3, 'executor', 'ship').map((worker, index) => ({
    ...worker,
    status: index === 1 ? 'failed' : 'completed',
    summary: index === 1 ? 'Verifier found failing regression tests' : 'done',
    logPath: 'x',
    workDir: '.',
  }));
  const task = buildFixPassTask({
    id: 'team-old',
    sessionName: 'session-old',
    task: 'ship',
    role: 'executor',
    count: 3,
    cwd: '.',
    startedAt: new Date().toISOString(),
    currentPhase: 'fixing',
    status: 'failed',
    workers,
  });
  assert.match(task, /Follow-up fix pass for team team-old/);
  assert.match(task, /Verifier found failing regression tests/);
});
