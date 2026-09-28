import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmMode,
  resolveDecision,
  stripComments,
  type ActionPrompter,
  type Choice,
} from '#commands/prompt.js';

function fake(choices: Choice[], edits: string[], offered: boolean[] = []): ActionPrompter {
  let choiceIndex: number = 0;
  let editIndex: number = 0;

  return {
    show() {},
    async choose(canRegenerate: boolean) {
      offered.push(canRegenerate);
      const choice = choices[choiceIndex];
      choiceIndex += 1;
      if (choice === undefined) throw new Error('unexpected extra choose()');
      return choice;
    },
    async edit() {
      const edit = edits[editIndex];
      editIndex += 1;
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

test('confirmMode: --dry-run and --yes work without a terminal', () => {
  assert.equal(confirmMode({ dryRun: true }, false), 'dry-run');
  assert.equal(confirmMode({ yes: true }, false), 'yes');
});

test('confirmMode prompts only when interactive', () => {
  assert.equal(confirmMode({}, true), 'prompt');
  assert.equal(confirmMode({}, false), undefined);
});

test('stripComments drops # lines and surrounding blank lines, keeps inner blank lines', () => {
  assert.equal(stripComments('\nfeat: x\n\nbody\n\n# ignored\n# also ignored\n'), 'feat: x\n\nbody');
  assert.equal(stripComments('# only comments\n'), '');
  assert.equal(stripComments('keep #inline hash'), 'keep #inline hash');
});

test('resolveDecision edits then confirms the edited value', async () => {
  assert.deepEqual(await resolveDecision(fake(['edit', 'confirm'], ['edited']), 'L', 'v'), {
    kind: 'confirm',
    value: 'edited',
  });
});

test('resolveDecision offers regenerate only when a regenerator is given', async () => {
  const withoutIt: boolean[] = [];
  await resolveDecision(fake(['confirm'], [], withoutIt), 'L', 'v');
  const withIt: boolean[] = [];
  await resolveDecision(fake(['confirm'], [], withIt), 'L', 'v', async () => 'new');
  assert.deepEqual([withoutIt, withIt], [[false], [true]]);
});

test('resolveDecision replaces the value on regenerate, and keeps it when regenerate yields nothing', async () => {
  const fresh = ['second', undefined, 'third'];
  const regenerate = async (): Promise<string | undefined> => fresh.shift();
  assert.deepEqual(
    await resolveDecision(fake(['regenerate', 'regenerate', 'confirm'], []), 'L', 'first', regenerate),
    { kind: 'confirm', value: 'second' },
  );
  assert.deepEqual(await resolveDecision(fake(['regenerate', 'confirm'], []), 'L', 'x', regenerate), {
    kind: 'confirm',
    value: 'third',
  });
});
