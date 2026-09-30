import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeHttp, openAiCompatible, type FakeReply, type FakeServer } from '#testing/fake-http.js';
import { eventually, isolateHome, KEY, renderUi, type Rendered } from '#testing/ui.js';
import { Auth } from '#ui/screens/Auth.js';

async function serve(t: TestContext, handle: Parameters<typeof fakeHttp>[0]): Promise<FakeServer> {
  const server = await fakeHttp(handle);
  t.after(() => server.close());
  return server;
}

function saved(home: string): unknown {
  return JSON.parse(readFileSync(join(home, '.git-wizzard', 'config.json'), 'utf8'));
}

function save(home: string, config: object): void {
  mkdirSync(join(home, '.git-wizzard'), { recursive: true });
  writeFileSync(join(home, '.git-wizzard', 'config.json'), JSON.stringify({ version: 1, ...config }));
}

function authScreen(t: TestContext): { app: Rendered; backs: () => number } {
  let backs = 0;
  return { app: renderUi(t, <Auth onBack={() => (backs += 1)} />), backs: () => backs };
}

test('Auth: set up a custom server, fixing the URL, and pick a model from its list', async (t) => {
  const home = isolateHome(t);
  const server = await serve(t, openAiCompatible(['m1', 'm2'], () => 'ok'));
  const { app } = authScreen(t);
  await app.waitFor('Not set up. Commit, branch, and pull request need a provider.');

  await app.press('1');
  await app.waitFor('Custom (OpenAI-compatible)');
  await app.press('4');
  await app.waitFor('Server URL of an OpenAI-compatible API');
  await app.type('nope');
  await app.press(KEY.enter);
  await app.waitFor('✗ Enter a full URL, like http://localhost:11434/v1.');
  await app.press(KEY.esc);
  await app.waitFor('Auth · provider');
  await app.press('4');
  await app.waitFor('Server URL of an OpenAI-compatible API');
  await app.type(`${server.url}/v1`);
  await app.press(KEY.enter);
  await app.waitFor(`API key for ${server.url}/v1 (leave empty if it needs none`);
  await app.press(KEY.esc);
  await app.waitFor('Server URL of an OpenAI-compatible API');
  await app.type(`${server.url}/v1`);
  await app.press(KEY.enter);
  await app.waitFor('API key for');
  await app.press(KEY.enter);

  await app.waitFor(`Model for ${server.url}/v1`);
  await app.press(KEY.down, KEY.enter);
  await app.waitFor(`Saved custom (m2) to ${join(home, '.git-wizzard', 'config.json')}.`);
  await app.waitFor('custom · m2 · key (none)');
  await app.waitFor(`server ${server.url}/v1`);
  await app.waitFor('from saved config');
  assert.deepEqual(saved(home), { version: 1, provider: 'custom', apiKey: '', model: 'm2', baseUrl: `${server.url}/v1` });
});

test('Auth: a rejected key offers another key, the URL, going on unchecked, or back', async (t) => {
  const home = isolateHome(t);
  const server = await serve(t, (): FakeReply => ({ status: 401, body: { error: { message: 'no' } } }));
  process.env['OPENAI_BASE_URL'] = `${server.url}/v1`;
  const { app } = authScreen(t);
  await app.waitFor('Set up a provider…');

  await app.press('1');
  await app.waitFor('Auth · provider');
  await app.press('1');
  await app.waitFor('OpenAI API key (checked with the provider');
  await app.press(KEY.enter);
  await app.waitFor('✗ Enter an API key.');
  await app.type('sk-bad');
  await app.waitFor('> ••••••');
  await app.press(KEY.enter);
  await app.waitFor('OpenAI rejected the API key');
  assert.doesNotMatch(app.frame(), /Change the URL/);

  await app.press('1');
  await app.waitFor('OpenAI API key');
  await app.press(KEY.esc);
  await app.waitFor('Auth · provider');
  await app.press(KEY.esc);
  await app.waitFor('Set up a provider…');

  await app.press('1');
  await app.waitFor('Auth · provider');
  await app.press('1');
  await app.waitFor('OpenAI API key');
  await app.type('sk-bad');
  await app.press(KEY.enter);
  await app.waitFor('Continue without checking');
  await app.press('2');
  await app.waitFor('Model for OpenAI');
  await app.waitFor('> gpt-5.4-mini');
  await app.press(KEY.esc);
  await app.waitFor('Set up a provider…');
  assert.throws(() => saved(home));

  await app.press('1');
  await app.waitFor('Auth · provider');
  await app.press('1');
  await app.waitFor('OpenAI API key');
  await app.type('sk-bad');
  await app.press(KEY.enter);
  await app.waitFor('Continue without checking');
  await app.press('2');
  await app.waitFor('> gpt-5.4-mini');
  await app.press(KEY.enter);
  await app.waitFor('Saved openai (gpt-5.4-mini)');
  assert.deepEqual(saved(home), { version: 1, provider: 'openai', apiKey: 'sk-bad', model: 'gpt-5.4-mini' });
});

test('Auth: a custom server that refuses the key can have its URL changed', async (t) => {
  isolateHome(t);
  const server = await serve(t, (): FakeReply => ({ status: 401, body: {} }));
  const { app, backs } = authScreen(t);
  await app.waitFor('Set up a provider…');
  await app.press('1');
  await app.waitFor('Auth · provider');
  await app.press('4');
  await app.waitFor('Server URL');
  await app.type(server.url);
  await app.press(KEY.enter);
  await app.waitFor('API key for');
  await app.type('k');
  await app.press(KEY.enter);
  await app.waitFor(`${server.url} rejected the API key`);
  await app.press('2');
  await app.waitFor('Server URL');
  await app.press(KEY.esc);
  await app.waitFor('Auth · provider');
  await app.press('3');
  await app.waitFor('Anthropic Claude API key');
  await app.press(KEY.esc);
  await app.waitFor('Auth · provider');
  await app.press(KEY.esc);
  await app.waitFor('Set up a provider…');
  await app.press('2');
  await eventually(() => backs() === 1, 'Back');
});

test('Auth: change the model of a saved setup, from the list or typed when the list fails', async (t) => {
  const home = isolateHome(t);
  const server = await serve(t, openAiCompatible(['m1', 'm2'], () => 'ok'));
  save(home, { provider: 'custom', apiKey: 'secret-key-1234', model: 'm1', baseUrl: `${server.url}/v1` });
  const { app } = authScreen(t);
  await app.waitFor('custom · m1 · key …1234');

  await app.press('1');
  await app.waitFor('❯ m1 · current');
  await app.press(KEY.down, KEY.enter);
  await app.waitFor('Saved custom (m2)');
  await app.waitFor('custom · m2');

  await server.close();
  await app.press('1');
  await app.waitFor("Couldn't list models; type the name.");
  await app.waitFor('> m2');
  await app.press('\u0015');
  await app.type('m3');
  await app.press(KEY.enter);
  await app.waitFor('Saved custom (m3)');
  assert.deepEqual(saved(home), { version: 1, provider: 'custom', apiKey: 'secret-key-1234', model: 'm3', baseUrl: `${server.url}/v1` });
});

test('Auth: log out removes the saved setup; a setup already gone says so', async (t) => {
  const home = isolateHome(t);
  save(home, { provider: 'gemini', apiKey: 'short', model: 'gemini-x' });
  const { app } = authScreen(t);
  await app.waitFor('gemini · gemini-x · key (set)');

  await app.press('3');
  await app.waitFor('✓ Removed saved credentials.');
  await app.waitFor('Not set up.');

  save(home, { provider: 'gemini', apiKey: 'short', model: 'gemini-x' });
  const second = renderUi(t, <Auth onBack={() => undefined} />);
  await second.waitFor('Log out');
  rmSync(join(home, '.git-wizzard', 'config.json'));
  await second.press('3');
  await second.waitFor('No saved credentials to remove.');
});

test('Auth: environment credentials are shown as such and win over a saved setup', async (t) => {
  const home = isolateHome(t);
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-environment';
  const { app } = authScreen(t);
  await app.waitFor('anthropic · claude-opus-5-5 · key …ment');
  await app.waitFor('from environment variables');
  await app.waitFor('A setup saved here is used only when those variables are unset.');
  await app.waitFor('1. Set up a different provider…');

  save(home, { provider: 'gemini', apiKey: 'short', model: 'gemini-x' });
  const second = renderUi(t, <Auth onBack={() => undefined} />);
  await second.waitFor('The saved config is ignored while environment credentials are set.');
  await second.waitFor('2. Log out');
  assert.doesNotMatch(second.frame(), /Change model/);
});

test('Auth: a broken config file is shown with a way out, and a failed save is reported', async (t) => {
  const home = isolateHome(t);
  mkdirSync(join(home, '.git-wizzard'));
  writeFileSync(join(home, '.git-wizzard', 'config.json'), '{ nope');
  const { app } = authScreen(t);
  await app.waitFor('Config file is not valid JSON');
  await app.waitFor('hint: Fix or delete');
  await app.press('2');
  await app.waitFor('✓ Removed saved credentials.');

  // A file where the config directory should be: saving must fail, and say so.
  rmSync(join(home, '.git-wizzard'), { recursive: true });
  writeFileSync(join(home, '.git-wizzard'), 'in the way');
  const second = renderUi(t, <Auth onBack={() => undefined} />);
  await second.waitFor('Set up a provider…');
  await second.press('1');
  await second.waitFor('Auth · provider');
  await second.press('2');
  await second.waitFor('Google Gemini API key');
  await second.type('g-key');
  await second.press(KEY.enter);
  await second.waitFor('Continue without checking');
  await second.press('2');
  await second.waitFor('> gemini-3.6-flash');
  await second.press(KEY.enter);
  await second.waitFor('✗ Failed to write');
});
