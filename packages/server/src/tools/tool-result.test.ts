import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { gitError, providerError, toWireError, TOOL_ERROR_META_KEY } from '@git-wizzard/shared';
import { samplingError, toolErr } from '#tools/tool-result.js';

test('toolErr carries the typed error in _meta alongside readable text', () => {
  const result = toolErr(gitError('nothing_to_commit', 'No staged changes'));
  assert.equal(result.isError, true);
  assert.deepEqual(result._meta?.[TOOL_ERROR_META_KEY], {
    kind: 'GitError',
    reason: 'nothing_to_commit',
    message: 'No staged changes',
  });
  assert.deepEqual(result.content, [{ type: 'text', text: 'Git error (nothing_to_commit): No staged changes' }]);
});

test('samplingError recovers the typed error attached by the client', () => {
  const original = providerError('unauthorized', 'OpenAI rejected the API key', new Error('401 Incorrect API key'));
  const cause = new McpError(ErrorCode.InternalError, 'ignored', toWireError(original));
  assert.deepEqual(samplingError(cause), {
    kind: 'ProviderError',
    reason: 'unauthorized',
    message: 'OpenAI rejected the API key',
    cause: '401 Incorrect API key',
  });
});

test('samplingError falls back to a generic provider error', () => {
  const cause = new Error('connection closed');
  assert.deepEqual(samplingError(cause), providerError('request_failed', 'Sampling request failed', cause));
});
