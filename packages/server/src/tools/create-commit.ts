import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createCommitInputSchema,
  createCommitOutputSchema,
  type CommitResult,
  type CreateCommitInput,
} from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerCreateCommitTool(server: McpServer): void {
  server.registerTool(
    'create_commit',
    {
      title: 'Create commit',
      description: 'Create a commit from staged changes with the given message. Mutates repository state.',
      inputSchema: createCommitInputSchema,
      outputSchema: createCommitOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input: CreateCommitInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.createCommit(input.message);
      return fromResult(result, (c: CommitResult) => `Commited ${c.sha.slice(0, 8)} on ${c.branch}: ${c.summary}`);
    },
  );
}
