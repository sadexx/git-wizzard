import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveConfig } from '#auth/config.js';
import { fakeHttp, openAiCompatible, type FakeReply, type FakeRequest, type FakeServer } from '#testing/fake-http.js';
import { converse, inTerminal, type Answer, type Conversation } from '#testing/terminal.js';

// The built `gitwizz` as users run it: a temp repo, a temp HOME for the config, and a fake model server.

const CLI = fileURLToPath(new URL('../index.js', import.meta.url));

let model: FakeServer;
before(async () => {
  model = await fakeHttp(
    openAiCompatible(['m1'], (system: string) => {
      if (system.includes('commit messages')) return 'feat: add a\n\nBecause it was missing.';
      if (system.includes('branch names')) return 'feature/add-a\nfix/a-thing';
      return 'Add a\n\nThe body.';
    }),
  );
});
const queued: FakeServer[] = [];
after(async () => {
  await model.close();
  await Promise.all(queued.map((server: FakeServer) => server.close()));
});

/** A model answering each chat with the next reply; `null` fails that request, as a down server would. */
async function queuedModel(replies: Array<string | null>): Promise<FakeServer> {
  const server = await fakeHttp((request: FakeRequest): FakeReply => {
    if (request.method === 'GET') return openAiCompatible(['m1'], () => '')(request);
    const next = replies.shift();
    return next === null || next === undefined ? { status: 500, body: { error: { message: 'model down' } } } : openAiCompatible([], () => next)(request);
  });
  queued.push(server);
  return server;
}

/** Whether any prompt sent to the model matched; tests run concurrently, so not "the last one". */
function asked(pattern: RegExp): boolean {
  return model.requests.some((request: FakeRequest) => pattern.test(JSON.stringify(request.body)));
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a command without blocking: the fake model server answers from this process meanwhile
 * (a sync spawn would deadlock any gitwizz call waiting on it).
 */
function exec(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): Promise<Run> {
  return new Promise((resolve: (run: Run) => void) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('close', (code: number | null) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });
}

interface Sandbox {
  readonly dir: string;
  readonly home: string;
  readonly env: Record<string, string>;
  git(...args: string[]): string;
  gitwizz(args: string[], options?: { input?: string; env?: Record<string, string> }): Promise<Run>;
  /** `gitwizz` as if in a terminal, so it asks; each answer is typed once its question shows. */
  prompt(args: string[], steps: ReadonlyArray<readonly [string, Answer]>, env?: Record<string, string>): Promise<Conversation>;
  /** Save a Custom provider pointing at the fake model server (or `server`). */
  login(server?: FakeServer): Promise<void>;
}

async function sandbox(): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), 'git-wizzard-cli-'));
  const home = await mkdtemp(join(tmpdir(), 'git-wizzard-home-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Real credentials or settings on this machine must not leak in.
    if (value !== undefined && !/_API_KEY$|^GIT_WIZZARD_|^GIT_/.test(key)) env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return {
    dir,
    home,
    env,
    git,
    gitwizz: (args: string[], options: { input?: string; env?: Record<string, string> } = {}) =>
      exec(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, ...options.env }, ...(options.input !== undefined ? { input: options.input } : {}) }),
    prompt: (args: string[], steps: ReadonlyArray<readonly [string, Answer]>, extra: Record<string, string> = {}) =>
      converse(inTerminal(CLI, args), steps, { cwd: dir, env: { ...env, ...extra } }),
    login: async (server: FakeServer = model) => {
      const saved = await saveConfig({ version: 1, provider: 'custom', apiKey: 'test-key-123456', model: 'm1', baseUrl: `${server.url}/v1` }, join(home, '.git-wizzard'));
      assert.equal(saved.ok, true);
    },
  };
}

// Each test has its own repo and HOME; running them together keeps the suite quick despite process startup.
describe('gitwizz', { concurrency: true }, () => {
  it('status and diff work without any setup', async () => {
    const box = await sandbox();
    box.git('commit', '-q', '--allow-empty', '-m', 'init');
    await writeFile(join(box.dir, 'a.txt'), 'one\n');
    box.git('add', 'a.txt');
    await writeFile(join(box.dir, 'a.txt'), 'two\n');

    const status = await box.gitwizz(['status']);
    assert.equal(status.code, 0);
    assert.match(status.stdout, /On branch main\n\nStaged:\n {2}added: {6}a\.txt\n\nNot staged:\n {2}modified: {3}a\.txt/);
    const unstaged = await box.gitwizz(['diff']);
    assert.match(unstaged.stdout, /^Unstaged changes: 1 file, \+1 -1\n/);
    assert.match(unstaged.stdout, /^-one\n\+two$/m);
    const staged = await box.gitwizz(['diff', '--staged']);
    assert.match(staged.stdout, /^Staged changes: 1 file, \+1 -0\n/);
  });

  it('commit: dry run prints, -y commits, -a takes tracked changes, and nothing staged is an error', async () => {
    const box = await sandbox();
    await box.login();
    await writeFile(join(box.dir, 'a.txt'), 'a\n');
    box.git('add', 'a.txt');

    const dry = await box.gitwizz(['commit', '--dry-run', '--hint', 'first file']);
    assert.deepEqual(dry, { code: 0, stdout: 'feat: add a\n\nBecause it was missing.\n', stderr: '' });
    assert.ok(asked(/Author's note on intent: first file/));
    const short = await box.gitwizz(['commit', '--dry-run', '--subject-only']);
    assert.deepEqual(short, { code: 0, stdout: 'feat: add a\n', stderr: '' });

    const yes = await box.gitwizz(['commit', '-y']);
    assert.match(yes.stdout, /^Created commit [0-9a-f]{8} on main: feat: add a\n$/);
    assert.equal(box.git('log', '-1', '--format=%B').trim(), 'feat: add a\n\nBecause it was missing.');

    const none = await box.gitwizz(['commit', '-y']);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /error: No staged changes to summarize\nhint: Stage your changes/);

    await writeFile(join(box.dir, 'a.txt'), 'changed\n');
    const all = await box.gitwizz(['commit', '-a', '-y']);
    assert.equal(all.code, 0);
    assert.equal(box.git('status', '--porcelain'), '');
  });

  it('AI commands without credentials or a terminal say what to do', async () => {
    const box = await sandbox();
    await writeFile(join(box.dir, 'a.txt'), 'a\n');
    box.git('add', 'a.txt');

    const noAuth = await box.gitwizz(['commit', '--dry-run']);
    assert.equal(noAuth.code, 1);
    assert.match(noAuth.stderr, /No saved credentials and no API key in the environment\nhint: Run "gitwizz auth"/);

    const runs = await Promise.all([['commit'], ['branch'], ['push'], ['pr', '--open']].map((args: string[]) => box.gitwizz(args)));
    for (const run of runs) {
      assert.equal(run.code, 1);
      assert.match(run.stderr, /error: Cannot ask for confirmation without an interactive terminal\nhint: Pass --yes/);
    }
    const yesAlone = await box.gitwizz(['pr', '--yes']);
    assert.deepEqual([yesAlone.code, yesAlone.stderr], [1, 'error: --yes only applies with --open\n']);
  });

  it('branch: dry run lists suggestions, -y creates the first', async () => {
    const box = await sandbox();
    await box.login();
    box.git('commit', '-q', '--allow-empty', '-m', 'init');
    await writeFile(join(box.dir, 'new.txt'), 'x\n');

    const dry = await box.gitwizz(['branch', '--dry-run', '--type', 'fix']);
    assert.equal(dry.stdout, 'feature/add-a\nfix/a-thing\n');
    assert.ok(asked(/Preferred prefix\/type: fix/));

    const yes = await box.gitwizz(['branch', '-y']);
    assert.equal(yes.stdout, 'Suggestions: feature/add-a, fix/a-thing\nCreated and switched to branch feature/add-a\n');
    assert.equal(box.git('branch', '--show-current').trim(), 'feature/add-a');
    const taken = await box.gitwizz(['branch', '-y']);
    assert.equal(taken.code, 1);
    assert.match(taken.stderr, /Failed to create branch feature\/add-a/);
  });

  it('push and pr --open: upstream on first push, nothing to push after, then a PR through gh', async () => {
    const box = await sandbox();
    await box.login();
    const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    box.git('remote', 'add', 'origin', remote);
    box.git('commit', '-q', '--allow-empty', '-m', 'init');

    const first = await box.gitwizz(['push', '-y']);
    assert.equal(first.stdout, 'Pushed main to origin/main and set it as the upstream.\n');
    assert.equal((await box.gitwizz(['push', '-y'])).stdout, 'Nothing to push: main is up to date with origin/main.\n');
    box.git('commit', '-q', '--allow-empty', '-m', 'two');
    assert.equal((await box.gitwizz(['push', '-y'])).stdout, 'Pushed 1 commit to origin/main.\n');

    box.git('checkout', '-q', '-b', 'feature');
    box.git('commit', '-q', '--allow-empty', '-m', 'work');
    const described = await box.gitwizz(['pr', '--base', 'origin/main']);
    assert.deepEqual(described, { code: 0, stdout: 'Add a\n\nThe body.\n', stderr: 'Describing 1 commit not on origin/main.\n' });

    // A stand-in gh: logged in, and prints a PR URL for its arguments.
    const bin = await mkdtemp(join(tmpdir(), 'git-wizzard-bin-'));
    await writeFile(join(bin, 'gh'), `#!/bin/sh\n[ "$1" = auth ] && exit 0\nprintf '%s\\n' "$@" > '${join(bin, 'args')}'\necho https://github.com/o/r/pull/9\n`, { mode: 0o755 });
    const opened = await box.gitwizz(['pr', '--open', '-y'], { env: { PATH: `${bin}:${process.env['PATH'] ?? ''}` } });
    assert.equal(opened.stdout, 'Pushed the branch and opened https://github.com/o/r/pull/9\n');
    assert.equal(await readFile(join(bin, 'args'), 'utf8'), 'pr\ncreate\n--title=Add a\n--body=The body.\n--base=main\n');

    const noBase = await box.gitwizz(['pr', '--base', 'nope']);
    assert.equal(noBase.code, 1);
    assert.match(noBase.stderr, /Base "nope" is not a branch or commit/);
  });

  it('auth status, model, and logout manage the saved setup; environment keys win', async () => {
    const box = await sandbox();
    const none = await box.gitwizz(['auth', 'status']);
    assert.equal(none.code, 1);
    assert.match((await box.gitwizz(['auth', 'model', 'x'])).stderr, /No saved setup to change/);

    await box.login();
    const status = await box.gitwizz(['auth', 'status']);
    assert.equal(
      status.stdout,
      `Provider: custom\nServer:   ${model.url}/v1\nModel:    m1\nAPI key:  …3456\nSource:   saved config (${join(box.home, '.git-wizzard', 'config.json')})\n`,
    );
    assert.equal((await box.gitwizz(['auth', 'model', ' m2 '])).stdout, 'Model set to m2 for custom.\n');
    assert.match((await box.gitwizz(['auth', 'status'])).stdout, /Model: {4}m2/);

    const env = { OPENAI_API_KEY: 'sk-env' };
    const shadowed = await box.gitwizz(['auth', 'status'], { env });
    assert.match(shadowed.stdout, /^Provider: openai\n[\s\S]*API key:  \(set\)\nSource:   environment\nNote: saved config at .* is ignored/);
    assert.match((await box.gitwizz(['auth', 'model', 'm3'], { env })).stdout, /Environment credentials are set and take precedence/);
    const logout = await box.gitwizz(['auth', 'logout'], { env });
    assert.match(logout.stdout, /^Removed saved credentials \(.*\)\.\nEnvironment credentials are still set and will be used\.\n$/);
    assert.equal((await box.gitwizz(['auth', 'logout'])).stdout, 'No saved credentials to remove.\n');

    const setup = await box.gitwizz(['auth']);
    assert.equal(setup.code, 1);
    assert.match(setup.stderr, /Setting up a provider needs an interactive terminal/);
    const unknown = await box.gitwizz(['auth', 'status'], { env: { GIT_WIZZARD_PROVIDER: 'nope' } });
    assert.match(unknown.stderr, /Unknown provider "nope"/);
  });

  it('the hook drafts the message of a real git commit, and install/uninstall respect foreign hooks', async () => {
    const box = await sandbox();
    await box.login();
    box.git('commit', '-q', '--allow-empty', '-m', 'init');

    const installed = await box.gitwizz(['hook', 'install']);
    assert.match(installed.stdout, /^Installed .*prepare-commit-msg\n/);
    assert.match((await box.gitwizz(['hook', 'install'])).stdout, /^Updated /);

    await writeFile(join(box.dir, 'a.txt'), 'a\n');
    box.git('add', 'a.txt');
    // `true` as the editor accepts the drafted message as is.
    const commit = await exec('git', ['-c', 'core.editor=true', 'commit', '-q'], { cwd: box.dir, env: box.env });
    assert.equal(commit.code, 0, commit.stderr);
    assert.equal(box.git('log', '-1', '--format=%B').trim(), 'feat: add a\n\nBecause it was missing.');

    assert.match((await box.gitwizz(['hook', 'uninstall'])).stdout, /^Removed /);
    assert.equal((await box.gitwizz(['hook', 'uninstall'])).stdout, 'No git-wizzard hook installed.\n');
    await writeFile(join(box.dir, '.git', 'hooks', 'prepare-commit-msg'), '#!/bin/sh\n');
    const foreign = await box.gitwizz(['hook', 'install']);
    assert.equal(foreign.code, 1);
    assert.match(foreign.stderr, /already exists and was not installed by git-wizzard\nhint: Remove or rename it first/);
    assert.match((await box.gitwizz(['hook', 'uninstall'])).stderr, /was not installed by git-wizzard; leaving it in place/);

    const outside = await mkdtemp(join(tmpdir(), 'git-wizzard-norepo-'));
    const noRepo = await exec(process.execPath, [CLI, 'hook', 'install'], { cwd: outside, env: { ...box.env, GIT_CEILING_DIRECTORIES: tmpdir() } });
    assert.equal(noRepo.code, 1);
    assert.match(noRepo.stderr, /error: Not a git repository/);
  });

  it('help lists every command with examples', async () => {
    const box = await sandbox();
    const help = await box.gitwizz(['--help']);
    for (const command of ['auth', 'status', 'diff', 'branch', 'commit', 'push', 'pr', 'hook']) {
      assert.match(help.stdout, new RegExp(`^ {2}${command}\\b`, 'm'), command);
    }
    assert.match(help.stdout, /gitwizz pr --open/);
    for (const args of [['status'], ['diff'], ['push', '-y']]) {
      const outside = await box.gitwizz(args, { env: { GIT_DIR: '/nonexistent' } });
      assert.equal(outside.code, 1, args.join(' '));
      assert.match(outside.stderr, /^error: /, args.join(' '));
    }
  });

  it('commit in a terminal: regenerate (a failed retry keeps the message), edit, confirm; or abort', async () => {
    const box = await sandbox();
    await box.login(await queuedModel(['feat: first', null, 'feat: second', 'feat: third']));
    await writeFile(join(box.dir, 'a.txt'), 'a\n');
    box.git('add', 'a.txt');

    const choice = '[c]onfirm / [e]dit / [r]egenerate / [a]bort: ';
    const run = await box.prompt(['commit'], [[choice, 'r\n'], [choice, 'r\n'], [choice, 'e\n'], [choice, 'c\n']], { GIT_EDITOR: `printf 'feat: edited\\n' >` });
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Commit message:\nfeat: first\n[\s\S]*Commit message:\nfeat: first\n[\s\S]*Commit message:\nfeat: second\n[\s\S]*Commit message:\nfeat: edited\n/);
    assert.match(run.stderr, /^error: Request to .* failed/m);
    assert.match(run.stdout, /Created commit [0-9a-f]{8} on main: feat: edited\n/);

    await writeFile(join(box.dir, 'b.txt'), 'b\n');
    box.git('add', 'b.txt');
    const aborted = await box.prompt(['commit'], [[choice, 'a\n']]);
    assert.match(aborted.stdout, /Commit message:\nfeat: third\n[\s\S]*Aborted\. No commit created\.\n$/);
    assert.equal(box.git('log', '--format=%s').trim(), 'feat: edited');
  });

  it('branch in a terminal: regenerate lists new names, confirm creates the first; or abort', async () => {
    const box = await sandbox();
    await box.login(await queuedModel(['feature/one', null, 'feature/two\nfix/x', 'feature/three']));
    box.git('commit', '-q', '--allow-empty', '-m', 'init');
    await writeFile(join(box.dir, 'new.txt'), 'x\n');

    const choice = '[c]onfirm / [e]dit / [r]egenerate / [a]bort: ';
    const run = await box.prompt(['branch'], [[choice, 'r\n'], [choice, 'r\n'], [choice, 'c\n']]);
    assert.match(run.stdout, /^Suggestions: feature\/one\n[\s\S]*Suggestions: feature\/two, fix\/x\n[\s\S]*Create branch:\nfeature\/two\n/);
    assert.match(run.stdout, /Created and switched to branch feature\/two\n$/);
    const aborted = await box.prompt(['branch'], [[choice, 'a\n']]);
    assert.match(aborted.stdout, /Aborted\. No branch created\.\n$/);
    assert.equal(box.git('branch', '--show-current').trim(), 'feature/two');
  });

  it('pr --open in a terminal: regenerate, confirm, and gh opens it; abort opens nothing; a logged-out gh fails', async () => {
    const box = await sandbox();
    await box.login(await queuedModel(['Title one\n\nBody one', null, 'Title two\n\nBody two', 'Title three', 'Title four']));
    const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    box.git('remote', 'add', 'origin', remote);
    box.git('commit', '-q', '--allow-empty', '-m', 'init');
    box.git('push', '-q', '-u', 'origin', 'main');
    box.git('checkout', '-q', '-b', 'feature');
    box.git('commit', '-q', '--allow-empty', '-m', 'work');
    const bin = await mkdtemp(join(tmpdir(), 'git-wizzard-bin-'));
    await writeFile(join(bin, 'gh'), `#!/bin/sh\n[ "$1" = auth ] && exit 0\nprintf '%s\\n' "$@" > '${join(bin, 'args')}'\necho https://github.com/o/r/pull/5\n`, { mode: 0o755 });
    const path = { PATH: `${bin}:${process.env['PATH'] ?? ''}` };

    const choice = '[c]onfirm / [e]dit / [r]egenerate / [a]bort: ';
    const run = await box.prompt(['pr', '--open'], [[choice, 'r\n'], [choice, 'r\n'], [choice, 'c\n']], path);
    assert.match(run.stdout, /Pull request into origin\/main:\nTitle two\n\nBody two\n/);
    assert.match(run.stdout, /Pushed the branch and opened https:\/\/github\.com\/o\/r\/pull\/5\n$/);
    assert.match(await readFile(join(bin, 'args'), 'utf8'), /--title=Title two\n--body=Body two\n/);

    const aborted = await box.prompt(['pr', '--open'], [[choice, 'a\n']], path);
    assert.match(aborted.stdout, /Pull request into origin\/main:\nTitle three\n[\s\S]*Aborted\. No pull request opened\.\n$/);

    await writeFile(join(bin, 'gh'), '#!/bin/sh\necho "You are not logged into any GitHub hosts." >&2\nexit 1\n', { mode: 0o755 });
    const loggedOut = await box.gitwizz(['pr', '--open', '-y', '--base', 'origin/main'], { env: { ...path } });
    assert.equal(loggedOut.code, 1);
    assert.match(loggedOut.stderr, /The GitHub CLI \(gh\) is not logged in\n {2}You are not logged into any GitHub hosts\.\nhint: Run "gh auth login"/);
  });

  it('push in a terminal asks first; being behind warns, and the rejected push says what to do', async () => {
    const box = await sandbox();
    const remote = await mkdtemp(join(tmpdir(), 'git-wizzard-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    box.git('remote', 'add', 'origin', remote);
    box.git('commit', '-q', '--allow-empty', '-m', 'init');

    const question = 'main is not on the remote yet. Push it and set its upstream? [y/N]: ';
    assert.match((await box.prompt(['push'], [[question, '\n']])).stdout, /Aborted\. Nothing pushed\.\n$/);
    assert.match((await box.prompt(['push'], [[question, 'y\n']])).stdout, /Pushed main to origin\/main and set it as the upstream\.\n$/);

    // Someone else pushes; we fetch it and commit on top of the old tip.
    const other = await mkdtemp(join(tmpdir(), 'git-wizzard-other-'));
    execFileSync('git', ['clone', '-q', remote, other], { env: box.env });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'theirs'], { cwd: other, env: box.env });
    execFileSync('git', ['push', '-q'], { cwd: other, env: box.env });
    box.git('fetch', '-q');
    box.git('commit', '-q', '--allow-empty', '-m', 'ours');
    const rejected = await box.gitwizz(['push', '-y']);
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /^origin\/main has 1 commit you don't have; pull first or the push is rejected\.\nerror: The remote has commits you do not have\n/);
  });

  it('auth in a terminal saves what you type; commit and auth report save and read failures', async () => {
    const box = await sandbox();
    const setup = await box.prompt(
      ['auth', '--no-validate'],
      [
        ['> ', '4\n'],
        ['Server URL, e.g. http://localhost:11434/v1 []: ', `${model.url}/v1\n`],
        ['Model []: ', 'm1\n'],
        ['API key (enter for none): ', '\r'],
      ],
    );
    assert.match(setup.stdout, /Authorized custom \(model m1\)\.\n$/);

    // A pre-commit hook that refuses.
    await writeFile(join(box.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 });
    await writeFile(join(box.dir, 'a.txt'), 'a\n');
    box.git('add', 'a.txt');
    const refused = await box.gitwizz(['commit', '-y']);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^error: git commit failed\n[\s\S]*lint failed/);

    const config = join(box.home, '.git-wizzard', 'config.json');
    await chmod(config, 0o400);
    const readOnly = await box.gitwizz(['auth', 'model', 'm2']);
    assert.match(readOnly.stderr, /^error: Failed to write .*config\.json\n[\s\S]*hint: Check that .* is writable/);
    await chmod(config, 0o600);

    await writeFile(config, '{ not json');
    assert.match((await box.gitwizz(['auth', 'model', 'm2'])).stderr, /^error: Config file is not valid JSON/);
    const noBranch = await box.gitwizz(['branch', '--dry-run']);
    assert.equal(noBranch.code, 1);
    assert.match(noBranch.stderr, /^error: Config file is not valid JSON/);

    // A directory where the config file should be: it can't be deleted as a file.
    await rm(config);
    await mkdir(config);
    const cannotRemove = await box.gitwizz(['auth', 'logout']);
    assert.equal(cannotRemove.code, 1);
    assert.match(cannotRemove.stderr, /^error: Failed to delete .*config\.json/);
  });
});
