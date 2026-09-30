import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Box, render, useWindowSize } from 'ink';
import type { AuthError, GitStatus, Result } from '@git-wizzard/shared';
import { activeAuth, defaultAuthDeps, resolveConfiguredAdapter, type ActiveAuth } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type ClientError, type GitWizzardClient } from '#mcp/client.js';
import { Header } from '#ui/components/Header.js';
import { Menu, menuIndex, type MenuTarget } from '#ui/screens/Menu.js';
import { Status } from '#ui/screens/Status.js';
import { Diff } from '#ui/screens/Diff.js';
import { BranchSuggest } from '#ui/screens/BranchSuggest.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';
import { PrDescribe } from '#ui/screens/PrDescribe.js';
import { Push } from '#ui/screens/Push.js';
import { Hook } from '#ui/screens/Hook.js';
import { Auth } from '#ui/screens/Auth.js';

export function App({ client }: { client: GitWizzardClient }): ReactElement {
  const [screen, setScreen] = useState<MenuTarget | 'menu'>('menu');
  const [lastTarget, setLastTarget] = useState<MenuTarget>('commit');
  const [status, setStatus] = useState<GitStatus | undefined>(undefined);
  const back = useCallback(() => setScreen('menu'), []);
  const open = useCallback((target: MenuTarget) => {
    setLastTarget(target);
    setScreen(target);
  }, []);

  const [model, setModel] = useState<string | undefined>(undefined);

  // Refresh the header whenever the menu shows: a commit, a new branch, or a new setup changes what it says.
  useEffect(() => {
    if (screen !== 'menu') return;
    client
      .getStatus()
      .then((result: Result<GitStatus, ClientError>) => setStatus(result.ok ? result.value : undefined))
      .catch(() => setStatus(undefined));
    activeAuth(defaultAuthDeps())
      .then((auth: Result<ActiveAuth, AuthError>) =>
        setModel(auth.ok ? `${auth.value.config.provider} ${auth.value.config.model}` : 'no provider, see Auth'),
      )
      .catch(() => setModel(undefined));
  }, [client, screen]);

  // Exactly the terminal's height, so nothing scrolls the header away; screens fit themselves inside.
  const { rows } = useWindowSize();
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <Header status={status} model={model} compact={screen !== 'menu'} />
      {body(screen, client, back, open, menuIndex(lastTarget))}
    </Box>
  );
}

function body(
  screen: MenuTarget | 'menu',
  client: GitWizzardClient,
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
    case 'push':
      return <Push client={client} onBack={back} />;
    case 'pr':
      return <PrDescribe client={client} onBack={back} />;
    case 'hook':
      return <Hook onBack={back} />;
    case 'auth':
      return <Auth onBack={back} />;
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
  // Full screen like vim/htop: the shell's content comes back on quit.
  const app = render(<App client={client} />, { alternateScreen: true });
  try {
    await app.waitUntilExit();
  } finally {
    await client.close();
  }
}
