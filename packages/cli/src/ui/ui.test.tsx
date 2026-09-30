import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { ReactElement } from 'react';
import { Text } from 'ink';
import { err, gitError, ok, type AppError, type CommitResult, type GenerateCommitMessageOutput, type Result } from '@git-wizzard/shared';
import type { CommitMessageOptions } from '#mcp/client.js';
import { fakeClient, gitStatus, KEY, renderUi } from '#testing/ui.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { SelectList } from '#ui/components/SelectList.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';
import { Push } from '#ui/screens/Push.js';

function message(subject: string): Result<GenerateCommitMessageOutput, AppError> {
  return ok({ subject, message: subject });
}

test('SelectList picks by number, by arrows (wrapping) and enter, and cancels on esc', async (t) => {
  const picked: number[] = [];
  let cancelled = 0;
  const app = renderUi(
    t,
    <SelectList items={[{ label: 'One' }, { label: 'Two', description: 'second' }, { label: 'Three' }]} onSelect={(i: number) => picked.push(i)} onCancel={() => (cancelled += 1)} />,
  );
  await app.waitFor('❯ 1. One');

  await app.press('3', KEY.down);
  await app.waitFor('❯ 2. Two');
  await app.press('k', KEY.up);
  await app.waitFor('❯ 3. Three');
  await app.press('j', KEY.enter, KEY.esc, '9');
  await delay(50);
  assert.deepEqual(picked, [2, 0]);
  assert.equal(cancelled, 1);
});

test('useMcpTool keeps the newest result when an older call finishes last, and reports thrown errors', async (t) => {
  const pending: Array<{ resolve: (value: Result<string, AppError>) => void; reject: (error: unknown) => void }> = [];
  const run = (): Promise<Result<string, AppError>> =>
    new Promise((resolve: (value: Result<string, AppError>) => void, reject: (error: unknown) => void) => pending.push({ resolve, reject }));
  let reload: () => void = () => undefined;
  function Probe(): ReactElement {
    const tool = useMcpTool(run);
    reload = tool.reload;
    const { state } = tool;
    return <Text>{state.status === 'success' ? `data:${state.data}` : state.status === 'error' ? `error:${state.message}` : state.status}</Text>;
  }
  const app = renderUi(t, <Probe />);
  await app.waitFor('loading');

  reload();
  pending[1]?.resolve(ok('new'));
  await app.waitFor('data:new');
  pending[0]?.resolve(ok('old'));
  await delay(50);
  assert.equal(app.frame(), 'data:new');

  reload();
  pending[2]?.reject(new Error('boom'));
  await app.waitFor('error:boom');
  reload();
  pending[3]?.reject('plain');
  await app.waitFor('error:plain');
  reload();
  pending[4]?.resolve(err(gitError('command_failed', 'git broke')));
  await app.waitFor('error:error: git broke');
});

test('Commit shows the generated message and commits exactly it', async (t) => {
  const commits: string[] = [];
  const client = fakeClient({
    generateCommitMessage: async () => message('feat: add retries'),
    createCommit: async ({ message: text }: { message: string }): Promise<Result<CommitResult, AppError>> => {
      commits.push(text);
      return ok({ sha: 'abcdef1234567890', branch: 'main', summary: text });
    },
  });
  const app = renderUi(t, <CommitGenerate client={client} onBack={() => undefined} />);
  await app.waitFor('feat: add retries');

  await app.press('1');
  await app.waitFor('Created commit abcdef12 on main: feat: add retries');
  assert.deepEqual(commits, ['feat: add retries']);
});

test('Commit regenerates for all tracked changes when the scope is switched', async (t) => {
  const calls: CommitMessageOptions[] = [];
  const client = fakeClient({
    generateCommitMessage: async (options: CommitMessageOptions = {}) => {
      calls.push(options);
      return message(options.all === true ? 'all changes' : 'staged only');
    },
  });
  const app = renderUi(t, <CommitGenerate client={client} onBack={() => undefined} />);
  await app.waitFor('staged only');

  await app.press('6');
  await app.waitFor('all changes');
  assert.deepEqual(
    calls.map((options: CommitMessageOptions) => options.all),
    [false, true],
  );
});

test('Commit shows a generation error and retries on request', async (t) => {
  const replies = [err(gitError('nothing_to_commit', 'No staged changes to summarize')), message('fix: typo')];
  const client = fakeClient({ generateCommitMessage: async () => replies.shift() ?? assert.fail('too many calls') });
  const app = renderUi(t, <CommitGenerate client={client} onBack={() => undefined} />);
  await app.waitFor('No staged changes to summarize');

  await app.press('1');
  await app.waitFor('fix: typo');
});

test('Push asks first, then pushes and reports the commits sent', async (t) => {
  let pushes = 0;
  const client = fakeClient({
    getStatus: async () => ok(gitStatus({ upstream: 'origin/main', ahead: 2 })),
    push: async () => {
      pushes += 1;
      return ok({ branch: 'main', upstream: 'origin/main', commits: 2 });
    },
  });
  const app = renderUi(t, <Push client={client} onBack={() => undefined} />);
  await app.waitFor('Push 2 commits on main to origin/main?');
  assert.equal(pushes, 0);

  await app.press(KEY.enter);
  await app.waitFor('Pushed 2 commits to origin/main.');
  assert.equal(pushes, 1);
});

test('Push has nothing to do when the branch is up to date', async (t) => {
  const client = fakeClient({ getStatus: async () => ok(gitStatus({ upstream: 'origin/main' })) });
  const app = renderUi(t, <Push client={client} onBack={() => undefined} />);
  await app.waitFor('Nothing to push: main is up to date with origin/main.');
});
