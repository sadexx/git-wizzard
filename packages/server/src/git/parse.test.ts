import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumstat, parseStatus } from '#git/parse.js';

test('parseStatus reads branch header and file entries', () => {
  const raw = [
    '# branch.oid abc123',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
    '1 M. N... 100644 100644 100644 ccc ddd src/util.ts',
    '2 R. N... 100644 100644 100644 eee fff R100 src/new.ts\tsrc/old.ts',
    '? untracked.txt',
    '',
  ].join('\n');

  const status = parseStatus(raw);
  assert.equal(status.branch, 'main');
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.isClean, false);
  assert.equal(status.files.length, 4);

  assert.deepEqual(status.files[0], { path: 'src/app.ts', index: 'unmodified', workingTree: 'modified' });
  assert.deepEqual(status.files[1], { path: 'src/util.ts', index: 'modified', workingTree: 'unmodified' });
  assert.deepEqual(status.files[2], {
    path: 'src/new.ts',
    index: 'renamed',
    workingTree: 'unmodified',
    originalPath: 'src/old.ts',
  });
  assert.deepEqual(status.files[3], { path: 'untracked.txt', index: 'unmodified', workingTree: 'untracked' });
});

test('parseStatus maps copied, conflicted, type-changed, and ignored entries', () => {
  const status = parseStatus(
    [
      '# branch.head main',
      '2 C. N... 100644 100644 100644 aaa bbb C100 copy.ts\torig.ts',
      '1 UU N... 100644 100644 100644 ccc ddd both.ts',
      'u UU N... 100644 100644 100644 100644 eee fff ggg merged.ts',
      '1 .T N... 100644 120000 120000 hhh iii link',
      '! build/',
    ].join('\n'),
  );
  assert.deepEqual(status.files, [
    { path: 'copy.ts', index: 'copied', workingTree: 'unmodified', originalPath: 'orig.ts' },
    { path: 'both.ts', index: 'conflicted', workingTree: 'conflicted' },
    { path: 'merged.ts', index: 'conflicted', workingTree: 'conflicted' },
    { path: 'link', index: 'unmodified', workingTree: 'modified' },
    { path: 'build/', index: 'unmodified', workingTree: 'ignored' },
  ]);
});

test('parseStatus reports clean tree with no upstream', () => {
  const status = parseStatus('# branch.head main\n');
  assert.equal(status.isClean, true);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
  assert.equal(status.upstream, undefined);
  assert.equal('upstream' in status, false);
});

test('parseNumstat parses counts and flags binary files', () => {
  const raw = ['5\t2\tsrc/app.ts', '-\t-\tassets/logo.png', '10\t0\tsrc/new.ts', ''].join('\n');
  assert.deepEqual(parseNumstat(raw), [
    { path: 'src/app.ts', additions: 5, deletions: 2, binary: false },
    { path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
    { path: 'src/new.ts', additions: 10, deletions: 0, binary: false },
  ]);
});
