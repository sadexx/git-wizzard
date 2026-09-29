import { type ReactElement, useState } from 'react';
import { Box, Text, useApp, useInput, type Key } from 'ink';

export type MenuTarget = 'commit' | 'branch' | 'pr' | 'status' | 'diff';

const ITEMS: ReadonlyArray<{ key: MenuTarget; label: string; description: string }> = [
  { key: 'commit', label: 'Commit', description: 'message for staged or all tracked changes' },
  { key: 'branch', label: 'Branch', description: 'suggest a name and create it' },
  { key: 'pr', label: 'Pull request', description: 'title and description for this branch' },
  { key: 'status', label: 'Status', description: 'branch, upstream, and changed files' },
  { key: 'diff', label: 'Diff', description: 'unstaged or staged changes' },
];

const LABEL_WIDTH = Math.max(...ITEMS.map((item: (typeof ITEMS)[number]) => item.label.length)) + 4;

export function Menu({
  onSelect,
  initial = 0,
}: {
  onSelect: (target: MenuTarget) => void;
  initial?: number;
}): ReactElement {
  const [index, setIndex] = useState(initial);
  const { exit } = useApp();

  useInput((input: string, key: Key) => {
    if (key.upArrow || input === 'k') setIndex((previous: number) => (previous - 1 + ITEMS.length) % ITEMS.length);
    else if (key.downArrow || input === 'j') setIndex((previous: number) => (previous + 1) % ITEMS.length);
    else if (key.return) {
      const item = ITEMS[index];
      if (item !== undefined) onSelect(item.key);
    } else if (input === 'q' || key.escape) exit();
    else {
      const item = ITEMS[Number.parseInt(input, 10) - 1];
      if (item !== undefined) onSelect(item.key);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {ITEMS.map((item: (typeof ITEMS)[number], itemIndex: number) => {
        const selected = itemIndex === index;
        return (
          <Text key={item.key}>
            <Text bold={selected}>{`${selected ? '❯' : ' '} ${itemIndex + 1}. ${item.label}`.padEnd(LABEL_WIDTH + 5)}</Text>
            <Text dimColor>{item.description}</Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · enter select · 1–{ITEMS.length} jump · q quit</Text>
      </Box>
    </Box>
  );
}

export function menuIndex(target: MenuTarget): number {
  return Math.max(0, ITEMS.findIndex((item: (typeof ITEMS)[number]) => item.key === target));
}
