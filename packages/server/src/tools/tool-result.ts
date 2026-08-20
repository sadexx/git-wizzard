import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError, type AppError, type Result } from '@git-assistant/shared';

/** Bridge a domain Result to a tool result: structuredContent on success, isError text on failure. */
export function fromResult<T extends Record<string, unknown>>(
  result: Result<T, AppError>,
  describe: (value: T) => string,
): CallToolResult {
  if (!result.ok) return toolErr(result.error);
  return { content: [{ type: 'text', text: describe(result.value) }], structuredContent: result.value };
}

export function toolErr(error: AppError): CallToolResult {
  return { content: [{ type: 'text', text: formatError(error) }], isError: true };
}
