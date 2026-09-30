import { useCallback, useState, type ReactElement } from 'react';
import { Box, useInput, type Key } from 'ink';
import type { GitWizzardClient } from '#mcp/client.js';
import { plural } from '#format.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { TextInput } from '#ui/components/TextInput.js';
import { ErrorView, Options, Proposal, Screen } from '#ui/components/Screen.js';
import { hintLabel, validateBase, validateHint } from '#ui/inputs.js';
import { Push } from '#ui/screens/Push.js';

type Phase = { kind: 'view' } | { kind: 'hint' } | { kind: 'base' } | { kind: 'push' };

const LIST_HINTS = ['↑/↓ select', 'enter choose', 'esc back'];

/** Everything `gitwizz pr` does: --base, --hint, regenerate. Read-only; save with `gitwizz pr > pr.md`. */
export function PrDescribe({ client, onBack }: { client: GitWizzardClient; onBack: () => void }): ReactElement {
  const [base, setBase] = useState<string | undefined>(undefined);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'view' });
  const run = useCallback(() => client.generatePrDescription({ base, hint }), [client, base, hint]);
  const { state, reload } = useMcpTool(run);

  const view = (): void => setPhase({ kind: 'view' });
  const applyHint = (value: string): void => {
    const next = value === '' ? undefined : value;
    view();
    if (next === hint) reload();
    else setHint(next);
  };
  const applyBase = (value: string): void => {
    view();
    if (value === base) reload();
    else setBase(value);
  };

  useInput(
    (_input: string, key: Key) => {
      if (key.escape) onBack();
    },
    { isActive: state.status === 'loading' && phase.kind === 'view' },
  );

  const shownBase = base ?? (state.status === 'success' ? state.data.base : undefined);
  const options = <Options items={[`base: ${shownBase ?? 'auto'}`, hint && `hint: ${hint}`]} />;

  if (phase.kind === 'hint') {
    return (
      <Screen title="Pull request" hints={[]}>
        <TextInput
          key="hint"
          label="What should reviewers know about this change? (empty clears the hint)"
          initial={hint ?? ''}
          placeholder="e.g. unblocks the checkout release"
          validate={validateHint}
          onSubmit={applyHint}
          onCancel={view}
        />
      </Screen>
    );
  }
  if (phase.kind === 'base') {
    return (
      <Screen title="Pull request" hints={[]}>
        <TextInput
          key="base"
          label="Base branch the PR targets"
          initial={shownBase ?? ''}
          placeholder="e.g. origin/main"
          validate={validateBase}
          onSubmit={applyBase}
          onCancel={view}
        />
      </Screen>
    );
  }
  if (phase.kind === 'push') return <Push client={client} onBack={view} />;
  if (state.status === 'loading') {
    return (
      <Screen title="Pull request" hints={['esc back']}>
        {options}
        <Box marginTop={1}>
          <Spinner label="Writing pull request description" />
        </Box>
      </Screen>
    );
  }

  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    [state.status === 'error' ? 'Retry' : 'Regenerate', undefined, reload],
    ['Change base…', 'default: origin’s default branch, else main/master', () => setPhase({ kind: 'base' })],
    [hintLabel(hint), 'tell the model what matters', () => setPhase({ kind: 'hint' })],
    ['Push…', 'the PR needs this branch on the remote', () => setPhase({ kind: 'push' })],
    ['Back', undefined, onBack],
  ];
  return (
    <Screen
      title={
        state.status === 'success'
          ? `Pull request · ${plural(state.data.commits, 'commit')} not on ${state.data.base}`
          : 'Pull request'
      }
      hints={[...LIST_HINTS, ...(state.status === 'success' ? ['save it with: gitwizz pr > pr.md'] : [])]}
    >
      {options}
      <Box marginY={1} flexDirection="column">
        {state.status === 'success' ? (
          <Proposal text={`${state.data.title}\n\n${state.data.body}`} />
        ) : (
          <ErrorView message={state.message} />
        )}
      </Box>
      <SelectList
        key={state.status}
        items={actions.map(([label, description]: [string, string | undefined, () => void]) =>
          description === undefined ? { label } : { label, description },
        )}
        onSelect={(index: number) => actions[index]?.[2]()}
        onCancel={onBack}
      />
    </Screen>
  );
}
