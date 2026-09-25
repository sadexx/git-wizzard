import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiff } from '#commands/diff.js';

test('formatDiff summarizes counts and includes the patch', () => {
  const out = formatDiff({
    staged: true,
    additions: 5,
    deletions: 2,
    files: [{ path: 'a.ts', additions: 5, deletions: 2, binary: false }],
    patch: 'diff --git a/a.ts b/a.ts',
  });
  assert.match(out, /Staged changes: 1 file\(s\), \+5\/-2/);
  assert.match(out, /\+5\/-2 {2}a\.ts/);
  assert.match(out, /diff --git/);
});

test('formatDiff omits the file list when empty', () => {
  const out = formatDiff({ staged: false, additions: 0, deletions: 0, files: [], patch: '' });
  assert.match(out, /Unstaged changes: 0 file\(s\)/);
});
