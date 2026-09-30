import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';
import { CHROME_ROWS } from '#ui/components/ScrollView.js';
import { rankModels } from '#ui/inputs.js';

/** Rows the label, filter box, and hints take above and below the list. */
const PICKER_ROWS = 7;

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
  const [query, setQuery] = useState(models.length === 0 ? initial : '');
  const [cursor, setCursor] = useState(Math.max(0, models.indexOf(initial)));
  const { stdout } = useStdout();

  const typed = query.trim();
  const rows = [...(typed !== '' && !models.includes(typed) ? [typed] : []), ...rankModels(models, typed)];
  const at = Math.min(cursor, Math.max(0, rows.length - 1));

  useInput((input: string, key: Key) => {
    if (key.escape) onCancel();
    else if (key.return) {
      const picked = rows[at];
      if (picked !== undefined) onSubmit(picked);
    } else if (key.upArrow) setCursor((at - 1 + rows.length) % Math.max(1, rows.length));
    else if (key.downArrow) setCursor((at + 1) % Math.max(1, rows.length));
    else if (key.backspace || key.delete) {
      setQuery((previous: string) => previous.slice(0, -1));
      setCursor(0);
    } else if (key.ctrl && input === 'u') {
      setQuery('');
      setCursor(0);
    } else if (input !== '' && !key.ctrl && !key.meta) {
      setQuery((previous: string) => previous + input.replace(/[\x00-\x1f\x7f]/g, ''));
      setCursor(0);
    }
  });

  // A window of rows that follows the cursor, so long lists (OpenAI has dozens) fit the terminal.
  const height = Math.max(3, (stdout.rows || 24) - CHROME_ROWS - PICKER_ROWS);
  const start = Math.min(Math.max(0, at - height + 1), Math.max(0, rows.length - height));
  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text>
          <Text dimColor>{'> '}</Text>
          {query === '' ? <Text dimColor>{models.length > 0 ? 'type to filter' : 'model name'}</Text> : query}
          <Text inverse> </Text>
        </Text>
      </Box>
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
