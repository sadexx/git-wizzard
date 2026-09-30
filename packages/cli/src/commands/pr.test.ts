import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPrText } from '#commands/pr.js';

test('splitPrText takes the first line as title and the trimmed rest as body', () => {
  assert.deepEqual(splitPrText('Add retries\n\nWhy.\n\n- one\n'), { title: 'Add retries', body: 'Why.\n\n- one' });
  assert.deepEqual(splitPrText('  Title only  '), { title: 'Title only', body: '' });
});
