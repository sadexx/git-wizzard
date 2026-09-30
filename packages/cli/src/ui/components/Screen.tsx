import type { ReactElement, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { Scroll } from '#ui/components/ScrollView.js';

/**
 * Every screen: a "⏺ Title" line, indented content, and a dim row of key hints, fitted to the
 * terminal. Content taller than the room left scrolls with PgUp/PgDn; with `scroll={false}` the
 * screen fits it itself (children that must stay whole get flexShrink={0}, one part scrolls).
 */
export function Screen({
  title,
  hints,
  scroll = true,
  children,
}: {
  title: string;
  hints: readonly string[];
  scroll?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={1}>
      <Box flexShrink={0}>
        <Text bold>⏺ {title}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={1} flexShrink={1} overflow="hidden">
        {scroll ? <Scroll>{children}</Scroll> : children}
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <Text dimColor>{hints.join(' · ')}</Text>
      </Box>
    </Box>
  );
}

/** A `renderError` block: the error line stands out; indented detail and the hint recede. */
export function ErrorView({ message }: { message: string }): ReactElement {
  const [first = '', ...rest] = message.split('\n');
  const detail = rest.filter((line: string) => line.startsWith('  ')).map((line: string) => line.slice(2));
  const hints = rest.filter((line: string) => !line.startsWith('  '));
  return (
    <Box flexDirection="column">
      <Text bold>✗ {first.replace(/^error: /, '')}</Text>
      {detail.length > 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>{detail.join('\n')}</Text>
        </Box>
      ) : null}
      {hints.map((hint: string) => (
        <Text key={hint} dimColor>
          {hint}
        </Text>
      ))}
    </Box>
  );
}

export function Success({ children }: { children: ReactNode }): ReactElement {
  return <Text>✓ {children}</Text>;
}

/**
 * Generated text awaiting a decision: first line bold, the rest as body, in a dim rounded frame.
 * On a `scroll={false}` screen it shrinks to the room left and scrolls inside the frame.
 */
export function Proposal({ text }: { text: string }): ReactElement {
  const [first = '', ...rest] = text.split('\n');
  const body = rest.join('\n').trim();
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column" flexShrink={1} minHeight={4}>
      <Scroll>
        <Text bold>{first}</Text>
        {body !== '' ? <Text>{`\n${body}`}</Text> : null}
      </Scroll>
    </Box>
  );
}

/** The options steering a generation (scope, type, base, hint), as one dim line. */
export function Options({ items }: { items: ReadonlyArray<string | undefined> }): ReactElement | null {
  const shown = items.filter((item: string | undefined): item is string => item !== undefined);
  return shown.length > 0 ? <Text dimColor>{shown.join(' · ')}</Text> : null;
}
