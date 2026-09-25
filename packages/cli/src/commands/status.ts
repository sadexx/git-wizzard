import type { Command } from 'commander';
import type { GitFileChange, GitStatus } from '@git-assistant/shared';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show the working-tree status')
    .action(async () => {
      await withClient(async (client: GitAssistantClient) => {
        const result = await client.getStatus();
        if (!result.ok) {
          printError(result.error);
          return;
        }
        process.stdout.write(`${formatStatus(result.value)}\n`);
      });
    });
}

export function formatStatus(status: GitStatus): string {
  const header = `On branch ${status.branch}${status.upstream !== undefined ? ` (tracking ${status.upstream})` : ''}`;
  const counts = `${status.ahead} ahead, ${status.behind} behind`;
  if (status.isClean) return `${header}\n${counts}\nWorking tree clean.`;

  const files = status.files
    .map(
      (file: GitFileChange) =>
        `  ${fileLabel(file)}  ${file.path}${file.originalPath !== undefined ? ` (from ${file.originalPath})` : ''}`,
    )
    .join('\n');
  return `${header}\n${counts}\nChanges:\n${files}`;
}

function fileLabel(file: GitFileChange): string {
  const parts: string[] = [];
  if (file.index !== 'unmodified') parts.push(`staged:${file.index}`);
  if (file.workingTree !== 'unmodified') parts.push(file.workingTree);
  return parts.length > 0 ? parts.join(' ') : 'unmodified';
}
