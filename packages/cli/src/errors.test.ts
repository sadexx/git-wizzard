import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authError, gitError, providerError } from '@git-assistant/shared';
import { renderError } from '#errors.js';

test('renderError shows the message and an actionable hint', () => {
  assert.equal(
    renderError(gitError('nothing_to_commit', 'No staged changes to summarize')),
    'error: No staged changes to summarize\nhint: Stage your changes with "git add <path>", or run "git-assistant commit -a" to include all tracked files.',
  );
});

test('renderError indents multi-line cause detail under the message', () => {
  const error = gitError('command_failed', 'Failed to create branch x', 'fatal: line one\nline two');
  assert.equal(renderError(error), 'error: Failed to create branch x\n  fatal: line one\n  line two');
});

test('renderError points auth failures at the auth command', () => {
  assert.match(renderError(authError('missing_credentials', 'none')), /^hint: Run "git-assistant auth"/m);
  assert.match(renderError(providerError('unauthorized', 'rejected')), /^hint: Run "git-assistant auth"/m);
});

test('renderError skips detail that repeats the message and omits hint when none applies', () => {
  assert.equal(renderError(providerError('request_failed', 'boom', new Error('boom'))), 'error: boom');
});

test('renderError lists validation issues as detail', () => {
  const error = {
    kind: 'ValidationError',
    message: 'Validation failed',
    issues: [
      { path: 'n', message: 'Expected number' },
      { path: '', message: 'Bad root' },
    ],
  } as const;
  assert.equal(renderError(error), 'error: Validation failed\n  n: Expected number\n  <root>: Bad root');
});
