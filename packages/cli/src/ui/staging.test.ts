import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitFileChange } from '@git-wizzard/shared';
import { changeLabel, stagedState, stagingPlan } from '#ui/staging.js';

const staged: GitFileChange = { path: 'staged.ts', index: 'modified', workingTree: 'unmodified' };
const partly: GitFileChange = { path: 'partly.ts', index: 'modified', workingTree: 'modified' };
const fresh: GitFileChange = { path: 'fresh.ts', index: 'unmodified', workingTree: 'untracked' };
const moved: GitFileChange = { path: 'new.ts', index: 'renamed', workingTree: 'unmodified', originalPath: 'old.ts' };

test('stagedState tells fully, partly, and not staged apart', () => {
  assert.equal(stagedState(staged), 'all');
  assert.equal(stagedState(partly), 'part');
  assert.equal(stagedState(fresh), 'none');
});

test('changeLabel names new files and renames', () => {
  assert.equal(changeLabel(fresh), 'new file');
  assert.equal(changeLabel(moved), 'renamed from old.ts');
  assert.equal(changeLabel(partly), 'modified');
});

test('stagingPlan only touches files that change, and unstages both sides of a rename', () => {
  const files = [staged, partly, fresh, moved];
  assert.deepEqual(stagingPlan(files, new Map()), { stage: [], unstage: [] });
  assert.deepEqual(
    stagingPlan(
      files,
      new Map([
        ['staged.ts', true],
        ['partly.ts', true],
        ['fresh.ts', true],
        ['new.ts', false],
      ]),
    ),
    { stage: ['partly.ts', 'fresh.ts'], unstage: ['new.ts', 'old.ts'] },
  );
  assert.deepEqual(stagingPlan([partly, fresh], new Map([['partly.ts', false], ['fresh.ts', false]])), {
    stage: [],
    unstage: ['partly.ts'],
  });
});
