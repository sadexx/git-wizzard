import type { Command } from 'commander';
import { defaultAuthDeps, runAuthFlow } from '@/auth/flow.js';
import { printError } from '@/commands/support.js';

export function registerAuthCommand(program: Command): void {
  program
    .command('auth')
    .description('Authorize a provider (OpenAI or Google) and store credentials')
    .option('--no-validate', 'Skip API key validation')
    .action(async (options: { validate: boolean }) => {
      const result = await runAuthFlow(defaultAuthDeps(), { forceInteractive: true, validate: options.validate });
      if (!result.ok) {
        printError(result.error);
        return;
      }
      process.stdout.write(`Authorized ${result.value.provider} (model ${result.value.model}).\n`);
    });
}
