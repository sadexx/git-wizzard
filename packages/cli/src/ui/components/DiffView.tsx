import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type { GitDiff } from '@git-assistant/shared';
import { classifyPatch, plural, type PatchLineKind } from '#format.js';

const LINE_PROPS: Record<PatchLineKind, { color?: string; bold?: boolean }> = {
  header: { bold: true },
  hunk: { color: 'cyan' },
  add: { color: 'green' },
  del: { color: 'red' },
  context: {},
};

export function DiffView({ diff, maxLines = 200 }: { diff: GitDiff; maxLines?: number }): ReactElement {
  if (diff.files.length === 0) return <Text>No {diff.staged ? 'staged' : 'unstaged'} changes.</Text>;

  const lines = classifyPatch(diff.patch.trimEnd());
  const shown = lines.slice(0, maxLines);

  return (
    <Box flexDirection="column">
      <Text bold>
        {`${diff.staged ? 'Staged' : 'Unstaged'} changes: ${plural(diff.files.length, 'file')}, ` +
          `+${diff.additions} -${diff.deletions}`}
      </Text>
      {shown.map(({ line, kind }: { line: string; kind: PatchLineKind }, i: number) => (
        <Text key={i} {...LINE_PROPS[kind]}>
          {line === '' ? ' ' : line}
        </Text>
      ))}
      {lines.length > maxLines ? (
        <Text dimColor>... {plural(lines.length - maxLines, 'more line')} not shown</Text>
      ) : null}
    </Box>
  );
}
