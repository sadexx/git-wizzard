import { test } from 'node:test';
import assert from 'node:assert';
import { ok, type AuthError, type PersistedConfig, type Result } from '@git-wizzard/shared';
import { activeAuth, createAdapter, readEnvConfig, runAuthFlow, type AuthDeps, type AuthEnv, type Prompter } from '#auth/flow.js';
import type { ProviderAdapter, ProviderConfig } from '#auth/provider-adapter.js';

const emptyEnv: AuthEnv = {
  provider: undefined,
  openaiKey: undefined,
  geminiKey: undefined,
  anthropicKey: undefined,
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
    createAdapter: async (config: ProviderConfig) => fakeAdapter(config),
    ...overrides,
  };
}

function fakeAdapter(config: ProviderConfig): ProviderAdapter {
  return {
    provider: config.provider,
    model: config.model,
    validateKey: async () => ok(undefined),
    listModels: async () => ok([config.model]),
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
  assert.deepEqual(readEnvConfig({ ...emptyEnv, geminiKey: 'b', anthropicKey: 'c' }), { ok: true, value: null });
});

test('readEnvConfig picks Anthropic from ANTHROPIC_API_KEY alone, or by name among several keys', () => {
  assert.deepEqual(readEnvConfig({ ...emptyEnv, anthropicKey: 'c' }), {
    ok: true,
    value: { provider: 'anthropic', apiKey: 'c', model: 'claude-opus-5-5' },
  });
  assert.deepEqual(readEnvConfig({ ...emptyEnv, provider: 'anthropic', openaiKey: 'a', anthropicKey: 'c' }), {
    ok: true,
    value: { provider: 'anthropic', apiKey: 'c', model: 'claude-opus-5-5' },
  });
});

test('readEnvConfig leaves a custom provider to the saved setup, which holds its URL', () => {
  assert.deepEqual(readEnvConfig({ ...emptyEnv, provider: 'custom', openaiKey: 'a' }), { ok: true, value: null });
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
  if (!result.ok) assert.equal(result.error.reason, 'no_terminal');
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

test('readEnvConfig: a provider named without its key is an error, not a silent fallback', () => {
  const result = readEnvConfig({ ...emptyEnv, provider: 'anthropic', openaiKey: 'sk' });
  assert.equal(!result.ok && result.error.reason, 'missing_credentials');
});

test('runAuthFlow reports environment credentials that fail validation', async () => {
  const rejecting = async (config: ProviderConfig): Promise<ProviderAdapter> => ({
    ...fakeAdapter(config),
    validateKey: async () => ({ ok: false, error: { kind: 'AuthError', reason: 'invalid_api_key', message: 'rejected' } }),
  });
  const result = await runAuthFlow(deps({ env: { ...emptyEnv, openaiKey: 'sk' }, createAdapter: rejecting }));
  assert.equal(!result.ok && result.error.reason, 'invalid_api_key');
});

test('createAdapter picks the adapter for each provider; custom speaks the OpenAI API', async () => {
  for (const provider of ['openai', 'gemini', 'anthropic', 'custom'] as const) {
    const adapter = await createAdapter({ provider, apiKey: 'k', model: 'm', ...(provider === 'custom' ? { baseUrl: 'http://localhost:1/v1' } : {}) });
    assert.deepEqual([adapter.provider, adapter.model], [provider, 'm']);
  }
});

test('activeAuth reports env credentials and flags a shadowed saved config', async () => {
  const saved: PersistedConfig = { version: 1, provider: 'openai', apiKey: 'k', model: 'm' };
  const result = await activeAuth(deps({ env: { ...emptyEnv, geminiKey: 'g' }, loadConfig: async () => ok(saved) }));
  assert.deepEqual(result, {
    ok: true,
    value: { config: { provider: 'gemini', apiKey: 'g', model: 'gemini-3.6-flash' }, source: 'environment', savedIgnored: true },
  });
});

test('activeAuth falls back to the saved config, and fails when nothing is set', async () => {
  const saved: PersistedConfig = { version: 1, provider: 'openai', apiKey: 'k', model: 'm' };
  assert.deepEqual(await activeAuth(deps({ loadConfig: async () => ok(saved) })), {
    ok: true,
    value: { config: { provider: 'openai', apiKey: 'k', model: 'm' }, source: 'config', savedIgnored: false },
  });
  const missing = await activeAuth(deps({}));
  assert.equal(!missing.ok && missing.error.reason, 'missing_credentials');
});
