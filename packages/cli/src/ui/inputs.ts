import type { Key } from 'ink';
import { generationHintSchema } from '@git-wizzard/shared';

/** A one-line text field: its text and the cursor, counted in characters (code points). */
export interface Line {
  readonly value: string;
  readonly cursor: number;
}

/**
 * Applies one key to a field: ←/→ move, home/end (ctrl+a/ctrl+e) jump, backspace/delete remove around
 * the cursor, ctrl+u clears, text is inserted at the cursor. Undefined for keys that aren't editing.
 */
export function editLine(line: Line, input: string, key: Partial<Key>): Line | undefined {
  const chars = [...line.value];
  const at = Math.min(Math.max(0, line.cursor), chars.length);
  const join = (next: readonly string[], cursor: number): Line => ({ value: next.join(''), cursor });
  if (key.leftArrow) return join(chars, Math.max(0, at - 1));
  if (key.rightArrow) return join(chars, Math.min(chars.length, at + 1));
  if (key.home || (key.ctrl && input === 'a')) return join(chars, 0);
  if (key.end || (key.ctrl && input === 'e')) return join(chars, chars.length);
  if (key.backspace) return at === 0 ? join(chars, 0) : join(chars.toSpliced(at - 1, 1), at - 1);
  if (key.delete) return join(chars.toSpliced(at, 1), at);
  if (key.ctrl && input === 'u') return { value: '', cursor: 0 };
  if (input === '' || key.ctrl || key.meta) return undefined;
  // Pasted text: newlines become spaces, other control characters are dropped.
  const text = [...input.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '')];
  return join(chars.toSpliced(at, 0, ...text), at + text.length);
}

/** Empty clears the hint; otherwise the same 1–500 character rule as `--hint`. */
export function validateHint(value: string): string | undefined {
  return value === '' || generationHintSchema.safeParse(value).success ? undefined : 'Expected at most 500 characters.';
}

/** Mirrors `--base`: git would read a leading "-" as an option. */
export function validateBase(value: string): string | undefined {
  if (value === '') return 'Enter a branch or commit.';
  return value.startsWith('-') ? 'Must not start with "-".' : undefined;
}

/** Cheap checks before asking git, which has the final say on ref names. */
export function validateBranchName(value: string): string | undefined {
  if (value === '') return 'Enter a branch name.';
  return /\s/.test(value) ? 'Branch names cannot contain spaces.' : undefined;
}

/** Models containing `query` (any case), those starting with it first; the list's own order otherwise. */
export function rankModels(models: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  const hits = models.filter((model: string) => model.toLowerCase().includes(needle));
  return [
    ...hits.filter((model: string) => model.toLowerCase().startsWith(needle)),
    ...hits.filter((model: string) => !model.toLowerCase().startsWith(needle)),
  ];
}

/** "Add a hint…" or "Change hint (…)". */
export function hintLabel(hint: string | undefined): string {
  return hint === undefined ? 'Add a hint…' : 'Change hint…';
}
