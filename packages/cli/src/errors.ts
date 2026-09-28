import { dirname } from 'node:path';
import { causeMessage, type AppError, type ValidationIssue } from '@git-assistant/shared';
import { configPath } from '#auth/config.js';

const KEY_HINT =
  'Run "git-assistant auth" to update your API key (or fix OPENAI_API_KEY / GEMINI_API_KEY if set in your environment).';

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
          return 'Run "git-assistant auth" to set up a provider, or set OPENAI_API_KEY or GEMINI_API_KEY.';
        case 'invalid_api_key':
          return KEY_HINT;
        case 'unsupported_provider':
          return 'Set GIT_ASSISTANT_PROVIDER to "openai" or "gemini".';
        case 'config_read_failed':
          return `Fix or delete ${configPath()}, then run "git-assistant auth".`;
        case 'config_write_failed':
          return `Check that ${dirname(configPath())} is writable.`;
      }
    case 'GitError':
      switch (error.reason) {
        case 'not_a_repository':
          return 'Run git-assistant from inside a git repository.';
        case 'nothing_to_commit':
          return 'Stage your changes with "git add <path>" first.';
        case 'no_changes':
          return 'Branch names are suggested from your uncommitted changes; make some first.';
        case 'merge_conflict':
          return 'Resolve the conflicts, then try again.';
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
