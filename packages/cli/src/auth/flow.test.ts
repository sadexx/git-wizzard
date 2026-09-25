import { test } from 'node:test';
import assert from 'node:assert';
import { ok, type AuthError, type PersistedConfig, type Result } from '@git-assistant/shared';
import { readEnvConfig, runAuthFlow, type AuthDeps, type AuthEnv, type Prompter } from '#auth/flow.js';
import type { ProviderAdapter, ProviderConfig } from '#auth/provider-adapter.js';

const emptyEnv: AuthEnv = {
  provider: undefined,
  openaiKey: undefined,
  geminiKey: undefined,
  model: undefined,
  isTty: false,
};

function deps(overrides: Partial<AuthDeps>): AuthDeps {
  const saved: PersistedConfig[] = [];
  const prompter: Prompter = {
    select: async () => 'openai',
    text: async (_message: string, defaultValue: string) => defaultValue,
    secret: async () => 'interactive-key',
  };

  return {
    env: emptyEnv,
    prompter,
    loadConfig: async (): Promise<Result<PersistedConfig | null, AuthError>> => ok(null),
    saveConfig: async (config: PersistedConfig) => {
      saved.push(config);
      return ok(undefined);
    },
    createAdapter: fakeAdapter,
    ...overrides,
  };
}

function fakeAdapter(config: ProviderConfig): ProviderAdapter {
  return {
    provider: config.provider,
    model: config.model,
    validateKey: async () => ok(undefined),
    complete: async () => ok({ text: '', model: config.model, finishReason: 'stop' }),
  };
}

test('readEnvConfig infers provider from a single key', () => {
  const result = readEnvConfig({ ...emptyEnv, openaiKey: 'k' });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { provider: 'openai', apiKey: 'k', model: 'gpt-5.4-mini' });
});

test('readEnvConfig returns null when ambiguous', () => {
  const result = readEnvConfig({ ...emptyEnv, openaiKey: 'a', geminiKey: 'b' });
  assert.deepEqual(result, { ok: true, value: null });
});

test('readEnvConfig rejects an unknown provider', () => {
  const result = readEnvConfig({ ...emptyEnv, provider: 'bogus' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'unsupported_provider');
});

test('runAuthFlow prefers env credentials without persisting', async () => {
  let loadCalled: boolean = false;
  const dependencies = deps({
    env: { ...emptyEnv, geminiKey: 'g' },
    loadConfig: async () => {
      loadCalled = true;
      return ok(null);
    },
    saveConfig: async () => {
      throw new Error('should not persist env credentials');
    },
  });
  const result = await runAuthFlow(dependencies, { validate: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.provider, 'gemini');
  assert.equal(loadCalled, false);
});

test('runAuthFlow uses saved config when env is empty', async () => {
  const config: PersistedConfig = { version: 1, provider: 'openai', apiKey: 'k', model: 'm' };
  const dependencies = deps({ loadConfig: async () => ok(config) });
  const result = await runAuthFlow(dependencies, { validate: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.model, 'm');
});

test('runAuthFlow fails without a TTY when nothing is configured', async () => {
  const result = await runAuthFlow(deps({}), { validate: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'missing_credentials');
});

test('runAuthFlow prompts and persists interactively', async () => {
  const saved: PersistedConfig[] = [];
  const dependencies = deps({
    env: { ...emptyEnv, isTty: true },
    saveConfig: async (config: PersistedConfig) => {
      saved.push(config);
      return ok(undefined);
    },
  });
  const result = await runAuthFlow(dependencies, { validate: true });
  assert.equal(result.ok, true);
  assert.equal(saved.length, 1);
  const [savedConfig] = saved;
  assert.equal(savedConfig?.apiKey, 'interactive-key');
});
