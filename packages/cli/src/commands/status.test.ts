import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitStatus } from '@git-assistant/shared';
import { formatStatus } from '#commands/status.js';

const clean: GitStatus = { branch: 'main', ahead: 0, behind: 0, isClean: true, files: [] };

test('formatStatus reports a clean tree', () => {
  const out = formatStatus(clean);
  assert.match(out, /On branch main/);
  assert.match(out, /Working tree clean/);
});

test('formatStatus lists changes and upstream', () => {
  const out = formatStatus({
    ...clean,
    isClean: false,
    upstream: 'origin/main',
    ahead: 1,
    files: [{ path: 'a.ts', index: 'modified', workingTree: 'unmodified' }],
  });
  assert.match(out, /tracking origin\/main/);
  assert.match(out, /staged:modified {2}a\.ts/);
});
