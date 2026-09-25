import OpenAI from 'openai';
import {
  authError,
  parseWithSchema,
  providerError,
  openAiChatCompletionSchema,
  type AuthError,
  type CompletionResponse,
  type ProviderError,
  type Result,
  err,
  ok,
  type ProviderConfig,
  type CompletionRequest,
} from '@git-assistant/shared';
import { extractHttpStatus, type ProviderAdapter } from '#auth/provider-adapter.js';

export class OpenAiAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({ apiKey: config.apiKey });
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
    let raw: unknown;
    try {
      raw = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
    } catch (cause) {
      const classified = classifyError(cause);
      return err(
        classified.kind === 'AuthError' ? providerError('unauthorized', classified.message, cause) : classified,
      );
    }
    return normalizeOpenAiResponse(raw, this.model);
  }
}

export function normalizeOpenAiResponse(
  raw: unknown,
  fallbackModel: string,
): Result<CompletionResponse, ProviderError> {
  const parsed = parseWithSchema(openAiChatCompletionSchema, raw);
  if (!parsed.ok) return err(providerError('invalid_response', 'Unexpected OpenAI response shape', parsed.error));

  const [choice] = parsed.value.choices;
  if (choice === undefined) return err(providerError('invalid_response', 'OpenAI returned no choices'));

  const text = choice.message.content ?? '';
  if (text === '') return err(providerError('empty_completion', 'OpenAI returned empty content'));

  return ok({ text, model: parsed.value.model ?? fallbackModel, finishReason: mapFinish(choice.finish_reason) });
}

function mapFinish(reason: string | null | undefined): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'other';
  }
}

function classifyError(cause: unknown): ProviderError | AuthError {
  const status = extractHttpStatus(cause);
  if (status === 401) return authError('invalid_api_key', 'OpenAI rejected the API key');
  if (status === 429) return providerError('rate_limited', 'OpenAI rate limit exceeded', cause);
  return providerError('request_failed', 'OpenAI request failed', cause);
}
