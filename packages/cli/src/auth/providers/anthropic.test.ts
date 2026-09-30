import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeAnthropicResponse } from '#auth/providers/anthropic.js';

type Reply = Parameters<typeof normalizeAnthropicResponse>[0];

const reply = (content: unknown[], stop_reason: Reply['stop_reason'], stop_details: unknown = null): Reply => ({
  model: 'claude-opus-5-5',
  stop_reason,
  stop_details: stop_details as Anthropic.Beta.BetaMessage['stop_details'],
  content: content as Anthropic.Beta.BetaContentBlock[],
});

test('normalizeAnthropicResponse joins text blocks, skipping thinking, and maps stop reasons', () => {
  const thinking = { type: 'thinking', thinking: '', signature: 's' };
  const text = { type: 'text', text: 'feat: add x', citations: null };
  assert.deepEqual(normalizeAnthropicResponse(reply([thinking, text], 'end_turn')), {
    ok: true,
    value: { text: 'feat: add x', model: 'claude-opus-5-5', finishReason: 'stop' },
  });
  const finish = (reason: Reply['stop_reason']): unknown => {
    const result = normalizeAnthropicResponse(reply([text], reason));
    return result.ok && result.value.finishReason;
  };
  assert.equal(finish('max_tokens'), 'length');
  assert.equal(finish('model_context_window_exceeded'), 'length');
  assert.equal(finish('stop_sequence'), 'stop');
  assert.equal(finish('pause_turn'), 'other');
});

test('normalizeAnthropicResponse turns a refusal or a text-less reply into an error', () => {
  const refused = normalizeAnthropicResponse(reply([], 'refusal', { type: 'refusal', category: 'cyber', explanation: null }));
  assert.equal(!refused.ok && refused.error.message, 'Claude declined the request (cyber)');
  const empty = normalizeAnthropicResponse(reply([{ type: 'thinking', thinking: '', signature: 's' }], 'end_turn'));
  assert.equal(!empty.ok && empty.error.kind === 'ProviderError' && empty.error.reason, 'empty_completion');
});
