import type { GitFileChange } from '@git-wizzard/shared';

/** How much of a file's change is in the index: all of it, part of it (more edits since `git add`), or none. */
export type Staged = 'all' | 'part' | 'none';

export function stagedState(file: GitFileChange): Staged {
  if (file.index === 'unmodified') return 'none';
  return file.workingTree === 'unmodified' ? 'all' : 'part';
}

/** "new file", "modified", "renamed from old.ts", … as the file stands in the index, else in the working tree. */
export function changeLabel(file: GitFileChange): string {
  const change = file.index !== 'unmodified' ? file.index : file.workingTree;
  const label = change === 'added' || change === 'untracked' ? 'new file' : change;
  return file.originalPath !== undefined ? `${label} from ${file.originalPath}` : label;
}

/**
 * What to `git add` and `git reset` so each file in `wanted` ends up fully staged (true) or unstaged (false).
 * Files already that way are left alone; unstaging a rename also restores its old path.
 */
export function stagingPlan(
  files: readonly GitFileChange[],
  wanted: ReadonlyMap<string, boolean>,
): { stage: string[]; unstage: string[] } {
  const stage: string[] = [];
  const unstage: string[] = [];
  for (const file of files) {
    const want = wanted.get(file.path);
    const state = stagedState(file);
    if (want === true && state !== 'all') stage.push(file.path);
    else if (want === false && state !== 'none') {
      unstage.push(file.path, ...(file.originalPath !== undefined ? [file.originalPath] : []));
    }
  }
  return { stage, unstage };
}
