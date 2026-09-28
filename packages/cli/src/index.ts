#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuthCommand } from '#commands/auth.js';
import { registerStatusCommand } from '#commands/status.js';
import { registerDiffCommand } from '#commands/diff.js';
import { registerBranchCommand } from '#commands/branch.js';
import { registerCommitCommand } from '#commands/commit.js';
import { registerPrCommand } from '#commands/pr.js';
import { startInteractiveUi } from '#ui/App.js';

function buildProgram(): Command {
  const program = new Command();
  program
    .name('git-assistant')
    .description('AI-assisted git helper (status, diff, branch, commit)')
    .version('0.0.0')
    .showHelpAfterError();

  registerAuthCommand(program);
  registerStatusCommand(program);
  registerDiffCommand(program);
  registerBranchCommand(program);
  registerCommitCommand(program);
  registerPrCommand(program);

  return program;
}

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    await startInteractiveUi();
    return;
  }
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
