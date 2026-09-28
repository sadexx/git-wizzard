import { z } from 'zod';
import { commitResultSchema, gitDiffSchema, gitStatusSchema } from '#schemas/git.js';

export const toolNameSchema = z.enum([
  'get_status',
  'get_diff',
  'suggest_branch_name',
  'generate_commit_message',
  'create_commit',
  'create_branch',
]);
export type ToolName = z.infer<typeof toolNameSchema>;

/** `_meta` key under which a failed tool call carries its wire-form AppError (see `toWireError`). */
export const TOOL_ERROR_META_KEY = 'git-assistant/error';

export const branchTypeSchema = z.enum(['feature', 'fix', 'chore', 'refactor', 'docs', 'test', 'hotfix']);
export type BranchType = z.infer<typeof branchTypeSchema>;

export const getStatusInputSchema = z.object({ repoPath: z.string().min(1).optional() }).strict();
export type GetStatusInput = z.infer<typeof getStatusInputSchema>;
export const getStatusOutputSchema = gitStatusSchema;
export type GetStatusOutput = z.infer<typeof getStatusOutputSchema>;

export const getDiffInputSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    staged: z.boolean().optional(),
  })
  .strict();
export type GetDiffInput = z.infer<typeof getDiffInputSchema>;
export const getDiffOutputSchema = gitDiffSchema;
export type GetDiffOutput = z.infer<typeof getDiffOutputSchema>;

/** Free-text intent from the user ("why"), passed to the model alongside the diff. */
export const generationHintSchema = z.string().min(1).max(500);

export const suggestBranchNameInputSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    type: branchTypeSchema.optional(),
    hint: generationHintSchema.optional(),
  })
  .strict();
export type SuggestBranchNameInput = z.infer<typeof suggestBranchNameInputSchema>;
export const suggestBranchNameOutputSchema = z
  .object({
    suggestions: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SuggestBranchNameOutput = z.infer<typeof suggestBranchNameOutputSchema>;

export const generateCommitMessageInputSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    hint: generationHintSchema.optional(),
  })
  .strict();
export type GenerateCommitMessageInput = z.infer<typeof generateCommitMessageInputSchema>;
export const generateCommitMessageOutputSchema = z
  .object({
    subject: z.string().min(1).max(72),
    body: z.string().optional(),
    message: z.string().min(1),
  })
  .strict();
export type GenerateCommitMessageOutput = z.infer<typeof generateCommitMessageOutputSchema>;

export const createCommitInputSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .strict();
export type CreateCommitInput = z.infer<typeof createCommitInputSchema>;
export const createCommitOutputSchema = commitResultSchema;
export type CreateCommitOutput = z.infer<typeof createCommitOutputSchema>;

export const createBranchInputSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    name: z.string().min(1),
  })
  .strict();
export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;

export const createBranchOutputSchema = z.object({ branch: z.string().min(1), created: z.boolean() });
export type CreateBranchOutput = z.infer<typeof createBranchOutputSchema>;
