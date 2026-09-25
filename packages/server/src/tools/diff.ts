import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDiffInputSchema, getDiffOutputSchema } from '@git-assistant/shared';
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
    async (input) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const diff = await repo.value.diff(input.staged ?? false);
      return fromResult(
        diff,
        (d) => `${d.staged ? 'Staged' : 'Unstaged'} diff: ${d.files.length} file(s), +${d.additions}/-${d.deletions}.`,
      );
    },
  );
}
