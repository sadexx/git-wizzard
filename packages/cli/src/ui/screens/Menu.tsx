import { type ReactElement, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

type MenuTarget = 'diff' | 'branch' | 'commit';

const ITEMS: ReadonlyArray<{ key: MenuTarget | 'quit'; label: string }> = [
  { key: 'diff', label: 'View diff' },
  { key: 'branch', label: 'Suggest branch name' },
  { key: 'commit', label: 'Generate commit message' },
  { key: 'quit', label: 'Quit' },
];

export function Menu({ onSelect }: { onSelect: (target: MenuTarget) => void }): ReactElement {
  const [index, setIndex] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => (i - 1 + ITEMS.length) % ITEMS.length);
    else if (key.downArrow) setIndex((i) => (i + 1) % ITEMS.length);
    else if (key.return) {
      const item = ITEMS[index];
      if (item === undefined) return;
      if (item.key === 'quit') exit();
      else onSelect(item.key);
    } else if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column">
      <Text bold>git-assistant</Text>
      {ITEMS.map((item, i) => {
        const isSelected = i === index;
        return (
          <Text key={item.key} {...(isSelected && { color: 'green' })}>
            {isSelected ? '❯ ' : '  '}
            {item.label}
          </Text>
        );
      })}
      <Text dimColor>↑/↓ move · Enter select · q quit</Text>
    </Box>
  );
}
