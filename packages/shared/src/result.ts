/**
 * Result<T, E> - explicit success/failure channel for expected failures.
 * Reserve `throw` for truly exceptional (unrecoverable/programmer-error) paths.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function match<T, E, A, B>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T) => A; readonly err: (error: E) => B },
): A | B {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

/**
 * Wrap a promise-returning fn, mapping any thrown value into a typed error.
 * The single boundary where `throw` from I/O (git, provider SDKs) is converted
 * into the Result channel used everywhere else.
 */
export async function tryCatchAsync<T, E>(fn: () => Promise<T>, onError: (cause: unknown) => E): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onError(cause));
  }
}
