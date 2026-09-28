import { createInterface } from 'node:readline/promises';
import { stdin, stdout, env as processEnv } from 'node:process';
import {
  authError,
  err,
  ok,
  providerNameSchema,
  type AuthError,
  type PersistedConfig,
  type ProviderError,
  type ProviderName,
  type Result,
} from '@git-assistant/shared';
import type { ProviderAdapter, ProviderConfig } from '#auth/provider-adapter.js';
import { OpenAiAdapter } from '#auth/providers/openai.js';
import { GeminiAdapter } from '#auth/providers/gemini.js';
import { loadConfig, saveConfig } from '#auth/config.js';

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: 'gpt-5.4-mini',
  gemini: 'gemini-3.6-flash',
};

export interface AuthDeps {
  readonly env: AuthEnv;
  readonly prompter: Prompter;
  readonly loadConfig: () => Promise<Result<PersistedConfig | null, AuthError>>;
  readonly saveConfig: (config: PersistedConfig) => Promise<Result<void, AuthError>>;
  readonly createAdapter: (config: ProviderConfig) => ProviderAdapter;
}

export interface AuthEnv {
  readonly provider: string | undefined;
  readonly openaiKey: string | undefined;
  readonly geminiKey: string | undefined;
  readonly model: string | undefined;
  readonly isTty: boolean;
}

export interface Prompter {
  select(message: string, choices: readonly ProviderName[]): Promise<ProviderName>;
  text(message: string, defaultValue: string): Promise<string>;
  secret(message: string): Promise<string>;
}

export interface AuthOptions {
  readonly validate?: boolean;
  readonly forceInteractive?: boolean;
  readonly allowInteractive?: boolean;
}

/** Build a ProviderConfig from the environment or null when the env doesn't specify one. */
export function readEnvConfig(authEnv: AuthEnv): Result<ProviderConfig | null, AuthError> {
  let provider: ProviderName;
  if (authEnv.provider !== undefined && authEnv.provider !== '') {
    const parsed = providerNameSchema.safeParse(authEnv.provider);
    if (!parsed.success) {
      return err(authError('unsupported_provider', `Unknown provider "${authEnv.provider}"`));
    }
    provider = parsed.data;
  } else {
    const hasOpenai = authEnv.openaiKey !== undefined && authEnv.openaiKey !== '';
    const hasGemini = authEnv.geminiKey !== undefined && authEnv.geminiKey !== '';
    if (hasOpenai && !hasGemini) provider = 'openai';
    else if (hasGemini && !hasOpenai) provider = 'gemini';
    else return ok(null);
  }

  const apiKey = provider === 'openai' ? authEnv.openaiKey : authEnv.geminiKey;
  if (apiKey === undefined || apiKey === '') {
    return err(authError('missing_credentials', `Provider "${provider}" selected but its API key is not set`));
  }

  const model = authEnv.model !== undefined && authEnv.model !== '' ? authEnv.model : DEFAULT_MODELS[provider];
  return ok({ provider, apiKey, model });
}

/**
 * Resolve an authorized adapter. Precedence: explicit environment credentials
 * (not persisted) -> saved config -> interactive prompt (TTY only, persisted)
 */
export async function runAuthFlow(
  deps: AuthDeps,
  options: AuthOptions = {},
): Promise<Result<ProviderAdapter, AuthError | ProviderError>> {
  const validate = options.validate ?? true;

  const fromEnv = readEnvConfig(deps.env);
  if (!fromEnv.ok) return err(fromEnv.error);
  if (fromEnv.value !== null) {
    return finalize(deps, fromEnv.value, { persist: false, validate });
  }

  if (options.forceInteractive !== true) {
    const loaded = await deps.loadConfig();
    if (!loaded.ok) return err(loaded.error);
    if (loaded.value !== null) {
      const { version: _version, ...config } = loaded.value;
      return finalize(deps, config, { persist: false, validate });
    }
  }

  if (options.allowInteractive === false) {
    return err(authError('missing_credentials', 'No saved credentials and no API key in the environment'));
  }
  if (!deps.env.isTty) {
    return err(
      authError(
        'missing_credentials',
        'No saved credentials and no API key in the environment; cannot prompt without a TTY',
      ),
    );
  }

  return interactive(deps, validate);
}

export interface ActiveAuth {
  readonly config: ProviderConfig;
  readonly source: 'environment' | 'config';
  /** A saved config exists but environment credentials take precedence over it. */
  readonly savedIgnored: boolean;
}

/** Which credentials AI-backed commands would use right now, without touching the network. */
export async function activeAuth(
  deps: Pick<AuthDeps, 'env' | 'loadConfig'>,
): Promise<Result<ActiveAuth, AuthError>> {
  const fromEnv = readEnvConfig(deps.env);
  if (!fromEnv.ok) return err(fromEnv.error);
  const loaded = await deps.loadConfig();

  if (fromEnv.value !== null) {
    return ok({ config: fromEnv.value, source: 'environment', savedIgnored: loaded.ok && loaded.value !== null });
  }
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value === null) {
    return err(authError('missing_credentials', 'No saved credentials and no API key in the environment'));
  }
  const { version: _version, ...config } = loaded.value;
  return ok({ config, source: 'config', savedIgnored: false });
}

async function finalize(
  deps: AuthDeps,
  config: ProviderConfig,
  opts: { persist: boolean; validate: boolean },
): Promise<Result<ProviderAdapter, AuthError | ProviderError>> {
  const adapter = deps.createAdapter(config);
  if (opts.validate) {
    const valid = await adapter.validateKey();
    if (!valid.ok) return err(valid.error);
  }
  if (opts.persist) {
    const saved = await deps.saveConfig({ version: 1 as const, ...config });
    if (!saved.ok) return err(saved.error);
  }
  return ok(adapter);
}

async function interactive(
  deps: AuthDeps,
  validate: boolean,
): Promise<Result<ProviderAdapter, AuthError | ProviderError>> {
  const provider = await deps.prompter.select('Select a provider', ['openai', 'gemini']);
  const model = await deps.prompter.text('Model', DEFAULT_MODELS[provider]);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const apiKey = await deps.prompter.secret(attempt === 1 ? 'API key' : 'API key (try again)');
    const adapter = deps.createAdapter({ provider, apiKey, model });

    if (validate) {
      const valid = await adapter.validateKey();
      if (!valid.ok) {
        const retryable = valid.error.kind === 'AuthError' && valid.error.reason === 'invalid_api_key';
        if (retryable && attempt < maxAttempts) continue;
        return err(valid.error);
      }
    }

    const saved = await deps.saveConfig({ version: 1 as const, provider, apiKey, model });
    if (!saved.ok) return err(saved.error);

    return ok(adapter);
  }
  return err(authError('invalid_api_key', `Key validation failed after ${maxAttempts} attempts`));
}

// ---- Real dependency wiring (thin I/O; not unit-tested) ----

export function createAdapter(config: ProviderConfig): ProviderAdapter {
  return config.provider === 'openai' ? new OpenAiAdapter(config) : new GeminiAdapter(config);
}

export function defaultAuthDeps(): AuthDeps {
  return { env: readProcessEnv(), prompter: createReadlinePrompter(), loadConfig, saveConfig, createAdapter };
}

/**
 * Non-interactive credentials (env or saved config only) for AI-backed tools. Never
 * prompts: a missing setup surfaces as `missing_credentials`, whose hint points at `auth`.
 */
export function resolveConfiguredAdapter(): Promise<Result<ProviderAdapter, AuthError | ProviderError>> {
  return runAuthFlow(defaultAuthDeps(), { validate: false, allowInteractive: false });
}

function readProcessEnv(): AuthEnv {
  return {
    provider: processEnv['GIT_ASSISTANT_PROVIDER'],
    openaiKey: processEnv['OPENAI_API_KEY'],
    geminiKey: processEnv['GEMINI_API_KEY'] ?? processEnv['GOOGLE_API_KEY'],
    model: processEnv['GIT_ASSISTANT_MODEL'],
    isTty: stdin.isTTY === true && stdout.isTTY === true,
  };
}

function createReadlinePrompter(): Prompter {
  return {
    async select(message, choices) {
      const readline = createInterface({ input: stdin, output: stdout });
      try {
        stdout.write(`${message}:\n`);
        choices.forEach((choice: ProviderName, i: number) => stdout.write(`  ${i + 1}) ${choice}\n`));
        for (;;) {
          const answer = (await readline.question('> ')).trim();
          const byIndex = choices[Number.parseInt(answer, 10) - 1];
          if (byIndex !== undefined) return byIndex;
          const byName = choices.find((choice: ProviderName) => choice === answer);
          if (byName !== undefined) return byName;
          stdout.write('Invalid selection.\n');
        }
      } finally {
        readline.close();
      }
    },
    async text(message, defaultValue) {
      const readline = createInterface({ input: stdin, output: stdout });
      try {
        const answer = (await readline.question(`${message} [${defaultValue}]: `)).trim();
        return answer === '' ? defaultValue : answer;
      } finally {
        readline.close();
      }
    },
    secret(message) {
      return readSecret(`${message}: `);
    },
  };
}

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve: (value: string) => void, reject: (reason?: unknown) => void) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw ?? false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const cleanup = (): void => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\n' || character === '\r' || character === '\u0004') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Input cancelled'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else {
          value += character;
          stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}
