import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { GitAssistantClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { DiffView } from '#ui/components/DiffView.js';

export function Diff({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const [staged, setStaged] = useState(false);
  const run = useCallback(() => client.getDiff({ staged }), [client, staged]);
  const { state } = useMcpTool(run);

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'b') onBack();
    else if (input === 's') setStaged((wasStaged: boolean) => !wasStaged);
  });

  return (
    <Box flexDirection="column">
      {state.status === 'loading' ? <Spinner label="Loading diff..." /> : null}
      {state.status === 'error' ? <Text color="red">{state.message}</Text> : null}
      {state.status === 'success' ? <DiffView diff={state.data} /> : null}
      <Text dimColor>s: {staged ? 'staged' : 'unstaged'} (toggle) · b/Esc: back</Text>
    </Box>
  );
}
