import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeHttp, openAiCompatible, type FakeReply } from '#testing/fake-http.js';
import { converse as converseNode, type Answer } from '#testing/terminal.js';

// The terminal prompts, typed into like a person would: each answer waits for its question to appear.

const PROMPT = new URL('./prompt.js', import.meta.url).href;
const FLOW = new URL('../auth/flow.js', import.meta.url).href;

/** Run an ES module snippet through its prompts; it sets `result`, which comes back parsed. */
async function converse(
  code: string,
  steps: ReadonlyArray<readonly [string, Answer]>,
  env: Record<string, string> = {},
): Promise<{ stdout: string; result: unknown }> {
  const script = `${code}\nprocess.stdout.write('\\nRESULT ' + JSON.stringify(result) + '\\n');\nprocess.exit(0);`;
  const run = await converseNode(['--input-type=module', '-e', script], steps, { env: { ...process.env, ...env } });
  const line = run.stdout.split('\n').find((text: string) => text.startsWith('RESULT '));
  assert.ok(line !== undefined, `No result.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  return { stdout: run.stdout, result: JSON.parse(line.slice('RESULT '.length)) };
}

const choose = (canRegenerate: boolean): string =>
  `import { createActionPrompter } from '${PROMPT}';\nconst result = await createActionPrompter().choose(${canRegenerate});`;

test('choose re-asks on unknown input and understands every answer, full or short', async () => {
  const retried = await converse(choose(true), [
    ['[c]onfirm / [e]dit / [r]egenerate / [a]bort: ', 'x\n'],
    ['Please enter c, e, r, or a.\n', 'R\n'],
  ]);
  assert.equal(retried.result, 'regenerate');

  const noRegenerate = await converse(choose(false), [
    ['[c]onfirm / [e]dit / [a]bort: ', 'r\n'],
    ['Please enter c, e, or a.\n', 'confirm\n'],
  ]);
  assert.equal(noRegenerate.result, 'confirm');

  for (const [answer, expected] of [['e\n', 'edit'], ['abort\n', 'abort'], [null, 'abort']] as const) {
    assert.equal((await converse(choose(false), [['[a]bort: ', answer]])).result, expected);
  }
});

test('confirmYesNo takes only y or yes; anything else or Ctrl-D declines', async () => {
  const ask = `import { confirmYesNo } from '${PROMPT}';\nconst result = await confirmYesNo('Push?');`;
  for (const [answer, expected] of [[' YES \n', true], ['y\n', true], ['\n', false], ['no\n', false], [null, false]] as const) {
    assert.equal((await converse(ask, [['Push? [y/N]: ', answer]])).result, expected, JSON.stringify(answer));
  }
});

test('edit opens the git editor and falls back to a one-line prompt without one', async () => {
  const edit = (current: string): string =>
    `import { createActionPrompter } from '${PROMPT}';\nconst prompter = createActionPrompter();\nprompter.show('Commit message', ${JSON.stringify(current)});\nconst result = await prompter.edit(${JSON.stringify(current)});`;

  // The editor setting is a shell snippet given the file; these overwrite it.
  const edited = await converse(edit('old'), [], { GIT_EDITOR: `printf 'new subject\\n\\n# a comment\\n' >` });
  assert.equal(edited.result, 'new subject');
  assert.match(edited.stdout, /^\nCommit message:\nold\n\n/);
  assert.equal((await converse(edit('old'), [], { GIT_EDITOR: `printf '# only comments\\n' >` })).result, 'old');

  // An editor that fails, or that removes the file, leaves the prompt as the way to edit.
  assert.equal((await converse(edit('old'), [['New value (blank to keep current): ', 'kept\n']], { GIT_EDITOR: 'rm' })).result, 'kept');
  const failing = { GIT_EDITOR: 'false' };
  const typed = await converse(edit('old'), [['New value (blank to keep current): ', ' typed \n']], failing);
  assert.equal(typed.result, 'typed');
  assert.match(typed.stdout, /Could not use an editor; enter a single-line replacement instead\./);
  assert.equal((await converse(edit('old'), [['New value (blank to keep current): ', '\n']], failing)).result, 'old');

  // Without git on PATH, VISUAL/EDITOR are used directly; with neither, the prompt again.
  const noGit = { PATH: '', GIT_EDITOR: '' };
  assert.equal((await converse(edit('old'), [], { ...noGit, VISUAL: `printf 'from visual\\n' >` })).result, 'from visual');
  assert.equal((await converse(edit('old'), [['New value', null]], { ...noGit, VISUAL: '', EDITOR: '' })).result, 'old');
});

/** A HOME of its own, so a saved setup lands in a temp dir. */
function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'git-wizzard-home-'));
}

/** `runAuthFlow` as `gitwizz auth` runs it, but told it has a terminal (stdin is a pipe here). */
function authFlow(options: string): string {
  return (
    `import { defaultAuthDeps, runAuthFlow } from '${FLOW}';\n` +
    `const deps = defaultAuthDeps();\n` +
    `let result;\n` +
    `try {\n` +
    `  const outcome = await runAuthFlow({ ...deps, env: { ...deps.env, isTty: true } }, ${options});\n` +
    `  result = outcome.ok ? { provider: outcome.value.provider, model: outcome.value.model } : outcome.error.kind + '/' + outcome.error.reason;\n` +
    `} catch (error) { result = error.message; }`
  );
}

const noCredentials: Record<string, string> = { OPENAI_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', ANTHROPIC_API_KEY: '', GIT_WIZZARD_PROVIDER: '' };

test('interactive auth: pick a provider, fix a bad URL, type a masked key, and save the checked setup', async (t) => {
  const server = await fakeHttp(openAiCompatible(['m1'], () => 'ok'));
  t.after(() => server.close());
  const dir = await home();

  const run = await converse(
    authFlow('{ forceInteractive: true }'),
    [
      ['> ', '9\n'],
      ['Invalid selection.\n> ', 'custom\n'],
      ['Server URL, e.g. http://localhost:11434/v1 []: ', 'not a url\n'],
      ['Server URL, e.g. http://localhost:11434/v1 []: ', `${server.url}/v1\n`],
      ['Model []: ', '\n'],
      ['Model []: ', 'm1\n'],
      ['API key (enter for none): ', 'kx\u007Fey\r'],
    ],
    { ...noCredentials, HOME: dir },
  );
  assert.deepEqual(run.result, { provider: 'custom', model: 'm1' });
  // Each character echoes as "*"; backspace erases one with "\b \b".
  assert.match(run.stdout, /API key \(enter for none\): \*\*\x08 \x08\*\*\n/);
  assert.equal(server.requests.at(-1)?.headers.authorization, 'Bearer key');
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.git-wizzard', 'config.json'), 'utf8')), {
    version: 1,
    provider: 'custom',
    apiKey: 'key',
    model: 'm1',
    baseUrl: `${server.url}/v1`,
  });
});

test('interactive auth: a rejected key is asked for again, up to three times', async (t) => {
  const server = await fakeHttp((): FakeReply => ({ status: 401, body: { error: { message: 'bad key' } } }));
  t.after(() => server.close());

  const run = await converse(
    authFlow('{ forceInteractive: true }'),
    [
      ['> ', '1\n'],
      ['Model [gpt-5.4-mini]: ', '\n'],
      ['API key: ', 'one\n'],
      ['API key (try again): ', 'two\n'],
      ['API key (try again): ', 'three\n'],
    ],
    { ...noCredentials, HOME: await home(), OPENAI_BASE_URL: `${server.url}/v1` },
  );
  assert.equal(run.result, 'AuthError/invalid_api_key');
  assert.equal(server.requests.length, 3);
});

test('interactive auth: --no-validate saves without a check, and Ctrl-C at the key cancels', async () => {
  const dir = await home();
  const saved = await converse(
    authFlow('{ forceInteractive: true, validate: false }'),
    [
      ['> ', 'gemini\n'],
      ['Model [gemini-3.6-flash]: ', '\n'],
      ['API key: ', 'g-key\u0004'],
    ],
    { ...noCredentials, HOME: dir },
  );
  assert.deepEqual(saved.result, { provider: 'gemini', model: 'gemini-3.6-flash' });
  assert.match(await readFile(join(dir, '.git-wizzard', 'config.json'), 'utf8'), /"apiKey": "g-key"/);

  const cancelled = await converse(
    authFlow('{ forceInteractive: true }'),
    [
      ['> ', '2\n'],
      ['Model [gemini-3.6-flash]: ', '\n'],
      ['API key: ', 'abc\u0003'],
    ],
    { ...noCredentials, HOME: await home() },
  );
  assert.equal(cancelled.result, 'Input cancelled');
});
