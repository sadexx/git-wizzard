import type { BranchType, GenerateCommitMessageOutput, GitDiff, GitDiffFile } from '@git-assistant/shared';

export const COMMIT_SYSTEM_PROMPT: string =
  'You write Conventional-Commits-style git commit messages. Reply with a concise subject line ' +
  '(<=72 chars, imperative mood) optionally followed by a blank line and a short body. No code fences.';
export const BRANCH_SYSTEM_PROMPT: string =
  'You suggest git branch names. Reply with 3-5 kebab-case names, one per line, no numbering, ' +
  'using only [a-z0-9._/-].';

export function buildCommitPrompt(diff: GitDiff): string {
  const fileList = diff.files.map((file: GitDiffFile) => `- ${file.path} (+${file.additions}/-${file.deletions})`).join('\n');
  return `Staged changes (+${diff.additions}/-${diff.deletions}):\n${fileList}\n\nDiff:\n${clampPatch(diff.patch)}`;
}

/** Everything uncommitted: branch names describe the work in progress, staged or not. */
export interface WorkingChanges {
  readonly staged: GitDiff;
  readonly unstaged: GitDiff;
  readonly untracked: readonly string[];
}

export function hasChanges(changes: WorkingChanges): boolean {
  return changes.staged.files.length > 0 || changes.unstaged.files.length > 0 || changes.untracked.length > 0;
}

export function buildBranchPrompt(changes: WorkingChanges, type: BranchType | undefined): string {
  const prefix = type !== undefined ? `Preferred prefix/type: ${type}.\n` : '';
  const changed = new Set([...changes.staged.files, ...changes.unstaged.files].map((file: GitDiffFile) => file.path));
  const fileList = [
    ...[...changed].map((path: string) => `- ${path}`),
    ...changes.untracked.map((path: string) => `- ${path} (new, untracked)`),
  ].join('\n');
  const patch = [changes.staged.patch, changes.unstaged.patch].filter((text: string) => text.trim() !== '').join('\n');
  return `${prefix}Changed files:\n${fileList}\n\nDiff:\n${clampPatch(patch)}`;
}

/** Split model output into subject/body/message. Subject is trimmed of wrapping quotes and clamped to 72 chars. */
export function parseCommitMessage(text: string): GenerateCommitMessageOutput {
  const [firstLine = '', ...bodyLines] = text.trim().split('\n');
  const subject = firstLine
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .slice(0, 72);
  const body = bodyLines.join('\n').trim();
  return body ? { subject, body, message: `${subject}\n\n${body}` } : { subject, message: subject };
}

/**
 * Normalize model output into de-duplicated kebab-case branch names (max 5) that git accepts.
 * Tolerates list markers ("-", "*", "1.", "1)") and wrapping quotes/backticks.
 */
export function parseBranchSuggestions(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const name = raw
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
    if (isValidBranchName(name)) seen.add(name);
  }
  return [...seen].slice(0, 5);
}

/** Our charset plus the `git check-ref-format --branch` rules that charset alone doesn't rule out. */
function isValidBranchName(name: string): boolean {
  return /^[a-z0-9._/-]+$/.test(name) && !/(^|\/)[.-]|\.\.|\/\/|[/.]$|\.lock(\/|$)/.test(name);
}

/** Truncate a patch so prompts stay within a sane token budget. */
function clampPatch(patch: string, maxChars = 6000): string {
  return patch.length <= maxChars ? patch : `${patch.slice(0, maxChars)}\n... [diff truncated]`;
}
