import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pushInputSchema, pushOutputSchema, type PushInput, type PushResult } from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerPushTool(server: McpServer): void {
  server.registerTool(
    'push',
    {
      title: 'Push',
      description:
        'Push the current branch to its upstream, or set one on origin (else the only remote) for a new branch. Never force-pushes; fails when the remote has commits the branch lacks.',
      inputSchema: pushInputSchema,
      outputSchema: pushOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input: PushInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.push();
      return fromResult(result, (pushed: PushResult) => `Pushed ${pushed.branch} to ${pushed.upstream}.`);
    },
  );
}
