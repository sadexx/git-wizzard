import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authError, gitError, providerError } from '@git-wizzard/shared';
import { renderError } from '#errors.js';

test('renderError shows the message and an actionable hint', () => {
  assert.equal(
    renderError(gitError('nothing_to_commit', 'No staged changes to summarize')),
    'error: No staged changes to summarize\nhint: Stage your changes with "git add <path>", or run "gitwizz commit -a" to include all tracked files.',
  );
});

test('renderError indents multi-line cause detail under the message', () => {
  const error = gitError('command_failed', 'Failed to create branch x', 'fatal: line one\nline two');
  assert.equal(renderError(error), 'error: Failed to create branch x\n  fatal: line one\n  line two');
});

test('renderError points auth failures at the auth command', () => {
  assert.match(renderError(authError('missing_credentials', 'none')), /^hint: Run "gitwizz auth"/m);
  assert.match(renderError(providerError('unauthorized', 'rejected')), /^hint: Run "gitwizz auth"/m);
});

test('renderError does not send "auth" without a terminal back to "auth"', () => {
  const rendered = renderError(authError('no_terminal', 'needs a terminal'));
  assert.doesNotMatch(rendered, /gitwizz auth/);
  assert.match(rendered, /^hint: .*OPENAI_API_KEY/m);
});

test('renderError skips detail that repeats the message and omits hint when none applies', () => {
  assert.equal(renderError(providerError('request_failed', 'boom', new Error('boom'))), 'error: boom');
});

test('every git failure a user can fix comes with a hint', () => {
  const hints: ReadonlyArray<[Parameters<typeof gitError>[0], RegExp]> = [
    ['not_a_repository', /inside a git repository/],
    ['no_changes', /uncommitted changes/],
    ['merge_conflict', /Resolve the conflicts/],
    ['base_not_found', /--base <branch>/],
    ['no_commits', /Commit your work first/],
    ['no_remote', /git remote add origin/],
    ['push_rejected', /git pull/],
    ['gh_not_found', /cli\.github\.com/],
    ['gh_not_authenticated', /gh auth login/],
  ];
  for (const [reason, hint] of hints) assert.match(renderError(gitError(reason, 'x')), new RegExp(`^hint: .*${hint.source}`, 'm'), reason);
  assert.equal(renderError(gitError('command_failed', 'x')), 'error: x');
  assert.match(renderError(providerError('rate_limited', 'x')), /^hint: Wait a moment/m);
  assert.match(renderError(authError('unsupported_provider', 'x')), /GIT_WIZZARD_PROVIDER/);
  assert.match(renderError(authError('config_read_failed', 'x')), /^hint: Fix or delete .*config\.json/m);
  assert.match(renderError(authError('config_write_failed', 'x')), /^hint: Check that .* is writable/m);
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
