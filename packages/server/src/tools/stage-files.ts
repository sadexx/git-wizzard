import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  stageFilesInputSchema,
  stageFilesOutputSchema,
  type GitFileChange,
  type GitStatus,
  type StageFilesInput,
} from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';

export function registerStageFilesTool(server: McpServer): void {
  server.registerTool(
    'stage_files',
    {
      title: 'Stage files',
      description:
        'Stage (git add) and unstage (git reset) files, then report the new status. Paths are as get_status prints them. Mutates the index only.',
      inputSchema: stageFilesInputSchema,
      outputSchema: stageFilesOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input: StageFilesInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const result = await repo.value.stage(input.stage ?? [], input.unstage ?? []);
      return fromResult(
        result,
        (status: GitStatus) =>
          `Staged ${input.stage?.length ?? 0}, unstaged ${input.unstage?.length ?? 0}; ` +
          `${status.files.filter((file: GitFileChange) => file.index !== 'unmodified').length} file(s) now staged.`,
      );
    },
  );
}
