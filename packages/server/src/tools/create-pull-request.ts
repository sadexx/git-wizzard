import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createPullRequestInputSchema,
  createPullRequestOutputSchema,
  type CreatePullRequestInput,
  type CreatePullRequestOutput,
} from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerCreatePullRequestTool(server: McpServer): void {
  server.registerTool(
    'create_pull_request',
    {
      title: 'Create pull request',
      description:
        'Open a GitHub pull request for the current branch with `gh pr create`, pushing the branch first if the remote lacks it or some of its commits. Needs the GitHub CLI, logged in.',
      inputSchema: createPullRequestInputSchema,
      outputSchema: createPullRequestOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input: CreatePullRequestInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.createPullRequest(input.title, input.body, input.base);
      return fromResult(result, (created: CreatePullRequestOutput) => `Opened ${created.url}.`);
    },
  );
}
