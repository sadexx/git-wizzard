import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchType } from '#commands/branch.js';

test('parseBranchType returns the enum value', () => {
  assert.equal(parseBranchType('feature'), 'feature');
});

test('parseBranchType returns undefined when unset', () => {
  assert.equal(parseBranchType(undefined), undefined);
});

test('parseBranchType returns undefined for an invalid value', () => {
  assert.equal(parseBranchType('bogus'), undefined);
});
