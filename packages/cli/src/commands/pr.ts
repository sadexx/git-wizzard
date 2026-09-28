import { InvalidArgumentError, Option, type Command } from 'commander';
import type { GitAssistantClient } from '#mcp/client.js';
import { hintOption, printError, withClient } from '#commands/support.js';
import { plural } from '#format.js';

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
    .action(async (options: { base?: string; hint?: string }) => {
      await withClient(async (client: GitAssistantClient) => {
        const generated = await client.generatePrDescription({ base: options.base, hint: options.hint });
        if (!generated.ok) {
          printError(generated.error);
          return;
        }
        const { title, body, base, commits } = generated.value;
        // Context goes to stderr so stdout stays exactly the description (pipe-friendly).
        process.stderr.write(`Describing ${plural(commits, 'commit')} not on ${base}.\n`);
        process.stdout.write(body === '' ? `${title}\n` : `${title}\n\n${body}\n`);
      });
    });
}
