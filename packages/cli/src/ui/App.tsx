import { useCallback, useState, type ReactElement } from 'react';
import { render } from 'ink';
import { defaultAuthDeps, runAuthFlow } from '#auth/flow.js';
import { renderError } from '#errors.js';
import { connectClient, type GitAssistantClient } from '#mcp/client.js';
import { Menu } from '#ui/screens/Menu.js';
import { Diff } from '#ui/screens/Diff.js';
import { BranchSuggest } from '#ui/screens/BranchSuggest.js';
import { CommitGenerate } from '#ui/screens/CommitGenerate.js';

type Screen = 'menu' | 'diff' | 'branch' | 'commit';

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
    case 'menu':
      return <Menu onSelect={setScreen} />;
  }
}

/** Connect (auth + spawn server) outside the React tree, then render the UI until exit. */
export async function startInteractiveUi(): Promise<void> {
  const auth = await runAuthFlow(defaultAuthDeps(), { validate: false, allowInteractive: false });
  if (!auth.ok) {
    process.stderr.write(`${renderError(auth.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const connected = await connectClient(auth.value, { cwd: process.cwd() });
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
