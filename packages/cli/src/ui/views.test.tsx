import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Box, Text } from 'ink';
import { err, gitError, ok, type AppError, type GitDiff, type GitStatus, type Result } from '@git-wizzard/shared';
import type { GitWizzardClient } from '#mcp/client.js';
import { eventually, fakeClient, gitStatus, isolateHome, KEY, renderUi } from '#testing/ui.js';
import { App } from '#ui/App.js';
import { Header } from '#ui/components/Header.js';
import { ModelPicker } from '#ui/components/ModelPicker.js';
import { Screen } from '#ui/components/Screen.js';
import { TextInput } from '#ui/components/TextInput.js';
import { Diff } from '#ui/screens/Diff.js';
import { Hook } from '#ui/screens/Hook.js';
import { Status } from '#ui/screens/Status.js';

const HOME = '\u001B[H';
const END = '\u001B[F';
const DELETE = '\u001B[3~';

/** Run the test from `dir` (screens that call git directly use the working directory). */
function inside(t: TestContext, dir: string): void {
  const previous = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(previous));
}

test('Status shows git-style status, refreshes with r, and leaves with b or esc', async (t) => {
  const replies: Array<Result<GitStatus, AppError>> = [
    ok(gitStatus({ upstream: 'origin/main', ahead: 1, isClean: false, files: [{ path: 'a.ts', index: 'modified', workingTree: 'unmodified' }] })),
    err(gitError('command_failed', 'git status failed')),
  ];
  let backs = 0;
  const client = fakeClient({ getStatus: async () => replies.shift() ?? ok(gitStatus({})) });
  const app = renderUi(t, <Status client={client} onBack={() => (backs += 1)} />);
  await app.waitFor('Ahead of origin/main by 1 commit.');
  await app.waitFor('modified:   a.ts');
  await app.press('r');
  await app.waitFor('git status failed');
  await app.press('r');
  await app.waitFor('Nothing to commit, working tree clean.');
  await app.press('b', KEY.esc);
  await eventually(() => backs === 2, 'b and esc');
});

function diff(staged: boolean, lines: number): GitDiff {
  const body = Array.from({ length: lines }, (_: unknown, i: number) => `+line ${i + 1}`).join('\n');
  return lines === 0
    ? { staged, additions: 0, deletions: 0, files: [], patch: '' }
    : { staged, additions: lines, deletions: 0, files: [{ path: 'a.ts', additions: lines, deletions: 0, binary: false }], patch: `diff --git a/a.ts b/a.ts\n@@ -0,0 +1,${lines} @@\n${body}\n` };
}

test('Diff switches staged/unstaged with s, scrolls a long patch, and reports errors', async (t) => {
  const asked: boolean[] = [];
  let failNext = false;
  let backs = 0;
  const client = fakeClient({
    getDiff: async ({ staged = false }: { staged?: boolean } = {}) => {
      asked.push(staged);
      if (failNext) return err(gitError('command_failed', 'git diff failed'));
      return ok(staged ? diff(true, 40) : diff(false, 0));
    },
  });
  const app = renderUi(t, <Diff client={client} onBack={() => (backs += 1)} />, { rows: 15 });
  await app.waitFor('No unstaged changes. Press s for staged.');
  await app.press('s');
  await app.waitFor('Diff · staged');
  await app.waitFor('lines 1–8 of 45');

  await app.press(KEY.down);
  await app.waitFor('lines 2–9 of 45');
  await app.press(KEY.pageDown);
  await app.waitFor('lines 10–17 of 45');
  await app.press(' ');
  await app.waitFor('lines 18–25 of 45');
  await app.press(KEY.up);
  await app.waitFor('lines 17–24 of 45');
  await app.press(KEY.pageUp);
  await app.waitFor('lines 9–16 of 45');
  await app.press('G');
  await app.waitFor('lines 38–45 of 45');
  await app.waitFor('+line 40');
  await app.press(KEY.down);
  await app.press('g');
  await app.waitFor('lines 1–8 of 45');

  failNext = true;
  await app.press('r');
  await app.waitFor('git diff failed');
  await app.press('b');
  await eventually(() => backs === 1, 'b');
  assert.deepEqual(asked, [false, true, true]);
});

test('Screen content taller than the terminal scrolls with PgUp/PgDn', async (t) => {
  const lines = Array.from({ length: 30 }, (_: unknown, i: number) => <Text key={i}>row {i + 1}</Text>);
  const app = renderUi(
    t,
    <Box height={14} flexDirection="column">
      <Screen title="Long" hints={['esc back']}>
        {lines}
      </Screen>
    </Box>,
  );
  await app.waitFor('of 30 · PgUp/PgDn scroll');
  assert.match(app.frame(), /rows 1–(\d+) of 30/);
  await app.press(KEY.pageDown);
  await app.waitFor('row 12');
  assert.doesNotMatch(app.frame(), /rows 1–/);
  await app.press(KEY.pageUp);
  await app.waitFor('rows 1–');
});

test('Hook installs, updates, and uninstalls in the current repository, and leaves a foreign hook alone', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'git-wizzard-ui-hook-'));
  execFileSync('git', ['init', '-q', repo]);
  inside(t, repo);
  let backs = 0;
  const app = renderUi(t, <Hook onBack={() => (backs += 1)} />);
  await app.waitFor('prepare-commit-msg: not installed');

  await app.press('1');
  await app.waitFor('Installed. Plain "git commit" now opens with an AI draft.');
  await app.waitFor('prepare-commit-msg: installed');
  await app.press('1');
  await app.waitFor('✓ Updated.');
  await app.press('2');
  await app.waitFor('✓ Removed.');
  await app.waitFor('prepare-commit-msg: not installed');

  writeFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), '#!/bin/sh\n');
  const foreign = renderUi(t, <Hook onBack={() => (backs += 1)} />);
  await foreign.waitFor('a hook git-wizzard did not write is in place (left alone)');
  await foreign.press('1');
  await eventually(() => backs === 1, 'Back is the only option');
});

test('Hook outside a repository explains itself and offers Back', async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'git-wizzard-ui-norepo-'));
  inside(t, outside);
  const ceiling = process.env['GIT_CEILING_DIRECTORIES'];
  process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
  t.after(() => {
    if (ceiling === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
    else process.env['GIT_CEILING_DIRECTORIES'] = ceiling;
  });
  let backs = 0;
  const app = renderUi(t, <Hook onBack={() => (backs += 1)} />);
  await app.waitFor('Not a git repository');
  await app.press(KEY.enter);
  await eventually(() => backs === 1, 'Back');
});

test('Header shows the model, the path from home, and the repository in full or compact form', async (t) => {
  const home = isolateHome(t);
  const repo = join(home, 'code');
  execFileSync('git', ['init', '-q', repo]);
  inside(t, repo);

  const full = renderUi(t, <Header status={gitStatus({ ahead: 2, behind: 1, isClean: false, files: [{ path: 'a', index: 'modified', workingTree: 'unmodified' }] })} model="openai gpt-x" />);
  await full.waitFor('✻ git-wizzard v0.0.0 · openai gpt-x');
  await full.waitFor('~/code · main · ↑2 · ↓1 · 1 change');
  assert.match(full.frame(), /\( oo \)/);

  const compact = renderUi(t, <Header status={gitStatus({ branch: '(detached)' })} model={undefined} compact />);
  await compact.waitFor('✻ git-wizzard v0.0.0 · ~/code · detached HEAD · clean');

  process.env['HOME'] = '/nowhere';
  const elsewhere = renderUi(t, <Header status={undefined} model={undefined} compact />);
  await elsewhere.waitFor(`v0.0.0 · ${repo}`);
});

test('App: the menu opens every screen, esc comes back to the same menu row, q quits', async (t) => {
  isolateHome(t);
  const never = (): Promise<never> => new Promise(() => undefined);
  const client: GitWizzardClient = fakeClient({
    getStatus: async () => ok(gitStatus({ upstream: 'origin/main' })),
    getDiff: async () => ok(diff(false, 0)),
    generateCommitMessage: never,
    suggestBranchName: never,
    generatePrDescription: never,
  });
  const app = renderUi(t, <App client={client} />);
  await app.waitFor('no provider, see Auth');
  await app.waitFor('❯ 1. Commit');

  const screens: ReadonlyArray<[string, string]> = [
    ['1', 'Generating commit message'],
    ['2', 'Nothing to push: main is up to date with origin/main.'],
    ['3', 'Suggesting branch names'],
    ['4', 'Writing pull request description'],
    ['5', 'Up to date with origin/main.'],
    ['6', 'No unstaged changes.'],
    ['7', 'prepare-commit-msg:'],
    ['8', 'Not set up. Commit, branch, and pull request need a provider.'],
  ];
  for (const [key, shows] of screens) {
    await app.press(key);
    await app.waitFor(shows);
    await app.press(KEY.esc);
    await app.waitFor(`❯ ${key}.`);
  }
  await app.press('q');
  await app.exited();
});

test('App: esc on the menu quits too', async (t) => {
  isolateHome(t);
  const app = renderUi(t, <App client={fakeClient({ getStatus: async () => err(gitError('not_a_repository', 'no repo')) })} />);
  await app.waitFor('❯ 1. Commit');
  await app.press(KEY.esc);
  await app.exited();
});

test('TextInput edits at the cursor, masks secrets, and ignores keys that are not edits', async (t) => {
  const submitted: string[] = [];
  const app = renderUi(t, <TextInput label="Name" initial="abc" onSubmit={(value: string) => submitted.push(value)} onCancel={() => undefined} />);
  await app.waitFor('> abc');
  await app.press(KEY.left, KEY.left, KEY.backspace, HOME);
  await app.type('X');
  await app.press(END, KEY.left, DELETE, KEY.up);
  await app.waitFor('> Xb');
  await app.press(KEY.enter);
  await eventually(() => submitted.length === 1, 'submit');
  assert.deepEqual(submitted, ['Xb']);

  const secret = renderUi(t, <TextInput label="Key" mask placeholder="sk-…" onSubmit={() => undefined} onCancel={() => undefined} />);
  // Empty: the cursor cell, then the placeholder.
  await secret.waitFor('>  sk-…');
  await secret.type('abc');
  await secret.waitFor('> •••');
  assert.doesNotMatch(secret.frame(), /abc/);
});

test('ModelPicker filters as you type, offers what you typed, and scrolls a long list', async (t) => {
  const models = Array.from({ length: 30 }, (_: unknown, i: number) => `model-${String(i).padStart(2, '0')}`);
  const picked: string[] = [];
  let cancelled = 0;
  const app = renderUi(t, <ModelPicker label="Model" models={models} initial="model-10" onSubmit={(model: string) => picked.push(model)} onCancel={() => (cancelled += 1)} />, { rows: 20 });
  await app.waitFor('❯ model-10 · current');
  await app.waitFor('4–11 of 30');
  await app.press(KEY.down, KEY.down);
  await app.waitFor('❯ model-12');
  await app.press(KEY.up);
  await app.waitFor('❯ model-11');
  await app.press(KEY.enter);
  await eventually(() => picked.length === 1, 'pick');

  await app.type('2');
  await app.waitFor('> 2');
  await app.waitFor('❯ 2 · not in the list, use as typed');
  await app.press(KEY.down);
  await app.waitFor('❯ model-02');
  await app.press(KEY.backspace);
  await app.type('model-29');
  await app.waitFor('❯ model-29');
  assert.doesNotMatch(app.frame(), /not in the list/);
  await app.press(KEY.enter, KEY.esc);
  await eventually(() => cancelled === 1, 'esc');
  assert.deepEqual(picked, ['model-11', 'model-29']);

  const noList = renderUi(t, <ModelPicker label="Model" models={[]} initial="llama3" onSubmit={(model: string) => picked.push(model)} onCancel={() => undefined} />);
  await noList.waitFor('> llama3');
  await noList.waitFor('enter submit · esc back');
  await noList.press('\u0015', KEY.enter, KEY.up);
  await noList.type('qwen');
  await noList.press(KEY.enter);
  await eventually(() => picked.length === 3, 'typed model');
  assert.equal(picked.at(-1), 'qwen');
});
