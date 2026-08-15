import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchSuggestions, parseCommitMessage } from '@/tools/format.js';

test('parseCommitMesssage splits subject and body', () => {
  const parsed = parseCommitMessage('Add retry logic\n\nHandle transient client failures.');
  assert.deepEqual(parsed, {
    subject: 'Add retry logic',
    body: 'Handle transient client failures.',
    message: 'Add retry logic\n\nHandle transient client failures.',
  });
});

test('parseCommitMessage handles subject-only output and strips wrapping quotes', () => {
  const parsed = parseCommitMessage('"Fix null deref"');
  assert.deepEqual(parsed, { subject: 'Fix null deref', message: 'Fix null deref' });
  assert.equal('body' in parsed, false);
});

test('parseBranchSuggestions normalizes and drops invalid names', () => {
  const out = parseBranchSuggestions('feature/add-retry\nfix login flow\ninvalid name!');
  assert.deepEqual(out, ['feature/add-retry', 'fix-login-flow']);
});

test('parseBranchSuggestions de-duplicates and caps at five', () => {
  const out = parseBranchSuggestions('a\na\nb\nc\nd\ne\nf');
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
});
