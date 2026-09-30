import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { AppError, AuthError, ProviderName, Result } from '@git-wizzard/shared';
import { activeAuth, createAdapter, DEFAULT_MODELS, defaultAuthDeps, type ActiveAuth } from '#auth/flow.js';
import { configPath, deleteConfig, saveConfig } from '#auth/config.js';
import type { ProviderAdapter, ProviderConfig } from '#auth/provider-adapter.js';
import { maskKey } from '#commands/auth.js';
import { renderError } from '#errors.js';
import { Spinner } from '#ui/components/Spinner.js';
import { SelectList } from '#ui/components/SelectList.js';
import { TextInput } from '#ui/components/TextInput.js';
import { ModelPicker } from '#ui/components/ModelPicker.js';
import { ErrorView, Screen, Success } from '#ui/components/Screen.js';

/** A setup before its model is chosen: the model comes last, picked from what the key can use. */
type Draft = Omit<ProviderConfig, 'model'>;

type Phase =
  | { kind: 'overview'; notice?: string }
  | { kind: 'provider' }
  | { kind: 'url' }
  | { kind: 'key'; provider: ProviderName; baseUrl?: string }
  | { kind: 'checking'; draft: Draft; initial: string }
  | { kind: 'invalid'; draft: Draft; message: string }
  | { kind: 'model'; draft: Draft; models: readonly string[]; initial: string; notice?: string };

const LIST_HINTS = ['↑/↓ select', 'enter choose', 'esc back'];
const PROVIDERS: ReadonlyArray<{ name: ProviderName; label: string; description: string }> = [
  { name: 'openai', label: 'OpenAI', description: `default model ${DEFAULT_MODELS.openai}` },
  { name: 'gemini', label: 'Google Gemini', description: `default model ${DEFAULT_MODELS.gemini}` },
  { name: 'anthropic', label: 'Anthropic Claude', description: `default model ${DEFAULT_MODELS.anthropic}` },
  { name: 'custom', label: 'Custom (OpenAI-compatible)', description: 'any URL: Ollama, LM Studio, a gateway…' },
];

function providerLabel(provider: ProviderName): string {
  return PROVIDERS.find(({ name }: { name: ProviderName }) => name === provider)?.label ?? provider;
}

/** The draft's server fields, spread-safe under exactOptionalPropertyTypes. */
function server(baseUrl: string | undefined): { baseUrl?: string } {
  return baseUrl !== undefined ? { baseUrl } : {};
}

/** `gitwizz auth` (setup, with or without validation), `auth status`, and `auth logout`. */
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
  /**
   * Ask for the model list; it doubles as the key check. On setup a failure stops at "invalid";
   * on Change model… (key already saved) it falls back to typing the name.
   */
  const listModels = (draft: Draft, initial: string, setup: boolean): void => {
    setPhase({ kind: 'checking', draft, initial });
    const failed = (message: string): void =>
      setPhase(
        setup
          ? { kind: 'invalid', draft, message }
          : { kind: 'model', draft, models: [], initial, notice: `Couldn't list models; type the name.\n${message}` },
      );
    createAdapter({ ...draft, model: initial })
      .then((adapter: ProviderAdapter) => adapter.listModels())
      .then((listed: Result<string[], AppError>) =>
        listed.ok ? setPhase({ kind: 'model', draft, models: listed.value, initial }) : failed(renderError(listed.error)),
      )
      .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
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
          items={PROVIDERS.map(({ label, description }: { label: string; description: string }) => ({ label, description }))}
          onSelect={(index: number) => {
            const provider = PROVIDERS[index]?.name;
            if (provider === 'custom') setPhase({ kind: 'url' });
            else if (provider !== undefined) setPhase({ kind: 'key', provider });
          }}
          onCancel={() => overview()}
        />
      </Screen>
    );
  }
  if (phase.kind === 'url') {
    return (
      <Screen title="Auth · server" hints={[]}>
        <TextInput
          key="url"
          label="Server URL of an OpenAI-compatible API (usually ends in /v1)"
          placeholder="e.g. http://localhost:11434/v1 for Ollama"
          validate={(value: string) => (URL.canParse(value) ? undefined : 'Enter a full URL, like http://localhost:11434/v1.')}
          onSubmit={(baseUrl: string) => setPhase({ kind: 'key', provider: 'custom', baseUrl })}
          onCancel={() => setPhase({ kind: 'provider' })}
        />
      </Screen>
    );
  }
  if (phase.kind === 'key') {
    const custom = phase.provider === 'custom';
    const draft = (apiKey: string): Draft => ({ provider: phase.provider, apiKey, ...server(phase.baseUrl) });
    return (
      <Screen title="Auth · API key" hints={[]}>
        {/* Distinct keys: going straight from the URL input to this one must not carry its text over. */}
        <TextInput
          key="api-key"
          label={
            custom
              ? `API key for ${phase.baseUrl ?? 'the server'} (leave empty if it needs none; saved with 0600 permissions)`
              : `${providerLabel(phase.provider)} API key (checked with the provider, then saved with 0600 permissions)`
          }
          mask
          validate={(value: string) => (value === '' && !custom ? 'Enter an API key.' : undefined)}
          onSubmit={(apiKey: string) => listModels(draft(apiKey), DEFAULT_MODELS[phase.provider], true)}
          onCancel={() => setPhase(custom ? { kind: 'url' } : { kind: 'provider' })}
        />
      </Screen>
    );
  }
  if (phase.kind === 'checking') {
    return (
      <Screen title="Auth" hints={[]}>
        <Spinner label={`Asking ${phase.draft.baseUrl ?? providerLabel(phase.draft.provider)} for its models`} />
      </Screen>
    );
  }
  if (phase.kind === 'model') {
    const { draft } = phase;
    return (
      <Screen title="Auth · model" hints={[]}>
        {phase.notice !== undefined ? (
          <Box marginBottom={1}>
            <ErrorView message={phase.notice} />
          </Box>
        ) : null}
        <ModelPicker
          label={`Model for ${draft.baseUrl ?? providerLabel(draft.provider)}`}
          models={phase.models}
          initial={phase.initial}
          onSubmit={(model: string) => save({ ...draft, model })}
          onCancel={() => overview()}
        />
      </Screen>
    );
  }
  if (phase.kind === 'invalid') {
    const { draft } = phase;
    const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
      ['Enter a different key…', undefined, () => setPhase({ kind: 'key', provider: draft.provider, ...server(draft.baseUrl) })],
      ...(draft.provider === 'custom'
        ? [['Change the URL…', undefined, () => setPhase({ kind: 'url' })] as [string, undefined, () => void]]
        : []),
      [
        'Continue without checking',
        'type the model name; like auth --no-validate',
        () => setPhase({ kind: 'model', draft, models: [], initial: DEFAULT_MODELS[draft.provider] }),
      ],
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
  // Only a saved setup can change its model here; environment credentials take GIT_WIZZARD_MODEL.
  const savedConfig = auth.ok && auth.value.source === 'config' ? auth.value.config : undefined;
  const actions: ReadonlyArray<[string, string | undefined, () => void]> = [
    ...(savedConfig !== undefined
      ? [
          [
            'Change model…',
            'pick from the list; keeps the saved key',
            () => {
              const { model, ...draft } = savedConfig;
              listModels(draft, model, false);
            },
          ] as [string, string, () => void],
        ]
      : []),
    [auth.ok ? 'Set up a different provider…' : 'Set up a provider…', 'provider, API key, model', () => setPhase({ kind: 'provider' })],
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
          key={`${String(auth.ok)}-${String(hasSaved)}-${String(savedConfig !== undefined)}`}
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
      {config.baseUrl !== undefined ? <Text dimColor>server {config.baseUrl}</Text> : null}
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
