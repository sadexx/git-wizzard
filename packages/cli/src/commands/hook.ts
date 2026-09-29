import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';

const MARKER = '# Installed by git-wizzard';
const HOOK = 'prepare-commit-msg';

export function registerHookCommand(program: Command): void {
  const hook = program
    .command('hook')
    .description(`Manage the git ${HOOK} hook that drafts messages for plain "git commit"`);

  hook
    .command('install')
    .description('Pre-fill the editor of a plain "git commit" with an AI draft (never blocks the commit)')
    .action(() => {
      const path = hookPathOrFail();
      if (path === undefined) return;
      // The script itself (its shebang finds node), so a node upgrade doesn't break the hook.
      const result = installHook(path, [process.argv[1] ?? 'gitwizz']);
      if (result === 'foreign') {
        return fail(`${path} already exists and was not installed by git-wizzard`, 'Remove or rename it first.');
      }
      process.stdout.write(
        `${result === 'installed' ? 'Installed' : 'Updated'} ${path}\n` +
          'Plain "git commit" now opens with an AI draft; -m, -F, --amend, merges, and squashes are left alone.\n',
      );
    });

  hook
    .command('uninstall')
    .description('Remove the hook installed by "gitwizz hook install"')
    .action(() => {
      const path = hookPathOrFail();
      if (path === undefined) return;
      const result = uninstallHook(path);
      if (result === 'foreign') return fail(`${path} was not installed by git-wizzard; leaving it in place`);
      process.stdout.write(result === 'removed' ? `Removed ${path}\n` : 'No git-wizzard hook installed.\n');
    });
}

/**
 * The hook: only a plain `git commit` (no message source in $2) gets a draft, prepended above
 * git's comment template. Any failure leaves git's message untouched and the commit proceeds.
 */
export function hookScript(command: readonly string[]): string {
  const invocation = command.map(shellQuote).join(' ');
  return [
    '#!/bin/sh',
    `${MARKER}; remove with "gitwizz hook uninstall".`,
    '# Pre-fills the message of a plain `git commit` with an AI draft. Never blocks the commit.',
    '[ -z "$2" ] || exit 0',
    `draft=$(${invocation} commit --dry-run) || exit 0`,
    '[ -n "$draft" ] || exit 0',
    `{ printf '%s\\n' "$draft"; cat "$1"; } > "$1.git-wizzard" && mv "$1.git-wizzard" "$1"`,
    'exit 0',
    '',
  ].join('\n');
}

/** 'foreign' when a hook we didn't write is in the way; it is never overwritten. */
export function installHook(path: string, command: readonly string[]): 'installed' | 'updated' | 'foreign' {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  if (existing !== undefined && !existing.includes(MARKER)) return 'foreign';
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, hookScript(command));
  chmodSync(path, 0o755);
  return existing === undefined ? 'installed' : 'updated';
}

export function uninstallHook(path: string): 'removed' | 'absent' | 'foreign' {
  if (!existsSync(path)) return 'absent';
  if (!readFileSync(path, 'utf8').includes(MARKER)) return 'foreign';
  rmSync(path);
  return 'removed';
}

/** Is the hook at `path` ours, someone else's, or not there? */
export function hookState(path: string): 'installed' | 'absent' | 'foreign' {
  if (!existsSync(path)) return 'absent';
  return readFileSync(path, 'utf8').includes(MARKER) ? 'installed' : 'foreign';
}

/** Where the hook lives for the current repository (honors core.hooksPath and worktrees); undefined outside one. */
export function hookPath(): string | undefined {
  try {
    const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return join(resolve(hooksDir), HOOK);
  } catch {
    return undefined;
  }
}

function hookPathOrFail(): string | undefined {
  return hookPath() ?? fail('Not a git repository', 'Run gitwizz from inside a git repository.');
}

function fail(message: string, hint?: string): undefined {
  process.stderr.write(`error: ${message}\n${hint !== undefined ? `hint: ${hint}\n` : ''}`);
  process.exitCode = 1;
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
