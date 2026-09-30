import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintLabel, rankModels, validateBase, validateBranchName, validateHint } from '#ui/inputs.js';

test('rankModels filters case-insensitively and puts prefix matches first', () => {
  const models = ['claude-haiku-4-5', 'gpt-5.4-mini', 'kr/claude-sonnet-4.5', 'qwen3:8b'];
  assert.deepEqual(rankModels(models, ''), models);
  assert.deepEqual(rankModels(models, 'CLAUDE'), ['claude-haiku-4-5', 'kr/claude-sonnet-4.5']);
  assert.deepEqual(rankModels(models, 'kr/'), ['kr/claude-sonnet-4.5']);
  assert.deepEqual(rankModels(models, 'nope'), []);
});

test('validateHint allows empty (clears the hint) and up to 500 characters, like --hint', () => {
  assert.equal(validateHint(''), undefined);
  assert.equal(validateHint('x'.repeat(500)), undefined);
  assert.match(validateHint('x'.repeat(501)) ?? '', /500/);
});

test('validateBase and validateBranchName reject what git would misread or refuse outright', () => {
  assert.equal(validateBase('origin/main'), undefined);
  assert.match(validateBase('-x') ?? '', /"-"/);
  assert.match(validateBase('') ?? '', /Enter/);
  assert.equal(validateBranchName('feature/x'), undefined);
  assert.match(validateBranchName('two words') ?? '', /spaces/);
});

test('hintLabel offers to add or change', () => {
  assert.equal(hintLabel(undefined), 'Add a hint…');
  assert.equal(hintLabel('why'), 'Change hint…');
});
