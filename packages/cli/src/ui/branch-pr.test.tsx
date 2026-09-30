import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  err,
  gitError,
  ok,
  type AppError,
  type CreateBranchOutput,
  type CreatePullRequestOutput,
  type GeneratePrDescriptionOutput,
  type Result,
} from '@git-wizzard/shared';
import type { GitWizzardClient, PrDescriptionOptions, SuggestBranchOptions } from '#mcp/client.js';
import { eventually, fakeClient, KEY, renderUi } from '#testing/ui.js';
import { BranchSuggest } from '#ui/screens/BranchSuggest.js';
import { PrDescribe } from '#ui/screens/PrDescribe.js';

const CLEAR = '\u0015'; // ctrl+u

function branchScreen(
  suggest: (options: SuggestBranchOptions, call: number) => Result<string[], AppError>,
  createBranch?: GitWizzardClient['createBranch'],
) {
  const calls: SuggestBranchOptions[] = [];
  const created: string[] = [];
  let backs = 0;
  const client = fakeClient({
    suggestBranchName: async (options: SuggestBranchOptions = {}) => {
      calls.push(options);
      return suggest(options, calls.length);
    },
    createBranch:
      createBranch ??
      (async ({ name }: { name: string }): Promise<Result<CreateBranchOutput, AppError>> => {
        created.push(name);
        return ok({ branch: name, created: true });
      }),
  });
  return { calls, created, backs: () => backs, tree: <BranchSuggest client={client} onBack={() => (backs += 1)} /> };
}

const twoNames = (): Result<string[], AppError> => ok(['feature/a', 'fix/b']);

test('Branch: picking a suggestion creates it; enter goes back', async (t) => {
  const screen = branchScreen(twoNames);
  const app = renderUi(t, screen.tree);
  await app.waitFor('Branch · pick a name to create it');
  await app.press('2');
  await app.waitFor('Created and switched to fix/b');
  assert.deepEqual(screen.created, ['fix/b']);
  await app.press(KEY.enter);
  await eventually(() => screen.backs() === 1, 'back');
});

test('Branch: your own name is checked before git sees it', async (t) => {
  const screen = branchScreen(twoNames, async () => err(gitError('command_failed', 'Failed to create branch mine')));
  const app = renderUi(t, screen.tree);
  await app.waitFor('feature/a');
  await app.press('3');
  await app.waitFor('> feature/a');
  await app.press(CLEAR, KEY.enter);
  await app.waitFor('✗ Enter a branch name.');
  await app.type('bad name');
  await app.press(KEY.enter);
  await app.waitFor('✗ Branch names cannot contain spaces.');
  await app.press(CLEAR);
  await app.type('mine');
  await app.press(KEY.enter);
  await app.waitFor('Failed to create branch mine');
  await app.press(KEY.esc);
  await eventually(() => screen.backs() === 1, 'back');
});

test('Branch: a type or hint regenerates with it; choosing the same one again just regenerates', async (t) => {
  const screen = branchScreen((options: SuggestBranchOptions, call: number) => ok([`${options.type ?? 'any'}/n${call}`]));
  const app = renderUi(t, screen.tree);
  await app.waitFor('any/n1');

  await app.press('4');
  await app.waitFor('Branch · type');
  await app.waitFor('❯ 1. any');
  await app.press('3');
  await app.waitFor('fix/n2');
  await app.waitFor('type: fix');
  await app.press('4');
  await app.waitFor('❯ 3. fix');
  await app.press(KEY.enter);
  await app.waitFor('fix/n3');
  await app.press('4');
  await app.waitFor('Branch · type');
  await app.press(KEY.esc);
  await app.waitFor('fix/n3');

  await app.press('5');
  await app.waitFor('What is this branch for?');
  await app.type('checkout');
  await app.press(KEY.enter);
  await app.waitFor('hint: checkout');
  await app.waitFor('fix/n4');
  await app.press('5');
  await app.waitFor('What is this branch for?');
  await app.press(KEY.enter);
  await app.waitFor('fix/n5');
  await app.press('5');
  await app.waitFor('What is this branch for?');
  await app.press(KEY.esc);
  await app.waitFor('fix/n5');
  await app.press('3');
  await app.waitFor('fix/n6');
  assert.deepEqual(screen.calls.at(-1), { type: 'fix', hint: 'checkout' });

  await app.press('6');
  await eventually(() => screen.backs() === 1, 'Back');
});

test('Branch: a failed suggestion offers Retry and your own name; esc while loading goes back', async (t) => {
  const screen = branchScreen((_options: SuggestBranchOptions, call: number) =>
    call === 1 ? err(gitError('no_changes', 'No changes to suggest a branch name from')) : ok(['later']),
  );
  const app = renderUi(t, screen.tree);
  await app.waitFor('No changes to suggest a branch name from');
  await app.waitFor('2. Retry');
  await app.press('2');
  await app.waitFor('later');

  const thrown = branchScreen(twoNames, async () => Promise.reject(new Error('server died')));
  const second = renderUi(t, thrown.tree);
  await second.waitFor('feature/a');
  await second.press('1');
  await second.waitFor('server died');

  let backs = 0;
  const pending = fakeClient({ suggestBranchName: () => new Promise(() => undefined) });
  const third = renderUi(t, <BranchSuggest client={pending} onBack={() => (backs += 1)} />);
  await third.waitFor('Suggesting branch names');
  await third.press(KEY.esc);
  await eventually(() => backs === 1, 'esc while loading');
});

const DESCRIPTION: GeneratePrDescriptionOutput = { title: 'Add retries', body: 'Why it matters.', base: 'origin/main', commits: 2 };

function prScreen(
  describe: (options: PrDescriptionOptions, call: number) => Result<GeneratePrDescriptionOutput, AppError>,
  createPullRequest?: GitWizzardClient['createPullRequest'],
) {
  const calls: PrDescriptionOptions[] = [];
  const opened: Array<{ title: string; body: string; base: string }> = [];
  let backs = 0;
  const client = fakeClient({
    generatePrDescription: async (options: PrDescriptionOptions = {}) => {
      calls.push(options);
      return describe(options, calls.length);
    },
    createPullRequest:
      createPullRequest ??
      (async (request: { title: string; body: string; base: string }): Promise<Result<CreatePullRequestOutput, AppError>> => {
        opened.push(request);
        return ok({ url: 'https://github.com/o/r/pull/3', pushed: true });
      }),
  });
  return { calls, opened, backs: () => backs, tree: <PrDescribe client={client} onBack={() => (backs += 1)} /> };
}

test('PR: shows the description, then opens it with gh after a confirmation', async (t) => {
  const screen = prScreen(() => ok(DESCRIPTION));
  const app = renderUi(t, screen.tree);
  await app.waitFor('Pull request · 2 commits not on origin/main');
  await app.waitFor('Why it matters.');
  await app.waitFor('base: origin/main');

  await app.press('1');
  await app.waitFor('Open “Add retries” into origin/main on GitHub with gh?');
  await app.press('2');
  await app.waitFor('Why it matters.');
  await app.press('1');
  await app.waitFor('Open “Add retries”');
  await app.press(KEY.enter);
  await app.waitFor('Pushed the branch and opened https://github.com/o/r/pull/3');
  assert.deepEqual(screen.opened, [{ title: 'Add retries', body: 'Why it matters.', base: 'origin/main' }]);
  await app.press(KEY.enter);
  await app.waitFor('Why it matters.');
});

test('PR: open failures are shown, then lead back to the description', async (t) => {
  const failing = prScreen(() => ok(DESCRIPTION), async () => err(gitError('gh_not_authenticated', 'The GitHub CLI (gh) is not logged in')));
  const app = renderUi(t, failing.tree);
  await app.waitFor('Why it matters.');
  await app.press('1');
  await app.waitFor('Open “Add retries”');
  await app.press(KEY.enter);
  await app.waitFor('hint: Run "gh auth login", then try again.');
  await app.press(KEY.esc);
  await app.waitFor('Why it matters.');

  const thrown = prScreen(() => ok(DESCRIPTION), async () => Promise.reject(new Error('gh crashed')));
  const second = renderUi(t, thrown.tree);
  await second.waitFor('Why it matters.');
  await second.press('1');
  await second.waitFor('Open “Add retries”');
  await second.press(KEY.enter);
  await second.waitFor('gh crashed');

  const alreadyPushed = prScreen(() => ok(DESCRIPTION), async () => ok({ url: 'https://github.com/o/r/pull/4', pushed: false }));
  const third = renderUi(t, alreadyPushed.tree);
  await third.waitFor('Why it matters.');
  await third.press('1');
  await third.waitFor('Open “Add retries”');
  await third.press(KEY.enter);
  await third.waitFor('✓ Opened https://github.com/o/r/pull/4');
});

test('PR: base and hint are checked, regenerate with them, and the same value again just regenerates', async (t) => {
  const screen = prScreen((options: PrDescriptionOptions, call: number) => ok({ ...DESCRIPTION, title: `v${call}`, base: options.base ?? 'origin/main' }));
  const app = renderUi(t, screen.tree);
  await app.waitFor('v1');

  await app.press('3');
  await app.waitFor('> origin/main');
  await app.press(CLEAR, KEY.enter);
  await app.waitFor('✗ Enter a branch or commit.');
  await app.type('-x');
  await app.press(KEY.enter);
  await app.waitFor('✗ Must not start with "-".');
  await app.press(CLEAR);
  await app.type('dev');
  await app.press(KEY.enter);
  await app.waitFor('v2');
  await app.waitFor('base: dev');
  await app.press('3');
  await app.waitFor('> dev');
  await app.press(KEY.enter);
  await app.waitFor('v3');
  await app.press('3');
  await app.waitFor('Base branch the PR targets');
  await app.press(KEY.esc);
  await app.waitFor('v3');

  await app.press('4');
  await app.waitFor('What should reviewers know');
  await app.type('release');
  await app.press(KEY.enter);
  await app.waitFor('v4');
  await app.press('4');
  await app.waitFor('What should reviewers know');
  await app.press(KEY.enter);
  await app.waitFor('v5');
  await app.press('4');
  await app.waitFor('What should reviewers know');
  await app.press(KEY.esc);
  await app.waitFor('v5');
  await app.press('2');
  await app.waitFor('v6');
  assert.deepEqual(screen.calls.at(-1), { base: 'dev', hint: 'release' });
  await app.press('5');
  await eventually(() => screen.backs() === 1, 'Back');
});

test('PR: a failed description offers Retry; esc while loading goes back', async (t) => {
  const screen = prScreen((_options: PrDescriptionOptions, call: number) =>
    call === 1 ? err(gitError('no_commits', "No commits on main that aren't on origin/main")) : ok(DESCRIPTION),
  );
  const app = renderUi(t, screen.tree);
  await app.waitFor("No commits on main that aren't on origin/main");
  await app.waitFor('base: auto');
  await app.press('1');
  await app.waitFor('Why it matters.');

  let backs = 0;
  const pending = fakeClient({ generatePrDescription: () => new Promise(() => undefined) });
  const second = renderUi(t, <PrDescribe client={pending} onBack={() => (backs += 1)} />);
  await second.waitFor('Writing pull request description');
  await second.press(KEY.esc);
  await eventually(() => backs === 1, 'esc while loading');
});
