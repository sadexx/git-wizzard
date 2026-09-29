import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import {
  generatePrDescriptionInputSchema,
  generatePrDescriptionOutputSchema,
  gitError,
  parseWithSchema,
  providerError,
  type GeneratePrDescriptionInput,
  type GeneratePrDescriptionOutput,
} from '@git-wizzard/shared';
import { GitRepository } from '#git/repository.js';
import { fromResult, samplingError, toolErr } from '#tools/tool-result.js';
import { buildPrPrompt, parsePrDescription, PR_SYSTEM_PROMPT } from '#tools/format.js';

export function registerPrDescriptionTool(server: McpServer): void {
  server.registerTool(
    'generate_pr_description',
    {
      title: 'Generate pull request description',
      description:
        'Describe the commits on HEAD that are not on the base branch (default: origin\'s default branch, ' +
        'else main/master) as a PR title and Markdown body, via client sampling. Produces text only.',
      inputSchema: generatePrDescriptionInputSchema,
      outputSchema: generatePrDescriptionOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GeneratePrDescriptionInput) => {
      const repo = await GitRepository.open(input.repoPath);
      if (!repo.ok) return toolErr(repo.error);

      const base = input.base ?? (await repo.value.defaultBase());
      if (base === undefined) {
        return toolErr(gitError('base_not_found', 'Could not detect a base branch (no origin/HEAD, main, or master)'));
      }
      if (!(await repo.value.hasCommit(base))) {
        return toolErr(gitError('base_not_found', `Base "${base}" is not a branch or commit`));
      }
      const status = await repo.value.status();
      if (!status.ok) return toolErr(status.error);
      const changes = await repo.value.branchChanges(base);
      if (!changes.ok) return toolErr(changes.error);
      const { commits, log, diff } = changes.value;
      if (commits === 0) {
        return toolErr(gitError('no_commits', `No commits on ${status.value.branch} that aren't on ${base}`));
      }
      const prompt = buildPrPrompt({ base, branch: status.value.branch, log, diff }, input.hint);

      let sampled: CreateMessageResult;
      try {
        sampled = await server.server.createMessage({
          systemPrompt: PR_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
          maxTokens: 800,
        });
      } catch (cause) {
        return toolErr(samplingError(cause));
      }
      if (sampled.content.type !== 'text') {
        return toolErr(providerError('invalid_response', 'Sampling returned non-text content'));
      }
      return fromResult(
        parseWithSchema(generatePrDescriptionOutputSchema, { ...parsePrDescription(sampled.content.text), base, commits }),
        (generated: GeneratePrDescriptionOutput) => `${generated.title}\n\n${generated.body}`,
      );
    },
  );
}
