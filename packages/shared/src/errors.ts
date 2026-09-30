import { z } from 'zod';
import { type Result, ok, err } from '#result.js';

export interface AuthError {
  readonly kind: 'AuthError';
  readonly reason: AuthErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export const authErrorReasonSchema = z.enum([
  'missing_credentials',
  'no_terminal',
  'invalid_api_key',
  'unsupported_provider',
  'config_read_failed',
  'config_write_failed',
]);
export type AuthErrorReason = z.infer<typeof authErrorReasonSchema>;

export interface GitError {
  readonly kind: 'GitError';
  readonly reason: GitErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export const gitErrorReasonSchema = z.enum([
  'not_a_repository',
  'command_failed',
  'parse_failed',
  'nothing_to_commit',
  'no_changes',
  'merge_conflict',
  'base_not_found',
  'no_commits',
  'no_remote',
  'push_rejected',
]);
export type GitErrorReason = z.infer<typeof gitErrorReasonSchema>;

export interface ProviderError {
  readonly kind: 'ProviderError';
  readonly reason: ProviderErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}

export const providerErrorReasonSchema = z.enum([
  'unauthorized',
  'rate_limited',
  'request_failed',
  'empty_completion',
  'invalid_response',
]);
export type ProviderErrorReason = z.infer<typeof providerErrorReasonSchema>;

export interface ValidationError {
  readonly kind: 'ValidationError';
  readonly message: string;
  readonly issues: readonly ValidationIssue[];
  readonly cause?: unknown;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

const APP_ERROR_KINDS: readonly AppError['kind'][] = ['AuthError', 'GitError', 'ProviderError', 'ValidationError'];
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
  const issues: readonly ValidationIssue[] = error.issues.map((issue: z.core.$ZodIssue) => ({
    path: issue.path.map((seg: PropertyKey) => (typeof seg === 'symbol' ? (seg.description ?? '') : String(seg))).join('.'),
    message: issue.message,
  }));
  return { kind: 'ValidationError', message, issues, cause: error };
}

/** Parse `data` against `schema`, converting a Zod failure into a ValidationError. */
export function parseWithSchema<S extends z.ZodType>(schema: S, data: unknown): Result<z.infer<S>, ValidationError> {
  const parsed = schema.safeParse(data);
  return parsed.success ? ok(parsed.data) : err(validationError(parsed.error));
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { kind } = value as { readonly kind?: unknown };
  return typeof kind === 'string' && APP_ERROR_KINDS.includes(kind as AppError['kind']);
}

/** The underlying cause as human-readable text (e.g. git stderr, an SDK message), if it has any. */
export function causeMessage(cause: unknown): string | undefined {
  const text = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return text.trim() === '' ? undefined : text.trim();
}

const wireCauseSchema = z.string().optional();
const wireErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('AuthError'), reason: authErrorReasonSchema, message: z.string(), cause: wireCauseSchema }),
  z.object({ kind: z.literal('GitError'), reason: gitErrorReasonSchema, message: z.string(), cause: wireCauseSchema }),
  z.object({
    kind: z.literal('ProviderError'),
    reason: providerErrorReasonSchema,
    message: z.string(),
    cause: wireCauseSchema,
  }),
  z.object({
    kind: z.literal('ValidationError'),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
]);

/**
 * JSON-safe form of an AppError for crossing the client/server process boundary.
 * `cause` is reduced to its message text; a ValidationError's issues already carry the detail.
 */
export function toWireError(error: AppError): AppError {
  switch (error.kind) {
    case 'AuthError':
      return authError(error.reason, error.message, causeMessage(error.cause));
    case 'GitError':
      return gitError(error.reason, error.message, causeMessage(error.cause));
    case 'ProviderError':
      return providerError(error.reason, error.message, causeMessage(error.cause));
    case 'ValidationError':
      return { kind: error.kind, message: error.message, issues: error.issues };
  }
}

/** Decode a wire error produced by `toWireError`; undefined when `value` is not one. */
export function fromWireError(value: unknown): AppError | undefined {
  const parsed = wireErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
      const detail = error.issues.map((issue: ValidationIssue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ');
      return `Validation error: ${error.message}${detail ? ` [${detail}]` : ''}`;
  }
}
