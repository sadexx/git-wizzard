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
  type ChatMessage,
} from '@git-wizzard/shared';
import { extractHttpStatus, type ProviderAdapter } from '#auth/provider-adapter.js';

/** OpenAI itself, or (`custom`) any server speaking its chat-completions API at `baseUrl`. */
export class OpenAiAdapter implements ProviderAdapter {
  readonly provider: 'openai' | 'custom';
  readonly model: string;
  private readonly client: OpenAI;
  /** "OpenAI", or the server's address, for error messages. */
  private readonly name: string;

  constructor(config: ProviderConfig) {
    this.provider = config.provider === 'custom' ? 'custom' : 'openai';
    this.model = config.model;
    this.name = config.provider === 'custom' ? (config.baseUrl ?? 'the server') : 'OpenAI';
    // Keyless local servers still get a placeholder: the SDK requires a key, Ollama ignores it.
    this.client = new OpenAI({
      apiKey: config.apiKey === '' ? 'none' : config.apiKey,
      ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
    });
  }

  public async validateKey(): Promise<Result<void, ProviderError | AuthError>> {
    const models = await this.listModels();
    return models.ok ? ok(undefined) : models;
  }

  public async listModels(): Promise<Result<string[], ProviderError | AuthError>> {
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list()) ids.push(model.id);
      return ok(ids.sort());
    } catch (cause) {
      return err(classifyError(cause, this.name));
    }
  }

  public async complete(request: CompletionRequest): Promise<Result<CompletionResponse, ProviderError>> {
    let raw: unknown;
    try {
      raw = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map((message: ChatMessage) => ({
          role: message.role,
          content: message.content,
        })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        // ponytail: other servers get no cap. Ollama ignores max_completion_tokens, and a small max_tokens
        // leaves a thinking model no room to answer; the prompts already keep replies short.
        ...(request.maxTokens !== undefined && this.provider === 'openai' ? { max_completion_tokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
    } catch (cause) {
      const classified = classifyError(cause, this.name);
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

function classifyError(cause: unknown, name: string): ProviderError | AuthError {
  const status = extractHttpStatus(cause);
  if (status === 401) return authError('invalid_api_key', `${name} rejected the API key`);
  if (status === 429) return providerError('rate_limited', `Rate limit exceeded at ${name}`, cause);
  if (cause instanceof OpenAI.APIConnectionError) return providerError('request_failed', `Could not reach ${name}`, cause);
  return providerError('request_failed', `Request to ${name} failed`, cause);
}
