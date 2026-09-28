import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { CommitResult, Result } from '@git-assistant/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitAssistantClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ConfirmPrompt } from '#ui/components/ConfirmPrompt.js';

type Phase =
  | { kind: 'review' }
  | { kind: 'committing' }
  | { kind: 'done'; sha: string; branch: string }
  | { kind: 'failed'; message: string };

export function CommitGenerate({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  // Like `commit -a`: offered once there is nothing staged; nothing is staged unless the commit is confirmed.
  const [all, setAll] = useState(false);
  const run = useCallback(() => client.generateCommitMessage({ all }), [client, all]);
  const { state, reload } = useMcpTool(run);
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });

  const commit = useCallback(
    (message: string) => {
      setPhase({ kind: 'committing' });
      client
        .createCommit({ message, all })
        .then((result: Result<CommitResult, ClientError>) => {
          setPhase(
            result.ok
              ? { kind: 'done', sha: result.value.sha, branch: result.value.branch }
              : { kind: 'failed', message: renderError(result.error) },
          );
        })
        .catch((error: unknown) =>
          setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
        );
    },
    [client, all],
  );

  useInput(
    (input: string, key: Key) => {
      if (phase.kind === 'done' || phase.kind === 'failed' || state.status === 'error') {
        if (key.escape || input === 'b') onBack();
        else if (input === 'r' && state.status === 'error') reload();
        else if (input === 'a' && state.status === 'error' && !all) setAll(true);
      }
    },
    { isActive: !(state.status === 'success' && phase.kind === 'review') },
  );

  if (state.status === 'loading') return <Spinner label="Generating commit message..." />;
  if (state.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">{state.message}</Text>
        <Text dimColor>r: retry · {all ? '' : 'a: include all tracked changes · '}b/Esc: back</Text>
      </Box>
    );
  }

  if (phase.kind === 'review') {
    return (
      <ConfirmPrompt
        label={all ? 'Commit message (all tracked changes)' : 'Commit message'}
        value={state.data.message}
        onConfirm={commit}
        onAbort={onBack}
        onRegenerate={reload}
      />
    );
  }
  if (phase.kind === 'committing') return <Spinner label="Creating commit..." />;
  if (phase.kind === 'done') {
    return (
      <Box flexDirection="column">
        <Text color="green">
          Created commit {phase.sha.slice(0, 8)} on {phase.branch}
        </Text>
        <Text dimColor>b/Esc: back</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="red">{phase.message}</Text>
      <Text dimColor>b/Esc: back</Text>
    </Box>
  );
}
