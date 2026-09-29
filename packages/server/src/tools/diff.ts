import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDiffInputSchema, getDiffOutputSchema, type GetDiffInput, type GitDiff } from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerDiffTool(server: McpServer): void {
  server.registerTool(
    'get_diff',
    {
      title: 'Git diff',
      description: 'Return the staged (--staged) or unstaged diff with per-file line counts and patch text.',
      inputSchema: getDiffInputSchema,
      outputSchema: getDiffOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GetDiffInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const diff = await repo.value.diff(input.staged ?? false);
      return fromResult(
        diff,
        (gitDiff: GitDiff) =>
          `${gitDiff.staged ? 'Staged' : 'Unstaged'} diff: ${gitDiff.files.length} file(s), +${gitDiff.additions}/-${gitDiff.deletions}.`,
      );
    },
  );
}
