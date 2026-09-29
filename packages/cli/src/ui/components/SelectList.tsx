import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';

export interface SelectItem {
  readonly label: string;
  readonly description?: string;
}

/** Numbered choices: ↑/↓ (or j/k) to move, enter to pick, 1–9 to pick directly, esc to cancel. */
export function SelectList({
  items,
  onSelect,
  onCancel,
  initial = 0,
}: {
  items: readonly SelectItem[];
  onSelect: (index: number) => void;
  onCancel?: () => void;
  initial?: number;
}): ReactElement {
  const [index, setIndex] = useState(Math.min(initial, items.length - 1));

  useInput((input: string, key: Key) => {
    if (key.upArrow || input === 'k') setIndex((previous: number) => (previous - 1 + items.length) % items.length);
    else if (key.downArrow || input === 'j') setIndex((previous: number) => (previous + 1) % items.length);
    else if (key.return) onSelect(index);
    else if (key.escape) onCancel?.();
    else {
      const picked = Number.parseInt(input, 10) - 1;
      if (picked >= 0 && picked < items.length && picked < 9) onSelect(picked);
    }
  });

  const width = Math.max(...items.map((item: SelectItem, i: number) => `  ${i + 1}. ${item.label}`.length)) + 4;
  return (
    <Box flexDirection="column">
      {items.map((item: SelectItem, i: number) => (
        <Text key={`${i}-${item.label}`}>
          <Text bold={i === index}>
            {`${i === index ? '❯' : ' '} ${i + 1}. ${item.label}`.padEnd(item.description !== undefined ? width : 0)}
          </Text>
          {item.description !== undefined ? <Text dimColor>{item.description}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
