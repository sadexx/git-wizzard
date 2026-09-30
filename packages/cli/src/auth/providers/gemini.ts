import { FinishReason, GoogleGenAI } from '@google/genai';
import {
  authError,
  err,
  geminiGenerateContentSchema,
  ok,
  parseWithSchema,
  providerError,
  type AuthError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderConfig,
  type ProviderError,
  type Result,
} from '@git-wizzard/shared';
import { extractHttpStatus, type ProviderAdapter } from '#auth/provider-adapter.js';

type GeminiContent = { role: 'user' | 'model'; parts: Array<{ text: string }> };

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  public async validateKey(): Promise<Result<void, ProviderError | AuthError>> {
    try {
      await this.client.models.list({ config: { pageSize: 1 } });
      return ok(undefined);
    } catch (cause) {
      return err(classifyError(cause));
    }
  }

  public async listModels(): Promise<Result<string[], ProviderError | AuthError>> {
    try {
      // Only models that write text; names come as "models/<id>".
      const ids: string[] = [];
      for await (const model of await this.client.models.list()) {
        if (model.name !== undefined && model.supportedActions?.includes('generateContent') === true) {
          ids.push(model.name.replace(/^models\//, ''));
        }
      }
      return ok(ids.sort());
    } catch (cause) {
      return err(classifyError(cause));
    }
  }

  public async complete(request: CompletionRequest): Promise<Result<CompletionResponse, ProviderError>> {
    const { systemInstruction, contents } = toGeminiInput(request.messages);
    let raw: { text: string | undefined; modelVersion: string | undefined; candidates: unknown };
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          ...(systemInstruction !== undefined ? { systemInstruction } : {}),
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
      });
      raw = { text: response.text, modelVersion: response.modelVersion, candidates: response.candidates };
    } catch (cause) {
      const classified = classifyError(cause);
      return err(
        classified.kind === 'AuthError' ? providerError('unauthorized', classified.message, cause) : classified,
      );
    }
    return normalizeGeminiResponse(raw, this.model);
  }
}

/** Pure: split messages into a system instruction and Gemini `contents` (assistant -> model). */
export function toGeminiInput(messages: readonly ChatMessage[]): {
  systemInstruction: string | undefined;
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }
  return { systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, contents };
}

/** Pure: validate and map a raw Gemini response into the normalized response. */
export function normalizeGeminiResponse(
  raw: unknown,
  fallbackModel: string,
): Result<CompletionResponse, ProviderError> {
  const parsed = parseWithSchema(geminiGenerateContentSchema, raw);
  if (!parsed.ok) return err(providerError('invalid_response', 'Unexpected Gemini response shape', parsed.error));

  const [candidate] = parsed.value.candidates ?? [];
  const aggregated = parsed.value.text ?? '';
  const text = aggregated !== '' ? aggregated : (candidate?.content?.parts ?? []).map((part: { text?: string | undefined }) => part.text ?? '').join('');
  if (text === '') return err(providerError('empty_completion', 'Gemini returned no text'));

  return ok({
    text,
    model: parsed.value.modelVersion ?? fallbackModel,
    finishReason: mapFinish(candidate?.finishReason),
  });
}

function mapFinish(reason: string | undefined): CompletionResponse['finishReason'] {
  switch (reason) {
    case FinishReason.STOP:
      return 'stop';
    case FinishReason.MAX_TOKENS:
      return 'length';
    case FinishReason.SAFETY:
    case FinishReason.RECITATION:
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
      return 'content_filter';
    default:
      return 'other';
  }
}

function classifyError(cause: unknown): ProviderError | AuthError {
  const status = extractHttpStatus(cause);
  if (status === 400 || status === 401 || status === 403)
    return authError('invalid_api_key', 'Google rejected the API key');
  if (status === 429) return providerError('rate_limited', 'Gemini rate limit exceeded', cause);
  return providerError('request_failed', 'Gemini request failed', cause);
}
