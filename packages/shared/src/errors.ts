import { z } from 'zod';
import { type Result, ok, err } from '@/result.js';

export type AuthErrorReason =
  'missing_credentials' | 'invalid_api_key' | 'unsupported_provider' | 'config_read_failed' | 'config_write_failed';

export type GitErrorReason =
  'not_a_repository' | 'command_failed' | 'parse_failed' | 'nothing_to_commit' | 'merge_conflict';

export type ProviderErrorReason =
  'unauthorized' | 'rate_limited' | 'request_failed' | 'empty_completion' | 'invalid_response';

export interface AuthError {
  readonly kind: 'AuthError';
  readonly reason: AuthErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export interface GitError {
  readonly kind: 'GitError';
  readonly reason: GitErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ProviderError {
  readonly kind: 'ProviderError';
  readonly reason: ProviderErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationError {
  readonly kind: 'ValidationError';
  readonly message: string;
  readonly issues: readonly ValidationIssue[];
  readonly cause?: unknown;
}

export type AppError = AuthError | GitError | ProviderError | ValidationError;

// `cause` is conditionally spread rather than always assigned: exactOptionalPropertyTypes
// forbids assigning `undefined` to an optional property, so an absent cause must be ommited.
export function authError(reason: AuthErrorReason, message: string, cause?: unknown): AuthError {
  return cause === undefined ? { kind: 'AuthError', reason, message } : { kind: 'AuthError', reason, message, cause };
}

export function gitError(reason: GitErrorReason, message: string, cause?: unknown): GitError {
  return cause === undefined ? { kind: 'GitError', reason, message } : { kind: 'GitError', reason, message, cause };
}

export function providerError(reason: ProviderErrorReason, message: string, cause?: unknown): ProviderError {
  return cause === undefined
    ? { kind: 'ProviderError', reason, message }
    : { kind: 'ProviderError', reason, message, cause };
}

export function validationError(error: z.ZodError, message = 'Validation failed'): ValidationError {
  const issues: readonly ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.map((seg) => (typeof seg === 'symbol' ? (seg.description ?? '') : String(seg))).join('.'),
    message: issue.message,
  }));
  return { kind: 'ValidationError', message, issues, cause: error };
}

/** Parse `data` against `schema`, converting a Zod failure into a ValidationError. */
export function parseWithSchema<S extends z.ZodType>(schema: S, data: unknown): Result<z.infer<S>, ValidationError> {
  const parsed = schema.safeParse(data);
  return parsed.success ? ok(parsed.data) : err(validationError(parsed.error));
}

const APP_ERROR_KINDS: readonly AppError['kind'][] = ['AuthError', 'GitError', 'ProviderError', 'ValidationError'];

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { kind } = value as { readonly kind?: unknown };
  return typeof kind === 'string' && APP_ERROR_KINDS.includes(kind as AppError['kind']);
}

/** Single-line, user-facing rendering. Exhaustive over the union - no default arm. */
export function formatError(error: AppError): string {
  switch (error.kind) {
    case 'AuthError':
      return `Authentication error (${error.reason}): ${error.message}`;
    case 'GitError':
      return `Git error (${error.reason}): ${error.message}`;
    case 'ProviderError':
      return `Provider error (${error.reason}): ${error.message}`;
    case 'ValidationError':
      const detail = error.issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ');
      return `Validation error: ${error.message}${detail ? ` [${detail}]` : ''}`;
  }
}
