import type { BranchType, GenerateCommitMessageOutput, GitDiff, GitDiffFile } from '@git-assistant/shared';

export const COMMIT_SYSTEM_PROMPT: string =
  'You write git commit messages. If the recent commits show a consistent convention (prefix words, ' +
  'scopes, casing, ticket references), follow it exactly; otherwise use Conventional Commits. ' +
  'Reply with a concise subject line (<=72 chars, imperative mood) optionally followed by a blank line ' +
  'and a short body explaining why. No code fences, no quotes.';
export const BRANCH_SYSTEM_PROMPT: string =
  'You suggest git branch names. Reply with 3-5 kebab-case names, one per line, no numbering, ' +
  'using only [a-z0-9._/-].';

export const PR_SYSTEM_PROMPT: string =
  'You write pull request descriptions. Reply with a title (<=72 chars) on the first line, a blank line, ' +
  'then a Markdown body: one or two sentences on what the change does and why, then a bullet list of ' +
  'notable changes. Call out breaking changes, migrations, or follow-ups only if there are any. ' +
  'Do not wrap the reply in code fences.';

/** Repository context that lets the model match local conventions. */
export interface CommitContext {
  readonly branch: string;
  readonly recentSubjects: readonly string[];
}

export function buildCommitPrompt(diff: GitDiff, context: CommitContext, hint: string | undefined): string {
  const fileList = diff.files.map((file: GitDiffFile) => `- ${file.path} (+${file.additions}/-${file.deletions})`).join('\n');
  const history =
    context.recentSubjects.length > 0
      ? `Recent commits (newest first):\n${context.recentSubjects.map((subject: string) => `- ${subject}`).join('\n')}\n\n`
      : 'Recent commits: none (first commit).\n\n';
  return (
    `${authorNote(hint)}Branch: ${context.branch}\n\n${history}` +
    `Staged changes (+${diff.additions}/-${diff.deletions}):\n${fileList}\n\nDiff:\n${clampPatch(diff.patch)}`
  );
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

export function buildBranchPrompt(
  changes: WorkingChanges,
  type: BranchType | undefined,
  hint: string | undefined,
): string {
  const prefix = `${authorNote(hint)}${type !== undefined ? `Preferred prefix/type: ${type}.\n` : ''}`;
  const changed = new Set([...changes.staged.files, ...changes.unstaged.files].map((file: GitDiffFile) => file.path));
  const fileList = [
    ...[...changed].map((path: string) => `- ${path}`),
    ...changes.untracked.map((path: string) => `- ${path} (new, untracked)`),
  ].join('\n');
  const patch = [changes.staged.patch, changes.unstaged.patch].filter((text: string) => text.trim() !== '').join('\n');
  return `${prefix}Changed files:\n${fileList}\n\nDiff:\n${clampPatch(patch)}`;
}

/** Everything a PR contains: the commits ahead of `base` and their combined diff. */
export interface PrContext {
  readonly base: string;
  readonly branch: string;
  readonly log: string;
  readonly diff: GitDiff;
}

export function buildPrPrompt(context: PrContext, hint: string | undefined): string {
  const fileList = context.diff.files
    .map((file: GitDiffFile) => `- ${file.path} (+${file.additions}/-${file.deletions})`)
    .join('\n');
  return (
    `${authorNote(hint)}Branch ${context.branch} into ${context.base}.\n\n` +
    `Commits (oldest first):\n${clampPatch(context.log, 3000)}\n\n` +
    `Changed files (+${context.diff.additions}/-${context.diff.deletions}):\n${fileList}\n\n` +
    `Diff:\n${clampPatch(context.diff.patch)}`
  );
}

/** Title + Markdown body; tolerates a "# " heading or "Title:" label on the first line. */
export function parsePrDescription(text: string): { title: string; body: string } {
  const { subject, body = '' } = parseCommitMessage(text.trim().replace(/^(?:#+\s*|title:\s*)/i, ''));
  return { title: subject, body };
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

/** The user's stated intent leads the prompt: it explains the "why" a diff can't show. */
function authorNote(hint: string | undefined): string {
  return hint !== undefined && hint.trim() !== '' ? `Author's note on intent: ${hint.trim()}\n\n` : '';
}

/** Truncate a patch (or commit log) so prompts stay within a sane token budget. */
function clampPatch(patch: string, maxChars = 6000): string {
  return patch.length <= maxChars ? patch : `${patch.slice(0, maxChars)}\n... [diff truncated]`;
}
