import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  err,
  gitError,
  ok,
  type AppError,
  type CommitResult,
  type GenerateCommitMessageOutput,
  type GitFileChange,
  type GitStatus,
  type Result,
} from '@git-wizzard/shared';
import type { CommitMessageOptions, GitWizzardClient } from '#mcp/client.js';
import { eventually, fakeClient, gitStatus, KEY, renderUi } from '#testing/ui.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';
import { StageFiles } from '#ui/screens/StageFiles.js';
import { Push } from '#ui/screens/Push.js';

function message(subject: string, body?: string): Result<GenerateCommitMessageOutput, AppError> {
  return ok(body === undefined ? { subject, message: subject } : { subject, body, message: `${subject}\n\n${body}` });
}

/** A commit screen whose generations are recorded and answered by `reply`. */
function commitScreen(reply: (options: CommitMessageOptions, call: number) => Result<GenerateCommitMessageOutput, AppError>, extra: Partial<GitWizzardClient> = {}) {
  const calls: CommitMessageOptions[] = [];
  let backs = 0;
  const client = fakeClient({
    generateCommitMessage: async (options: CommitMessageOptions = {}) => {
      calls.push(options);
      return reply(options, calls.length);
    },
    ...extra,
  });
  return { calls, backs: () => backs, tree: <CommitGenerate client={client} onBack={() => (backs += 1)} /> };
}

test('Commit: a hint regenerates with it; the same hint again just regenerates; empty clears it', async (t) => {
  const screen = commitScreen((options: CommitMessageOptions, call: number) => message(`v${call}${options.hint !== undefined ? ` (${options.hint})` : ''}`));
  const app = renderUi(t, screen.tree);
  await app.waitFor('v1');

  await app.press('5');
  await app.waitFor('Why did you make this change?');
  await app.type('retry on 429');
  await app.press(KEY.enter);
  await app.waitFor('v2 (retry on 429)');
  await app.waitFor('hint: retry on 429');

  await app.press('5');
  await app.waitFor('retry on 429');
  await app.press(KEY.enter);
  await app.waitFor('v3 (retry on 429)');

  await app.press('5');
  await app.waitFor('Why did you make this change?');
  await app.press('\u0015', KEY.enter);
  await app.waitFor('v4');
  assert.equal(screen.calls.at(-1)?.hint, undefined);

  await app.press('5');
  await app.waitFor('Why did you make this change?');
  await app.press(KEY.esc);
  await app.waitFor('Add a hint…');
});

test('Commit: edit in the git editor replaces the message; a failing editor says so; regenerate drops the edit', async (t) => {
  const editor = process.env['GIT_EDITOR'];
  t.after(() => {
    if (editor === undefined) delete process.env['GIT_EDITOR'];
    else process.env['GIT_EDITOR'] = editor;
  });
  const screen = commitScreen((_options: CommitMessageOptions, call: number) => message(`generated ${call}`, 'a body'));
  const app = renderUi(t, screen.tree);
  await app.waitFor('generated 1');

  process.env['GIT_EDITOR'] = `printf 'hand written\\n' >`;
  await app.press('2');
  await app.waitFor('edited by you');
  await app.waitFor('hand written');

  process.env['GIT_EDITOR'] = 'false';
  await app.press('2');
  await app.waitFor('Could not open an editor; set GIT_EDITOR or core.editor.');

  await app.press('3');
  await app.waitFor('generated 2');
  assert.doesNotMatch(app.frame(), /edited by you|Could not open an editor/);
});

test('Commit: a failed commit shows the error; enter goes back', async (t) => {
  const screen = commitScreen(() => message('feat: x'), {
    createCommit: async () => err(gitError('command_failed', 'git commit failed', 'pre-commit hook said no')),
  });
  const app = renderUi(t, screen.tree);
  await app.waitFor('feat: x');
  await app.press('1');
  await app.waitFor('git commit failed');
  await app.waitFor('pre-commit hook said no');
  await app.press(KEY.enter);
  await eventually(() => screen.backs() === 1, 'back');
});

test('Commit: a thrown commit error is shown too', async (t) => {
  const screen = commitScreen(() => message('feat: x'), { createCommit: async () => Promise.reject(new Error('server died')) });
  const app = renderUi(t, screen.tree);
  await app.waitFor('feat: x');
  await app.press('1');
  await app.waitFor('server died');
});

test('Commit: after committing, Push… opens the push screen and Back leaves', async (t) => {
  const done = async (): Promise<Result<CommitResult, AppError>> => ok({ sha: '1234567890ab', branch: 'main', summary: 'feat: x' });
  const pushing = commitScreen(() => message('feat: x'), { createCommit: done, getStatus: async () => ok(gitStatus({})) });
  const app = renderUi(t, pushing.tree);
  await app.waitFor('feat: x');
  await app.press('1');
  await app.waitFor('Created commit 12345678');
  await app.press('1');
  await app.waitFor('main is not on the remote yet');

  const leaving = commitScreen(() => message('feat: x'), { createCommit: done });
  const other = renderUi(t, leaving.tree);
  await other.waitFor('feat: x');
  await other.press('1');
  await other.waitFor('Created commit');
  await other.press('2');
  await eventually(() => leaving.backs() === 1, 'back');
});

test('Commit: Choose files… stages and regenerates, or cancels back to the message', async (t) => {
  const staged: Array<{ stage?: readonly string[]; unstage?: readonly string[] }> = [];
  const screen = commitScreen((_options: CommitMessageOptions, call: number) => message(`v${call}`), {
    getStatus: async () => ok(gitStatus({ isClean: false, files: [{ path: 'a.ts', index: 'unmodified', workingTree: 'modified' }] })),
    stageFiles: async (plan: { stage?: readonly string[]; unstage?: readonly string[] }) => {
      staged.push(plan);
      return ok(gitStatus({}));
    },
  });
  const app = renderUi(t, screen.tree);
  await app.waitFor('v1');

  await app.press('4');
  await app.waitFor('[ ] a.ts');
  await app.press(KEY.esc);
  await app.waitFor('v1');

  await app.press('4');
  await app.waitFor('[ ] a.ts');
  await app.press(' ');
  await app.waitFor('[x] a.ts');
  await app.press(KEY.enter);
  await app.waitFor('v2');
  assert.deepEqual(staged, [{ stage: ['a.ts'], unstage: [] }]);
});

test('Commit: every option works from the error screen, esc while loading and Cancel go back', async (t) => {
  const screen = commitScreen((options: CommitMessageOptions) =>
    options.hint === 'why' ? message('with hint') : err(gitError('nothing_to_commit', 'No staged changes to summarize')),
  { getStatus: async () => ok(gitStatus({})) },
  );
  const app = renderUi(t, screen.tree);
  await app.waitFor('No staged changes to summarize');

  await app.press('2');
  await app.waitFor('Nothing to stage: the working tree is clean.');
  await app.press(KEY.esc);
  await app.waitFor('No staged changes to summarize');
  await app.press('3');
  await app.waitFor('all tracked changes');
  await app.waitFor('Only staged changes');
  await app.press('4');
  await app.waitFor('Why did you make this change?');
  await app.type('why');
  await app.press(KEY.enter);
  await app.waitFor('with hint');
  await app.press('7');
  await eventually(() => screen.backs() === 1, 'Cancel');

  let release: () => void = () => undefined;
  const client = fakeClient({ generateCommitMessage: () => new Promise((resolve: (value: Result<GenerateCommitMessageOutput, AppError>) => void) => (release = () => resolve(message('late')))) });
  let backs = 0;
  const loading = renderUi(t, <CommitGenerate client={client} onBack={() => (backs += 1)} />);
  await loading.waitFor('Generating commit message');
  await loading.press(KEY.esc);
  await eventually(() => backs === 1, 'esc while loading');
  release();

  const errorBack = commitScreen(() => err(gitError('nothing_to_commit', 'none')));
  const third = renderUi(t, errorBack.tree);
  await third.waitFor('none');
  await third.press('5');
  await eventually(() => errorBack.backs() === 1, 'Back from the error');
});

const FILES: GitFileChange[] = [
  { path: 'staged.ts', index: 'modified', workingTree: 'unmodified' },
  { path: 'unstaged.ts', index: 'unmodified', workingTree: 'modified' },
  { path: 'partly.ts', index: 'modified', workingTree: 'modified' },
  { path: 'conflict.ts', index: 'conflicted', workingTree: 'conflicted' },
  { path: 'new.ts', index: 'renamed', workingTree: 'unmodified', originalPath: 'old.ts' },
];

function stageScreen(status: Result<GitStatus, AppError>, stageFiles?: GitWizzardClient['stageFiles']) {
  const plans: Array<{ stage?: readonly string[]; unstage?: readonly string[] }> = [];
  const events: string[] = [];
  const client = fakeClient({
    getStatus: async () => status,
    stageFiles:
      stageFiles ??
      (async (plan: { stage?: readonly string[]; unstage?: readonly string[] }) => {
        plans.push(plan);
        return ok(gitStatus({}));
      }),
  });
  return { plans, events, tree: <StageFiles client={client} onDone={() => events.push('done')} onCancel={() => events.push('cancel')} /> };
}

test('StageFiles: toggles files, all/none, and applies only what changed; conflicts stay out', async (t) => {
  const screen = stageScreen(ok(gitStatus({ isClean: false, files: FILES })));
  const app = renderUi(t, screen.tree);
  await app.waitFor('❯ [x] staged.ts');
  assert.match(app.frame(), /\[ \] unstaged\.ts/);
  assert.match(app.frame(), /\[~\] partly\.ts .*modified · partly staged/);
  assert.match(app.frame(), /\[x\] new\.ts .*renamed from old\.ts/);
  assert.doesNotMatch(app.frame(), /conflict\.ts/);

  await app.press(' ');
  await app.waitFor('❯ [ ] staged.ts');
  await app.press(KEY.up);
  await app.waitFor('❯ [x] new.ts');
  await app.press('j', 'k', KEY.down, KEY.down, ' ');
  await app.waitFor('❯ [x] unstaged.ts');
  await app.press(KEY.enter);
  await eventually(() => screen.events.includes('done'), 'done');
  assert.deepEqual(screen.plans, [{ stage: ['unstaged.ts'], unstage: ['staged.ts'] }]);
});

test('StageFiles: a toggles everything on, then off; no net change just cancels', async (t) => {
  const screen = stageScreen(ok(gitStatus({ isClean: false, files: FILES })));
  const app = renderUi(t, screen.tree);
  await app.waitFor('staged.ts');
  await app.press('a');
  await app.waitFor('[x] partly.ts');
  assert.doesNotMatch(app.frame(), /\[ \]|\[~\]/);
  await app.press('a');
  await app.waitFor('[ ] new.ts');
  assert.doesNotMatch(app.frame(), /\[x\]|\[~\]/);
  await app.press('a');
  await app.waitFor('[x] unstaged.ts');
  await app.press(' ', ' ');
  // Back where they started except "partly" (now fully staged) and "unstaged" (now staged).
  await app.press(KEY.enter);
  await eventually(() => screen.plans.length === 1, 'apply');
  assert.deepEqual(screen.plans[0], { stage: ['unstaged.ts', 'partly.ts'], unstage: [] });

  const unchanged = stageScreen(ok(gitStatus({ isClean: false, files: FILES })));
  const second = renderUi(t, unchanged.tree);
  await second.waitFor('staged.ts');
  await second.press(KEY.enter);
  await eventually(() => unchanged.events.includes('cancel'), 'cancel');
  assert.deepEqual(unchanged.plans, []);
});

test('StageFiles: a long list scrolls with the cursor in a small terminal', async (t) => {
  const many = Array.from({ length: 30 }, (_: unknown, i: number): GitFileChange => ({ path: `file-${String(i).padStart(2, '0')}.ts`, index: 'unmodified', workingTree: 'modified' }));
  const app = renderUi(t, stageScreen(ok(gitStatus({ isClean: false, files: many }))).tree, { rows: 15 });
  await app.waitFor('files 1–8 of 30');
  await app.press(KEY.up);
  await app.waitFor('files 23–30 of 30');
  await app.waitFor('❯ [ ] file-29.ts');
});

test('StageFiles: errors, a clean tree, and esc all lead back', async (t) => {
  const failing = stageScreen(ok(gitStatus({ isClean: false, files: FILES })), async () => err(gitError('command_failed', 'Failed to update the staged files')));
  const app = renderUi(t, failing.tree);
  await app.waitFor('staged.ts');
  await app.press(' ', KEY.enter);
  await app.waitFor('Failed to update the staged files');
  await app.press(' ', KEY.enter);
  await eventually(() => failing.events.includes('cancel'), 'back from the error');

  const throwing = stageScreen(ok(gitStatus({ isClean: false, files: FILES })), async () => Promise.reject(new Error('gone')));
  const second = renderUi(t, throwing.tree);
  await second.waitFor('staged.ts');
  await second.press(' ', KEY.enter);
  await second.waitFor('gone');

  const statusError = stageScreen(err(gitError('not_a_repository', 'Not a git repository')));
  const third = renderUi(t, statusError.tree);
  await third.waitFor('Not a git repository');
  await third.press(KEY.esc);
  await eventually(() => statusError.events.includes('cancel'), 'esc');
});

test('Push: a new branch sets its upstream; being behind warns; Back and esc leave', async (t) => {
  let backs = 0;
  const client = fakeClient({
    getStatus: async () => ok(gitStatus({ branch: 'feature' })),
    push: async () => ok({ branch: 'feature', upstream: 'origin/feature' }),
  });
  const app = renderUi(t, <Push client={client} onBack={() => (backs += 1)} />);
  await app.waitFor('feature is not on the remote yet. Push it and set its upstream (git push -u)?');
  await app.press(KEY.enter);
  await app.waitFor('Pushed feature to origin/feature and set it as the upstream.');
  await app.press(KEY.enter);
  await eventually(() => backs === 1, 'back after push');

  const behind = fakeClient({ getStatus: async () => ok(gitStatus({ upstream: 'origin/main', ahead: 1, behind: 3 })) });
  const second = renderUi(t, <Push client={behind} onBack={() => (backs += 1)} />);
  await second.waitFor('origin/main has 3 commits you don\'t have; pull first or the push is rejected.');
  await second.press('2');
  await eventually(() => backs === 2, 'Back');
});

test('Push: rejected and failed pushes and a status error are shown', async (t) => {
  const rejected = fakeClient({
    getStatus: async () => ok(gitStatus({ upstream: 'origin/main', ahead: 1 })),
    push: async () => err(gitError('push_rejected', 'The remote has commits you do not have')),
  });
  const app = renderUi(t, <Push client={rejected} onBack={() => undefined} />);
  await app.waitFor('Push 1 commit');
  await app.press(KEY.enter);
  await app.waitFor('The remote has commits you do not have');
  await app.waitFor('hint: Pull their commits first');

  const thrown = fakeClient({ getStatus: async () => ok(gitStatus({ upstream: 'origin/main', ahead: 1 })), push: async () => Promise.reject(new Error('ssh died')) });
  const second = renderUi(t, <Push client={thrown} onBack={() => undefined} />);
  await second.waitFor('Push 1 commit');
  await second.press(KEY.enter);
  await second.waitFor('ssh died');

  const broken = fakeClient({ getStatus: async () => err(gitError('not_a_repository', 'Not a git repository')) });
  const third = renderUi(t, <Push client={broken} onBack={() => undefined} />);
  await third.waitFor('Not a git repository');
});
