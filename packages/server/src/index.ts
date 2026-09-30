#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerStatusTool } from '#tools/status.js';
import { registerDiffTool } from '#tools/diff.js';
import { registerBranchNameTool } from '#tools/branch-name.js';
import { registerCommitMessageTool } from '#tools/commit-message.js';
import { registerCreateCommitTool } from '#tools/create-commit.js';
import { registerCreateBranchTool } from '#tools/create-branch.js';
import { registerPrDescriptionTool } from '#tools/pr-description.js';
import { registerStageFilesTool } from '#tools/stage-files.js';
import { registerPushTool } from '#tools/push.js';
import { registerCreatePullRequestTool } from '#tools/create-pull-request.js';

export function createServer(): McpServer {
  const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
  const server = new McpServer({ name: 'git-wizzard-server', version }, { capabilities: { tools: {} } });
  registerStatusTool(server);
  registerDiffTool(server);
  registerBranchNameTool(server);
  registerCommitMessageTool(server);
  registerCreateCommitTool(server);
  registerCreateBranchTool(server);
  registerPrDescriptionTool(server);
  registerStageFilesTool(server);
  registerPushTool(server);
  registerCreatePullRequestTool(server);
  return server;
}

async function main(): Promise<void> {
  // The client owns the terminal (the UI draws on it full screen), so git must fail rather than ask for a
  // username/password there; credential helpers and ssh-agent still work.
  process.env['GIT_TERMINAL_PROMPT'] = '0';
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
