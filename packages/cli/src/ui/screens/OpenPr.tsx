import { useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { CreatePullRequestOutput, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitWizzardClient } from '#mcp/client.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

type Phase =
  | { kind: 'confirm' }
  | { kind: 'opening' }
  | { kind: 'done'; created: CreatePullRequestOutput }
  | { kind: 'failed'; message: string };

/** `gh pr create` with the generated title and body, pushing the branch first when needed. Asks before anything leaves the machine. */
export function OpenPr({
  client,
  title,
  body,
  base,
  onBack,
}: {
  client: GitWizzardClient;
  title: string;
  body: string;
  base: string;
  onBack: () => void;
}): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const open = (): void => {
    setPhase({ kind: 'opening' });
    client
      .createPullRequest({ title, body, base })
      .then((result: Result<CreatePullRequestOutput, ClientError>) =>
        setPhase(result.ok ? { kind: 'done', created: result.value } : { kind: 'failed', message: renderError(result.error) }),
      )
      .catch((error: unknown) =>
        setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  useInput(
    (_input: string, key: Key) => {
      if (key.escape || key.return) onBack();
    },
    { isActive: phase.kind === 'done' || phase.kind === 'failed' },
  );

  if (phase.kind === 'opening') {
    return (
      <Screen title="Open pull request" hints={[]}>
        <Spinner label="Opening pull request" />
      </Screen>
    );
  }
  if (phase.kind === 'done') {
    return (
      <Screen title="Open pull request" hints={['enter/esc back']}>
        <Success>
          {phase.created.pushed ? 'Pushed the branch and opened ' : 'Opened '}
          {phase.created.url}
        </Success>
      </Screen>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Screen title="Open pull request" hints={['enter/esc back']}>
        <ErrorView message={phase.message} />
      </Screen>
    );
  }
  return (
    <Screen title="Open pull request" hints={['↑/↓ select', 'enter choose', 'esc back']}>
      <Text>
        Open “<Text bold>{title}</Text>” into {base} on GitHub with gh?
      </Text>
      <Text dimColor>The branch is pushed first if the remote is missing it or any of its commits.</Text>
      <Box marginTop={1}>
        <SelectList
          items={[{ label: 'Open PR' }, { label: 'Back' }]}
          onSelect={(index: number) => (index === 0 ? open() : onBack())}
          onCancel={onBack}
        />
      </Box>
    </Screen>
  );
}
