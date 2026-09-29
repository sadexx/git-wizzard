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
} from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, samplingError, toolErr } from '#tools/tool-result.js';
import { buildCommitPrompt, COMMIT_SYSTEM_PROMPT, parseCommitMessage } from '#tools/format.js';

export function registerCommitMessageTool(server: McpServer): void {
  server.registerTool(
    'generate_commit_message',
    {
      title: 'Generate commit message',
      description:
        'Summarize staged changes (or, with all, every tracked change like `git commit -a`) into a commit message ' +
        'via client sampling. Produces text only.',
      inputSchema: generateCommitMessageInputSchema,
      outputSchema: generateCommitMessageOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GenerateCommitMessageInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const all = input.all === true;
      const diff = await repo.value.commitDiff(all);
      if (!diff.ok) return toolErr(diff.error);
      if (diff.value.files.length === 0) {
        return toolErr(
          gitError('nothing_to_commit', all ? 'No changes to tracked files to summarize' : 'No staged changes to summarize'),
        );
      }
      const status = await repo.value.status();
      if (!status.ok) return toolErr(status.error);
      const recentSubjects = await repo.value.recentSubjects();
      if (!recentSubjects.ok) return toolErr(recentSubjects.error);
      const prompt = buildCommitPrompt(
        diff.value,
        { branch: status.value.branch, recentSubjects: recentSubjects.value },
        input.hint,
      );

      let sampled: CreateMessageResult;
      try {
        sampled = await server.server.createMessage({
          systemPrompt: COMMIT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
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
