import {
  ErrorCode,
  McpError,
  type CreateMessageRequest,
  type CreateMessageResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  completionRequestSchema,
  err,
  formatError,
  ok,
  parseWithSchema,
  providerError,
  toWireError,
  type AppError,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderError,
  type Result,
} from '@git-assistant/shared';
import type { ProviderAdapter } from '#auth/provider-adapter.js';

/** Supplies the provider adapter on demand, so credentials are only needed once something is sampled. */
export type AdapterResolver = () => Promise<Result<ProviderAdapter, AppError>>;

/**
 * Build the sampling request handler. On any failure (including unresolved credentials)
 * it throws an McpError carrying the wire-form error as `data`, which the SDK turns into
 * a JSON-RPC error - surfacing on the server as a failed createMessage call, which the
 * tool reports (with the same typed error) as an isError result.
 */
export function createSamplingHandler(
  resolveAdapter: AdapterResolver,
): (request: CreateMessageRequest) => Promise<CreateMessageResult> {
  return async (request: CreateMessageRequest): Promise<CreateMessageResult> => {
    const converted = toCompletionRequest(request.params);
    if (!converted.ok) throw samplingFailure(ErrorCode.InvalidParams, converted.error);

    const adapter = await resolveAdapter();
    if (!adapter.ok) throw samplingFailure(ErrorCode.InternalError, adapter.error);

    const completion = await adapter.value.complete(converted.value);
    if (!completion.ok) throw samplingFailure(ErrorCode.InternalError, completion.error);

    return toCreateMessageResult(completion.value);
  };
}

function samplingFailure(code: ErrorCode, error: AppError): McpError {
  return new McpError(code, formatError(error), toWireError(error));
}

/** Pure: convert an MCP sampling request into a normalized CompletionRequest (text content only). */
export function toCompletionRequest(params: CreateMessageRequest['params']): Result<CompletionRequest, ProviderError> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (params.systemPrompt !== undefined && params.systemPrompt !== '') {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  for (const message of params.messages) {
    const content = Array.isArray(message.content) ? message.content[0] : message.content;
    if (!content || content.type !== 'text') {
      return err(providerError('invalid_response', `Unsupported sampling content type`));
    }
    messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: content.text });
  }

  const candidate = {
    messages,
    ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
  };
  const parsed = parseWithSchema(completionRequestSchema, candidate);
  return parsed.ok
    ? ok(parsed.value)
    : err(providerError('invalid_response', 'Invalid sampling parameters', parsed.error));
}

/** Pure: convert a normalized CompletionResponse into an MCP sampling result. */
export function toCreateMessageResult(response: CompletionResponse): CreateMessageResult {
  return {
    role: 'assistant',
    content: { type: 'text', text: response.text },
    model: response.model,
    stopReason: mapStopReason(response.finishReason),
  };
}

function mapStopReason(finishReason: CompletionResponse['finishReason']): string {
  switch (finishReason) {
    case 'length':
      return 'maxTokens';
    case 'stop':
    case 'content_filter':
    default:
      return 'endTurn';
  }
}
