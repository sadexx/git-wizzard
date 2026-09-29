import type { ReactElement } from 'react';
import { Text } from 'ink';
import type { GitDiff } from '@git-wizzard/shared';
import { formatDiff } from '#commands/diff.js';
import { ScrollView } from '#ui/components/ScrollView.js';
import { diffStyle } from '#ui/theme.js';

/** Same content as `gitwizz diff`: summary, per-file counts, then the patch, scrollable. */
export function DiffView({ diff }: { diff: GitDiff }): ReactElement {
  if (diff.files.length === 0) {
    return (
      <Text>
        No {diff.staged ? 'staged' : 'unstaged'} changes.
        <Text dimColor> Press s for {diff.staged ? 'unstaged' : 'staged'}.</Text>
      </Text>
    );
  }
  return <ScrollView lines={formatDiff(diff, diffStyle).split('\n')} />;
}
