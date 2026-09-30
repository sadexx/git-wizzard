import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { PushResult, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';
import { plural } from '#format.js';
import type { ClientError, GitWizzardClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

type Phase =
  | { kind: 'confirm' }
  | { kind: 'pushing' }
  | { kind: 'done'; result: PushResult }
  | { kind: 'failed'; message: string };

/** `git push` (or `git push -u` for a new branch) after showing what goes where. Never forces. */
export function Push({ client, onBack }: { client: GitWizzardClient; onBack: () => void }): ReactElement {
  const run = useCallback(() => client.getStatus(), [client]);
  const { state } = useMcpTool(run);
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });

  const push = (): void => {
    setPhase({ kind: 'pushing' });
    client
      .push()
      .then((result: Result<PushResult, ClientError>) =>
        setPhase(result.ok ? { kind: 'done', result: result.value } : { kind: 'failed', message: renderError(result.error) }),
      )
      .catch((error: unknown) =>
        setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  const status = state.status === 'success' ? state.data : undefined;
  const upToDate = status !== undefined && status.upstream !== undefined && status.ahead === 0;
  const confirming = phase.kind === 'confirm' && status !== undefined && !upToDate;
  useInput(
    (_input: string, key: Key) => {
      if (key.escape || (key.return && state.status !== 'loading')) onBack();
    },
    { isActive: phase.kind !== 'pushing' && !confirming },
  );

  if (phase.kind === 'pushing') {
    return (
      <Screen title="Push" hints={[]}>
        <Spinner label="Pushing" />
      </Screen>
    );
  }
  if (phase.kind === 'done') {
    const { branch, upstream, commits } = phase.result;
    return (
      <Screen title="Push" hints={['enter/esc back']}>
        <Success>
          {commits === undefined
            ? `Pushed ${branch} to ${upstream} and set it as the upstream.`
            : `Pushed ${plural(commits, 'commit')} to ${upstream}.`}
        </Success>
      </Screen>
    );
  }
  if (phase.kind === 'failed' || state.status === 'error') {
    return (
      <Screen title="Push" hints={['enter/esc back']}>
        <ErrorView message={phase.kind === 'failed' ? phase.message : state.status === 'error' ? state.message : ''} />
      </Screen>
    );
  }
  if (status === undefined) {
    return (
      <Screen title="Push" hints={['esc back']}>
        <Spinner label="Reading status" />
      </Screen>
    );
  }
  if (upToDate) {
    return (
      <Screen title="Push" hints={['enter/esc back']}>
        <Text>
          Nothing to push: {status.branch} is up to date with {status.upstream}.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen title="Push" hints={['↑/↓ select', 'enter choose', 'esc back']}>
      <Text>
        {status.upstream === undefined
          ? `${status.branch} is not on the remote yet. Push it and set its upstream (git push -u)?`
          : `Push ${plural(status.ahead, 'commit')} on ${status.branch} to ${status.upstream}?`}
      </Text>
      {status.behind > 0 ? (
        <Text dimColor>
          {status.upstream} has {plural(status.behind, 'commit')} you don't have; pull first or the push is rejected.
        </Text>
      ) : null}
      <Box marginTop={1}>
        <SelectList items={[{ label: 'Push' }, { label: 'Back' }]} onSelect={(index: number) => (index === 0 ? push() : onBack())} onCancel={onBack} />
      </Box>
    </Screen>
  );
}
