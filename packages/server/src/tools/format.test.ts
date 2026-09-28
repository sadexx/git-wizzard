import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitDiff } from '@git-assistant/shared';
import {
  budgetPatch,
  buildBranchPrompt,
  buildCommitPrompt,
  buildPrPrompt,
  hasChanges,
  parseBranchSuggestions,
  parseCommitMessage,
  parsePrDescription,
} from '#tools/format.js';

function diff(staged: boolean, paths: string[], patch: string = ''): GitDiff {
  return {
    staged,
    additions: 0,
    deletions: 0,
    files: paths.map((path: string) => ({ path, additions: 1, deletions: 0, binary: false })),
    patch,
  };
}

test('parseCommitMesssage splits subject and body', () => {
  const parsed = parseCommitMessage('Add retry logic\n\nHandle transient client failures.');
  assert.deepEqual(parsed, {
    subject: 'Add retry logic',
    body: 'Handle transient client failures.',
    message: 'Add retry logic\n\nHandle transient client failures.',
  });
});

test('parseCommitMessage handles subject-only output and strips wrapping quotes', () => {
  const parsed = parseCommitMessage('"Fix null deref"');
  assert.deepEqual(parsed, { subject: 'Fix null deref', message: 'Fix null deref' });
  assert.equal('body' in parsed, false);
});

test('parseBranchSuggestions normalizes and drops invalid names', () => {
  const out = parseBranchSuggestions('feature/add-retry\nfix login flow\ninvalid name!');
  assert.deepEqual(out, ['feature/add-retry', 'fix-login-flow']);
});

test('parseBranchSuggestions strips list markers and quotes but keeps leading digits of a name', () => {
  const out = parseBranchSuggestions('1. feature/login\n2) `fix/crash`\n- "chore/deps"\n* 2fa-setup\n3.x-upgrade');
  assert.deepEqual(out, ['feature/login', 'fix/crash', 'chore/deps', '2fa-setup', '3.x-upgrade']);
});

test('parseBranchSuggestions rejects names git would refuse', () => {
  const out = parseBranchSuggestions(
    'feature/\n-leading\n.hidden\nfeat/.dot\na..b\na//b\nends.\nrefs.lock\nx.lock/y\nok-name',
  );
  assert.deepEqual(out, ['ok-name']);
});

test('buildBranchPrompt covers staged, unstaged, and untracked work', () => {
  const prompt = buildBranchPrompt(
    {
      staged: diff(true, ['src/a.ts', 'src/shared.ts'], '+staged line'),
      unstaged: diff(false, ['src/shared.ts', 'src/b.ts'], '+unstaged line'),
      untracked: ['src/new.ts'],
    },
    'fix',
    undefined,
  );
  assert.match(prompt, /^Preferred prefix\/type: fix\./);
  assert.match(prompt, /- src\/a\.ts\n- src\/shared\.ts\n- src\/b\.ts\n- src\/new\.ts \(new, untracked\)/);
  assert.match(prompt, /\+staged line\n\+unstaged line/);
});

test('hasChanges is false only when nothing is staged, modified, or untracked', () => {
  const none = { staged: diff(true, []), unstaged: diff(false, []), untracked: [] };
  assert.equal(hasChanges(none), false);
  assert.equal(hasChanges({ ...none, untracked: ['x'] }), true);
  assert.equal(hasChanges({ ...none, staged: diff(true, ['x']) }), true);
});

test('buildCommitPrompt gives the branch and recent subjects as style context', () => {
  const prompt = buildCommitPrompt(
    diff(true, ['src/a.ts'], '+x'),
    { branch: 'fix/login-timeout', recentSubjects: ['feature: add login', 'fix: typo'] },
    undefined,
  );
  assert.match(prompt, /^Branch: fix\/login-timeout\n\nRecent commits \(newest first\):\n- feature: add login\n- fix: typo\n/);
  assert.match(prompt, /Changes to commit \(\+0\/-0\):\n- src\/a\.ts \(\+1\/-0\)\n\nDiff:\n\+x$/);
});

test('buildCommitPrompt says so when there is no history yet', () => {
  const prompt = buildCommitPrompt(diff(true, ['a']), { branch: 'main', recentSubjects: [] }, undefined);
  assert.match(prompt, /Recent commits: none \(first commit\)\./);
});

test('prompts lead with the author note when a hint is given, and omit it when blank', () => {
  const context = { branch: 'main', recentSubjects: [] };
  const changes = { staged: diff(true, ['a']), unstaged: diff(false, []), untracked: [] };
  assert.match(buildCommitPrompt(diff(true, ['a']), context, ' retry on 429 '), /^Author's note on intent: retry on 429\n\nBranch:/);
  assert.match(buildBranchPrompt(changes, 'fix', 'retry on 429'), /^Author's note on intent: retry on 429\n\nPreferred/);
  assert.doesNotMatch(buildCommitPrompt(diff(true, ['a']), context, '  '), /Author's note/);
});

test('buildPrPrompt names both branches and includes commits, files, and the hint', () => {
  const prompt = buildPrPrompt(
    { base: 'origin/main', branch: 'feature/x', log: '- add a\n  because', diff: diff(false, ['a.txt'], '+one') },
    'unblock release',
  );
  assert.match(prompt, /^Author's note on intent: unblock release\n\nBranch feature\/x into origin\/main\./);
  assert.match(prompt, /Commits \(oldest first\):\n- add a\n {2}because\n/);
  assert.match(prompt, /- a\.txt \(\+1\/-0\)[\s\S]*Diff:\n\+one$/);
});

test('parsePrDescription splits title and body, dropping a heading or "Title:" label', () => {
  assert.deepEqual(parsePrDescription('# Add retries\n\nWhy.\n\n- one'), { title: 'Add retries', body: 'Why.\n\n- one' });
  assert.deepEqual(parsePrDescription('Title: Add retries'), { title: 'Add retries', body: '' });
});

function filePatch(path: string, lines: number, width: number = 10): string {
  const body = Array.from({ length: lines }, (_: unknown, i: number) => `+${String(i).padEnd(width - 1, 'x')}\n`);
  return `diff --git a/${path} b/${path}\n@@ -0,0 +1,${lines} @@\n${body.join('')}`;
}

test('budgetPatch leaves a small patch alone but always omits lockfile diffs', () => {
  const small = filePatch('src/a.ts', 3);
  assert.equal(budgetPatch(small), small);
  assert.equal(
    budgetPatch(`${filePatch('package-lock.json', 3)}${small}`),
    `diff --git a/package-lock.json b/package-lock.json\n[generated file, diff omitted]\n${small}`,
  );
});

test('budgetPatch keeps small files whole and truncates the big one on a line boundary', () => {
  const big = filePatch('big.ts', 100, 50);
  const small = filePatch('small.ts', 2);
  const out = budgetPatch(`${big}${small}`, 600);
  assert.ok(out.endsWith(small), 'small file after the big one survives intact');
  const [kept = ''] = out.split(small);
  assert.match(kept, /^diff --git a\/big\.ts b\/big\.ts\n@@[^\n]*\n(\+\dx*\n|\+\d\dx*\n)+\.\.\. \[\d+ more lines truncated\]\n$/);
  assert.ok(kept.length <= 600 - small.length + 40);
});

test('budgetPatch stays bounded when there are more files than room for their headers', () => {
  const patch = Array.from({ length: 300 }, (_: unknown, i: number) => filePatch(`src/file-${i}.ts`, 5)).join('');
  const out = budgetPatch(patch, 6000);
  assert.ok(out.length <= 6000 * 1.5, `got ${out.length} chars`);
  assert.match(out, /\.\.\. \[\d+ more files not shown\]\n$/);
});

test('parseBranchSuggestions de-duplicates and caps at five', () => {
  const out = parseBranchSuggestions('a\na\nb\nc\nd\ne\nf');
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
});
