import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createBranchInputSchema, createBranchOutputSchema } from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerCreateBranchTool(server: McpServer): void {
  server.registerTool(
    'create_branch',
    {
      title: 'Create branch',
      description: 'Create and switch to a new git branch. Mutates repository state.',
      inputSchema: createBranchInputSchema,
      outputSchema: createBranchOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.createBranch(input.name);
      return fromResult(result, (b) => `Created and switched to ${b.branch}.`);
    },
  );
}
