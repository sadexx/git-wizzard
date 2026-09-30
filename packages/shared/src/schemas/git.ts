import { z } from 'zod';

export const gitFileStatusSchema = z.enum([
  'unmodified',
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'ignored',
  'conflicted',
]);
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;

export const gitFileChangeSchema = z
  .object({
    path: z.string().min(1),
    index: gitFileStatusSchema,
    workingTree: gitFileStatusSchema,
    originalPath: z.string().min(1).optional(),
  })
  .strict();
export type GitFileChange = z.infer<typeof gitFileChangeSchema>;

export const gitStatusSchema = z
  .object({
    branch: z.string().min(1),
    upstream: z.string().min(1).optional(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    isClean: z.boolean(),
    files: z.array(gitFileChangeSchema),
  })
  .strict();
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const gitDiffFileSchema = z
  .object({
    path: z.string().min(1),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
  })
  .strict();
export type GitDiffFile = z.infer<typeof gitDiffFileSchema>;

export const gitDiffSchema = z
  .object({
    staged: z.boolean(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    files: z.array(gitDiffFileSchema),
    patch: z.string(),
  })
  .strict();
export type GitDiff = z.infer<typeof gitDiffSchema>;

export const commitResultSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{7,64}$/),
    branch: z.string().min(1),
    summary: z.string(),
  })
  .strict();
export type CommitResult = z.infer<typeof commitResultSchema>;

/** `commits` is how many were ahead of the upstream; absent when the push created the remote branch. */
export const pushResultSchema = z
  .object({
    branch: z.string().min(1),
    upstream: z.string().min(1),
    commits: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PushResult = z.infer<typeof pushResultSchema>;
