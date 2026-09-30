#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuthCommand } from '#commands/auth.js';
import { registerStatusCommand } from '#commands/status.js';
import { registerDiffCommand } from '#commands/diff.js';
import { registerBranchCommand } from '#commands/branch.js';
import { registerCommitCommand } from '#commands/commit.js';
import { registerPrCommand } from '#commands/pr.js';
import { registerPushCommand } from '#commands/push.js';
import { registerHookCommand } from '#commands/hook.js';
import { VERSION } from '#version.js';

function buildProgram(): Command {
  const program = new Command();
  program
    .name('gitwizz')
    .description('AI-assisted git: commit messages, branch names, and PR descriptions from your changes')
    .version(VERSION)
    .showHelpAfterError()
    .addHelpText(
      'after',
      `
Run without arguments for the interactive menu.

Examples:
  gitwizz commit                  message for staged changes; confirm, edit, or regenerate
  gitwizz commit -a --hint "why"  include all tracked changes, steer with your intent
  gitwizz branch --type fix       suggest and create a branch for uncommitted work
  gitwizz push                    push this branch (sets the upstream for a new one)
  gitwizz pr > pr.md              title and description for this branch's commits
  gitwizz pr --open               write the description, then open the PR with gh
  gitwizz hook install            draft messages inside plain "git commit"
  gitwizz auth status             which provider, model, and key are in use`,
    );

  registerAuthCommand(program);
  registerStatusCommand(program);
  registerDiffCommand(program);
  registerBranchCommand(program);
  registerCommitCommand(program);
  registerPushCommand(program);
  registerPrCommand(program);
  registerHookCommand(program);

  return program;
}

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    const { startInteractiveUi } = await import('#ui/App.js');
    await startInteractiveUi();
    return;
  }
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
