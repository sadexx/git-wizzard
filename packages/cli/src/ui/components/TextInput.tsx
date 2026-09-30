import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { editLine, type Line } from '#ui/inputs.js';

/**
 * Single-line input in a rounded box. Enter submits the trimmed value (after `validate`, which
 * returns an error message or undefined), esc cancels; editing keys are `editLine`'s.
 */
export function TextInput({
  label,
  initial = '',
  placeholder = '',
  validate,
  onSubmit,
  onCancel,
  mask = false,
}: {
  label: string;
  initial?: string;
  placeholder?: string;
  /** Show • per character (API keys). */
  mask?: boolean;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [line, setLine] = useState<Line>({ value: initial, cursor: [...initial].length });
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((input: string, key: Key) => {
    if (key.return) {
      const trimmed = line.value.trim();
      const problem = validate?.(trimmed);
      if (problem !== undefined) setError(problem);
      else onSubmit(trimmed);
    } else if (key.escape) onCancel();
    // Keys can arrive faster than renders: edit the latest line, not this render's.
    else if (editLine(line, input, key) !== undefined) {
      setLine((previous: Line) => editLine(previous, input, key) ?? previous);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <FieldBox line={line} placeholder={placeholder} mask={mask} />
      {error !== undefined ? <Text bold>✗ {error}</Text> : null}
      <Text dimColor>enter submit · esc cancel · ←/→ move · ctrl+u clear</Text>
    </Box>
  );
}

/** The rounded "> text" box with the cursor drawn as an inverse cell. */
export function FieldBox({ line, placeholder, mask = false }: { line: Line; placeholder: string; mask?: boolean }): ReactElement {
  const chars = [...line.value].map((char: string) => (mask ? '•' : char));
  return (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      <Text>
        <Text dimColor>{'> '}</Text>
        {chars.slice(0, line.cursor).join('')}
        <Text inverse>{chars[line.cursor] ?? ' '}</Text>
        {chars.slice(line.cursor + 1).join('')}
        {chars.length === 0 ? <Text dimColor>{placeholder}</Text> : null}
      </Text>
    </Box>
  );
}
