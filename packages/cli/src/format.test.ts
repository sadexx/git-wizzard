import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPatch, plural, stylePatch, withProgress, type Style } from '#format.js';

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

function recorder(isTTY: boolean): { isTTY: boolean; write(text: string): boolean; out: string[] } {
  const out: string[] = [];
  return { isTTY, out, write: (text: string) => out.push(text) > 0 };
}

test('withProgress draws a labeled spinner on a terminal and erases it, even on failure', async () => {
  const stream = recorder(true);
  assert.equal(await withProgress('Working', async () => 42, stream), 42);
  assert.deepEqual(stream.out, ['\r⠋ Working', '\r\x1b[2K']);

  const failing = recorder(true);
  await assert.rejects(withProgress('Working', async () => Promise.reject(new Error('boom')), failing), /boom/);
  assert.equal(failing.out.at(-1), '\r\x1b[2K');
});

test('withProgress writes nothing when the stream is not a terminal', async () => {
  const stream = recorder(false);
  assert.equal(await withProgress('Working', async () => 'done', stream), 'done');
  assert.deepEqual(stream.out, []);
});

test('plural', () => {
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(0, 'file'), '0 files');
  assert.equal(plural(3, 'commit'), '3 commits');
});
