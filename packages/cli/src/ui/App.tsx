import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Box, render } from 'ink';
import type { GitStatus, Result } from '@git-assistant/shared';
import { resolveConfiguredAdapter } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type ClientError, type GitAssistantClient } from '#mcp/client.js';
import { Header } from '#ui/components/Header.js';
import { Menu, menuIndex, type MenuTarget } from '#ui/screens/Menu.js';
import { Status } from '#ui/screens/Status.js';
import { Diff } from '#ui/screens/Diff.js';
import { BranchSuggest } from '#ui/screens/BranchSuggest.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';
import { PrDescribe } from '#ui/screens/PrDescribe.js';

export function App({ client }: { client: GitAssistantClient }): ReactElement {
  const [screen, setScreen] = useState<MenuTarget | 'menu'>('menu');
  const [lastTarget, setLastTarget] = useState<MenuTarget>('commit');
  const [status, setStatus] = useState<GitStatus | undefined>(undefined);
  const back = useCallback(() => setScreen('menu'), []);
  const open = useCallback((target: MenuTarget) => {
    setLastTarget(target);
    setScreen(target);
  }, []);

  // Refresh the header whenever the menu shows: a commit or a new branch changes what it says.
  useEffect(() => {
    if (screen !== 'menu') return;
    client
      .getStatus()
      .then((result: Result<GitStatus, ClientError>) => setStatus(result.ok ? result.value : undefined))
      .catch(() => setStatus(undefined));
  }, [client, screen]);

  return (
    <Box flexDirection="column">
      <Header status={status} />
      {body(screen, client, back, open, menuIndex(lastTarget))}
    </Box>
  );
}

function body(
  screen: MenuTarget | 'menu',
  client: GitAssistantClient,
  back: () => void,
  open: (target: MenuTarget) => void,
  menuPosition: number,
): ReactElement {
  switch (screen) {
    case 'status':
      return <Status client={client} onBack={back} />;
    case 'diff':
      return <Diff client={client} onBack={back} />;
    case 'branch':
      return <BranchSuggest client={client} onBack={back} />;
    case 'commit':
      return <CommitGenerate client={client} onBack={back} />;
    case 'pr':
      return <PrDescribe client={client} onBack={back} />;
    case 'menu':
      return <Menu onSelect={open} initial={menuPosition} />;
  }
}

/** Spawn the server outside the React tree, then render the UI until exit. Credentials resolve on first AI use. */
export async function startInteractiveUi(): Promise<void> {
  const connected = await connectClient(resolveConfiguredAdapter, { cwd: process.cwd() });
  if (!connected.ok) {
    process.stderr.write(`${renderError(connected.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const client = connected.value;
  const app = render(<App client={client} />);
  try {
    await app.waitUntilExit();
  } finally {
    await client.close();
  }
}
