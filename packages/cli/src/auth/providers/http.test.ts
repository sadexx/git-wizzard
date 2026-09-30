import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AppError, CompletionRequest, Result } from '@git-wizzard/shared';
import { fakeHttp, openAiCompatible, type FakeReply, type FakeRequest, type FakeServer } from '#testing/fake-http.js';
import { AnthropicAdapter } from '#auth/providers/anthropic.js';
import { GeminiAdapter } from '#auth/providers/gemini.js';
import { OpenAiAdapter } from '#auth/providers/openai.js';

// Each adapter against a local server speaking its provider's API: requests out, responses and errors in.

const REQUEST: CompletionRequest = {
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'again' },
  ],
  maxTokens: 400,
  temperature: 0.2,
};

async function serve(t: TestContext, handle: (request: FakeRequest) => FakeReply): Promise<FakeServer> {
  const server = await fakeHttp(handle);
  t.after(() => server.close());
  return server;
}

/** "Kind/reason" of a failed result, for compact assertions. */
function failure(result: Result<unknown, AppError>): string {
  return result.ok ? 'ok' : `${result.error.kind}/${'reason' in result.error ? result.error.reason : ''}`;
}

const failing = (status: number) => (): FakeReply => ({ status, body: { error: { message: `status ${status}` } } });

test('OpenAI lists models, validates the key, and sends a chat with a token cap', async (t) => {
  const server = await serve(t, openAiCompatible(['gpt-b', 'gpt-a'], (system: string) => `reply to ${system}`));
  process.env['OPENAI_BASE_URL'] = `${server.url}/v1`;
  t.after(() => delete process.env['OPENAI_BASE_URL']);
  const adapter = new OpenAiAdapter({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-a' });

  assert.deepEqual(await adapter.listModels(), { ok: true, value: ['gpt-a', 'gpt-b'] });
  assert.deepEqual(await adapter.validateKey(), { ok: true, value: undefined });
  assert.deepEqual(await adapter.complete(REQUEST), { ok: true, value: { text: 'reply to be brief', model: 'gpt-a', finishReason: 'stop' } });
  const chat = server.requests.at(-1);
  assert.equal(chat?.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(chat?.body, {
    model: 'gpt-a',
    messages: REQUEST.messages,
    max_completion_tokens: 400,
    temperature: 0.2,
  });
});

test('a custom server gets a placeholder key and no token cap', async (t) => {
  const server = await serve(t, openAiCompatible([], () => 'ok'));
  const adapter = new OpenAiAdapter({ provider: 'custom', apiKey: '', model: 'llama', baseUrl: `${server.url}/v1` });
  assert.equal(adapter.provider, 'custom');

  assert.equal((await adapter.complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })).ok, true);
  const chat = server.requests.at(-1);
  assert.equal(chat?.headers.authorization, 'Bearer none');
  assert.deepEqual(chat?.body, { model: 'llama', messages: [{ role: 'user', content: 'x' }] });
});

test('OpenAI-compatible errors: a bad key, a rate limit, a failure, and an unreachable server', async (t) => {
  for (const [status, validate, complete] of [
    [401, 'AuthError/invalid_api_key', 'ProviderError/unauthorized'],
    [429, 'ProviderError/rate_limited', 'ProviderError/rate_limited'],
    [500, 'ProviderError/request_failed', 'ProviderError/request_failed'],
  ] as const) {
    const server = await serve(t, failing(status));
    const adapter = new OpenAiAdapter({ provider: 'custom', apiKey: 'k', model: 'm', baseUrl: server.url });
    assert.equal(failure(await adapter.validateKey()), validate, `validate on ${status}`);
    assert.equal(failure(await adapter.complete(REQUEST)), complete, `complete on ${status}`);
  }

  const closed = await fakeHttp(failing(500));
  await closed.close();
  const adapter = new OpenAiAdapter({ provider: 'custom', apiKey: 'k', model: 'm', baseUrl: closed.url });
  const unreachable = await adapter.listModels();
  assert.equal(!unreachable.ok && unreachable.error.message, `Could not reach ${closed.url}`);
});

function anthropicMessage(model: string, text: string): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

test('Anthropic lists models, validates the key, and sends system apart with fallback on models that have it', async (t) => {
  const server = await serve(t, (request: FakeRequest) =>
    request.method === 'GET'
      ? {
          body: {
            data: ['claude-b', 'claude-a'].map((id: string) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })),
            has_more: false,
            first_id: 'claude-b',
            last_id: 'claude-a',
          },
        }
      : { body: anthropicMessage((request.body as { model: string }).model, 'hi there') },
  );
  process.env['ANTHROPIC_BASE_URL'] = server.url;
  t.after(() => delete process.env['ANTHROPIC_BASE_URL']);

  const opus = new AnthropicAdapter({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-opus-5-5' });
  assert.deepEqual(await opus.listModels(), { ok: true, value: ['claude-a', 'claude-b'] });
  assert.deepEqual(await opus.validateKey(), { ok: true, value: undefined });
  assert.deepEqual(await opus.complete(REQUEST), { ok: true, value: { text: 'hi there', model: 'claude-opus-5-5', finishReason: 'stop' } });
  assert.deepEqual(server.requests.at(-1)?.body, {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    system: 'be brief',
    messages: REQUEST.messages.slice(1),
    fallbacks: 'default',
  });
  assert.match(String(server.requests.at(-1)?.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);

  const other = new AnthropicAdapter({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-haiku-4-5' });
  assert.equal((await other.complete({ messages: [{ role: 'user', content: 'x' }] })).ok, true);
  assert.deepEqual(server.requests.at(-1)?.body, { model: 'claude-haiku-4-5', max_tokens: 16000, messages: [{ role: 'user', content: 'x' }] });
});

test('Anthropic errors: a bad key, a rate limit, and a failure', async (t) => {
  for (const [status, validate, complete] of [
    [401, 'AuthError/invalid_api_key', 'ProviderError/unauthorized'],
    [429, 'ProviderError/rate_limited', 'ProviderError/rate_limited'],
    [500, 'ProviderError/request_failed', 'ProviderError/request_failed'],
  ] as const) {
    const server = await serve(t, failing(status));
    process.env['ANTHROPIC_BASE_URL'] = server.url;
    const adapter = new AnthropicAdapter({ provider: 'anthropic', apiKey: 'k', model: 'claude-x' });
    assert.equal(failure(await adapter.validateKey()), validate, `validate on ${status}`);
    assert.equal(failure(await adapter.listModels()), validate, `list on ${status}`);
    assert.equal(failure(await adapter.complete(REQUEST)), complete, `complete on ${status}`);
  }
  delete process.env['ANTHROPIC_BASE_URL'];
});

test('Gemini lists only text models, validates the key, and sends a system instruction and config', async (t) => {
  const server = await serve(t, (request: FakeRequest) =>
    request.method === 'GET'
      ? {
          body: {
            models: [
              { name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/embedder', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-a', supportedGenerationMethods: ['countTokens', 'generateContent'] },
            ],
          },
        }
      : { body: { candidates: [{ content: { role: 'model', parts: [{ text: 'hola' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-a-001' } },
  );
  process.env['GOOGLE_GEMINI_BASE_URL'] = server.url;
  t.after(() => delete process.env['GOOGLE_GEMINI_BASE_URL']);
  const adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'g-key', model: 'gemini-a' });

  assert.deepEqual(await adapter.listModels(), { ok: true, value: ['gemini-a', 'gemini-b'] });
  assert.deepEqual(await adapter.validateKey(), { ok: true, value: undefined });
  assert.deepEqual(await adapter.complete(REQUEST), { ok: true, value: { text: 'hola', model: 'gemini-a-001', finishReason: 'stop' } });
  const sent = server.requests.at(-1);
  assert.match(sent?.path ?? '', /\/models\/gemini-a:generateContent/);
  assert.deepEqual(sent?.body, {
    contents: [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi' }] },
      { role: 'user', parts: [{ text: 'again' }] },
    ],
    systemInstruction: { parts: [{ text: 'be brief' }], role: 'user' },
    generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
  });

  assert.equal((await adapter.complete({ messages: [{ role: 'user', content: 'x' }] })).ok, true);
  assert.deepEqual(server.requests.at(-1)?.body, { contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: {} });
});

test('Gemini errors: a rejected key, a rate limit, and a failure', async (t) => {
  for (const [status, validate, complete] of [
    [403, 'AuthError/invalid_api_key', 'ProviderError/unauthorized'],
    [429, 'ProviderError/rate_limited', 'ProviderError/rate_limited'],
    [500, 'ProviderError/request_failed', 'ProviderError/request_failed'],
  ] as const) {
    const server = await serve(t, failing(status));
    process.env['GOOGLE_GEMINI_BASE_URL'] = server.url;
    const adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'k', model: 'gemini-x' });
    assert.equal(failure(await adapter.validateKey()), validate, `validate on ${status}`);
    assert.equal(failure(await adapter.listModels()), validate, `list on ${status}`);
    assert.equal(failure(await adapter.complete(REQUEST)), complete, `complete on ${status}`);
  }
  delete process.env['GOOGLE_GEMINI_BASE_URL'];
});
