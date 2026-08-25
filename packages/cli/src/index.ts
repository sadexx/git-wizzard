#!/usr/bin/env node
import { formatError } from '@git-assistant/shared';
import { defaultAuthDeps, runAuthFlow } from '@/auth/flow.js';

async function main(): Promise<void> {
  const result = await runAuthFlow(defaultAuthDeps());
  if (!result.ok) {
    process.stderr.write(`Auth failed: ${formatError(result.error)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Authorized ${result.value.provider} (model ${result.value.model}).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
