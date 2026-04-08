import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerAssignments, parseTeamSpec } from '../team.js';

test('parseTeamSpec validates count and role', () => {
  assert.deepEqual(parseTeamSpec('3:executor'), { count: 3, role: 'executor' });
});

test('buildWorkerAssignments creates a verification lane', () => {
  const assignments = buildWorkerAssignments(3, 'executor', 'ship the feature');
  assert.equal(assignments[0]?.lane, 'primary-delivery');
  assert.equal(assignments[2]?.lane, 'verification');
});
