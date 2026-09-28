import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  authError,
  causeMessage,
  formatError,
  fromWireError,
  gitError,
  isAppError,
  parseWithSchema,
  providerError,
  toWireError,
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

test('causeMessage extracts trimmed text from errors and strings only', () => {
  assert.equal(causeMessage(new Error('fatal: nope\n')), 'fatal: nope');
  assert.equal(causeMessage('boom'), 'boom');
  assert.equal(causeMessage(new Error('')), undefined);
  assert.equal(causeMessage({ message: 'not an error' }), undefined);
  assert.equal(causeMessage(undefined), undefined);
});

test('wire errors survive a JSON round trip with cause reduced to text', () => {
  const original = gitError('command_failed', 'Failed to create branch x', new Error("fatal: a branch named 'x' already exists"));
  const decoded = fromWireError(JSON.parse(JSON.stringify(toWireError(original))));
  assert.deepEqual(decoded, {
    kind: 'GitError',
    reason: 'command_failed',
    message: 'Failed to create branch x',
    cause: "fatal: a branch named 'x' already exists",
  });
});

test('wire form omits a cause that has no text', () => {
  const wire = toWireError(providerError('rate_limited', 'slow', { status: 429 }));
  assert.equal('cause' in wire, false);
});

test('wire form of a ValidationError keeps issues and drops the zod cause', () => {
  const parsed = z.object({ n: z.number() }).safeParse({ n: 'x' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const wire = toWireError(validationError(parsed.error));
    assert.equal('cause' in wire, false);
    assert.deepEqual(fromWireError(JSON.parse(JSON.stringify(wire))), wire);
  }
});

test('fromWireError rejects values that are not wire errors', () => {
  assert.equal(fromWireError(undefined), undefined);
  assert.equal(fromWireError({ kind: 'GitError', reason: 'bogus', message: 'x' }), undefined);
  assert.equal(fromWireError({ kind: 'Nope', message: 'x' }), undefined);
});
