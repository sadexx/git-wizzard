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
} from '@/errors.js';

test('factory omits cause when not supplied', () => {
  const e = authError('invalid_api_key', 'bad key');
  assert.equal(e.kind, 'AuthError');
  assert.equal(e.reason, 'invalid_api_key');
  assert.equal('cause' in e, false);
});

test('factory attaches cause when supplied', () => {
  const cause = new Error('io');
  const e = authError('config_read_failed', 'read failed', cause);
  assert.equal(e.cause, cause);
});

test('validationError normalizes zod issues to path/message', () => {
  const schema = z.object({ n: z.number() }).strict();
  const parsed = schema.safeParse({ n: 'no' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const e = validationError(parsed.error);
    assert.equal(e.kind, 'ValidationError');
    assert.equal(e.issues.length, 1);
    assert.equal(e.issues[0]?.path, 'n');
  }
});

test('parseWithSchema returns ok on valid input', () => {
  const schema = z.object({ n: z.number() });
  const r = parseWithSchema(schema, { n: 1 });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { n: 1 });
});

test('parseWithSchema returns ValidationError on invalid input', () => {
  const schema = z.object({ n: z.number() });
  const r = parseWithSchema(schema, { n: 'x' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'ValidationError');
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
