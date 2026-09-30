import { homedir } from 'node:os';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { GitStatus } from '@git-wizzard/shared';
import { plural } from '#format.js';
import { VERSION } from '#version.js';

const WIZARD = String.raw`
   /\   *
  /__\ \|/
 ( oo ) |
 /|\/|\_|
/_|__|_\|`.slice(1);

/**
 * Rounded banner: the wizard, then name, version, and model in use, and where you are (path · branch ·
 * upstream · changes). `compact` says the same in one line, leaving the rows to the screen below.
 */
export function Header({
  status,
  model,
  compact = false,
}: {
  status: GitStatus | undefined;
  model: string | undefined;
  compact?: boolean;
}): ReactElement {
  const where = [tildePath(process.cwd()), ...(status !== undefined ? repoFacts(status) : [])].join(' · ');
  if (compact) {
    return (
      <Box flexShrink={0}>
        <Text wrap="truncate-end">
          <Text bold>✻ git-wizzard</Text>
          <Text dimColor>{` v${VERSION}${model !== undefined ? ` · ${model}` : ''} · ${where}`}</Text>
        </Text>
      </Box>
    );
  }
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} alignItems="center" flexShrink={0}>
      <Box flexShrink={0} marginRight={2}>
        <Text>{WIZARD}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text>
          <Text bold>✻ git-wizzard</Text>
          <Text dimColor>
            {' '}
            v{VERSION}
            {model !== undefined ? ` · ${model}` : ''}
          </Text>
        </Text>
        <Text dimColor wrap="truncate-middle">
          {where}
        </Text>
      </Box>
    </Box>
  );
}

function repoFacts(status: GitStatus): string[] {
  const facts = [status.branch === '(detached)' ? 'detached HEAD' : status.branch];
  if (status.ahead > 0) facts.push(`↑${status.ahead}`);
  if (status.behind > 0) facts.push(`↓${status.behind}`);
  facts.push(status.isClean ? 'clean' : `${plural(status.files.length, 'change')}`);
  return facts;
}

function tildePath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
