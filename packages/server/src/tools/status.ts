import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getStatusInputSchema,
  getStatusOutputSchema,
  type GetStatusInput,
  type GitStatus,
} from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    'get_status',
    {
      title: 'Git status',
      description: 'Report working-tree status: branch, upstream, ahead/behind, and changed files.',
      inputSchema: getStatusInputSchema,
      outputSchema: getStatusOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GetStatusInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const status = await repo.value.status();
      return fromResult(
        status,
        (s: GitStatus) =>
          `On ${s.branch}${s.upstream !== undefined ? ` (tracking ${s.upstream})` : ''}: ` +
          `${s.files.length} changed file(s), ${s.ahead} ahead / ${s.behind} behind.`,
      );
    },
  );
}
