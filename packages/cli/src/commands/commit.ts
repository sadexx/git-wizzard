import type { Command } from 'commander';
import { printError, withClient } from '@/commands/support.js';
import { createActionPrompter, resolveDecision } from '@/commands/prompt.js';

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from staged changes and create the commit')
    .action(async () => {
      await withClient(async (client) => {
        const generated = await client.generateCommitMessage();
        if (!generated.ok) {
          printError(generated.error);
          return;
        }

        const decision = await resolveDecision(createActionPrompter(), 'Commit message', generated.value.message);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No commit create.\n');
          return;
        }

        const commited = await client.createCommit({ message: decision.value });
        if (!commited.ok) {
          printError(commited.error);
          return;
        }

        process.stdout.write(`Created commit ${commited.value.sha.slice(0, 8)} on ${commited.value.branch}.\n`);
      });
    });
}
