import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';

/**
 * Single-line input in a rounded box. Enter submits the trimmed value (after `validate`, which
 * returns an error message or undefined), esc cancels, ctrl+u clears. Typing appends at the end.
 */
export function TextInput({
  label,
  initial = '',
  placeholder = '',
  validate,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((input: string, key: Key) => {
    if (key.return) {
      const trimmed = value.trim();
      const problem = validate?.(trimmed);
      if (problem !== undefined) setError(problem);
      else onSubmit(trimmed);
    } else if (key.escape) onCancel();
    else if (key.backspace || key.delete) setValue((previous: string) => previous.slice(0, -1));
    else if (key.ctrl && input === 'u') setValue('');
    else if (input !== '' && !key.ctrl && !key.meta) {
      // Pasted text: newlines become spaces, other control characters are dropped.
      const text = input.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
      setValue((previous: string) => previous + text);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text>
          <Text dimColor>{'> '}</Text>
          {value === '' ? <Text dimColor>{placeholder}</Text> : value}
          <Text inverse> </Text>
        </Text>
      </Box>
      {error !== undefined ? <Text bold>✗ {error}</Text> : null}
      <Text dimColor>enter submit · esc cancel · ctrl+u clear</Text>
    </Box>
  );
}
