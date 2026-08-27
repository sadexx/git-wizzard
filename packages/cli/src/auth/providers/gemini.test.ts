import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeminiResponse, toGeminiInput } from '@/auth/providers/gemini.js';

test('toGeminiInput separates system instruction and maps assistant to model', () => {
  const out = toGeminiInput([
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'yo' },
  ]);
  assert.deepEqual(out, {
    systemInstruction: 'be terse',
    contents: [
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'yo' }] },
    ],
  });
});

test('toGeminiInput omits system instruction when none present', () => {
  const out = toGeminiInput([{ role: 'user', content: 'hi' }]);
  assert.equal(out.systemInstruction, undefined);
});

test('normalizeGeminiResponse uses aggregated text and maps MAX_TOKENS to length', () => {
  const result = normalizeGeminiResponse(
    { text: 'done', modelVersion: 'gemini-3.6-flash', candidates: [{ finishReason: 'MAX_TOKENS' }] },
    'fb',
  );
  assert.deepEqual(result, { ok: true, value: { text: 'done', model: 'gemini-3.6-flash', finishReason: 'length' } });
});

test('normalizeGeminiResponse falls back to candidate parts and safety maps to content_filter', () => {
  const result = normalizeGeminiResponse(
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'a' }, { text: 'b' }] } }] },
    'fb',
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { text: 'ab', model: 'fb', finishReason: 'content_filter' });
});

test('normalizeGeminiResponse errors when no text is produced', () => {
  const result = normalizeGeminiResponse({ candidates: [{ finishReason: 'STOP' }] }, 'fb');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'empty_completion');
});
