import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useApp, useInput, type Key } from 'ink';
import type { CommitResult, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';
import { editViaEditor } from '#commands/prompt.js';
import type { ClientError, GitWizzardClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { TextInput } from '#ui/components/TextInput.js';
import { ErrorView, Options, Proposal, Screen, Success } from '#ui/components/Screen.js';
import { hintLabel, validateHint } from '#ui/inputs.js';
import { StageFiles } from '#ui/screens/StageFiles.js';
import { Push } from '#ui/screens/Push.js';

type Phase =
  | { kind: 'review' }
  | { kind: 'hint' }
  | { kind: 'stage' }
  | { kind: 'push' }
  | { kind: 'committing' }
  | { kind: 'done'; sha: string; branch: string; summary: string }
  | { kind: 'failed'; message: string };

const LIST_HINTS = ['↑/↓ select', 'enter choose', 'esc back'];

/** Everything `gitwizz commit` does: staged or all tracked (-a), --hint, edit, regenerate; plus picking what is staged. */
export function CommitGenerate({ client, onBack }: { client: GitWizzardClient; onBack: () => void }): ReactElement {
  const [all, setAll] = useState(false);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const run = useCallback(() => client.generateCommitMessage({ all, hint }), [client, all, hint]);
  const { state, reload } = useMcpTool(run);
  const { suspendTerminal } = useApp();

  // Any fresh generation replaces hand edits. Changing `all` or `hint` regenerates via `run`.
  const regenerate = (): void => {
    setEdited(undefined);
    setNotice(undefined);
    reload();
  };
  const toggleScope = (): void => {
    setEdited(undefined);
    setAll((previous: boolean) => !previous);
  };
  const applyHint = (value: string): void => {
    const next = value === '' ? undefined : value;
    setPhase({ kind: 'review' });
    if (next === hint) regenerate();
    else {
      setEdited(undefined);
      setHint(next);
    }
  };
  const edit = (current: string): void => {
    // Hand the terminal to the editor; Ink restores its full screen and redraws afterwards.
    void suspendTerminal(() => {
      const result = editViaEditor(current);
      if (result === undefined) setNotice('Could not open an editor; set GIT_EDITOR or core.editor.');
      else if (result !== '') setEdited(result);
    });
  };
  const commit = (message: string): void => {
    setPhase({ kind: 'committing' });
    client
      .createCommit({ message, all })
      .then((result: Result<CommitResult, ClientError>) => {
        setPhase(
          result.ok
            ? { kind: 'done', ...result.value }
            : { kind: 'failed', message: renderError(result.error) },
        );
      })
      .catch((error: unknown) =>
        setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  const settled = phase.kind === 'done' || phase.kind === 'failed';
  // After a commit, the Push/Back list handles the keys.
  useInput(
    (_input: string, key: Key) => {
      if (key.escape || (settled && key.return)) onBack();
    },
    { isActive: phase.kind === 'failed' || (state.status === 'loading' && phase.kind === 'review') },
  );

  const options = <Options items={[all ? 'all tracked changes' : 'staged changes', hint && `hint: ${hint}`]} />;
  const scopeLabel = all ? 'Only staged changes' : 'Include all tracked changes';

  if (phase.kind === 'hint') {
    return (
      <Screen title="Commit" hints={[]}>
        <TextInput
          label="Why did you make this change? (empty clears the hint)"
          initial={hint ?? ''}
          placeholder="e.g. retry on 429 from the payments API"
          validate={validateHint}
          onSubmit={applyHint}
          onCancel={() => setPhase({ kind: 'review' })}
        />
      </Screen>
    );
  }
  if (phase.kind === 'stage') {
    return (
      <StageFiles
        client={client}
        onDone={() => {
          setPhase({ kind: 'review' });
          regenerate();
        }}
        onCancel={() => setPhase({ kind: 'review' })}
      />
    );
  }
  if (phase.kind === 'push') return <Push client={client} onBack={onBack} />;
  if (phase.kind === 'committing' || settled) {
    return (
      <Screen title="Commit" hints={phase.kind === 'done' ? LIST_HINTS : settled ? ['enter/esc back'] : []}>
        {phase.kind === 'committing' ? <Spinner label="Creating commit" /> : null}
        {phase.kind === 'done' ? (
          <>
            <Success>
              Created commit {phase.sha.slice(0, 8)} on {phase.branch}: {phase.summary}
            </Success>
            <Box marginTop={1}>
              <SelectList
                key="done"
                items={[{ label: 'Push…', description: 'send it to the remote' }, { label: 'Back' }]}
                onSelect={(index: number) => (index === 0 ? setPhase({ kind: 'push' }) : onBack())}
                onCancel={onBack}
              />
            </Box>
          </>
        ) : null}
        {phase.kind === 'failed' ? <ErrorView message={phase.message} /> : null}
      </Screen>
    );
  }
  if (state.status === 'loading') {
    return (
      <Screen title="Commit" hints={['esc back']}>
        {options}
        <Box marginTop={1}>
          <Spinner label="Generating commit message" />
        </Box>
      </Screen>
    );
  }
  if (state.status === 'error') {
    const actions: ReadonlyArray<[string, () => void]> = [
      ['Retry', regenerate],
      ['Choose files…', () => setPhase({ kind: 'stage' })],
      [scopeLabel, toggleScope],
      [hintLabel(hint), () => setPhase({ kind: 'hint' })],
      ['Back', onBack],
    ];
    return (
      <Screen title="Commit" hints={LIST_HINTS}>
        {options}
        <Box marginY={1}>
          <ErrorView message={state.message} />
        </Box>
        <SelectList
          key="error"
          items={actions.map(([label]: [string, () => void]) => ({ label }))}
          onSelect={(index: number) => actions[index]?.[1]()}
          onCancel={onBack}
        />
      </Screen>
    );
  }

  const message = edited ?? state.data.message;
  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    ['Commit', undefined, () => commit(message)],
    ['Edit', 'in your git editor', () => edit(message)],
    ['Regenerate', undefined, regenerate],
    ['Choose files…', 'stage or unstage', () => setPhase({ kind: 'stage' })],
    [hintLabel(hint), 'tell the model why', () => setPhase({ kind: 'hint' })],
    [scopeLabel, all ? 'like git commit' : 'like git commit -a', toggleScope],
    ['Cancel', undefined, onBack],
  ];
  return (
    <Screen title="Commit" hints={LIST_HINTS} scroll={false}>
      {/* A long message scrolls inside its frame; the rest keeps its rows. */}
      <Box flexShrink={0}>{options}</Box>
      <Box marginY={1} flexDirection="column" flexShrink={1} minHeight={4}>
        <Proposal text={message} />
        <Box flexDirection="column" flexShrink={0}>
          {edited !== undefined ? <Text dimColor>edited by you</Text> : null}
          {notice !== undefined ? <Text bold>✗ {notice}</Text> : null}
        </Box>
      </Box>
      <Box flexShrink={0}>
        <SelectList
          key="review"
          items={actions.map(([label, description]: [string, string | undefined, () => void]) =>
            description === undefined ? { label } : { label, description },
          )}
          onSelect={(index: number) => actions[index]?.[2]()}
          onCancel={onBack}
        />
      </Box>
    </Screen>
  );
}
