import { useCallback, type ReactElement } from 'react';
import { useInput, type Key } from 'ink';
import type { GitWizzardClient } from '#mcp/client.js';
import { formatStatus } from '#commands/status.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ErrorView, Screen } from '#ui/components/Screen.js';
import { ScrollView } from '#ui/components/ScrollView.js';
import { mono } from '#ui/theme.js';

/** Same content as `gitwizz status`, in the UI's monochrome style. */
export function Status({ client, onBack }: { client: GitWizzardClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.getStatus(), [client]);
  const { state, reload } = useMcpTool(run);

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'b') onBack();
    else if (input === 'r' && state.status !== 'loading') reload();
  });

  return (
    <Screen title="Status" hints={['r refresh', 'esc back']}>
      {state.status === 'loading' ? <Spinner label="Reading status" /> : null}
      {state.status === 'error' ? <ErrorView message={state.message} /> : null}
      {state.status === 'success' ? <ScrollView lines={formatStatus(state.data, mono).split('\n')} /> : null}
    </Screen>
  );
}
