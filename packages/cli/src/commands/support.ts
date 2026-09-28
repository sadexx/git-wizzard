import type { AppError } from '@git-assistant/shared';
import { resolveConfiguredAdapter } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type GitAssistantClient } from '#mcp/client.js';

/**
 * Spawn the server-backed client, run `use`, and always close. Credentials are
 * resolved only if a tool samples, so git-only commands work without any setup.
 */
export async function withClient(use: (client: GitAssistantClient) => Promise<void>): Promise<void> {
  const connected = await connectClient(resolveConfiguredAdapter, { cwd: process.cwd() });
  if (!connected.ok) {
    printError(connected.error);
    return;
  }

  try {
    await use(connected.value);
  } finally {
    await connected.value.close();
  }
}

export function printError(error: AppError): void {
  process.stderr.write(`${renderError(error)}\n`);
  process.exitCode = 1;
}
