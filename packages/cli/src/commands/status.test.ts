import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitStatus } from '@git-assistant/shared';
import { formatStatus } from '#commands/status.js';
import type { Style } from '#format.js';

const tagged: Style = (format, text) => `<${format}>${text}</${format}>`;

const clean: GitStatus = { branch: 'main', ahead: 0, behind: 0, isClean: true, files: [] };

test('formatStatus reports a clean tree without upstream noise', () => {
  assert.equal(formatStatus(clean), 'On branch main\n\nNothing to commit, working tree clean.');
});

test('formatStatus describes the upstream relation', () => {
  const at = (ahead: number, behind: number): string =>
    formatStatus({ ...clean, upstream: 'origin/main', ahead, behind }).split('\n')[1] ?? '';
  assert.equal(at(0, 0), 'Up to date with origin/main.');
  assert.equal(at(1, 0), 'Ahead of origin/main by 1 commit.');
  assert.equal(at(0, 3), 'Behind origin/main by 3 commits.');
  assert.equal(at(2, 1), 'Diverged from origin/main: 2 ahead, 1 behind.');
});

test('formatStatus groups changes like git, listing a partly staged file twice', () => {
  const out = formatStatus({
    ...clean,
    isClean: false,
    files: [
      { path: 'both.ts', index: 'modified', workingTree: 'modified' },
      { path: 'new.ts', index: 'renamed', workingTree: 'unmodified', originalPath: 'old.ts' },
      { path: 'gone.ts', index: 'unmodified', workingTree: 'deleted' },
      { path: 'notes.md', index: 'unmodified', workingTree: 'untracked' },
      { path: 'clash.ts', index: 'conflicted', workingTree: 'conflicted' },
    ],
  });
  assert.equal(
    out,
    [
      'On branch main',
      '',
      'Conflicts:',
      '  conflicted: clash.ts',
      '',
      'Staged:',
      '  modified:   both.ts',
      '  renamed:    new.ts (from old.ts)',
      '',
      'Not staged:',
      '  modified:   both.ts',
      '  deleted:    gone.ts',
      '',
      'Untracked:',
      '  notes.md',
    ].join('\n'),
  );
});

test('formatStatus colors staged green and unstaged red', () => {
  const out = formatStatus(
    {
      ...clean,
      isClean: false,
      files: [{ path: 'a.ts', index: 'added', workingTree: 'modified' }],
    },
    tagged,
  );
  assert.match(out, /<green>added: {6}a\.ts<\/green>/);
  assert.match(out, /<red>modified: {3}a\.ts<\/red>/);
});

test('formatStatus names a detached HEAD', () => {
  assert.match(formatStatus({ ...clean, branch: '(detached)' }), /^HEAD detached\n/);
});
