import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpError, type CreateMessageRequest } from '@modelcontextprotocol/sdk/types.js';
import { authError, err, ok, providerError } from '@git-assistant/shared';
import type { ProviderAdapter } from '#auth/provider-adapter.js';
import {
  createSamplingHandler,
  toCompletionRequest,
  toCreateMessageResult,
  type AdapterResolver,
} from '#mcp/sampling.js';

function params(overrides: Record<string, unknown> = {}): CreateMessageRequest['params'] {
  return {
    messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
    maxTokens: 100,
    ...overrides,
  } as CreateMessageRequest['params'];
}

function adapter(complete: ProviderAdapter['complete']): AdapterResolver {
  return async () => ok({ provider: 'openai', model: 'm', validateKey: async () => ok(undefined), complete });
}

test('toCompletionRequest prepends systemPrompt and maps assitant role', () => {
  const result = toCompletionRequest(
    params({
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: { type: 'text', text: 'q' } },
        { role: 'assistant', content: { type: 'text', text: 'a' } },
      ],
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.messages, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
  }
});

test('toCompletionRequest passes through maxTokens and temperature', () => {
  const result = toCompletionRequest(params({ maxTokens: 200, temperature: 0.5 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.maxTokens, 200);
    assert.equal(result.value.temperature, 0.5);
  }
});

test('toCompletionRequest rejects non-text content', () => {
  const result = toCompletionRequest(
    params({ messages: [{ role: 'user', content: { type: 'image', data: 'x', mimeType: 'image/png' } }] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'invalid_response');
});

test('toCreateMessageResult maps finishReason to stopReason', () => {
  assert.deepEqual(toCreateMessageResult({ text: 'done', model: 'm', finishReason: 'length' }), {
    role: 'assistant',
    content: { type: 'text', text: 'done' },
    model: 'm',
    stopReason: 'maxTokens',
  });
});

test('sampling handler returns a result on success', async () => {
  const handler = createSamplingHandler(adapter(async () => ok({ text: 'x', model: 'm', finishReason: 'stop' })));
  const result = await handler({ params: params() } as CreateMessageRequest);
  assert.equal(result.content.type, 'text');
  if (result.content.type === 'text') assert.equal(result.content.text, 'x');
  assert.equal(result.stopReason, 'endTurn');
});

test('sampling handler throws an McpError carrying the typed adapter error', async () => {
  const handler = createSamplingHandler(
    adapter(async () => err(providerError('unauthorized', 'rejected', new Error('401 bad key')))),
  );
  await assert.rejects(
    () => handler({ params: params() } as CreateMessageRequest),
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.deepEqual(error.data, {
        kind: 'ProviderError',
        reason: 'unauthorized',
        message: 'rejected',
        cause: '401 bad key',
      });
      return true;
    },
  );
});

test('sampling handler resolves credentials per request and reports when they are missing', async () => {
  let resolved: number = 0;
  const handler = createSamplingHandler(async () => {
    resolved += 1;
    return err(authError('missing_credentials', 'none configured'));
  });
  assert.equal(resolved, 0);
  await assert.rejects(
    () => handler({ params: params() } as CreateMessageRequest),
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.deepEqual(error.data, { kind: 'AuthError', reason: 'missing_credentials', message: 'none configured' });
      return true;
    },
  );
  assert.equal(resolved, 1);
});
