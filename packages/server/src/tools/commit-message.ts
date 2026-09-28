import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import {
  generateCommitMessageInputSchema,
  generateCommitMessageOutputSchema,
  gitError,
  parseWithSchema,
  providerError,
  type GenerateCommitMessageInput,
  type GenerateCommitMessageOutput,
} from '@git-assistant/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, samplingError, toolErr } from '#tools/tool-result.js';
import { buildCommitPrompt, COMMIT_SYSTEM_PROMPT, parseCommitMessage } from '#tools/format.js';

export function registerCommitMessageTool(server: McpServer): void {
  server.registerTool(
    'generate_commit_message',
    {
      title: 'Generate commit message',
      description: 'Summarize staged changes into a commit message via client sampling. Produces text only.',
      inputSchema: generateCommitMessageInputSchema,
      outputSchema: generateCommitMessageOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GenerateCommitMessageInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const diff = await repo.value.diff(true);
      if (!diff.ok) return toolErr(diff.error);
      if (diff.value.files.length === 0) {
        return toolErr(gitError('nothing_to_commit', 'No staged changes to summarize'));
      }

      let sampled: CreateMessageResult;
      try {
        sampled = await server.server.createMessage({
          systemPrompt: COMMIT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: { type: 'text', text: buildCommitPrompt(diff.value) } }],
          maxTokens: 400,
        });
      } catch (cause) {
        return toolErr(samplingError(cause));
      }
      if (sampled.content.type !== 'text') {
        return toolErr(providerError('invalid_response', 'Sampling returned non-text content'));
      }
      return fromResult(
        parseWithSchema(generateCommitMessageOutputSchema, parseCommitMessage(sampled.content.text)),
        (generated: GenerateCommitMessageOutput) => generated.message,
      );
    },
  );
}
