import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import {
  parseWithSchema,
  providerError,
  suggestBranchNameInputSchema,
  suggestBranchNameOutputSchema,
  type SuggestBranchNameInput,
  type SuggestBranchNameOutput,
} from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, toolErr } from '#tools/tool-result.js';
import { BRANCH_SYSTEM_PROMPT, buildBranchPrompt, parseBranchSuggestions } from '#tools/format.js';

export function registerBranchNameTool(server: McpServer): void {
  server.registerTool(
    'suggest_branch_name',
    {
      title: 'Suggest branch name',
      description: 'Suggest branch names for the current changes via client sampling. Produces text only.',
      inputSchema: suggestBranchNameInputSchema,
      outputSchema: suggestBranchNameOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: SuggestBranchNameInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const diff = await repo.value.diff(false);
      if (!diff.ok) return toolErr(diff.error);

      let sampled: CreateMessageResult;
      try {
        sampled = await server.server.createMessage({
          systemPrompt: BRANCH_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: { type: 'text', text: buildBranchPrompt(diff.value, input.type) } }],
          maxTokens: 200,
        });
      } catch (cause) {
        return toolErr(providerError('request_failed', 'Sampling request failed', cause));
      }
      if (sampled.content.type !== 'text') {
        return toolErr(providerError('invalid_response', 'Sampling returned non-text content'));
      }
      return fromResult(
        parseWithSchema(suggestBranchNameOutputSchema, { suggestions: parseBranchSuggestions(sampled.content.text) }),
        (branchSuggestions: SuggestBranchNameOutput) => `Suggestions: ${branchSuggestions.suggestions.join(', ')}`,
      );
    },
  );
}
