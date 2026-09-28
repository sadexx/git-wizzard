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
      description:
        'Create a commit from staged changes (or, with all, every tracked change like `git commit -a`) with the ' +
        'given message. Mutates repository state.',
      inputSchema: createCommitInputSchema,
      outputSchema: createCommitOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input: CreateCommitInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.createCommit(input.message, input.all === true);
      return fromResult(
        result,
        (createdCommit: CommitResult) =>
          `Committed ${createdCommit.sha.slice(0, 8)} on ${createdCommit.branch}: ${createdCommit.summary}`,
      );
    },
  );
}
