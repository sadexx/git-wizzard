import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenAiResponse } from '#auth/providers/openai.js';

test('normalizeOpenAiResponse maps content and finish_reason', () => {
  const result = normalizeOpenAiResponse(
    { model: 'gpt-5.4-mini', choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] },
    'fallback',
  );
  assert.deepEqual(result, { ok: true, value: { text: 'hello', model: 'gpt-5.4-mini', finishReason: 'stop' } });
});

test('normalizeOpenAiResponse accepts a full real-world response, extra fields and all', () => {
  const result = normalizeOpenAiResponse(
    {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'qwen3:8b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'feat: x', refusal: null }, finish_reason: 'stop', logprobs: null }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    'fb',
  );
  assert.deepEqual(result, { ok: true, value: { text: 'feat: x', model: 'qwen3:8b', finishReason: 'stop' } });
});

test('normalizeOpenAiResponse maps unknown finish_reason to other and falls back on model', () => {
  const result = normalizeOpenAiResponse(
    { choices: [{ message: { content: 'x' }, finish_reason: 'tool_calls' }] },
    'fb',
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { text: 'x', model: 'fb', finishReason: 'other' });
});

test('normalizeOpenAiResponse errors on empty content', () => {
  const result = normalizeOpenAiResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }, 'fb');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'empty_completion');
});

test('normalizeOpenAiResponse errors on malformed shape', () => {
  const result = normalizeOpenAiResponse({ choices: [] }, 'fb');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'invalid_response');
});
