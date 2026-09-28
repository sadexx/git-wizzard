import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitDiff } from '@git-assistant/shared';
import { formatDiff } from '#commands/diff.js';
import type { Style } from '#format.js';

const tagged: Style = (format, text) => `<${format}>${text}</${format}>`;

const diff: GitDiff = {
  staged: true,
  additions: 15,
  deletions: 2,
  files: [
    { path: 'a.ts', additions: 5, deletions: 2, binary: false },
    { path: 'logo.png', additions: 0, deletions: 0, binary: true },
    { path: 'b.ts', additions: 10, deletions: 0, binary: false },
  ],
  patch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-x\n+y\n',
};

test('formatDiff shows a summary, aligned per-file counts, then the patch', () => {
  assert.equal(
    formatDiff(diff),
    [
      'Staged changes: 3 files, +15 -2',
      '  +5 -2   a.ts',
      '  binary  logo.png',
      '  +10 -0  b.ts',
      '',
      'diff --git a/a.ts b/a.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n'),
  );
});

test('formatDiff colors counts and patch lines', () => {
  const out = formatDiff(diff, tagged);
  assert.match(out, /<green>\+5<\/green> <red>-2<\/red> {3}a\.ts/);
  assert.match(out, /<dim>binary<\/dim> {2}logo\.png/);
  assert.match(out, /<red>-x<\/red>\n<green>\+y<\/green>$/);
});

test('formatDiff says plainly when there is nothing to show', () => {
  const empty: GitDiff = { staged: false, additions: 0, deletions: 0, files: [], patch: '' };
  assert.equal(formatDiff(empty), 'No unstaged changes.\nStaged changes are shown with --staged.');
  assert.equal(formatDiff({ ...empty, staged: true }), 'No staged changes.');
});
