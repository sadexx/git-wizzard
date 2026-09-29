import { useState, type ReactElement } from 'react';
import { Box, Text } from 'ink';
import { hookPath, hookState, installHook, uninstallHook } from '#commands/hook.js';
import { SelectList } from '#ui/components/SelectList.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

const STATE_TEXT = {
  installed: 'installed',
  absent: 'not installed',
  foreign: 'a hook git-wizzard did not write is in place (left alone)',
} as const;

/** `gitwizz hook install` / `uninstall`, with the current state shown up front. */
export function Hook({ onBack }: { onBack: () => void }): ReactElement {
  const path = hookPath();
  const [result, setResult] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  if (path === undefined) {
    return (
      <Screen title="Git hook" hints={['esc back']}>
        <ErrorView message={'error: Not a git repository\nhint: Run gitwizz from inside a git repository.'} />
        <Box marginTop={1}>
          <SelectList items={[{ label: 'Back' }]} onSelect={onBack} onCancel={onBack} />
        </Box>
      </Screen>
    );
  }

  const state = hookState(path);
  const install = (): void => {
    // The script itself (its shebang finds node), same as the CLI, so a node upgrade doesn't break the hook.
    const outcome = installHook(path, [process.argv[1] ?? 'gitwizz']);
    setResult(
      outcome === 'foreign'
        ? { ok: false, text: 'A hook git-wizzard did not write is in place; remove or rename it first.' }
        : { ok: true, text: outcome === 'installed' ? 'Installed. Plain "git commit" now opens with an AI draft.' : 'Updated.' },
    );
  };
  const uninstall = (): void => {
    const outcome = uninstallHook(path);
    setResult(
      outcome === 'foreign'
        ? { ok: false, text: 'That hook was not installed by git-wizzard; leaving it in place.' }
        : { ok: true, text: outcome === 'removed' ? 'Removed.' : 'Nothing to remove.' },
    );
  };

  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    ...(state === 'foreign' ? [] : [[state === 'installed' ? 'Update' : 'Install', 'draft messages inside plain git commit', install] as [string, string, () => void]]),
    ...(state === 'installed' ? [['Uninstall', undefined, uninstall] as [string, undefined, () => void]] : []),
    ['Back', undefined, onBack],
  ];
  return (
    <Screen title="Git hook" hints={['↑/↓ select', 'enter choose', 'esc back']}>
      <Text>
        prepare-commit-msg: <Text bold>{STATE_TEXT[state]}</Text>
      </Text>
      <Text dimColor wrap="truncate-middle">
        {path}
      </Text>
      <Text dimColor>
        A plain git commit opens your editor with a generated draft; -m, --amend, merges and squashes are left alone.
      </Text>
      {result !== undefined ? (
        <Box marginTop={1}>{result.ok ? <Success>{result.text}</Success> : <Text bold>✗ {result.text}</Text>}</Box>
      ) : null}
      <Box marginTop={1}>
        <SelectList
          key={state}
          items={actions.map(([label, description]: [string, string | undefined, () => void]) =>
            description === undefined ? { label } : { label, description },
          )}
          onSelect={(index: number) => actions[index]?.[2]()}
          onCancel={onBack}
        />
      </Box>
    </Screen>
  );
}
