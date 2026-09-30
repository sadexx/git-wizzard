import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editLine, hintLabel, rankModels, validateBase, validateBranchName, validateHint, type Line } from '#ui/inputs.js';

test('editLine moves the cursor and edits at it, not only at the end', () => {
  const type = (line: Line, input: string): Line | undefined => editLine(line, input, {});
  let line: Line = { value: 'fix bug', cursor: 7 };
  line = editLine(line, '', { leftArrow: true }) ?? line;
  line = editLine(line, '', { leftArrow: true }) ?? line;
  assert.deepEqual(line, { value: 'fix bug', cursor: 5 });
  assert.deepEqual(type(line, 'X'), { value: 'fix bXug', cursor: 6 });
  assert.deepEqual(editLine(line, '', { backspace: true }), { value: 'fix ug', cursor: 4 });
  assert.deepEqual(editLine(line, '', { delete: true }), { value: 'fix bg', cursor: 5 });
  assert.deepEqual(editLine(line, 'a', { ctrl: true }), { value: 'fix bug', cursor: 0 });
  assert.deepEqual(editLine(line, '', { end: true }), { value: 'fix bug', cursor: 7 });
  assert.deepEqual(editLine({ value: 'ab', cursor: 0 }, '', { backspace: true }), { value: 'ab', cursor: 0 });
  assert.deepEqual(editLine({ value: 'ab', cursor: 2 }, '', { rightArrow: true }), { value: 'ab', cursor: 2 });
  assert.deepEqual(editLine({ value: 'ab', cursor: 1 }, 'u', { ctrl: true }), { value: '', cursor: 0 });
  assert.deepEqual(type({ value: 'ab', cursor: 1 }, 'x\ny\x07'), { value: 'ax yb', cursor: 4 });
  assert.deepEqual(editLine({ value: 'é😀', cursor: 2 }, '', { backspace: true }), { value: 'é', cursor: 1 });
  assert.equal(editLine({ value: 'ab', cursor: 1 }, 'c', { ctrl: true }), undefined);
});

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
