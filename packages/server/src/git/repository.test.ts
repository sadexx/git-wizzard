import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRepository } from '#git/repository.js';

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

async function tempRepo(): Promise<{ dir: string; git: (...args: string[]) => void }> {
  const dir = await mkdtemp(join(tmpdir(), 'git-wizzard-repo-'));
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

test('commit with all includes unstaged tracked changes but never untracked files', async () => {
  const { dir, git } = await tempRepo();
  // createCommit runs git without our -c identity flags, so give the repo its own.
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  await writeFile(join(dir, 'first.txt'), 'first\n');
  git('add', 'first.txt');
  const repo = await open(dir);
  const unborn = await repo.commitDiff(true);
  assert.deepEqual(unborn.ok && unborn.value.files.map((file: { path: string }) => file.path), ['first.txt']);
  git('commit', '-q', '-m', 'init');

  await writeFile(join(dir, 'first.txt'), 'changed\n');
  await writeFile(join(dir, 'new.txt'), 'untracked\n');
  const staged = await repo.commitDiff(false);
  assert.deepEqual(staged.ok && staged.value.files, []);
  const all = await repo.commitDiff(true);
  assert.deepEqual(all.ok && all.value.files.map((file: { path: string }) => file.path), ['first.txt']);

  const committed = await repo.createCommit('update first', true);
  assert.equal(committed.ok && committed.value.summary, 'update first');
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.equal(status, '?? new.txt\n');
  const again = await repo.createCommit('nothing left', true);
  assert.equal(!again.ok && again.error.kind === 'GitError' && again.error.reason, 'nothing_to_commit');
});

test('stage adds new and deleted files, unstages before the first commit, and treats names literally', async () => {
  const { dir, git } = await tempRepo();
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await writeFile(join(dir, '*.txt'), 'star\n');
  const repo = await open(dir);
  const porcelain = (): string => execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

  const added = await repo.stage(['*.txt'], []);
  assert.deepEqual(added.ok && added.value.files.map((file: { path: string; index: string }) => [file.path, file.index]), [
    ['*.txt', 'added'],
    ['a.txt', 'unmodified'],
  ]);
  assert.equal((await repo.stage(['a.txt'], ['*.txt'])).ok, true);
  assert.equal(porcelain(), 'A  a.txt\n?? *.txt\n');

  git('commit', '-q', '-m', 'init');
  await rm(join(dir, 'a.txt'));
  assert.equal((await repo.stage(['a.txt'], [])).ok, true);
  assert.equal(porcelain(), 'D  a.txt\n?? *.txt\n');
});

test('push sets an upstream on first push, counts commits later, and never forces', async () => {
  const { dir, git } = await tempRepo();
  const repo = await open(dir);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const none = await repo.push();
  assert.equal(!none.ok && none.error.kind === 'GitError' && none.error.reason, 'no_remote');

  const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  assert.deepEqual(await repo.push(), { ok: true, value: { branch: 'main', upstream: 'origin/main' } });

  git('commit', '-q', '--allow-empty', '-m', 'two');
  git('commit', '-q', '--allow-empty', '-m', 'three');
  assert.deepEqual(await repo.push(), { ok: true, value: { branch: 'main', upstream: 'origin/main', commits: 2 } });

  // Someone else pushes first: ours must be rejected, not forced over theirs.
  const other = await mkdtemp(join(tmpdir(), 'git-wizzard-other-'));
  execFileSync('git', ['clone', '-q', remote, other]);
  execFileSync('git', [...identity, 'commit', '-q', '--allow-empty', '-m', 'theirs'], { cwd: other });
  execFileSync('git', ['push', '-q'], { cwd: other });
  git('commit', '-q', '--allow-empty', '-m', 'ours');
  const rejected = await repo.push();
  assert.equal(!rejected.ok && rejected.error.kind === 'GitError' && rejected.error.reason, 'push_rejected');
});

test('createPullRequest pushes an unpushed branch, then hands gh the title, body, and GitHub base name', async (t) => {
  const { dir, git } = await tempRepo();
  const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('push', '-q', '-u', 'origin', 'main');
  git('checkout', '-q', '-b', 'feature');
  git('commit', '-q', '--allow-empty', '-m', 'work');

  // A stand-in gh that records its arguments, one per line, and prints a PR URL like the real one.
  const bin = await mkdtemp(join(tmpdir(), 'git-wizzard-bin-'));
  const argsFile = join(bin, 'args');
  await writeFile(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\necho https://github.com/o/r/pull/7\n`, { mode: 0o755 });
  const path = process.env['PATH'];
  process.env['PATH'] = `${bin}:${path ?? ''}`;
  t.after(() => {
    process.env['PATH'] = path;
  });

  const repo = await open(dir);
  assert.deepEqual(await repo.createPullRequest('-dash title', 'why\nand how', 'origin/main'), {
    ok: true,
    value: { url: 'https://github.com/o/r/pull/7', pushed: true },
  });
  assert.equal(await readFile(argsFile, 'utf8'), 'pr\ncreate\n--title=-dash title\n--body=why\nand how\n--base=main\n');
  assert.match(execFileSync('git', ['branch', '-r'], { cwd: dir, encoding: 'utf8' }), /origin\/feature/);

  const again = await repo.createPullRequest('t', '', 'main');
  assert.equal(again.ok && again.value.pushed, false);
});

test('createPullRequest stops before pushing when gh is not logged in', async (t) => {
  const { dir, git } = await tempRepo();
  const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('checkout', '-q', '-b', 'feature');

  // A stand-in gh whose `auth status` fails the way the real one does when logged out.
  const bin = await mkdtemp(join(tmpdir(), 'git-wizzard-bin-'));
  await writeFile(join(bin, 'gh'), `#!/bin/sh\n[ "$1" = auth ] && { echo 'not logged in' >&2; exit 1; }\nexit 0\n`, { mode: 0o755 });
  const path = process.env['PATH'];
  process.env['PATH'] = `${bin}:${path ?? ''}`;
  t.after(() => {
    process.env['PATH'] = path;
  });

  const result = await (await open(dir)).createPullRequest('t', '', 'main');
  assert.equal(!result.ok && result.error.kind === 'GitError' && result.error.reason, 'gh_not_authenticated');
  assert.equal(execFileSync('git', ['ls-remote', '--heads', remote], { encoding: 'utf8' }), '');
});

test('git failures surface as command_failed with git\'s own words: a hook, a lost remote, gh itself', async (t) => {
  const { dir, git } = await tempRepo();
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const repo = await open(dir);

  // A pre-commit hook that refuses: the commit fails and git's message comes along.
  await writeFile(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 });
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  const refused = await repo.createCommit('feat: a');
  assert.equal(!refused.ok && refused.error.kind === 'GitError' && refused.error.reason, 'command_failed');
  assert.match(!refused.ok ? String(refused.error.cause) : '', /lint failed/);

  // A remote that no longer exists: not "rejected", just failed.
  git('remote', 'add', 'origin', join(dir, 'gone.git'));
  const lost = await repo.push();
  assert.equal(!lost.ok && lost.error.kind === 'GitError' && lost.error.reason, 'command_failed');

  const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'set-url', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  const bin = await mkdtemp(join(tmpdir(), 'git-wizzard-bin-'));
  await writeFile(join(bin, 'gh'), '#!/bin/sh\n[ "$1" = auth ] && exit 0\necho "a pull request already exists" >&2\nexit 1\n', { mode: 0o755 });
  const path = process.env['PATH'];
  process.env['PATH'] = `${bin}:${path ?? ''}`;
  t.after(() => {
    process.env['PATH'] = path;
  });
  const duplicate = await repo.createPullRequest('t', '', 'main');
  assert.deepEqual(!duplicate.ok && [duplicate.error.message, duplicate.error.cause], ['gh pr create failed', 'a pull request already exists\n']);
});

test('diff ignores user config that reshapes the patch', async () => {
  const { dir, git } = await tempRepo();
  const external = join(dir, 'external.sh');
  await writeFile(external, '#!/bin/sh\necho EXTERNAL\n', { mode: 0o755 });
  git('config', 'color.ui', 'always');
  git('config', 'diff.noprefix', 'true');
  git('config', 'diff.mnemonicPrefix', 'true');
  git('config', 'diff.external', external);
  await writeFile(join(dir, 'a.txt'), 'one\n');
  git('add', 'a.txt');

  const diff = await (await open(dir)).diff(true);
  assert.equal(diff.ok, true);
  if (!diff.ok) return;
  assert.match(diff.value.patch, /^diff --git a\/a\.txt b\/a\.txt\n/);
  assert.doesNotMatch(diff.value.patch, /\x1b|EXTERNAL/);
  assert.deepEqual(diff.value.files.map((file: { path: string }) => file.path), ['a.txt']);
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
