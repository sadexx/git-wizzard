import { type Command, Option } from 'commander';
import { branchTypeSchema, type BranchType } from '@git-wizzard/shared';
import type { GitWizzardClient } from '#mcp/client.js';
import { hintOption, printError, printRecoverableError, withClient } from '#commands/support.js';
import { withProgress } from '#format.js';
import {
  createActionPrompter,
  requireConfirmMode,
  resolveDecision,
  type ConfirmOptions,
  type Decision,
  type Regenerate,
} from '#commands/prompt.js';

export function registerBranchCommand(program: Command): void {
  program
    .command('branch')
    .description('Suggest a branch name for the current changes and optionally create it')
    .addOption(new Option('--type <type>', 'Branch type prefix').choices([...branchTypeSchema.options]))
    .option('-y, --yes', 'Create the first suggestion without asking')
    .addOption(new Option('--dry-run', 'Print the suggestions, one per line, without creating a branch').conflicts('yes'))
    .addOption(hintOption())
    .action(async (options: ConfirmOptions & { type?: string; hint?: string }) => {
      const mode = requireConfirmMode(options);
      if (mode === undefined) return;

      const request = { type: parseBranchType(options.type), hint: options.hint };
      await withClient(async (client: GitWizzardClient) => {
        const suggest = (label: string): ReturnType<GitWizzardClient['suggestBranchName']> =>
          withProgress(label, () => client.suggestBranchName(request));
        const suggestions = await suggest('Suggesting branch names');
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

        const regenerate: Regenerate = async () => {
          const again = await suggest('Regenerating branch names');
          if (!again.ok) {
            printRecoverableError(again.error);
            return undefined;
          }
          process.stdout.write(`Suggestions: ${again.value.join(', ')}\n`);
          return again.value[0];
        };
        const decision: Decision =
          mode === 'yes'
            ? { kind: 'confirm', value: first }
            : await resolveDecision(createActionPrompter(), 'Create branch', first, regenerate);
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
