import { dirname } from 'node:path';
import { causeMessage, type AppError, type ValidationIssue } from '@git-wizzard/shared';
import { configPath } from '#auth/config.js';

const KEY_HINT =
  'Run "gitwizz auth" to update your API key (or fix OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY if set in your environment).';

/**
 * Multi-line, user-facing rendering: what went wrong, the underlying detail
 * (git stderr, provider message) indented beneath it, and what to do next.
 */
export function renderError(error: AppError): string {
  const lines = [`error: ${error.message}`];

  const detail =
    error.kind === 'ValidationError'
      ? error.issues.map((issue: ValidationIssue) => `${issue.path || '<root>'}: ${issue.message}`).join('\n')
      : causeMessage(error.cause);
  if (detail !== undefined && detail !== '' && detail !== error.message) {
    lines.push(...detail.split('\n').map((line: string) => `  ${line}`));
  }

  const hint = errorHint(error);
  if (hint !== undefined) lines.push(`hint: ${hint}`);

  return lines.join('\n');
}

function errorHint(error: AppError): string | undefined {
  switch (error.kind) {
    case 'AuthError':
      switch (error.reason) {
        case 'missing_credentials':
          return 'Run "gitwizz auth" to set up a provider, or set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.';
        case 'no_terminal':
          return 'Run it in a terminal, or set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in the environment instead.';
        case 'invalid_api_key':
          return KEY_HINT;
        case 'unsupported_provider':
          return 'Set GIT_WIZZARD_PROVIDER to "openai", "gemini", or "anthropic".';
        case 'config_read_failed':
          return `Fix or delete ${configPath()}, then run "gitwizz auth".`;
        case 'config_write_failed':
          return `Check that ${dirname(configPath())} is writable.`;
      }
    case 'GitError':
      switch (error.reason) {
        case 'not_a_repository':
          return 'Run gitwizz from inside a git repository.';
        case 'nothing_to_commit':
          return 'Stage your changes with "git add <path>", or run "gitwizz commit -a" to include all tracked files.';
        case 'no_changes':
          return 'Branch names are suggested from your uncommitted changes; make some first.';
        case 'merge_conflict':
          return 'Resolve the conflicts, then try again.';
        case 'base_not_found':
          return 'Pass the target branch with --base <branch> (e.g. --base origin/main).';
        case 'no_commits':
          return 'Commit your work first, or pick a different --base.';
        case 'no_remote':
          return 'Add one with "git remote add origin <url>", or push once with "git push -u <remote> <branch>".';
        case 'push_rejected':
          return 'Pull their commits first ("git pull"), then push again.';
        case 'gh_not_found':
          return 'Install it from https://cli.github.com, then run "gh auth login".';
        case 'gh_not_authenticated':
          return 'Run "gh auth login", then try again.';
        default:
          return undefined;
      }
    case 'ProviderError':
      switch (error.reason) {
        case 'unauthorized':
          return KEY_HINT;
        case 'rate_limited':
          return 'Wait a moment and try again, or check your provider quota.';
        default:
          return undefined;
      }
    case 'ValidationError':
      return undefined;
  }
}
