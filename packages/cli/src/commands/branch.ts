import { type Command, Option } from 'commander';
import { branchTypeSchema, type BranchType } from '@git-assistant/shared';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import { createActionPrompter, resolveDecision } from '#commands/prompt.js';

export function registerBranchCommand(program: Command): void {
  program
    .command('branch')
    .description('Suggest a branch name for the current changes and optionally create it')
    .addOption(new Option('--type <type>', 'Branch type prefix').choices([...branchTypeSchema.options]))
    .action(async (options: { type?: string }) => {
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

        process.stdout.write(`Suggestions: ${suggestions.value.join(', ')}\n`);

        const decision = await resolveDecision(createActionPrompter(), 'Create branch', first);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No branch create.\n');
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
