import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
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
