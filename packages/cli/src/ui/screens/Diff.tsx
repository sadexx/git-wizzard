import { useCallback, useState, type ReactElement } from 'react';
import { useInput, type Key } from 'ink';
import type { GitWizzardClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { DiffView } from '#ui/components/DiffView.js';
import { ErrorView, Screen } from '#ui/components/Screen.js';

export function Diff({ client, onBack }: { client: GitWizzardClient; onBack: () => void }): ReactElement {
  const [staged, setStaged] = useState(false);
  const run = useCallback(() => client.getDiff({ staged }), [client, staged]);
  const { state, reload } = useMcpTool(run);

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'b') onBack();
    else if (input === 's') setStaged((wasStaged: boolean) => !wasStaged);
    else if (input === 'r' && state.status !== 'loading') reload();
  });

  return (
    <Screen
      title={staged ? 'Diff · staged' : 'Diff · unstaged'}
      hints={[`s show ${staged ? 'unstaged' : 'staged'}`, 'r refresh', 'esc back']}
    >
      {state.status === 'loading' ? <Spinner label="Loading diff" /> : null}
      {state.status === 'error' ? <ErrorView message={state.message} /> : null}
      {/* key: a fresh scroll position when switching between staged and unstaged */}
      {state.status === 'success' ? <DiffView key={String(staged)} diff={state.data} /> : null}
    </Screen>
  );
}
