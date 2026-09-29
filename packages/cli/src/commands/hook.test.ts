import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookScript, hookState, installHook, uninstallHook } from '#commands/hook.js';

function tempHookPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'git-assistant-hook-')), 'hooks', 'prepare-commit-msg');
}

/** Run the hook with a fake "git-assistant" that prints `draft` (or fails when undefined). */
function runHook(source: string, draft: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-assistant-hookrun-'));
  const fake = join(dir, 'fake-cli');
  writeFileSync(fake, draft === undefined ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\nprintf '%s' '${draft}'\n`, { mode: 0o755 });
  const hook = join(dir, 'hook');
  writeFileSync(hook, hookScript([fake]), { mode: 0o755 });
  const message = join(dir, 'COMMIT_EDITMSG');
  writeFileSync(message, '\n# Please enter the commit message\n');
  execFileSync(hook, source === '' ? [message] : [message, source]);
  return readFileSync(message, 'utf8');
}

test('hook prepends the draft above git\'s template for a plain commit', { skip: process.platform === 'win32' }, () => {
  assert.equal(runHook('', 'feat: x'), 'feat: x\n\n# Please enter the commit message\n');
});

test('hook leaves -m/merge/amend messages and failed drafts alone', { skip: process.platform === 'win32' }, () => {
  const untouched = '\n# Please enter the commit message\n';
  assert.equal(runHook('message', 'feat: x'), untouched);
  assert.equal(runHook('commit', 'feat: x'), untouched);
  assert.equal(runHook('', undefined), untouched);
});

test('hookScript quotes paths with spaces and quotes', () => {
  assert.match(hookScript(['/opt/my node/node', "/it's/cli.js"]), /draft=\$\('\/opt\/my node\/node' '\/it'\\''s\/cli\.js' commit --dry-run\)/);
});

test('installHook creates an executable hook, updates its own, and never touches a foreign one', () => {
  const path = tempHookPath();
  assert.equal(installHook(path, ['git-assistant']), 'installed');
  assert.equal(statSync(path).mode & 0o111, 0o111);
  assert.equal(installHook(path, ['git-assistant']), 'updated');
  assert.equal(uninstallHook(path), 'removed');
  assert.equal(uninstallHook(path), 'absent');

  assert.equal(hookState(path), 'absent');
  installHook(path, ['git-assistant']);
  assert.equal(hookState(path), 'installed');
  uninstallHook(path);

  writeFileSync(path, '#!/bin/sh\necho mine\n');
  assert.equal(hookState(path), 'foreign');
  assert.equal(installHook(path, ['git-assistant']), 'foreign');
  assert.equal(uninstallHook(path), 'foreign');
  assert.equal(readFileSync(path, 'utf8'), '#!/bin/sh\necho mine\n');
});
