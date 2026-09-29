import { useCallback, type ReactElement } from 'react';
import { Text, useInput, type Key } from 'ink';
import type { GitAssistantClient } from '#mcp/client.js';
import { plural } from '#format.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ErrorView, Screen } from '#ui/components/Screen.js';

/** Read-only: shows the generated PR text. `git-assistant pr --base <branch>` covers a non-default base. */
export function PrDescribe({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.generatePrDescription(), [client]);
  const { state, reload } = useMcpTool(run);

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'b') onBack();
    else if (input === 'r' && state.status !== 'loading') reload();
  });

  if (state.status !== 'success') {
    return (
      <Screen title="Pull request" hints={state.status === 'error' ? ['r retry', 'esc back'] : ['esc back']}>
        {state.status === 'loading' ? <Spinner label="Writing pull request description" /> : null}
        {state.status === 'error' ? <ErrorView message={state.message} /> : null}
      </Screen>
    );
  }

  const { title, body, base, commits } = state.data;
  return (
    <Screen
      title={`Pull request · ${plural(commits, 'commit')} not on ${base}`}
      hints={['r regenerate', 'esc back', 'save it with: git-assistant pr > pr.md']}
    >
      <Text bold>{title}</Text>
      {body !== '' ? <Text>{`\n${body}`}</Text> : null}
    </Screen>
  );
}
