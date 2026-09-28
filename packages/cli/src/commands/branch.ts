import { type Command, Option } from 'commander';
import { branchTypeSchema, type BranchType } from '@git-assistant/shared';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import {
  createActionPrompter,
  requireConfirmMode,
  resolveDecision,
  type ConfirmOptions,
  type Decision,
} from '#commands/prompt.js';

export function registerBranchCommand(program: Command): void {
  program
    .command('branch')
    .description('Suggest a branch name for the current changes and optionally create it')
    .addOption(new Option('--type <type>', 'Branch type prefix').choices([...branchTypeSchema.options]))
    .option('-y, --yes', 'Create the first suggestion without asking')
    .addOption(new Option('--dry-run', 'Print the suggestions, one per line, without creating a branch').conflicts('yes'))
    .action(async (options: ConfirmOptions & { type?: string }) => {
      const mode = requireConfirmMode(options);
      if (mode === undefined) return;

      const type = parseBranchType(options.type);
      await withClient(async (client: GitAssistantClient) => {
        const suggestions = await client.suggestBranchName(type !== undefined ? { type } : {});
        if (!suggestions.ok) {
          printError(suggestions.error);
          return;
        }

        const [first] = suggestions.value;
        if (first === undefined) {
          process.stderr.write('No branch suggestions were returned.\n');
          process.exitCode = 1;
          return;
        }

        if (mode === 'dry-run') {
          process.stdout.write(`${suggestions.value.join('\n')}\n`);
          return;
        }

        process.stdout.write(`Suggestions: ${suggestions.value.join(', ')}\n`);

        const decision: Decision =
          mode === 'yes'
            ? { kind: 'confirm', value: first }
            : await resolveDecision(createActionPrompter(), 'Create branch', first);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No branch created.\n');
          return;
        }

        const created = await client.createBranch({ name: decision.value });
        if (!created.ok) {
          printError(created.error);
          return;
        }

        process.stdout.write(`Created and switched to branch ${created.value.branch}\n`);
      });
    });
}

export function parseBranchType(value: string | undefined): BranchType | undefined {
  if (value === undefined) return undefined;

  const parsed = branchTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
