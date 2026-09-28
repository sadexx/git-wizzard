import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRepository } from '#git/repository.js';

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

async function tempRepo(): Promise<{ dir: string; git: (...args: string[]) => void }> {
  const dir = await mkdtemp(join(tmpdir(), 'git-assistant-repo-'));
  let tick: number = 0;
  const git = (...args: string[]): void => {
    // Distinct, increasing dates so `git log` ordering is deterministic within one test second.
    tick += 1;
    const date = `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z`;
    execFileSync('git', [...identity, ...args], {
      cwd: dir,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  };
  git('init', '-q', '-b', 'main');
  return { dir, git };
}

async function open(dir: string): Promise<GitRepository> {
  const repo = await GitRepository.open(dir);
  assert.equal(repo.ok, true);
  if (!repo.ok) throw new Error('unreachable');
  return repo.value;
}

test('recentSubjects is empty before the first commit', async () => {
  const { dir } = await tempRepo();
  assert.deepEqual(await (await open(dir)).recentSubjects(), { ok: true, value: [] });
});

test('recentSubjects lists newest first, skips merges, and honors the limit', async () => {
  const { dir, git } = await tempRepo();
  git('commit', '-q', '--allow-empty', '-m', 'first');
  git('checkout', '-q', '-b', 'side');
  git('commit', '-q', '--allow-empty', '-m', 'on side');
  git('checkout', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'second\n\nbody is not a subject');
  git('merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side');

  const repo = await open(dir);
  assert.deepEqual(await repo.recentSubjects(), { ok: true, value: ['second', 'on side', 'first'] });
  assert.deepEqual(await repo.recentSubjects(1), { ok: true, value: ['second'] });
});

test('defaultBase prefers origin/HEAD, falls back to main, and is undefined before any commit', async () => {
  const { dir, git } = await tempRepo();
  const repo = await open(dir);
  assert.equal(await repo.defaultBase(), undefined);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  assert.equal(await repo.defaultBase(), 'main');
  git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  assert.equal(await repo.defaultBase(), 'origin/trunk');
  assert.equal(await repo.hasCommit('nope'), false);
});

test('branchChanges covers only the non-merge commits since the branch left base', async () => {
  const { dir, git } = await tempRepo();
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('checkout', '-q', '-b', 'feature');
  await writeFile(join(dir, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'add a\n\nbecause reasons');
  git('checkout', '-q', 'main');
  await writeFile(join(dir, 'b.txt'), 'two\n');
  git('add', 'b.txt');
  git('commit', '-q', '-m', 'main moves on');
  git('checkout', '-q', 'feature');
  git('merge', '-q', '--no-ff', '-m', 'Merge main', 'main');

  const repo = await open(dir);
  const changes = await repo.branchChanges('main');
  assert.equal(changes.ok, true);
  if (!changes.ok) return;
  assert.equal(changes.value.commits, 1);
  assert.equal(changes.value.log, '- add a\n  because reasons');
  assert.deepEqual(
    changes.value.diff.files.map((file: { path: string }) => file.path),
    ['a.txt'],
  );
  const none = await repo.branchChanges('feature');
  assert.equal(none.ok && none.value.commits, 0);
});
