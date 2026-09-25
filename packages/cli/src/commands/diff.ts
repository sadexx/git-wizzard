import type { Command } from 'commander';
import type { GitDiff, GitDiffFile } from '@git-assistant/shared';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Show the staged or unstaged diff')
    .option('--staged', 'Show staged changes instead of unstaged')
    .action(async (options: { staged?: boolean }) => {
      await withClient(async (client: GitAssistantClient) => {
        const result = await client.getDiff({ staged: options.staged === true });
        if (!result.ok) {
          printError(result.error);
          return;
        }
        process.stdout.write(`${formatDiff(result.value)}\n`);
      });
    });
}

export function formatDiff(diff: GitDiff): string {
  const summary = `${diff.staged ? 'Staged' : 'Unstaged'} changes: ${diff.files.length} file(s), +${diff.additions}/-${diff.deletions}`;
  if (diff.files.length === 0) return summary;

  const files = diff.files
    .map((file: GitDiffFile) => `  ${file.binary ? 'binary' : `+${file.additions}/-${file.deletions}`}  ${file.path}`)
    .join('\n');
  const patch = diff.patch.trim() === '' ? '' : `\n\n${diff.patch}`;
  return `${summary}\n${files}${patch}`;
}
