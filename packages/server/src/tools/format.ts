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

export function buildBranchPrompt(diff: GitDiff, type: BranchType | undefined): string {
  const prefix = type !== undefined ? `Preferred prefix/type: ${type}.\n` : '';
  const fileList = diff.files.map((file: GitDiffFile) => `- ${file.path}`).join('\n');
  return `${prefix}Changed files:\n${fileList}\n\nDiff:\n${clampPatch(diff.patch)}`;
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

/** Notmalize model output into branch-name-safe, de-duplicated kebab tokens (max 5). */
export function parseBranchSuggestions(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const name = raw
      .trim()
      .replace(/^[-*\d.\s]+/, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
    if (/^[a-z0-9._/-]+$/.test(name)) seen.add(name);
  }
  return [...seen].slice(0, 5);
}

/** Truncate a patch so prompts stay within a sane token budget. */
function clampPatch(patch: string, maxChars = 6000): string {
  return patch.length <= maxChars ? patch : `${patch.slice(0, maxChars)}\n... [diff truncated]`;
}
