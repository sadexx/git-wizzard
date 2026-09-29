import { generationHintSchema } from '@git-wizzard/shared';

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

/** "Add a hint…" or "Change hint (…)". */
export function hintLabel(hint: string | undefined): string {
  return hint === undefined ? 'Add a hint…' : 'Change hint…';
}
