import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createBranchOutputSchema,
  createCommitOutputSchema,
  err,
  fromWireError,
  generateCommitMessageOutputSchema,
  generatePrDescriptionOutputSchema,
  getDiffOutputSchema,
  getStatusOutputSchema,
  ok,
  parseWithSchema,
  providerError,
  suggestBranchNameOutputSchema,
  TOOL_ERROR_META_KEY,
  type AppError,
  type BranchType,
  type CommitResult,
  type CreateBranchOutput,
  type GenerateCommitMessageOutput,
  type GeneratePrDescriptionOutput,
  type GitDiff,
  type GitStatus,
  type ProviderError,
  type Result,
} from '@git-assistant/shared';
import { createSamplingHandler, type AdapterResolver } from '#mcp/sampling.js';

export type ClientError = AppError;

/** Options shared by the AI-backed tools; `hint` is the user's stated intent. */
export interface GenerationOptions {
  readonly hint?: string | undefined;
  readonly repoPath?: string;
}

export interface SuggestBranchOptions extends GenerationOptions {
  readonly type?: BranchType | undefined;
}

/** `all` works like `git commit -a`: every tracked change, not only the staged ones. */
export interface CommitMessageOptions extends GenerationOptions {
  readonly all?: boolean | undefined;
}

export interface PrDescriptionOptions extends GenerationOptions {
  readonly base?: string | undefined;
}

export interface GitAssistantClient {
  getStatus(repoPath?: string): Promise<Result<GitStatus, ClientError>>;
  getDiff(options?: { staged?: boolean; repoPath?: string }): Promise<Result<GitDiff, ClientError>>;
  suggestBranchName(options?: SuggestBranchOptions): Promise<Result<string[], ClientError>>;
  generateCommitMessage(options?: CommitMessageOptions): Promise<Result<GenerateCommitMessageOutput, ClientError>>;
  generatePrDescription(options?: PrDescriptionOptions): Promise<Result<GeneratePrDescriptionOutput, ClientError>>;
  createCommit(options: {
    message: string;
    all?: boolean | undefined;
    repoPath?: string;
  }): Promise<Result<CommitResult, ClientError>>;
  createBranch(options: { name: string; repoPath?: string }): Promise<Result<CreateBranchOutput, ClientError>>;
  close(): Promise<void>;
}

/**
 * Spawn the git-assistant server as a subprocess, register the sampling handler
 * (which resolves the provider adapter only when a tool actually samples), and connect.
 * `cwd` is the target repo - the server resolves its own dependencies from its install
 * location, not from `cwd`.
 */
export async function connectClient(
  resolveAdapter: AdapterResolver,
  options: { cwd?: string } = {},
): Promise<Result<GitAssistantClient, ProviderError>> {
  let serverEntry: string;
  try {
    serverEntry = resolveServerEntry();
  } catch (cause) {
    return err(providerError('request_failed', 'Could not resolve the @git-assistant/server entry point', cause));
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: options.cwd ?? process.cwd(),
    env: cleanEnv(process.env),
    stderr: 'inherit',
  });
  const client = new Client({ name: 'git-assistant-cli', version: '0.0.0' }, { capabilities: { sampling: {} } });
  client.setRequestHandler(CreateMessageRequestSchema, createSamplingHandler(resolveAdapter));

  try {
    await client.connect(transport);
  } catch (cause) {
    return err(providerError('request_failed', 'Failed to connect to the git-assistant server', cause));
  }

  return ok(new StdioGitAssistantClient(client));
}

class StdioGitAssistantClient implements GitAssistantClient {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async getStatus(repoPath?: string): Promise<Result<GitStatus, ClientError>> {
    const raw = await this.rawCall('get_status', repoPath !== undefined ? { repoPath } : {});
    return raw.ok ? parseWithSchema(getStatusOutputSchema, raw.value) : raw;
  }

  public async getDiff(options: { staged?: boolean; repoPath?: string } = {}): Promise<Result<GitDiff, ClientError>> {
    const args: Record<string, unknown> = {};
    if (options.staged !== undefined) args['staged'] = options.staged;
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('get_diff', args);
    return raw.ok ? parseWithSchema(getDiffOutputSchema, raw.value) : raw;
  }

  public async suggestBranchName(options: SuggestBranchOptions = {}): Promise<Result<string[], ClientError>> {
    const args: Record<string, unknown> = {};
    if (options.type !== undefined) args['type'] = options.type;
    if (options.hint !== undefined) args['hint'] = options.hint;
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('suggest_branch_name', args);
    if (!raw.ok) return raw;

    const parsed = parseWithSchema(suggestBranchNameOutputSchema, raw.value);
    return parsed.ok ? ok(parsed.value.suggestions) : parsed;
  }

  public async generateCommitMessage(
    options: CommitMessageOptions = {},
  ): Promise<Result<GenerateCommitMessageOutput, ClientError>> {
    const args: Record<string, unknown> = {};
    if (options.hint !== undefined) args['hint'] = options.hint;
    if (options.all !== undefined) args['all'] = options.all;
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('generate_commit_message', args);
    return raw.ok ? parseWithSchema(generateCommitMessageOutputSchema, raw.value) : raw;
  }

  public async generatePrDescription(
    options: PrDescriptionOptions = {},
  ): Promise<Result<GeneratePrDescriptionOutput, ClientError>> {
    const args: Record<string, unknown> = {};
    if (options.base !== undefined) args['base'] = options.base;
    if (options.hint !== undefined) args['hint'] = options.hint;
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('generate_pr_description', args);
    return raw.ok ? parseWithSchema(generatePrDescriptionOutputSchema, raw.value) : raw;
  }

  public async createCommit(options: {
    message: string;
    all?: boolean | undefined;
    repoPath?: string;
  }): Promise<Result<CommitResult, ClientError>> {
    const args: Record<string, unknown> = { message: options.message };
    if (options.all !== undefined) args['all'] = options.all;
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('create_commit', args);
    return raw.ok ? parseWithSchema(createCommitOutputSchema, raw.value) : raw;
  }

  public async createBranch(options: {
    name: string;
    repoPath?: string;
  }): Promise<Result<CreateBranchOutput, ClientError>> {
    const args: Record<string, unknown> = { name: options.name };
    if (options.repoPath !== undefined) args['repoPath'] = options.repoPath;

    const raw = await this.rawCall('create_branch', args);
    return raw.ok ? parseWithSchema(createBranchOutputSchema, raw.value) : raw;
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private async rawCall(name: string, args: Record<string, unknown>): Promise<Result<unknown, ClientError>> {
    let result: CallToolResult;
    try {
      result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (cause) {
      return err(providerError('request_failed', `Tool ${name} call failed`, cause));
    }

    if (result.isError === true) return err(toolCallError(name, result));
    if (result.structuredContent === undefined) {
      return err(providerError('request_failed', `Tool ${name} returned no structured content`));
    }

    return ok(result.structuredContent);
  }
}

/** The typed error our server attaches to a failed call; a generic provider error for anything else. */
export function toolCallError(name: string, result: CallToolResult): AppError {
  return (
    fromWireError(result._meta?.[TOOL_ERROR_META_KEY]) ??
    providerError('request_failed', textContent(result) ?? `Tool ${name} returned an error`)
  );
}

function textContent(result: CallToolResult): string | undefined {
  const [first] = result.content;
  return first !== undefined && first.type === 'text' ? first.text : undefined;
}

function cleanEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function resolveServerEntry(): string {
  return createRequire(import.meta.url).resolve('@git-assistant/server');
}
