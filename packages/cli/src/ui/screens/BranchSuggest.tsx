import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import { formatError } from '@git-assistant/shared';
import type { GitAssistantClient } from '@/mcp/client.js';
import { useMcpTool } from '@/ui/hooks/useMcpTool.js';
import { Spinner } from '@/ui/components/Spinner.js';
import { ConfirmPrompt } from '@/ui/components/ConfirmPrompt.js';

type Phase =
  | { kind: 'choosing'; index: number }
  | { kind: 'confirming'; name: string }
  | { kind: 'creating' }
  | { kind: 'done'; branch: string }
  | { kind: 'failed'; message: string };

export function BranchSuggest({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.suggestBranchName({}), [client]);
  const { state } = useMcpTool(run);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing', index: 0 });
  const suggestions = state.status === 'success' ? state.data : [];

  const createBranch = useCallback(
    (name: string) => {
      setPhase({ kind: 'creating' });
      client
        .createBranch({ name })
        .then((result) => {
          setPhase(
            result.ok
              ? { kind: 'done', branch: result.value.branch }
              : { kind: 'failed', message: formatError(result.error) },
          );
        })
        .catch((error: unknown) =>
          setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
        );
    },
    [client],
  );

  useInput(
    (input, key) => {
      if (state.status !== 'success') {
        if (key.escape || input === 'b') onBack();
        return;
      }
      if (phase.kind === 'choosing') {
        if (key.upArrow) setPhase({ kind: 'choosing', index: Math.max(0, phase.index - 1) });
        else if (key.downArrow)
          setPhase({ kind: 'choosing', index: Math.min(suggestions.length - 1, phase.index + 1) });
        else if (key.return) {
          const name = suggestions[phase.index];
          if (name !== undefined) setPhase({ kind: 'confirming', name });
        } else if (key.escape || input === 'b') onBack();
      } else if (phase.kind === 'done' || phase.kind === 'failed') {
        if (key.escape || input === 'b') onBack();
      }
    },
    { isActive: phase.kind !== 'confirming' },
  );

  if (state.status === 'loading') return <Spinner label="Requesting branch suggestions..." />;
  if (state.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">{state.message}</Text>
        <Text dimColor>b/Esc: back</Text>
      </Box>
    );
  }

  if (phase.kind === 'confirming') {
    return (
      <ConfirmPrompt
        label="Create branch"
        value={phase.name}
        onConfirm={createBranch}
        onAbort={() => setPhase({ kind: 'choosing', index: 0 })}
      />
    );
  }
  if (phase.kind === 'creating') return <Spinner label="Creating branch..." />;
  if (phase.kind === 'done') {
    return (
      <Box flexDirection="column">
        <Text color="green">Created and switched to {phase.branch}.</Text>
        <Text dimColor>b/Esc: back</Text>
      </Box>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Box flexDirection="column">
        <Text color="red">{phase.message}</Text>
        <Text dimColor>b/Esc: back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Branch suggestions</Text>
      {suggestions.map((name, i) => (
        <Text key={name} {...(i === phase.index && { color: 'green' })}>
          {i === phase.index ? '❯ ' : '  '}
          {name}
        </Text>
      ))}
      <Text dimColor>↑/↓ select · Enter confirm · b/Esc back</Text>
    </Box>
  );
}
