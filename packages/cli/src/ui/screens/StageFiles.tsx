import { useCallback, useState, type ReactElement } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';
import type { GitFileChange, GitStatus, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';
import type { ClientError, GitWizzardClient } from '#mcp/client.js';
import { useMcpTool } from '#ui/hooks/useMcpTool.js';
import { Spinner } from '#ui/components/Spinner.js';
import { ErrorView, Screen } from '#ui/components/Screen.js';
import { CHROME_ROWS } from '#ui/components/ScrollView.js';
import { changeLabel, stagedState, stagingPlan } from '#ui/staging.js';

const BOX: Record<'all' | 'part' | 'none', string> = { all: '[x]', part: '[~]', none: '[ ]' };

/** Tick files in or out of the index, like `git add` / `git reset` per file. `onDone` fires only if something changed. */
export function StageFiles({
  client,
  onDone,
  onCancel,
}: {
  client: GitWizzardClient;
  onDone: () => void;
  onCancel: () => void;
}): ReactElement {
  const run = useCallback(() => client.getStatus(), [client]);
  const { state } = useMcpTool(run);
  const [cursor, setCursor] = useState(0);
  const [wanted, setWanted] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [phase, setPhase] = useState<{ kind: 'pick' } | { kind: 'applying' } | { kind: 'failed'; message: string }>({
    kind: 'pick',
  });
  const { stdout } = useStdout();

  // ponytail: conflicted files stay out; resolving a merge is git's job, not a checkbox.
  const files = state.status === 'success' ? state.data.files.filter((file: GitFileChange) => file.index !== 'conflicted') : [];
  const shown = (file: GitFileChange): 'all' | 'part' | 'none' => {
    const want = wanted.get(file.path);
    return want === undefined ? stagedState(file) : want ? 'all' : 'none';
  };
  const set = (targets: readonly GitFileChange[], value: boolean): void =>
    setWanted((previous: ReadonlyMap<string, boolean>) => {
      const next = new Map(previous);
      for (const file of targets) next.set(file.path, value);
      return next;
    });
  const apply = (): void => {
    const plan = stagingPlan(files, wanted);
    if (plan.stage.length === 0 && plan.unstage.length === 0) return onCancel();
    setPhase({ kind: 'applying' });
    client
      .stageFiles(plan)
      .then((result: Result<GitStatus, ClientError>) =>
        result.ok ? onDone() : setPhase({ kind: 'failed', message: renderError(result.error) }),
      )
      .catch((error: unknown) =>
        setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  useInput(
    (input: string, key: Key) => {
      if (key.escape) return onCancel();
      if (state.status !== 'success' || phase.kind === 'failed' || files.length === 0) {
        if (key.return && state.status !== 'loading') onCancel();
        return;
      }
      const current = files[cursor];
      if (key.upArrow || input === 'k') setCursor((previous: number) => (previous - 1 + files.length) % files.length);
      else if (key.downArrow || input === 'j') setCursor((previous: number) => (previous + 1) % files.length);
      else if (input === ' ' && current !== undefined) set([current], shown(current) !== 'all');
      else if (input === 'a') set(files, files.some((file: GitFileChange) => shown(file) !== 'all'));
      else if (key.return) apply();
    },
    { isActive: phase.kind !== 'applying' },
  );

  if (state.status === 'loading') {
    return (
      <Screen title="Stage files" hints={['esc back']}>
        <Spinner label="Reading status" />
      </Screen>
    );
  }
  if (state.status === 'error' || phase.kind === 'failed') {
    return (
      <Screen title="Stage files" hints={['enter/esc back']}>
        <ErrorView message={state.status === 'error' ? state.message : phase.kind === 'failed' ? phase.message : ''} />
      </Screen>
    );
  }
  if (files.length === 0) {
    return (
      <Screen title="Stage files" hints={['enter/esc back']}>
        <Text>Nothing to stage: the working tree is clean.</Text>
      </Screen>
    );
  }

  // Keep the cursor row on screen: a window of rows that slides with it.
  const height = Math.max(5, (stdout.rows || 24) - CHROME_ROWS);
  const start = Math.min(Math.max(0, cursor - height + 1), Math.max(0, files.length - height));
  const width = Math.max(...files.map((file: GitFileChange) => file.path.length)) + 2;
  return (
    <Screen
      title="Stage files"
      hints={phase.kind === 'applying' ? [] : ['↑/↓ select', 'space toggle', 'a all/none', 'enter apply', 'esc back']}
    >
      {files.slice(start, start + height).map((file: GitFileChange, i: number) => (
        <Text key={file.path} wrap="truncate-end">
          <Text bold={start + i === cursor}>{`${start + i === cursor ? '❯' : ' '} ${BOX[shown(file)]} ${file.path.padEnd(width)}`}</Text>
          <Text dimColor>
            {changeLabel(file)}
            {shown(file) === 'part' ? ' · partly staged' : ''}
          </Text>
        </Text>
      ))}
      {files.length > height ? (
        <Text dimColor>
          files {start + 1}–{Math.min(files.length, start + height)} of {files.length}
        </Text>
      ) : null}
      {phase.kind === 'applying' ? (
        <Box marginTop={1}>
          <Spinner label="Updating the index" />
        </Box>
      ) : null}
    </Screen>
  );
}
