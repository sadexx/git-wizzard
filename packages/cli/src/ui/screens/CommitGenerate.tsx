import { useCallback, useState, type ReactElement } from 'react';
import { useInput, type Key } from 'ink';
import type { CommitResult, Result } from '@git-assistant/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitAssistantClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ConfirmPrompt } from '#ui/components/ConfirmPrompt.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

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
      if (key.escape || input === 'b') onBack();
      else if (input === 'r' && state.status === 'error') reload();
      else if (input === 'a' && state.status === 'error' && !all) setAll(true);
    },
    { isActive: !(state.status === 'success' && phase.kind === 'review') && phase.kind !== 'committing' },
  );

  const title = all ? 'Commit · all tracked changes' : 'Commit · staged changes';
  if (state.status === 'loading') {
    return (
      <Screen title={title} hints={['esc back']}>
        <Spinner label="Generating commit message" />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen title={title} hints={['r retry', ...(all ? [] : ['a include all tracked changes']), 'esc back']}>
        <ErrorView message={state.message} />
      </Screen>
    );
  }

  if (phase.kind === 'review') {
    return (
      <Screen title={title} hints={[]}>
        <ConfirmPrompt
          label="Commit message"
          value={state.data.message}
          onConfirm={commit}
          onAbort={onBack}
          onRegenerate={reload}
        />
      </Screen>
    );
  }
  return (
    <Screen title={title} hints={phase.kind === 'committing' ? [] : ['esc back']}>
      {phase.kind === 'committing' ? <Spinner label="Creating commit" /> : null}
      {phase.kind === 'done' ? (
        <Success>
          Created commit {phase.sha.slice(0, 8)} on {phase.branch}
        </Success>
      ) : null}
      {phase.kind === 'failed' ? <ErrorView message={phase.message} /> : null}
    </Screen>
  );
}
