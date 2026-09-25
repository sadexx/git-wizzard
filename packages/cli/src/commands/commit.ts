import type { Command } from 'commander';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import { createActionPrompter, resolveDecision } from '#commands/prompt.js';

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from staged changes and create the commit')
    .action(async () => {
      await withClient(async (client: GitAssistantClient) => {
        const generated = await client.generateCommitMessage();
        if (!generated.ok) {
          printError(generated.error);
          return;
        }

        const decision = await resolveDecision(createActionPrompter(), 'Commit message', generated.value.message);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No commit created.\n');
          return;
        }

        const commitResult = await client.createCommit({ message: decision.value });
        if (!commitResult.ok) {
          printError(commitResult.error);
          return;
        }

        process.stdout.write(`Created commit ${commitResult.value.sha.slice(0, 8)} on ${commitResult.value.branch}.\n`);
      });
    });
}
