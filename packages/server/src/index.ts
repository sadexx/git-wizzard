#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerStatusTool } from '@/tools/status.js';
import { registerDiffTool } from '@/tools/diff.js';
import { registerBranchNameTool } from '@/tools/branch-name.js';
import { registerCommitMessageTool } from '@/tools/commit-message.js';
import { registerCreateCommitTool } from '@/tools/create-commit.js';
import { registerCreateBranchTool } from './tools/create-branch.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'git-assistant-server', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerStatusTool(server);
  registerDiffTool(server);
  registerBranchNameTool(server);
  registerCommitMessageTool(server);
  registerCreateCommitTool(server);
  registerCreateBranchTool(server);
  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
