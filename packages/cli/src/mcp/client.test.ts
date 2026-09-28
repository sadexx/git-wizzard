import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitError, toWireError, TOOL_ERROR_META_KEY } from '@git-assistant/shared';
import { toolCallError } from '#mcp/client.js';

test('toolCallError decodes the typed error from _meta', () => {
  const error = toolCallError('create_commit', {
    content: [{ type: 'text', text: 'Git error (nothing_to_commit): No staged changes' }],
    isError: true,
    _meta: { [TOOL_ERROR_META_KEY]: toWireError(gitError('nothing_to_commit', 'No staged changes')) },
  });
  assert.deepEqual(error, { kind: 'GitError', reason: 'nothing_to_commit', message: 'No staged changes' });
});

test('toolCallError falls back to the text content for foreign errors', () => {
  const error = toolCallError('get_status', { content: [{ type: 'text', text: 'something broke' }], isError: true });
  assert.deepEqual(error, { kind: 'ProviderError', reason: 'request_failed', message: 'something broke' });
});

test('toolCallError names the tool when there is no text', () => {
  const error = toolCallError('get_status', { content: [], isError: true });
  assert.equal(error.message, 'Tool get_status returned an error');
});
