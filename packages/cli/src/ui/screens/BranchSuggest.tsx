import { useCallback, useState, type ReactElement } from 'react';
import { Text, useInput, type Key } from 'ink';
import type { CreateBranchOutput, Result } from '@git-assistant/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitAssistantClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ConfirmPrompt } from '#ui/components/ConfirmPrompt.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

type Phase =
  | { kind: 'choosing'; index: number }
  | { kind: 'confirming'; name: string }
  | { kind: 'creating' }
  | { kind: 'done'; branch: string }
  | { kind: 'failed'; message: string };

export function BranchSuggest({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.suggestBranchName({}), [client]);
  const { state, reload } = useMcpTool(run);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing', index: 0 });
  const suggestions = state.status === 'success' ? state.data : [];
  const regenerate = useCallback(() => {
    setPhase({ kind: 'choosing', index: 0 });
    reload();
  }, [reload]);

  const createBranch = useCallback(
    (name: string) => {
      setPhase({ kind: 'creating' });
      client
        .createBranch({ name })
        .then((result: Result<CreateBranchOutput, ClientError>) => {
          setPhase(
            result.ok
              ? { kind: 'done', branch: result.value.branch }
              : { kind: 'failed', message: renderError(result.error) },
          );
        })
        .catch((error: unknown) =>
          setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
        );
    },
    [client],
  );

  useInput(
    (input: string, key: Key) => {
      if (state.status !== 'success') {
        if (key.escape || input === 'b') onBack();
        else if (input === 'r' && state.status === 'error') regenerate();
        return;
      }
      if (phase.kind === 'choosing') {
        if (key.upArrow) setPhase({ kind: 'choosing', index: Math.max(0, phase.index - 1) });
        else if (key.downArrow)
          setPhase({ kind: 'choosing', index: Math.min(suggestions.length - 1, phase.index + 1) });
        else if (key.return) {
          const name = suggestions[phase.index];
          if (name !== undefined) setPhase({ kind: 'confirming', name });
        } else if (input === 'r') regenerate();
        else if (key.escape || input === 'b') onBack();
      } else if (phase.kind === 'done' || phase.kind === 'failed') {
        if (key.escape || input === 'b') onBack();
      }
    },
    { isActive: phase.kind !== 'confirming' && phase.kind !== 'creating' },
  );

  if (state.status !== 'success') {
    return (
      <Screen title="Branch" hints={state.status === 'error' ? ['r retry', 'esc back'] : ['esc back']}>
        {state.status === 'loading' ? <Spinner label="Suggesting branch names" /> : null}
        {state.status === 'error' ? <ErrorView message={state.message} /> : null}
      </Screen>
    );
  }

  if (phase.kind === 'confirming') {
    return (
      <Screen title="Branch" hints={[]}>
        <ConfirmPrompt
          label="Create branch"
          value={phase.name}
          onConfirm={createBranch}
          onAbort={() => setPhase({ kind: 'choosing', index: 0 })}
        />
      </Screen>
    );
  }
  if (phase.kind !== 'choosing') {
    return (
      <Screen title="Branch" hints={phase.kind === 'creating' ? [] : ['esc back']}>
        {phase.kind === 'creating' ? <Spinner label="Creating branch" /> : null}
        {phase.kind === 'done' ? <Success>Created and switched to {phase.branch}</Success> : null}
        {phase.kind === 'failed' ? <ErrorView message={phase.message} /> : null}
      </Screen>
    );
  }

  return (
    <Screen title="Branch · suggestions" hints={['↑/↓ select', 'enter create', 'r regenerate', 'esc back']}>
      {suggestions.map((name: string, i: number) => (
        <Text key={name} bold={i === phase.index}>
          {i === phase.index ? '❯ ' : '  '}
          {name}
        </Text>
      ))}
    </Screen>
  );
}
