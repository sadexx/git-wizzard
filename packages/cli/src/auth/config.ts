import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import {
  authError,
  err,
  ok,
  parseWithSchema,
  persistedConfigSchema,
  type AuthError,
  type PersistedConfig,
  type Result,
} from '@git-assistant/shared';

/** Load and validate config. Returns ok(null) when the file does not exist. */
export async function loadConfig(
  baseDir: string = defaultBaseDir(),
): Promise<Result<PersistedConfig | null, AuthError>> {
  const file = configPath(baseDir);

  let contents: string;
  try {
    contents = await readFile(file, 'utf8');
  } catch (cause) {
    return isNotFound(cause) ? ok(null) : err(authError('config_read_failed', `Failed to read ${file}`, cause));
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (cause) {
    return err(authError('config_read_failed', 'Config file is not valid JSON', cause));
  }

  const parsed = parseWithSchema(persistedConfigSchema, json);
  return parsed.ok
    ? ok(parsed.value)
    : err(authError('config_read_failed', 'Config file has an unexpected shape', parsed.error));
}

export async function saveConfig(
  config: PersistedConfig,
  baseDir: string = defaultBaseDir(),
): Promise<Result<void, AuthError>> {
  const parsed = parseWithSchema(persistedConfigSchema, config);
  if (!parsed.ok) return err(authError('config_write_failed', 'Refusing to persist invalid config', parsed.error));

  const file = configPath(baseDir);
  try {
    await mkdir(baseDir, { recursive: true, mode: 0o700 });
    await chmod(baseDir, 0o700);
    await writeFile(file, `${JSON.stringify(parsed.value, null, 2)}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
  } catch (cause) {
    return err(authError('config_write_failed', `Failed to write ${file}`, cause));
  }
  return ok(undefined);
}

export function configPath(baseDir: string = defaultBaseDir()): string {
  return join(baseDir, 'config.json');
}

function defaultBaseDir(): string {
  return join(homedir(), '.git-assistant');
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && 'code' in cause && (cause as { code: unknown }).code === 'ENOENT'
  );
}
