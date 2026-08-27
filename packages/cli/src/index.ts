#!/usr/bin/env node
import { formatError } from '@git-assistant/shared';
import { defaultAuthDeps, runAuthFlow } from '@/auth/flow.js';
import { connectClient } from '@/mcp/client.js';

async function main(): Promise<void> {
  const auth = await runAuthFlow(defaultAuthDeps());
  if (!auth.ok) {
    fail(`Auth failed: ${formatError(auth.error)}`);
    return;
  }

  process.stdout.write(`Authorized ${auth.value.provider} (model ${auth.value.model}).\n`);

  const connected = await connectClient(auth.value);
  if (!connected.ok) {
    fail(`Connect failed: ${formatError(connected.error)}`);
    return;
  }

  const client = connected.value;
  try {
    const result = await client.generateCommitMessage();
    if (!result.ok) {
      fail(`generate_commit_message failed: ${formatError(result.error)}`);
      return;
    }
    process.stdout.write(`\nSuggested commit message: \n${result.value.message}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => fail(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`));

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
