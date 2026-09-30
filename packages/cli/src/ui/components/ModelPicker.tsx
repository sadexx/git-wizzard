import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import { CHROME_ROWS } from '#ui/components/ScrollView.js';
import { FieldBox } from '#ui/components/TextInput.js';
import { editLine, rankModels, type Line } from '#ui/inputs.js';

/** Rows the label, filter box, and key hints take besides the list. */
const PICKER_ROWS = 5;

/**
 * Type to filter `models`, ↑/↓ to move, enter to take the highlighted one. Whatever you typed is
 * offered too ("Use …"), so a model the server doesn't list still works; with no list it is a text field.
 */
export function ModelPicker({
  label,
  models,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string;
  models: readonly string[];
  /** The current model: highlighted in the list, or prefilled when there is no list. */
  initial: string;
  onSubmit: (model: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [line, setLine] = useState<Line>(() => {
    const query = models.length === 0 ? initial : '';
    return { value: query, cursor: [...query].length };
  });
  // The highlighted row belongs to the text it was picked under; new text starts at the top again.
  const [pick, setPick] = useState({ value: line.value, index: Math.max(0, models.indexOf(initial)) });
  const { rows: windowRows } = useWindowSize();

  const typed = line.value.trim();
  const rows = [...(typed !== '' && !models.includes(typed) ? [typed] : []), ...rankModels(models, typed)];
  const at = Math.min(pick.value === line.value ? pick.index : 0, Math.max(0, rows.length - 1));

  useInput((input: string, key: Key) => {
    if (key.escape) onCancel();
    else if (key.return) {
      const picked = rows[at];
      if (picked !== undefined) onSubmit(picked);
    } else if (key.upArrow) setPick({ value: line.value, index: (at - 1 + rows.length) % Math.max(1, rows.length) });
    else if (key.downArrow) setPick({ value: line.value, index: (at + 1) % Math.max(1, rows.length) });
    // Keys can arrive faster than renders: edit the latest line, not this render's.
    else setLine((previous: Line) => editLine(previous, input, key) ?? previous);
  });

  // A window of rows that follows the cursor, so long lists (OpenAI has dozens) fit the terminal.
  const height = Math.max(3, windowRows - CHROME_ROWS - PICKER_ROWS);
  const start = Math.min(Math.max(0, at - height + 1), Math.max(0, rows.length - height));
  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <FieldBox line={line} placeholder={models.length > 0 ? 'type to filter' : 'model name'} />
      {rows.slice(start, start + height).map((model: string, i: number) => (
        <Text key={model} wrap="truncate-end">
          <Text bold={start + i === at}>{`${start + i === at ? '❯' : ' '} ${model}`}</Text>
          {model === typed && !models.includes(typed) && models.length > 0 ? <Text dimColor> · not in the list, use as typed</Text> : null}
          {model === initial ? <Text dimColor> · current</Text> : null}
        </Text>
      ))}
      {rows.length > height ? (
        <Text dimColor>
          {start + 1}–{Math.min(rows.length, start + height)} of {rows.length}
        </Text>
      ) : null}
      <Text dimColor>
        {models.length > 0 ? 'type to filter · ↑/↓ select · enter choose · esc back' : 'enter submit · esc back'}
      </Text>
    </Box>
  );
}
