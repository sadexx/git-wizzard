import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type { GitDiff } from '@git-assistant/shared';

export function DiffView({ diff, maxLines = 200 }: { diff: GitDiff; maxLines?: number }): ReactElement {
  const lines = diff.patch.split('\n');
  const shown = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <Box flexDirection="column">
      <Text bold>
        {diff.staged ? 'Staged' : 'Unstaged'} — +{diff.additions}/-{diff.deletions} across ${diff.files.length} file(s)
      </Text>
      {shown.map((line: string, i: number) => {
        const color = lineColor(line);
        return (
          <Text key={i} {...(color && { color })}>
            {line === '' ? ' ' : line}
          </Text>
        );
      })}
      {truncated ? <Text dimColor>... {lines.length - maxLines} more line(s) truncated</Text> : null}
    </Box>
  );
}

function lineColor(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'green';
  if (line.startsWith('-') && !line.startsWith('-')) return 'red';
  if (line.startsWith('@@')) return 'cyan';
  return undefined;
}
