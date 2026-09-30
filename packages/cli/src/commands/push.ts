import type { Command } from 'commander';
import type { GitWizzardClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import { confirmYesNo, requireConfirmMode } from '#commands/prompt.js';
import { plural, withProgress } from '#format.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push the current branch; a new branch gets its upstream set on origin. Never forces')
    .option('-y, --yes', 'Push without asking')
    .action(async (options: { yes?: boolean }) => {
      const mode = requireConfirmMode(options, 'Pass --yes to push without asking.');
      if (mode === undefined) return;

      await withClient(async (client: GitWizzardClient) => {
        const status = await client.getStatus();
        if (!status.ok) {
          printError(status.error);
          return;
        }
        const { branch, upstream, ahead, behind } = status.value;
        if (upstream !== undefined && ahead === 0) {
          process.stdout.write(`Nothing to push: ${branch} is up to date with ${upstream}.\n`);
          return;
        }
        if (upstream !== undefined && behind > 0) {
          process.stderr.write(`${upstream} has ${plural(behind, 'commit')} you don't have; pull first or the push is rejected.\n`);
        }

        const question =
          upstream === undefined
            ? `${branch} is not on the remote yet. Push it and set its upstream?`
            : `Push ${plural(ahead, 'commit')} on ${branch} to ${upstream}?`;
        if (mode === 'prompt' && !(await confirmYesNo(question))) {
          process.stdout.write('Aborted. Nothing pushed.\n');
          return;
        }

        const pushed = await withProgress('Pushing', () => client.push());
        if (!pushed.ok) {
          printError(pushed.error);
          return;
        }
        const { commits } = pushed.value;
        process.stdout.write(
          commits === undefined
            ? `Pushed ${pushed.value.branch} to ${pushed.value.upstream} and set it as the upstream.\n`
            : `Pushed ${plural(commits, 'commit')} to ${pushed.value.upstream}.\n`,
        );
      });
    });
}
