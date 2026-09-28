import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitDiff } from '@git-assistant/shared';
import { buildBranchPrompt, hasChanges, parseBranchSuggestions, parseCommitMessage } from '#tools/format.js';

function diff(staged: boolean, paths: string[], patch: string = ''): GitDiff {
  return {
    staged,
    additions: 0,
    deletions: 0,
    files: paths.map((path: string) => ({ path, additions: 1, deletions: 0, binary: false })),
    patch,
  };
}

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

test('parseBranchSuggestions strips list markers and quotes but keeps leading digits of a name', () => {
  const out = parseBranchSuggestions('1. feature/login\n2) `fix/crash`\n- "chore/deps"\n* 2fa-setup\n3.x-upgrade');
  assert.deepEqual(out, ['feature/login', 'fix/crash', 'chore/deps', '2fa-setup', '3.x-upgrade']);
});

test('parseBranchSuggestions rejects names git would refuse', () => {
  const out = parseBranchSuggestions(
    'feature/\n-leading\n.hidden\nfeat/.dot\na..b\na//b\nends.\nrefs.lock\nx.lock/y\nok-name',
  );
  assert.deepEqual(out, ['ok-name']);
});

test('buildBranchPrompt covers staged, unstaged, and untracked work', () => {
  const prompt = buildBranchPrompt(
    {
      staged: diff(true, ['src/a.ts', 'src/shared.ts'], '+staged line'),
      unstaged: diff(false, ['src/shared.ts', 'src/b.ts'], '+unstaged line'),
      untracked: ['src/new.ts'],
    },
    'fix',
  );
  assert.match(prompt, /^Preferred prefix\/type: fix\./);
  assert.match(prompt, /- src\/a\.ts\n- src\/shared\.ts\n- src\/b\.ts\n- src\/new\.ts \(new, untracked\)/);
  assert.match(prompt, /\+staged line\n\+unstaged line/);
});

test('hasChanges is false only when nothing is staged, modified, or untracked', () => {
  const none = { staged: diff(true, []), unstaged: diff(false, []), untracked: [] };
  assert.equal(hasChanges(none), false);
  assert.equal(hasChanges({ ...none, untracked: ['x'] }), true);
  assert.equal(hasChanges({ ...none, staged: diff(true, ['x']) }), true);
});

test('parseBranchSuggestions de-duplicates and caps at five', () => {
  const out = parseBranchSuggestions('a\na\nb\nc\nd\ne\nf');
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
});
