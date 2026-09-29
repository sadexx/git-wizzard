import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { AppError, AuthError, ProviderName, Result } from '@git-assistant/shared';
import { activeAuth, createAdapter, DEFAULT_MODELS, defaultAuthDeps, type ActiveAuth } from '#auth/flow.js';
import { configPath, deleteConfig, saveConfig } from '#auth/config.js';
import type { ProviderConfig } from '#auth/provider-adapter.js';
import { maskKey } from '#commands/auth.js';
import { renderError } from '#errors.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { TextInput } from '#ui/components/TextInput.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

type Phase =
  | { kind: 'overview'; notice?: string }
  | { kind: 'provider' }
  | { kind: 'model'; provider: ProviderName }
  | { kind: 'key'; provider: ProviderName; model: string }
  | { kind: 'validating'; config: ProviderConfig }
  | { kind: 'invalid'; config: ProviderConfig; message: string };

const LIST_HINTS = ['↑/↓ select', 'enter choose', 'esc back'];
const PROVIDERS: ReadonlyArray<{ name: ProviderName; label: string }> = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'gemini', label: 'Google Gemini' },
];

/** `git-assistant auth` (setup, with or without validation), `auth status`, and `auth logout`. */
export function Auth({ onBack }: { onBack: () => void }): ReactElement {
  const [auth, setAuth] = useState<Result<ActiveAuth, AuthError> | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'overview' });
  const refresh = useCallback(() => {
    activeAuth(defaultAuthDeps())
      .then(setAuth)
      .catch(() => setAuth(undefined));
  }, []);
  useEffect(refresh, [refresh]);

  const overview = (notice?: string): void => {
    refresh();
    setPhase(notice === undefined ? { kind: 'overview' } : { kind: 'overview', notice });
  };
  const save = (config: ProviderConfig): void => {
    saveConfig({ version: 1, ...config })
      .then((saved: Result<void, AuthError>) =>
        overview(saved.ok ? `Saved ${config.provider} (${config.model}) to ${configPath()}.` : renderError(saved.error)),
      )
      .catch((error: unknown) => overview(error instanceof Error ? error.message : String(error)));
  };
  const validateAndSave = (config: ProviderConfig): void => {
    setPhase({ kind: 'validating', config });
    createAdapter(config)
      .validateKey()
      .then((valid: Result<void, AppError>) =>
        valid.ok ? save(config) : setPhase({ kind: 'invalid', config, message: renderError(valid.error) }),
      )
      .catch((error: unknown) =>
        setPhase({ kind: 'invalid', config, message: error instanceof Error ? error.message : String(error) }),
      );
  };
  const logout = (): void => {
    deleteConfig()
      .then((removed: Result<boolean, AuthError>) =>
        overview(!removed.ok ? renderError(removed.error) : removed.value ? 'Removed saved credentials.' : 'No saved credentials to remove.'),
      )
      .catch((error: unknown) => overview(error instanceof Error ? error.message : String(error)));
  };

  useInput(
    (_input: string, key: Key) => {
      if (key.escape) onBack();
    },
    { isActive: auth === undefined && phase.kind === 'overview' },
  );

  if (phase.kind === 'provider') {
    return (
      <Screen title="Auth · provider" hints={LIST_HINTS}>
        <SelectList
          items={PROVIDERS.map(({ name, label }: { name: ProviderName; label: string }) => ({
            label,
            description: `default model ${DEFAULT_MODELS[name]}`,
          }))}
          onSelect={(index: number) => {
            const provider = PROVIDERS[index]?.name;
            if (provider !== undefined) setPhase({ kind: 'model', provider });
          }}
          onCancel={() => overview()}
        />
      </Screen>
    );
  }
  if (phase.kind === 'model') {
    return (
      <Screen title="Auth · model" hints={[]}>
        <TextInput
          key="model"
          label={`Model for ${phase.provider}`}
          initial={DEFAULT_MODELS[phase.provider]}
          validate={(value: string) => (value === '' ? 'Enter a model name.' : undefined)}
          onSubmit={(model: string) => setPhase({ kind: 'key', provider: phase.provider, model })}
          onCancel={() => setPhase({ kind: 'provider' })}
        />
      </Screen>
    );
  }
  if (phase.kind === 'key') {
    return (
      <Screen title="Auth · API key" hints={[]}>
        {/* Distinct keys: going straight from the model input to this one must not carry its text over. */}
        <TextInput
          key="api-key"
          label={`${phase.provider === 'openai' ? 'OpenAI' : 'Gemini'} API key (checked with the provider, then saved with 0600 permissions)`}
          mask
          validate={(value: string) => (value === '' ? 'Enter an API key.' : undefined)}
          onSubmit={(apiKey: string) => validateAndSave({ provider: phase.provider, model: phase.model, apiKey })}
          onCancel={() => setPhase({ kind: 'model', provider: phase.provider })}
        />
      </Screen>
    );
  }
  if (phase.kind === 'validating') {
    return (
      <Screen title="Auth" hints={[]}>
        <Spinner label={`Checking the key with ${phase.config.provider}`} />
      </Screen>
    );
  }
  if (phase.kind === 'invalid') {
    const { config } = phase;
    const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
      ['Enter a different key…', undefined, () => setPhase({ kind: 'key', provider: config.provider, model: config.model })],
      ['Save without checking', 'like auth --no-validate', () => save(config)],
      ['Back', undefined, () => overview()],
    ];
    return (
      <Screen title="Auth" hints={LIST_HINTS}>
        <ErrorView message={phase.message} />
        <Box marginTop={1}>
          <SelectList
            items={actions.map(([label, description]: [string, string | undefined, () => void]) =>
              description === undefined ? { label } : { label, description },
            )}
            onSelect={(index: number) => actions[index]?.[2]()}
            onCancel={() => overview()}
          />
        </Box>
      </Screen>
    );
  }

  if (auth === undefined) {
    return (
      <Screen title="Auth" hints={['esc back']}>
        <Spinner label="Reading credentials" />
      </Screen>
    );
  }
  const missing = !auth.ok && auth.error.reason === 'missing_credentials';
  const hasSaved = auth.ok ? auth.value.source === 'config' || auth.value.savedIgnored : auth.error.reason === 'config_read_failed';
  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    [auth.ok ? 'Set up a different provider…' : 'Set up a provider…', 'provider, model, API key', () => setPhase({ kind: 'provider' })],
    ...(hasSaved ? [['Log out', 'delete the saved credentials', logout] as [string, string, () => void]] : []),
    ['Back', undefined, onBack],
  ];
  return (
    <Screen title="Auth" hints={LIST_HINTS}>
      {auth.ok ? <AuthSummary auth={auth.value} /> : null}
      {missing ? <Text>Not set up. Commit, branch, and pull request need a provider.</Text> : null}
      {!auth.ok && !missing ? <ErrorView message={renderError(auth.error)} /> : null}
      {phase.notice !== undefined ? (
        <Box marginTop={1}>
          {phase.notice.startsWith('error:') ? <ErrorView message={phase.notice} /> : <Success>{phase.notice}</Success>}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <SelectList
          key={`${String(auth.ok)}-${String(hasSaved)}`}
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

function AuthSummary({ auth }: { auth: ActiveAuth }): ReactElement {
  const { config, source, savedIgnored } = auth;
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{config.provider}</Text> · {config.model} · key {maskKey(config.apiKey)}
      </Text>
      <Text dimColor>
        {source === 'environment' ? 'from environment variables' : `from saved config (${configPath()})`}
      </Text>
      {savedIgnored ? (
        <Text dimColor>The saved config is ignored while environment credentials are set.</Text>
      ) : source === 'environment' ? (
        <Text dimColor>A setup saved here is used only when those variables are unset.</Text>
      ) : null}
    </Box>
  );
}
