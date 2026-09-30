import { InvalidArgumentError, type Command } from 'commander';
import { authError } from '@git-wizzard/shared';
import { activeAuth, defaultAuthDeps, readEnvConfig, runAuthFlow } from '#auth/flow.js';
import { configPath, deleteConfig, loadConfig, saveConfig } from '#auth/config.js';
import { printError } from '#commands/support.js';

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('Authorize a provider (OpenAI or Google) and store credentials')
    .option('--no-validate', 'Skip API key validation')
    .action(async (options: { validate: boolean }) => {
      const result = await runAuthFlow(defaultAuthDeps(), { forceInteractive: true, validate: options.validate });
      if (!result.ok) {
        printError(result.error);
        return;
      }
      process.stdout.write(`Authorized ${result.value.provider} (model ${result.value.model}).\n`);
    });

  auth
    .command('status')
    .description('Show which provider, model, and key AI commands will use (no network)')
    .action(async () => {
      const result = await activeAuth(defaultAuthDeps());
      if (!result.ok) {
        printError(result.error);
        return;
      }
      const { config, source, savedIgnored } = result.value;
      process.stdout.write(
        `Provider: ${config.provider}\n` +
          (config.baseUrl !== undefined ? `Server:   ${config.baseUrl}\n` : '') +
          `Model:    ${config.model}\n` +
          `API key:  ${maskKey(config.apiKey)}\n` +
          `Source:   ${source === 'environment' ? 'environment' : `saved config (${configPath()})`}\n`,
      );
      if (savedIgnored) {
        process.stdout.write(`Note: saved config at ${configPath()} is ignored while environment credentials are set.\n`);
      }
    });

  auth
    .command('model')
    .description('Change the model of the saved setup, keeping its API key')
    .argument('<name>', 'Model id, e.g. gemini-3.6-flash', (value: string) => {
      if (value.trim() === '') throw new InvalidArgumentError('Enter a model name.');
      return value.trim();
    })
    .action(async (name: string) => {
      const loaded = await loadConfig();
      if (!loaded.ok) {
        printError(loaded.error);
        return;
      }
      if (loaded.value === null) {
        printError(authError('missing_credentials', 'No saved setup to change'));
        return;
      }
      const saved = await saveConfig({ ...loaded.value, model: name });
      if (!saved.ok) {
        printError(saved.error);
        return;
      }
      process.stdout.write(`Model set to ${name} for ${loaded.value.provider}.\n`);
      const fromEnv = readEnvConfig(defaultAuthDeps().env);
      if (fromEnv.ok && fromEnv.value !== null) {
        process.stdout.write('Environment credentials are set and take precedence; use GIT_WIZZARD_MODEL there.\n');
      }
    });

  auth
    .command('logout')
    .description('Delete the saved credentials')
    .action(async () => {
      const removed = await deleteConfig();
      if (!removed.ok) {
        printError(removed.error);
        return;
      }
      process.stdout.write(removed.value ? `Removed saved credentials (${configPath()}).\n` : 'No saved credentials to remove.\n');
      const fromEnv = readEnvConfig(defaultAuthDeps().env);
      if (fromEnv.ok && fromEnv.value !== null) {
        process.stdout.write('Environment credentials are still set and will be used.\n');
      }
    });
}

/** Enough of the key to tell two apart, never enough to use. */
export function maskKey(key: string): string {
  if (key === '') return '(none)';
  return key.length >= 12 ? `…${key.slice(-4)}` : '(set)';
}
