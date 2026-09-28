import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPatch, plural, stylePatch, type Style } from '#format.js';

/** Marks styled spans as <format>text</format> so tests can see what gets colored. */
const tagged: Style = (format, text) => `<${format}>${text}</${format}>`;

const PATCH = [
  'diff --git a/a.md b/a.md',
  'index 1..2 100644',
  '--- a/a.md',
  '+++ b/a.md',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '--- a horizontal rule removed',
  '+++ one added',
  '-old',
  '+new',
].join('\n');

test('classifyPatch tells headers from +/- lines by position, not prefix', () => {
  assert.deepEqual(
    classifyPatch(PATCH).map(({ kind }) => kind),
    ['header', 'header', 'header', 'header', 'hunk', 'context', 'del', 'add', 'del', 'add'],
  );
});

test('classifyPatch resets to headers at the next file', () => {
  const kinds = classifyPatch('diff --git a/x b/x\n@@ -1 +1 @@\n-a\ndiff --git a/y b/y\n--- a/y').map(
    ({ kind }) => kind,
  );
  assert.deepEqual(kinds, ['header', 'hunk', 'del', 'header', 'header']);
});

test('stylePatch colors by kind and leaves context lines alone', () => {
  const out = stylePatch('diff --git a/x b/x\n@@ -1 +1 @@\n ctx\n-a\n+b', tagged);
  assert.equal(
    out,
    '<bold>diff --git a/x b/x</bold>\n<cyan>@@ -1 +1 @@</cyan>\n ctx\n<red>-a</red>\n<green>+b</green>',
  );
});

test('plural', () => {
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(0, 'file'), '0 files');
  assert.equal(plural(3, 'commit'), '3 commits');
});
