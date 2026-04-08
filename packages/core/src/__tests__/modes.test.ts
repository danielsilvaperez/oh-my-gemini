import test from 'node:test';
import assert from 'node:assert/strict';
import { isNonTrivialTask, selectMode } from '../modes.js';

test('selectMode chooses high over madmax', () => {
  assert.deepEqual(selectMode({ madmax: true, high: true }), { mode: 'high', tmux: false });
});

test('isNonTrivialTask detects multi-step asks', () => {
  assert.equal(isNonTrivialTask('implement the workflow engine and verify the release flow'), true);
  assert.equal(isNonTrivialTask('fix typo'), false);
});
