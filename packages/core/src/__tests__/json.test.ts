import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, parseGeminiJsonPayload } from '../utils/json.js';

test('extractJsonObject finds the first balanced object', () => {
  assert.equal(extractJsonObject('prefix {"ok":true,"nested":{"a":1}} suffix'), '{"ok":true,"nested":{"a":1}}');
});

test('parseGeminiJsonPayload reads headless json response', () => {
  const parsed = parseGeminiJsonPayload<{ answer: string }>(JSON.stringify({ response: '{"answer":"ok"}' }));
  assert.deepEqual(parsed, { answer: 'ok' });
});
