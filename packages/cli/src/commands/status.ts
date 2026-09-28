import type { Command } from 'commander';
import type { GitFileChange, GitFileStatus, GitStatus } from '@git-assistant/shared';
import type { GitAssistantClient } from '#mcp/client.js';
import { printError, withClient } from '#commands/support.js';
import { plain, plural, styleFor, type Style, type StyleFormat } from '#format.js';

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
        process.stdout.write(`${formatStatus(result.value, styleFor(process.stdout))}\n`);
      });
    });
}

/** Statuses that describe a change in that column (as opposed to "nothing here"). */
const CHANGE: ReadonlySet<GitFileStatus> = new Set(['modified', 'added', 'deleted', 'renamed', 'copied']);

/** git-style status: branch, upstream relation, then changes grouped by where they live. */
export function formatStatus(status: GitStatus, style: Style = plain): string {
  const lines = [status.branch === '(detached)' ? 'HEAD detached' : `On branch ${style('bold', status.branch)}`];
  const upstream = upstreamLine(status);
  if (upstream !== undefined) lines.push(upstream);

  if (status.isClean) {
    lines.push('', 'Nothing to commit, working tree clean.');
    return lines.join('\n');
  }

  const conflicted = status.files.filter((file: GitFileChange) => file.index === 'conflicted');
  const staged = status.files.filter((file: GitFileChange) => CHANGE.has(file.index));
  const unstaged = status.files.filter((file: GitFileChange) => CHANGE.has(file.workingTree));
  const untracked = status.files.filter((file: GitFileChange) => file.workingTree === 'untracked');

  const section = (title: string, color: StyleFormat, entries: string[]): void => {
    if (entries.length === 0) return;
    lines.push('', style('bold', title), ...entries.map((entry: string) => `  ${style(color, entry)}`));
  };
  section('Conflicts:', 'red', conflicted.map((file: GitFileChange) => entry('conflicted', file)));
  section('Staged:', 'green', staged.map((file: GitFileChange) => entry(file.index, file)));
  section('Not staged:', 'red', unstaged.map((file: GitFileChange) => entry(file.workingTree, file)));
  section('Untracked:', 'red', untracked.map((file: GitFileChange) => file.path));
  return lines.join('\n');
}

function entry(change: GitFileStatus, file: GitFileChange): string {
  const from = file.originalPath !== undefined ? ` (from ${file.originalPath})` : '';
  return `${`${change}:`.padEnd(12)}${file.path}${from}`;
}

function upstreamLine({ upstream, ahead, behind }: GitStatus): string | undefined {
  if (upstream === undefined) return undefined;
  if (ahead > 0 && behind > 0) return `Diverged from ${upstream}: ${ahead} ahead, ${behind} behind.`;
  if (ahead > 0) return `Ahead of ${upstream} by ${plural(ahead, 'commit')}.`;
  if (behind > 0) return `Behind ${upstream} by ${plural(behind, 'commit')}.`;
  return `Up to date with ${upstream}.`;
}
