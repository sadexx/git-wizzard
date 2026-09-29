import { InvalidArgumentError, Option } from 'commander';
import { generationHintSchema, type AppError } from '@git-wizzard/shared';
import { resolveConfiguredAdapter } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type GitWizzardClient } from '#mcp/client.js';

/**
 * Spawn the server-backed client, run `use`, and always close. Credentials are
 * resolved only if a tool samples, so git-only commands work without any setup.
 */
export async function withClient(use: (client: GitWizzardClient) => Promise<void>): Promise<void> {
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
  printRecoverableError(error);
  process.exitCode = 1;
}

/** Report an error the user can recover from in the same run (e.g. a failed regenerate): no exit code. */
export function printRecoverableError(error: AppError): void {
  process.stderr.write(`${renderError(error)}\n`);
}

/** `--hint <text>`, validated with the tool's own schema so bad input fails before any work starts. */
export function hintOption(): Option {
  return new Option('--hint <text>', 'Tell the model the intent behind the change (why, not what)').argParser(
    (value: string) => {
      const hint = value.trim();
      if (!generationHintSchema.safeParse(hint).success) throw new InvalidArgumentError('Expected 1-500 characters.');
      return hint;
    },
  );
}
