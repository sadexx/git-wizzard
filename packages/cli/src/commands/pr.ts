import { InvalidArgumentError, Option, type Command } from 'commander';
import type { GeneratePrDescriptionOutput } from '@git-wizzard/shared';
import type { GitWizzardClient } from '#mcp/client.js';
import { hintOption, printError, printRecoverableError, withClient } from '#commands/support.js';
import {
  createActionPrompter,
  requireConfirmMode,
  resolveDecision,
  type Decision,
  type Regenerate,
} from '#commands/prompt.js';
import { plural, withProgress } from '#format.js';

export function registerPrCommand(program: Command): void {
  program
    .command('pr')
    .description('Write a pull request title and description from the commits on this branch')
    .addOption(
      new Option('--base <branch>', "Branch the PR targets (default: origin's default branch, else main/master)").argParser(
        (value: string) => {
          if (value.startsWith('-')) throw new InvalidArgumentError('Must not start with "-".');
          return value;
        },
      ),
    )
    .addOption(hintOption())
    .option('--open', 'Open the pull request on GitHub with gh, pushing the branch first if needed')
    .option('-y, --yes', 'With --open, open it without asking')
    .action(async (options: { base?: string; hint?: string; open?: boolean; yes?: boolean }) => {
      if (options.yes === true && options.open !== true) {
        process.stderr.write('error: --yes only applies with --open\n');
        process.exitCode = 1;
        return;
      }
      const hint = 'Pass --yes to open it without asking, or leave out --open to only print the description.';
      if (options.open === true && requireConfirmMode(options, hint) === undefined) return;

      await withClient(async (client: GitWizzardClient) => {
        const generate = (label: string): ReturnType<GitWizzardClient['generatePrDescription']> =>
          withProgress(label, () => client.generatePrDescription({ base: options.base, hint: options.hint }));
        const generated = await generate('Writing pull request description');
        if (!generated.ok) {
          printError(generated.error);
          return;
        }
        const { base, commits } = generated.value;
        // Context goes to stderr so stdout stays exactly the description (pipe-friendly).
        process.stderr.write(`Describing ${plural(commits, 'commit')} not on ${base}.\n`);
        const text = prText(generated.value);
        if (options.open !== true) {
          process.stdout.write(`${text}\n`);
          return;
        }

        const regenerate: Regenerate = async () => {
          const again = await generate('Rewriting pull request description');
          if (again.ok) return prText(again.value);
          printRecoverableError(again.error);
          return undefined;
        };
        const decision: Decision =
          options.yes === true
            ? { kind: 'confirm', value: text }
            : await resolveDecision(createActionPrompter(), `Pull request into ${base}`, text, regenerate);
        if (decision.kind === 'abort') {
          process.stdout.write('Aborted. No pull request opened.\n');
          return;
        }

        const { title, body } = splitPrText(decision.value);
        const created = await withProgress('Opening pull request', () => client.createPullRequest({ title, body, base }));
        if (!created.ok) {
          printError(created.error);
          return;
        }
        process.stdout.write(`${created.value.pushed ? 'Pushed the branch and opened' : 'Opened'} ${created.value.url}\n`);
      });
    });
}

/** Title, blank line, body: what `pr` prints and what the user edits. */
function prText({ title, body }: Pick<GeneratePrDescriptionOutput, 'title' | 'body'>): string {
  return body === '' ? title : `${title}\n\n${body}`;
}

/** Pure: the first line is the title, the rest (trimmed) the body. */
export function splitPrText(text: string): { title: string; body: string } {
  const [title = '', ...rest] = text.trim().split('\n');
  return { title: title.trim(), body: rest.join('\n').trim() };
}
