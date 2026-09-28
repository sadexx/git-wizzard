import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  formatError,
  fromWireError,
  providerError,
  toWireError,
  TOOL_ERROR_META_KEY,
  type AppError,
  type Result,
} from '@git-assistant/shared';

/** Bridge a domain Result to a tool result: structuredContent on success, isError text on failure. */
export function fromResult<T extends Record<string, unknown>>(
  result: Result<T, AppError>,
  describe: (value: T) => string,
): CallToolResult {
  if (!result.ok) return toolErr(result.error);
  return { content: [{ type: 'text', text: describe(result.value) }], structuredContent: result.value };
}

/** Error result: readable text for generic MCP clients, plus the typed error in `_meta` for ours. */
export function toolErr(error: AppError): CallToolResult {
  return {
    content: [{ type: 'text', text: formatError(error) }],
    isError: true,
    _meta: { [TOOL_ERROR_META_KEY]: toWireError(error) },
  };
}

/** Recover the client's typed error from a failed `createMessage` call (our CLI attaches it as McpError data). */
export function samplingError(cause: unknown): AppError {
  return (
    fromWireError(cause instanceof McpError ? cause.data : undefined) ??
    providerError('request_failed', 'Sampling request failed', cause)
  );
}
