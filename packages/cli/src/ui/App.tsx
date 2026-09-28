import { useCallback, useState, type ReactElement } from 'react';
import { render } from 'ink';
import { resolveConfiguredAdapter } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type GitAssistantClient } from '#mcp/client.js';
import { Menu } from '#ui/screens/Menu.js';
import { Diff } from '#ui/screens/Diff.js';
import { BranchSuggest } from '#ui/screens/BranchSuggest.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';
import { PrDescribe } from '#ui/screens/PrDescribe.js';

type Screen = 'menu' | 'diff' | 'branch' | 'commit' | 'pr';

export function App({ client }: { client: GitAssistantClient }): ReactElement {
  const [screen, setScreen] = useState<Screen>('menu');
  const back = useCallback(() => setScreen('menu'), []);
  switch (screen) {
    case 'diff':
      return <Diff client={client} onBack={back} />;
    case 'branch':
      return <BranchSuggest client={client} onBack={back} />;
    case 'commit':
      return <CommitGenerate client={client} onBack={back} />;
    case 'pr':
      return <PrDescribe client={client} onBack={back} />;
    case 'menu':
      return <Menu onSelect={setScreen} />;
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
