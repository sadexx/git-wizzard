import { useState, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmPromptProps {
  label: string;
  value: string;
  onConfirm: (value: string) => void;
  onAbort: () => void;
  allowEdit?: boolean;
}

export function ConfirmPrompt({
  label,
  value,
  onConfirm,
  onAbort,
  allowEdit = true,
}: ConfirmPromptProps): ReactElement {
  const [current, setCurrent] = useState(value);
  const [editing, setEditing] = useState(false);

  useInput((input, key) => {
    if (editing) {
      if (key.return || key.escape) {
        setEditing(false);
        return;
      }

      if (key.backspace || key.delete) {
        setCurrent((v) => v.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) setCurrent((v) => v + input);
      return;
    }

    if (input === 'c' || key.return) onConfirm(current);
    else if (input === 'a' || key.escape) onAbort();
    else if (input === 'e' && allowEdit) setEditing(true);
  });

  return (
    <Box flexDirection="column">
      <Text bold>{label}:</Text>
      {editing ? (
        <Text>
          {current}
          <Text inverse></Text>
        </Text>
      ) : (
        <Text>{current}</Text>
      )}
      <Text dimColor>
        {editing ? 'Type to edit · Enter/Esc to finish' : `[c]onfirm · ${allowEdit ? '[e]dit · ' : ''}[a]bort`}
      </Text>
    </Box>
  );
}
