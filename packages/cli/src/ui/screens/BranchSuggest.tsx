import { useCallback, useState, type ReactElement } from 'react';
import { Box, useInput, type Key } from 'ink';
import { branchTypeSchema, type BranchType, type CreateBranchOutput, type Result } from '@git-assistant/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitAssistantClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { TextInput } from '#ui/components/TextInput.js';
import { ErrorView, Options, Screen, Success } from '#ui/components/Screen.js';
import { hintLabel, validateBranchName, validateHint } from '#ui/inputs.js';

type Phase =
  | { kind: 'choosing' }
  | { kind: 'hint' }
  | { kind: 'type' }
  | { kind: 'name'; initial: string }
  | { kind: 'creating'; name: string }
  | { kind: 'done'; branch: string }
  | { kind: 'failed'; message: string };

const LIST_HINTS = ['↑/↓ select', 'enter choose', 'esc back'];
const TYPES: ReadonlyArray<BranchType | undefined> = [undefined, ...branchTypeSchema.options];

/** Everything `git-assistant branch` does: --type, --hint, pick or edit a name, regenerate. */
export function BranchSuggest({ client, onBack }: { client: GitAssistantClient; onBack: () => void }): ReactElement {
  const [type, setType] = useState<BranchType | undefined>(undefined);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const run = useCallback(() => client.suggestBranchName({ type, hint }), [client, type, hint]);
  const { state, reload } = useMcpTool(run);

  const choosing = (): void => setPhase({ kind: 'choosing' });
  const applyHint = (value: string): void => {
    const next = value === '' ? undefined : value;
    choosing();
    if (next === hint) reload();
    else setHint(next);
  };
  const applyType = (next: BranchType | undefined): void => {
    choosing();
    if (next === type) reload();
    else setType(next);
  };
  const create = (name: string): void => {
    setPhase({ kind: 'creating', name });
    client
      .createBranch({ name })
      .then((result: Result<CreateBranchOutput, ClientError>) => {
        setPhase(
          result.ok ? { kind: 'done', branch: result.value.branch } : { kind: 'failed', message: renderError(result.error) },
        );
      })
      .catch((error: unknown) =>
        setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  const settled = phase.kind === 'done' || phase.kind === 'failed';
  useInput(
    (_input: string, key: Key) => {
      if (key.escape || (settled && key.return)) onBack();
    },
    { isActive: settled || (state.status === 'loading' && phase.kind === 'choosing') },
  );

  const options = <Options items={[`type: ${type ?? 'any'}`, hint && `hint: ${hint}`]} />;

  if (phase.kind === 'hint') {
    return (
      <Screen title="Branch" hints={[]}>
        <TextInput
          label="What is this branch for? (empty clears the hint)"
          initial={hint ?? ''}
          placeholder="e.g. payments retry for the checkout release"
          validate={validateHint}
          onSubmit={applyHint}
          onCancel={choosing}
        />
      </Screen>
    );
  }
  if (phase.kind === 'name') {
    return (
      <Screen title="Branch" hints={[]}>
        <TextInput
          label="Branch name"
          initial={phase.initial}
          validate={validateBranchName}
          onSubmit={create}
          onCancel={choosing}
        />
      </Screen>
    );
  }
  if (phase.kind === 'type') {
    return (
      <Screen title="Branch · type" hints={LIST_HINTS}>
        <SelectList
          items={TYPES.map((candidate: BranchType | undefined) => ({ label: candidate ?? 'any' }))}
          initial={TYPES.indexOf(type)}
          onSelect={(index: number) => applyType(TYPES[index])}
          onCancel={choosing}
        />
      </Screen>
    );
  }
  if (phase.kind === 'creating' || settled) {
    return (
      <Screen title="Branch" hints={settled ? ['enter/esc back'] : []}>
        {phase.kind === 'creating' ? <Spinner label={`Creating ${phase.name}`} /> : null}
        {phase.kind === 'done' ? <Success>Created and switched to {phase.branch}</Success> : null}
        {phase.kind === 'failed' ? <ErrorView message={phase.message} /> : null}
      </Screen>
    );
  }
  if (state.status === 'loading') {
    return (
      <Screen title="Branch" hints={['esc back']}>
        {options}
        <Box marginTop={1}>
          <Spinner label="Suggesting branch names" />
        </Box>
      </Screen>
    );
  }

  const suggestions = state.status === 'success' ? state.data : [];
  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    ...suggestions.map((name: string): [string, string | undefined, () => void] => [name, undefined, () => create(name)]),
    ['Write your own name…', 'starts from the first suggestion', () => setPhase({ kind: 'name', initial: suggestions[0] ?? '' })],
    [state.status === 'error' ? 'Retry' : 'Regenerate', undefined, reload],
    [`Type: ${type ?? 'any'}…`, 'feature, fix, chore, …', () => setPhase({ kind: 'type' })],
    [hintLabel(hint), 'tell the model what it is for', () => setPhase({ kind: 'hint' })],
    ['Back', undefined, onBack],
  ];
  return (
    <Screen title={state.status === 'success' ? 'Branch · pick a name to create it' : 'Branch'} hints={LIST_HINTS}>
      {options}
      {state.status === 'error' ? (
        <Box marginTop={1}>
          <ErrorView message={state.message} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <SelectList
          key={suggestions.join(',')}
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
