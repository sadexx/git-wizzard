import Anthropic from '@anthropic-ai/sdk';
import {
  authError,
  err,
  ok,
  providerError,
  type AuthError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderConfig,
  type ProviderError,
  type Result,
} from '@git-wizzard/shared';
import type { ProviderAdapter } from '#auth/provider-adapter.js';

/**
 * Models that accept `fallbacks: "default"`: a request their safety classifiers decline is re-run
 * server-side on the model Anthropic recommends, instead of failing. Other models 400 on the field.
 */
// ponytail: hand-kept list; add model ids here as they gain server-side fallback.
const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Thinking counts toward `max_tokens` and can't be turned off on current models; smaller caps cut answers off. */
const MIN_MAX_TOKENS = 16000;

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  public async validateKey(): Promise<Result<void, ProviderError | AuthError>> {
    try {
      await this.client.models.list();
      return ok(undefined);
    } catch (cause) {
      return err(classifyError(cause));
    }
  }

  public async complete(request: CompletionRequest): Promise<Result<CompletionResponse, ProviderError>> {
    const system = request.messages
      .filter((message: ChatMessage) => message.role === 'system')
      .map((message: ChatMessage) => message.content)
      .join('\n\n');
    const messages: Anthropic.Beta.BetaMessageParam[] = request.messages.flatMap((message: ChatMessage) =>
      message.role === 'system' ? [] : [{ role: message.role, content: message.content }],
    );

    let response: Anthropic.Beta.BetaMessage;
    try {
      // `temperature` is not forwarded: current Claude models reject sampling parameters.
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: Math.max(request.maxTokens ?? 0, MIN_MAX_TOKENS),
        ...(system !== '' ? { system } : {}),
        messages,
        ...(FALLBACK_MODELS.has(this.model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      });
    } catch (cause) {
      const classified = classifyError(cause);
      return err(
        classified.kind === 'AuthError' ? providerError('unauthorized', classified.message, cause) : classified,
      );
    }
    return normalizeAnthropicResponse(response);
  }
}

export function normalizeAnthropicResponse(
  response: Pick<Anthropic.Beta.BetaMessage, 'model' | 'stop_reason' | 'stop_details' | 'content'>,
): Result<CompletionResponse, ProviderError> {
  // A decline (after any fallback also declined) is a normal response; its content is not an answer.
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category;
    return err(providerError('request_failed', `Claude declined the request${category ? ` (${category})` : ''}`));
  }
  const text = response.content
    .flatMap((block: Anthropic.Beta.BetaContentBlock) => (block.type === 'text' ? [block.text] : []))
    .join('');
  if (text.trim() === '') return err(providerError('empty_completion', 'Claude returned no text'));
  return ok({ text, model: response.model, finishReason: mapFinish(response.stop_reason) });
}

function mapFinish(reason: Anthropic.Beta.BetaStopReason | null): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    default:
      return 'other';
  }
}

function classifyError(cause: unknown): ProviderError | AuthError {
  if (cause instanceof Anthropic.AuthenticationError) return authError('invalid_api_key', 'Anthropic rejected the API key');
  if (cause instanceof Anthropic.RateLimitError) return providerError('rate_limited', 'Anthropic rate limit exceeded', cause);
  return providerError('request_failed', 'Anthropic request failed', cause);
}
