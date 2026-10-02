import { Option, type Command } from 'commander';
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

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from staged changes and create the commit')
    .option('-a, --all', 'Include all changes to tracked files, like "git commit -a" (new files still need git add)')
    .option('-y, --yes', 'Commit with the generated message without asking')
    .option('--subject-only', 'Use only the subject line of the generated message, without the body')
    .addOption(new Option('--dry-run', 'Print the generated message and exit without committing').conflicts('yes'))
    .addOption(hintOption())
    .action(async (options: ConfirmOptions & { hint?: string; all?: boolean; subjectOnly?: boolean }) => {
      const mode = requireConfirmMode(options);
      if (mode === undefined) return;

      await withClient(async (client: GitWizzardClient) => {
        const generate = (label: string): ReturnType<GitWizzardClient['generateCommitMessage']> =>
          withProgress(label, () => client.generateCommitMessage({ hint: options.hint, all: options.all }));
        const generated = await generate('Generating commit message');
        if (!generated.ok) {
          printError(generated.error);
          return;
        }

        const pick = ({ subject, message }: { subject: string; message: string }): string =>
          options.subjectOnly === true ? subject : message;
        const message = pick(generated.value);
        if (mode === 'dry-run') {
          process.stdout.write(`${message}\n`);
          return;
        }

        const regenerate: Regenerate = async () => {
          const again = await generate('Regenerating commit message');
          if (again.ok) return pick(again.value);
          printRecoverableError(again.error);
          return undefined;
        };
        const decision: Decision =
          mode === 'yes'
            ? { kind: 'confirm', value: message }
            : await resolveDecision(createActionPrompter(), 'Commit message', message, regenerate);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No commit created.\n');
          return;
        }

        const commitResult = await client.createCommit({ message: decision.value, all: options.all });
        if (!commitResult.ok) {
          printError(commitResult.error);
          return;
        }

        const { sha, branch, summary } = commitResult.value;
        process.stdout.write(`Created commit ${sha.slice(0, 8)} on ${branch}: ${summary}\n`);
      });
    });
}
