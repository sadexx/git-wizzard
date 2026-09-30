import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authError, err, ok, type AppError, type CompletionRequest, type Result } from '@git-wizzard/shared';
import type { ProviderAdapter } from '#auth/provider-adapter.js';
import { connectClient, type GitWizzardClient } from '#mcp/client.js';
import type { AdapterResolver } from '#mcp/sampling.js';

// The real server as a subprocess, a temp repo, and a scripted model: the whole tool -> sampling -> tool path.

async function tempRepo(): Promise<{ dir: string; git: (...args: string[]) => string }> {
  const dir = await mkdtemp(join(tmpdir(), 'git-wizzard-e2e-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  return { dir, git };
}

/** A model that answers with `replies` in order and records what it was asked. */
function scripted(...replies: string[]): { resolve: AdapterResolver; requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  const adapter: ProviderAdapter = {
    provider: 'openai',
    model: 'fake',
    validateKey: async () => ok(undefined),
    listModels: async () => ok([]),
    complete: async (request: CompletionRequest) => {
      requests.push(request);
      return ok({ text: replies.shift() ?? '', model: 'fake', finishReason: 'stop' });
    },
  };
  return { resolve: async () => ok(adapter), requests };
}

async function connect(dir: string, resolve: AdapterResolver): Promise<GitWizzardClient> {
  const client = await connectClient(resolve, { cwd: dir });
  if (!client.ok) throw new Error(client.error.message);
  return client.value;
}

test('commit round trip: the staged diff reaches the model and its message is committed', async (t) => {
  const { dir, git } = await tempRepo();
  await writeFile(join(dir, 'retry.ts'), 'export const retries = 3;\n');
  git('add', 'retry.ts');
  const model = scripted('"feat: add retry count"\n\nSo callers can tune it.');
  const client = await connect(dir, model.resolve);
  t.after(() => client.close());

  const generated = await client.generateCommitMessage({ hint: 'tunable retries' });
  assert.deepEqual(generated, {
    ok: true,
    value: { subject: 'feat: add retry count', body: 'So callers can tune it.', message: 'feat: add retry count\n\nSo callers can tune it.' },
  });
  const [request] = model.requests;
  const prompt = request?.messages.map((message: { content: string }) => message.content).join('\n') ?? '';
  assert.match(prompt, /Author's note on intent: tunable retries/);
  assert.match(prompt, /\+export const retries = 3;/);

  const committed = await client.createCommit({ message: generated.ok ? generated.value.message : '' });
  assert.equal(committed.ok && committed.value.summary, 'feat: add retry count');
  assert.equal(git('log', '-1', '--format=%B').trim(), 'feat: add retry count\n\nSo callers can tune it.');
  const status = await client.getStatus();
  assert.equal(status.ok && status.value.isClean, true);
});

test('branch suggestions are parsed from the model reply and the chosen one is created', async (t) => {
  const { dir, git } = await tempRepo();
  git('commit', '-q', '--allow-empty', '-m', 'init');
  await writeFile(join(dir, 'new.ts'), 'x\n');
  const client = await connect(dir, scripted('1. feature/add-new\n2. `chore/new-file`').resolve);
  t.after(() => client.close());

  const suggestions = await client.suggestBranchName({ type: 'feature' });
  assert.deepEqual(suggestions, { ok: true, value: ['feature/add-new', 'chore/new-file'] });
  assert.equal((await client.createBranch({ name: 'feature/add-new' })).ok, true);
  assert.equal(git('branch', '--show-current').trim(), 'feature/add-new');
});

test('staging, push, and pull request calls go through; a closed connection is an error, not a hang', async () => {
  const { dir, git } = await tempRepo();
  git('commit', '-q', '--allow-empty', '-m', 'init');
  await writeFile(join(dir, 'a.txt'), 'a\n');
  const client = await connect(dir, scripted().resolve);

  const staged = await client.stageFiles({ stage: ['a.txt'] });
  assert.deepEqual(staged.ok && staged.value.files, [{ path: 'a.txt', index: 'added', workingTree: 'unmodified' }]);
  const unstaged = await client.stageFiles({ unstage: ['a.txt'] });
  assert.equal(unstaged.ok && unstaged.value.files[0]?.workingTree, 'untracked');
  const diff = await client.getDiff({ staged: false });
  assert.equal(diff.ok && diff.value.staged, false);

  const push = await client.push();
  assert.equal(!push.ok && push.error.message, 'This repository has no remote');
  const pr = await client.createPullRequest({ title: 't', body: '', base: 'main' });
  assert.equal(pr.ok, false);

  await client.close();
  const closed = await client.getStatus();
  assert.equal(!closed.ok && closed.error.message, 'Tool get_status call failed');
});

test('typed errors survive the trip through the server, from git and from the credentials lookup', async (t) => {
  const { dir } = await tempRepo();
  const noCredentials: AdapterResolver = async () => err(authError('missing_credentials', 'No saved credentials'));
  const client = await connect(dir, noCredentials);
  t.after(() => client.close());

  const reason = (result: Result<unknown, AppError>): string =>
    result.ok ? 'ok' : `${result.error.kind}/${'reason' in result.error ? result.error.reason : ''}`;
  assert.equal(reason(await client.generateCommitMessage()), 'GitError/nothing_to_commit');

  await writeFile(join(dir, 'a.txt'), 'a\n');
  assert.equal(reason(await client.suggestBranchName()), 'AuthError/missing_credentials');
});
