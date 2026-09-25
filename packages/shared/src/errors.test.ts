import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  authError,
  formatError,
  gitError,
  isAppError,
  parseWithSchema,
  providerError,
  validationError,
} from '#errors.js';

test('factory omits cause when not supplied', () => {
  const error = authError('invalid_api_key', 'bad key');
  assert.equal(error.kind, 'AuthError');
  assert.equal(error.reason, 'invalid_api_key');
  assert.equal('cause' in error, false);
});

test('factory attaches cause when supplied', () => {
  const cause = new Error('io');
  const error = authError('config_read_failed', 'read failed', cause);
  assert.equal(error.cause, cause);
});

test('validationError normalizes zod issues to path/message', () => {
  const schema = z.object({ n: z.number() }).strict();
  const parsed = schema.safeParse({ n: 'no' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const error = validationError(parsed.error);
    assert.equal(error.kind, 'ValidationError');
    assert.equal(error.issues.length, 1);
    const [firstIssue] = error.issues;
    assert.equal(firstIssue?.path, 'n');
  }
});

test('parseWithSchema returns ok on valid input', () => {
  const schema = z.object({ n: z.number() });
  const result = parseWithSchema(schema, { n: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { n: 1 });
});

test('parseWithSchema returns ValidationError on invalid input', () => {
  const schema = z.object({ n: z.number() });
  const result = parseWithSchema(schema, { n: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ValidationError');
});

test('isAppError guards union membership', () => {
  assert.equal(isAppError(gitError('command_failed', 'boom')), true);
  assert.equal(isAppError(providerError('rate_limited', 'slow')), true);
  assert.equal(isAppError({ kind: 'Nope' }), false);
  assert.equal(isAppError(null), false);
});

test('formatError renders each variant', () => {
  assert.match(formatError(gitError('not_a_repository', 'no repo')), /^Git error \(not_a_repository\): no repo$/);
  assert.match(formatError(providerError('unauthorized', 'nope')), /^Provider error \(unauthorized\): nope$/);
  assert.match(
    formatError(authError('invalid_api_key', 'bad key')),
    /^Authentication error \(invalid_api_key\): bad key$/,
  );

  const parsed = z.object({ n: z.number() }).strict().safeParse({ n: 'x' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const rendered = formatError(validationError(parsed.error));
    assert.match(rendered, /^Validation error: Validation failed \[n: /);
  }
});
