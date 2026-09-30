import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';

/** Rows used by the header box, screen title, hints, and margins around a scrollable body. */
export const CHROME_ROWS = 11;

/** Pre-rendered (ANSI-styled) lines in a window that fits the terminal; ↑/↓, PgUp/PgDn, g/G to move. */
export function ScrollView({ lines }: { lines: readonly string[] }): ReactElement {
  const { stdout } = useStdout();
  const height = Math.max(5, (stdout.rows || 24) - CHROME_ROWS);
  const maxOffset = Math.max(0, lines.length - height);
  const [offset, setOffset] = useState(0);
  const move = (delta: number): void => setOffset((previous: number) => Math.min(maxOffset, Math.max(0, previous + delta)));

  useInput(
    (input: string, key: Key) => {
      if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (key.pageUp) move(-height);
      else if (key.pageDown || input === ' ') move(height);
      else if (input === 'g') setOffset(0);
      else if (input === 'G') setOffset(maxOffset);
    },
    { isActive: maxOffset > 0 },
  );

  const start = Math.min(offset, maxOffset);
  return (
    <Box flexDirection="column">
      {lines.slice(start, start + height).map((line: string, i: number) => (
        <Text key={start + i} wrap="truncate-end">
          {line === '' ? ' ' : line}
        </Text>
      ))}
      {maxOffset > 0 ? (
        <Text dimColor>
          lines {start + 1}–{Math.min(lines.length, start + height)} of {lines.length} · ↑/↓ PgUp/PgDn g/G scroll
        </Text>
      ) : null}
    </Box>
  );
}
