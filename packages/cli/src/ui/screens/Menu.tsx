import type { ReactElement } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { SelectList } from '#ui/components/SelectList.js';

export type MenuTarget = 'commit' | 'push' | 'branch' | 'pr' | 'status' | 'diff' | 'hook' | 'auth';

const ITEMS: ReadonlyArray<{ key: MenuTarget; label: string; description: string }> = [
  { key: 'commit', label: 'Commit', description: 'message for staged or all tracked changes' },
  { key: 'push', label: 'Push', description: 'send this branch’s commits to the remote' },
  { key: 'branch', label: 'Branch', description: 'suggest a name and create it' },
  { key: 'pr', label: 'Pull request', description: 'title and description for this branch' },
  { key: 'status', label: 'Status', description: 'branch, upstream, and changed files' },
  { key: 'diff', label: 'Diff', description: 'unstaged or staged changes' },
  { key: 'hook', label: 'Git hook', description: 'AI drafts inside plain git commit' },
  { key: 'auth', label: 'Auth', description: 'provider, model, and API key' },
];

export function Menu({
  onSelect,
  initial = 0,
}: {
  onSelect: (target: MenuTarget) => void;
  initial?: number;
}): ReactElement {
  const { exit } = useApp();
  useInput((input: string) => {
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <SelectList
        items={ITEMS}
        initial={initial}
        onSelect={(index: number) => {
          const item = ITEMS[index];
          if (item !== undefined) onSelect(item.key);
        }}
        onCancel={exit}
      />
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · enter select · 1–{ITEMS.length} jump · q quit</Text>
      </Box>
    </Box>
  );
}

export function menuIndex(target: MenuTarget): number {
  return Math.max(0, ITEMS.findIndex((item: (typeof ITEMS)[number]) => item.key === target));
}
