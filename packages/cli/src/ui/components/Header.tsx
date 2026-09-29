import { homedir } from 'node:os';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { GitStatus } from '@git-assistant/shared';
import { plural } from '#format.js';
import { VERSION } from '#version.js';

/** Rounded banner: name, version, and model in use, then where you are (path · branch · upstream · changes). */
export function Header({ status, model }: { status: GitStatus | undefined; model: string | undefined }): ReactElement {
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
      <Text>
        <Text bold>✻ git-assistant</Text>
        <Text dimColor>
          {' '}
          v{VERSION}
          {model !== undefined ? ` · ${model}` : ''}
        </Text>
      </Text>
      <Text dimColor wrap="truncate-middle">
        {[tildePath(process.cwd()), ...(status !== undefined ? repoFacts(status) : [])].join(' · ')}
      </Text>
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
