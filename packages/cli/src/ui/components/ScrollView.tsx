import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Box, Text, useBoxMetrics, useInput, useWindowSize, type DOMElement, type Key } from 'ink';

/**
 * Rows taken by everything but a windowed list: the one-line header, the screen title and hints with
 * their margins, and one "x–y of n" line under the list.
 */
export const CHROME_ROWS = 7;

/** Pre-rendered (ANSI-styled) lines in a window that fits the terminal; ↑/↓, PgUp/PgDn, g/G to move. */
export function ScrollView({ lines }: { lines: readonly string[] }): ReactElement {
  const { rows } = useWindowSize();
  const height = Math.max(5, rows - CHROME_ROWS);
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

/**
 * Any content in the height its parent leaves it (as a flex item that shrinks); when that is too
 * little, PgUp/PgDn scroll it. Measured after layout, so wrapped lines and resizes count.
 */
export function Scroll({ children }: { children: ReactNode }): ReactElement {
  const view = useRef<DOMElement>(null);
  const content = useRef<DOMElement>(null);
  const { height } = useBoxMetrics(view);
  const { height: total } = useBoxMetrics(content);
  const maxOffset = Math.max(0, total - height);
  const [offset, setOffset] = useState(0);
  const top = Math.min(offset, maxOffset);
  const page = Math.max(1, height - 1);

  useInput(
    (_input: string, key: Key) => {
      if (key.pageUp) setOffset(Math.max(0, top - page));
      else if (key.pageDown) setOffset(Math.min(maxOffset, top + page));
    },
    { isActive: maxOffset > 0 },
  );

  return (
    <Box flexDirection="column" flexShrink={1}>
      <Box ref={view} flexDirection="column" flexShrink={1} overflow="hidden">
        <Box ref={content} flexDirection="column" flexShrink={0} marginTop={-top}>
          {children}
        </Box>
      </Box>
      {maxOffset > 0 ? (
        <Box flexShrink={0}>
          <Text dimColor>
            rows {top + 1}–{top + height} of {total} · PgUp/PgDn scroll
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
