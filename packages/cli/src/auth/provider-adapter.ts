import type {
  AuthError,
  CompletionRequest,
  CompletionResponse,
  ProviderError,
  ProviderName,
  Result,
  ProviderConfig,
} from '@git-wizzard/shared';

/**
 * Provider-agnostic contract. `validateKey` performs a cheap autheticated call
 * (used by the auth flow); `complete` is the sampling backend.
 * `ProviderConfig` is intentionally not stored here - adapters construct their own client.
 */
export interface ProviderAdapter {
  readonly provider: ProviderName;
  readonly model: string;
  validateKey(): Promise<Result<void, ProviderError | AuthError>>;
  /** Model ids the key can use, sorted; an error when the provider can't list them (the model is then typed). */
  listModels(): Promise<Result<string[], ProviderError | AuthError>>;
  complete(request: CompletionRequest): Promise<Result<CompletionResponse, ProviderError>>;
}

/** Extract an HTTP status from an SDK error, if present. Both provider SDKs expose `.status`. */
export function extractHttpStatus(cause: unknown): number | undefined {
  if (typeof cause === 'object' && cause !== null && 'status' in cause) {
    const status = (cause as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export type { ProviderConfig };
