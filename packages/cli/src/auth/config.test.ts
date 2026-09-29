import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedConfig } from '@git-wizzard/shared';
import { configPath, deleteConfig, loadConfig, saveConfig } from '#auth/config.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'git-wizzard'));
}

test('loadConfig returns null when the file is absent', async () => {
  const dir = await tempDir();
  const result = await loadConfig(dir);
  assert.deepEqual(result, { ok: true, value: null });
});

test('saveConfig then loadConfig round-trips', async () => {
  const dir = await tempDir();
  const config: PersistedConfig = { version: 1, provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4-mini' };
  const saved = await saveConfig(config, dir);
  assert.equal(saved.ok, true);
  const loaded = await loadConfig(dir);
  assert.deepEqual(loaded, { ok: true, value: config });
});

test('saveConfig wirtes a 0600 file on POSIX', { skip: process.platform === 'win32' }, async () => {
  const dir = await tempDir();
  await saveConfig({ version: 1, provider: 'gemini', apiKey: 'k', model: 'm' }, dir);
  const info = await stat(configPath(dir));
  assert.equal(info.mode & 0o777, 0o600);
});

test('deleteConfig removes the file, then reports nothing to remove', async () => {
  const dir = await tempDir();
  await saveConfig({ version: 1, provider: 'openai', apiKey: 'k', model: 'm' }, dir);
  assert.deepEqual(await deleteConfig(dir), { ok: true, value: true });
  assert.deepEqual(await loadConfig(dir), { ok: true, value: null });
  assert.deepEqual(await deleteConfig(dir), { ok: true, value: false });
});

test('loadConfig rejects a malformed config', async () => {
  const dir = await tempDir();
  await writeFile(configPath(dir), '{"version":1,"provider":"nope"}');
  const result = await loadConfig(dir);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, 'config_read_failed');
});
