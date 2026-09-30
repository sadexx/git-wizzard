import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema, type CallToolResult, type CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_ERROR_META_KEY } from '@git-wizzard/shared';
import { createServer } from '#index.js';

// The server as any MCP client sees it: tools called over a transport, sampling answered by `sample`.

type Sampler = () => Promise<CreateMessageResult>;

const text = (reply: string): Sampler => async () => ({ role: 'assistant', model: 'test', content: { type: 'text', text: reply } });

async function connect(t: TestContext, sample: Sampler): Promise<(name: string, args: Record<string, unknown>) => Promise<CallToolResult>> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: { sampling: {} } });
  client.setRequestHandler(CreateMessageRequestSchema, sample);
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(() => client.close());
  return async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallToolResult;
}

async function repo(branch: string = 'main'): Promise<{ dir: string; git: (...args: string[]) => void }> {
  const dir = await mkdtemp(join(tmpdir(), 'git-wizzard-tools-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q', '-b', branch);
  // In the repo's config, so the server's own git calls (create_commit) have an identity too.
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@t');
  return { dir, git };
}

/** "Kind/reason" of the typed error a failed tool attaches. */
function failure(result: CallToolResult): string {
  assert.equal(result.isError, true, JSON.stringify(result.content));
  const error = result._meta?.[TOOL_ERROR_META_KEY] as { kind: string; reason: string };
  return `${error.kind}/${error.reason}`;
}

function firstText(result: CallToolResult): string {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : '';
}

test('status, diff, and staging describe themselves in text next to the structured result', async (t) => {
  const { dir } = await repo();
  await writeFile(join(dir, 'a.txt'), 'a\n');
  const call = await connect(t, text(''));

  assert.equal(firstText(await call('get_status', { repoPath: dir })), 'On main: 1 changed file(s), 0 ahead / 0 behind.');
  const staged = await call('stage_files', { repoPath: dir, stage: ['a.txt'] });
  assert.equal(firstText(staged), 'Staged 1, unstaged 0; 1 file(s) now staged.');
  assert.equal(firstText(await call('get_diff', { repoPath: dir, staged: true })), 'Staged diff: 1 file(s), +1/-0.');
  assert.equal(firstText(await call('stage_files', { repoPath: dir, unstage: ['a.txt'] })), 'Staged 0, unstaged 1; 0 file(s) now staged.');
  assert.equal(firstText(await call('get_diff', { repoPath: dir })), 'Unstaged diff: 0 file(s), +0/-0.');
  assert.equal(failure(await call('stage_files', { repoPath: dir, stage: ['missing.txt'] })), 'GitError/command_failed');
});

test('every tool reports a directory that is not a repository', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'git-wizzard-norepo-'));
  process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
  t.after(() => delete process.env['GIT_CEILING_DIRECTORIES']);
  const call = await connect(t, text(''));
  const tools: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['get_status', {}],
    ['get_diff', {}],
    ['suggest_branch_name', {}],
    ['generate_commit_message', {}],
    ['generate_pr_description', {}],
    ['create_commit', { message: 'x' }],
    ['create_branch', { name: 'x' }],
    ['stage_files', {}],
    ['push', {}],
    ['create_pull_request', { title: 't', body: '', base: 'main' }],
  ];
  for (const [name, args] of tools) {
    assert.equal(failure(await call(name, { repoPath: outside, ...args })), 'GitError/not_a_repository', name);
  }
});

test('branch names: nothing to name, a reply with no usable name, a failed or non-text sample', async (t) => {
  const { dir } = await repo();
  const clean = await connect(t, text('feature/x'));
  assert.equal(failure(await clean('suggest_branch_name', { repoPath: dir })), 'GitError/no_changes');

  await writeFile(join(dir, 'a.txt'), 'a\n');
  const garbage = await connect(t, text('!!!\n???'));
  assert.equal(failure(await garbage('suggest_branch_name', { repoPath: dir })), 'ProviderError/invalid_response');
  const image = await connect(t, async () => ({ role: 'assistant', model: 'test', content: { type: 'image', data: '', mimeType: 'image/png' } }));
  assert.equal(failure(await image('suggest_branch_name', { repoPath: dir })), 'ProviderError/invalid_response');
  const broken = await connect(t, async () => Promise.reject(new Error('client has no model')));
  assert.equal(failure(await broken('suggest_branch_name', { repoPath: dir })), 'ProviderError/request_failed');
});

test('commit message: a non-text or failed sample is an error, text becomes subject and body', async (t) => {
  const { dir, git } = await repo();
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');

  const image = await connect(t, async () => ({ role: 'assistant', model: 'test', content: { type: 'image', data: '', mimeType: 'image/png' } }));
  assert.equal(failure(await image('generate_commit_message', { repoPath: dir })), 'ProviderError/invalid_response');
  const broken = await connect(t, async () => Promise.reject(new Error('no model')));
  assert.equal(failure(await broken('generate_commit_message', { repoPath: dir })), 'ProviderError/request_failed');

  const good = await connect(t, text('feat: a\n\nwhy'));
  const result = await good('generate_commit_message', { repoPath: dir, all: true });
  assert.deepEqual(result.structuredContent, { subject: 'feat: a', body: 'why', message: 'feat: a\n\nwhy' });
  assert.equal(firstText(await good('create_commit', { repoPath: dir, message: 'feat: a' })).slice(0, 10), 'Committed ');
  assert.equal(firstText(await good('create_branch', { repoPath: dir, name: 'next' })), 'Created and switched to next.');
});

test('PR description: no base to find, a bad base, no commits, a failed or non-text sample', async (t) => {
  const { dir, git } = await repo('trunk');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const call = await connect(t, text('Title\n\nBody'));

  assert.equal(failure(await call('generate_pr_description', { repoPath: dir })), 'GitError/base_not_found');
  assert.equal(failure(await call('generate_pr_description', { repoPath: dir, base: 'nope' })), 'GitError/base_not_found');
  assert.equal(failure(await call('generate_pr_description', { repoPath: dir, base: 'trunk' })), 'GitError/no_commits');

  git('checkout', '-q', '-b', 'feature');
  git('commit', '-q', '--allow-empty', '-m', 'work');
  const described = await call('generate_pr_description', { repoPath: dir, base: 'trunk', hint: 'why' });
  assert.deepEqual(described.structuredContent, { title: 'Title', body: 'Body', base: 'trunk', commits: 1 });
  assert.equal(firstText(described), 'Title\n\nBody');

  const image = await connect(t, async () => ({ role: 'assistant', model: 'test', content: { type: 'image', data: '', mimeType: 'image/png' } }));
  assert.equal(failure(await image('generate_pr_description', { repoPath: dir, base: 'trunk' })), 'ProviderError/invalid_response');
  const broken = await connect(t, async () => Promise.reject(new Error('no model')));
  assert.equal(failure(await broken('generate_pr_description', { repoPath: dir, base: 'trunk' })), 'ProviderError/request_failed');
});
