import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDecision, type ActionPrompter } from '#commands/prompt.js';

function fake(choices: Array<'confirm' | 'edit' | 'abort'>, edits: string[]): ActionPrompter {
  let ci: number = 0;
  let ei: number = 0;

  return {
    show() {},
    async choose() {
      const choice = choices[ci];
      ci += 1;
      if (choice === undefined) throw new Error('unexpected extra choose()');
      return choice;
    },
    async edit() {
      const edit = edits[ei];
      ei += 1;
      if (edit === undefined) throw new Error('unexpected extra edit()');
      return edit;
    },
  };
}

test('resolveDecision confirms immediately', async () => {
  assert.deepEqual(await resolveDecision(fake(['confirm'], []), 'L', 'v'), { kind: 'confirm', value: 'v' });
});

test('resolveDecision aborts', async () => {
  assert.deepEqual(await resolveDecision(fake(['abort'], []), 'L', 'v'), { kind: 'abort' });
});

test('resolveDecision edits then confirms the edited value', async () => {
  assert.deepEqual(await resolveDecision(fake(['edit', 'confirm'], ['edited']), 'L', 'v'), {
    kind: 'confirm',
    value: 'edited',
  });
});
