import { formatError, type AppError } from '@git-assistant/shared';
import { defaultAuthDeps, runAuthFlow } from '@/auth/flow.js';
import { connectClient, type GitAssistantClient } from '@/mcp/client.js';

/**
 * Resolve credentials non-interactively (saved config or env only), spawn the
 * server-backed client, run `use`, and always close. Directs the user to `auth`
 * when nothing is configured rather than surprising them with a prompt.
 */
export async function withClient(use: (client: GitAssistantClient) => Promise<void>): Promise<void> {
  const auth = await runAuthFlow(defaultAuthDeps(), { validate: false, allowInteractive: false });
  if (!auth.ok) {
    if (auth.error.kind === 'AuthError' && auth.error.reason === 'missing_credentials') {
      process.stderr.write('No credentials found. Run "git-assistant auth" first.\n');
      process.exitCode = 1;
      return;
    }
    printError(auth.error);
    return;
  }

  const connected = await connectClient(auth.value, { cwd: process.cwd() });
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
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
