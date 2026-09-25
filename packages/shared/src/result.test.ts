import { test } from 'node:test';
import assert from 'node:assert/strict';
import { andThen, err, isErr, isOk, map, mapErr, match, ok, tryCatchAsync, unwrapOr, type Result } from '#result.js';

test('ok/err construct discriminated results', () => {
  assert.deepEqual(ok(1), { ok: true, value: 1 });
  assert.deepEqual(err('e'), { ok: false, error: 'e' });
});

test('isOk/isErr reflect the discriminant', () => {
  const good: Result<number, string> = ok(2);
  const bad: Result<number, string> = err('x');
  assert.equal(isOk(good), true);
  assert.equal(isErr(good), false);
  assert.equal(isOk(bad), false);
  assert.equal(isErr(bad), true);
});

test('map transforms value, passes error through', () => {
  assert.deepEqual(
    map(ok(2), (n) => n + 1),
    ok(3),
  );
  assert.deepEqual(
    map(err<string>('x'), (n: number) => n + 1),
    err('x'),
  );
});

test('mapErr transforms error, passes value through', () => {
  assert.deepEqual(
    mapErr(err('x'), (e) => e.toUpperCase()),
    err('X'),
  );
  assert.deepEqual(
    mapErr(ok(5), (e: string) => e),
    ok(5),
  );
});

test('andThen chains only on success', () => {
  const step = (n: number): Result<number, string> => (n > 0 ? ok(n * 2) : err('neg'));
  assert.deepEqual(andThen(ok(3), step), ok(6));
  assert.deepEqual(andThen(ok(-1), step), err('neg'));
  assert.deepEqual(andThen(err<string>('e'), step), err('e'));
});

test('unwrapOr yields fallback on error', () => {
  assert.equal(unwrapOr(ok(1), 9), 1);
  assert.equal(unwrapOr(err<string>('e'), 9), 9);
});

test('match dispatches on branch', () => {
  assert.equal(match(ok(1), { ok: (v) => `v${v}`, err: (e) => `e${String(e)}` }), 'v1');
  assert.equal(match(err('x'), { ok: (v) => `v${String(v)}`, err: (e) => `e${e}` }), 'ex');
});

test('tryCatchAsync captures resolution and thrown error', async () => {
  const good = await tryCatchAsync(
    async () => 5,
    () => 'err',
  );
  assert.deepEqual(good, ok(5));

  const bad = await tryCatchAsync(
    async () => {
      throw new Error('boom');
    },
    (cause) => (cause as Error).message,
  );
  assert.deepEqual(bad, err('boom'));
});
