import { useCallback, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { GitAssistantClient } from '#mcp/client.js';
import { plural } from '#format.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';

/** Read-only: shows the generated PR text. `git-assistant pr --base <branch>` covers a non-default base. */
export function PrDescribe({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.generatePrDescription(), [client]);
  const { state, reload } = useMcpTool(run);

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'b') onBack();
    else if (input === 'r' && state.status !== 'loading') reload();
  });

  if (state.status === 'loading') return <Spinner label="Writing pull request description..." />;
  if (state.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">{state.message}</Text>
        <Text dimColor>r: retry · b/Esc: back</Text>
      </Box>
    );
  }

  const { title, body, base, commits } = state.data;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {plural(commits, 'commit')} not on {base}
      </Text>
      <Text bold>{title}</Text>
      {body !== '' ? <Text>{`\n${body}`}</Text> : null}
      <Text dimColor>{'\n'}r: regenerate · b/Esc: back · save it with: git-assistant pr &gt; pr.md</Text>
    </Box>
  );
}
