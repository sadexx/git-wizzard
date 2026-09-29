import type { Command } from 'commander';
import type { GitDiff, GitDiffFile } from '@git-wizzard/shared';
import type { GitWizzardClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import { plain, plural, styleFor, stylePatch, type Style } from '#format.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Show the staged or unstaged diff')
    .option('--staged', 'Show staged changes instead of unstaged')
    .action(async (options: { staged?: boolean }) => {
      await withClient(async (client: GitWizzardClient) => {
        const result = await client.getDiff({ staged: options.staged === true });
        if (!result.ok) {
          printError(result.error);
          return;
        }
        process.stdout.write(`${formatDiff(result.value, styleFor(process.stdout))}\n`);
      });
    });
}

/** Summary line, aligned per-file counts, then the (colored) patch. */
export function formatDiff(diff: GitDiff, style: Style = plain): string {
  const scope = diff.staged ? 'staged' : 'unstaged';
  if (diff.files.length === 0) {
    const hint = diff.staged ? '' : `\n${style('dim', 'Staged changes are shown with --staged.')}`;
    return `No ${scope} changes.${hint}`;
  }

  const summary = style(
    'bold',
    `${diff.staged ? 'Staged' : 'Unstaged'} changes: ${plural(diff.files.length, 'file')}, +${diff.additions} -${diff.deletions}`,
  );
  const counts = diff.files.map((file: GitDiffFile) => (file.binary ? 'binary' : `+${file.additions} -${file.deletions}`));
  const width = Math.max(...counts.map((count: string) => count.length));
  const files = diff.files.map((file: GitDiffFile, i: number) => {
    const pad = ' '.repeat(width - (counts[i] ?? '').length);
    const count = file.binary
      ? style('dim', 'binary')
      : `${style('green', `+${file.additions}`)} ${style('red', `-${file.deletions}`)}`;
    return `  ${count}${pad}  ${file.path}`;
  });

  const patch = diff.patch.trimEnd();
  return [summary, ...files, ...(patch === '' ? [] : ['', stylePatch(patch, style)])].join('\n');
}
