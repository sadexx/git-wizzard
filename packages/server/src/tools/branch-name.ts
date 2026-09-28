import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import {
  gitError,
  parseWithSchema,
  providerError,
  suggestBranchNameInputSchema,
  suggestBranchNameOutputSchema,
  type GitFileChange,
  type SuggestBranchNameInput,
  type SuggestBranchNameOutput,
} from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, samplingError, toolErr } from '#tools/tool-result.js';
import {
  BRANCH_SYSTEM_PROMPT,
  buildBranchPrompt,
  hasChanges,
  parseBranchSuggestions,
  type WorkingChanges,
} from '#tools/format.js';

export function registerBranchNameTool(server: McpServer): void {
  server.registerTool(
    'suggest_branch_name',
    {
      title: 'Suggest branch name',
      description:
        'Suggest branch names for all uncommitted work (staged, unstaged, untracked) via client sampling. ' +
        'Produces text only.',
      inputSchema: suggestBranchNameInputSchema,
      outputSchema: suggestBranchNameOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: SuggestBranchNameInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const staged = await repo.value.diff(true);
      if (!staged.ok) return toolErr(staged.error);
      const unstaged = await repo.value.diff(false);
      if (!unstaged.ok) return toolErr(unstaged.error);
      const status = await repo.value.status();
      if (!status.ok) return toolErr(status.error);

      const changes: WorkingChanges = {
        staged: staged.value,
        unstaged: unstaged.value,
        untracked: status.value.files
          .filter((file: GitFileChange) => file.workingTree === 'untracked')
          .map((file: GitFileChange) => file.path),
      };
      if (!hasChanges(changes)) {
        return toolErr(gitError('no_changes', 'No changes to suggest a branch name from'));
      }

      let sampled: CreateMessageResult;
      try {
        sampled = await server.server.createMessage({
          systemPrompt: BRANCH_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: { type: 'text', text: buildBranchPrompt(changes, input.type) } }],
          maxTokens: 200,
        });
      } catch (cause) {
        return toolErr(samplingError(cause));
      }
      if (sampled.content.type !== 'text') {
        return toolErr(providerError('invalid_response', 'Sampling returned non-text content'));
      }

      const suggestions = parseBranchSuggestions(sampled.content.text);
      if (suggestions.length === 0) {
        return toolErr(providerError('invalid_response', 'The model returned no usable branch names'));
      }
      return fromResult(
        parseWithSchema(suggestBranchNameOutputSchema, { suggestions }),
        (branchSuggestions: SuggestBranchNameOutput) => `Suggestions: ${branchSuggestions.suggestions.join(', ')}`,
      );
    },
  );
}
