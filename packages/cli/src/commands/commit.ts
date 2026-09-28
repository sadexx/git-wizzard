import { Option, type Command } from 'commander';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import {
  createActionPrompter,
  requireConfirmMode,
  resolveDecision,
  type ConfirmOptions,
  type Decision,
} from '#commands/prompt.js';

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from staged changes and create the commit')
    .option('-y, --yes', 'Commit with the generated message without asking')
    .addOption(new Option('--dry-run', 'Print the generated message and exit without committing').conflicts('yes'))
    .action(async (options: ConfirmOptions) => {
      const mode = requireConfirmMode(options);
      if (mode === undefined) return;

      await withClient(async (client: GitAssistantClient) => {
        const generated = await client.generateCommitMessage();
        if (!generated.ok) {
          printError(generated.error);
          return;
        }

        const { message } = generated.value;
        if (mode === 'dry-run') {
          process.stdout.write(`${message}\n`);
          return;
        }

        const decision: Decision =
          mode === 'yes'
            ? { kind: 'confirm', value: message }
            : await resolveDecision(createActionPrompter(), 'Commit message', message);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No commit created.\n');
          return;
        }

        const commitResult = await client.createCommit({ message: decision.value });
        if (!commitResult.ok) {
          printError(commitResult.error);
          return;
        }

        const { sha, branch, summary } = commitResult.value;
        process.stdout.write(`Created commit ${sha.slice(0, 8)} on ${branch}: ${summary}\n`);
      });
    });
}
