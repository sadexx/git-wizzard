import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { env as processEnv, stderr, stdin, stdout } from 'node:process';

export type Decision = { readonly kind: 'confirm'; readonly value: string } | { readonly kind: 'abort' };

export type Choice = 'confirm' | 'edit' | 'regenerate' | 'abort';

export interface ActionPrompter {
  show(label: string, value: string): void;
  choose(canRegenerate: boolean): Promise<Choice>;
  edit(current: string): Promise<string>;
}

/** Produces a fresh proposal, or undefined to keep the current one (e.g. the retry failed and was reported). */
export type Regenerate = () => Promise<string | undefined>;

/** How a generated proposal is settled: ask the user, accept it as-is, or only print it. */
export type ConfirmMode = 'prompt' | 'yes' | 'dry-run';

export interface ConfirmOptions {
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

const EDIT_INSTRUCTIONS =
  "# Edit the text above. Lines starting with '#' are ignored;\n# an empty result keeps the previous text.\n";

/** Pure: pick the mode from flags; undefined when prompting is needed but impossible (no terminal). */
export function confirmMode(options: ConfirmOptions, interactive: boolean): ConfirmMode | undefined {
  if (options.dryRun === true) return 'dry-run';
  if (options.yes === true) return 'yes';
  return interactive ? 'prompt' : undefined;
}

/** `confirmMode` for this process; reports a usage error (exit 1) instead of hanging on a closed stdin. */
export function requireConfirmMode(options: ConfirmOptions): ConfirmMode | undefined {
  const mode = confirmMode(options, stdin.isTTY === true && stdout.isTTY === true);
  if (mode === undefined) {
    stderr.write(
      'error: Cannot ask for confirmation without an interactive terminal\n' +
        'hint: Pass --yes to accept the suggestion, or --dry-run to only print it.\n',
    );
    process.exitCode = 1;
  }
  return mode;
}

/** Pure loop: show -> choose -> (edit or regenerate, and repeat | confirm | abort). */
export async function resolveDecision(
  prompter: ActionPrompter,
  label: string,
  initial: string,
  regenerate?: Regenerate,
): Promise<Decision> {
  let value = initial;
  for (;;) {
    prompter.show(label, value);
    const choice = await prompter.choose(regenerate !== undefined);
    if (choice === 'confirm') return { kind: 'confirm', value };
    if (choice === 'abort') return { kind: 'abort' };
    if (choice === 'edit') value = await prompter.edit(value);
    else if (regenerate !== undefined) value = (await regenerate()) ?? value;
  }
}

/** Pure: drop '#' comment lines from editor output, git-style, and trim surrounding whitespace. */
export function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line: string) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

export function createActionPrompter(): ActionPrompter {
  return {
    show(label, value) {
      stdout.write(`\n${label}:\n${value}\n\n`);
    },
    async choose(canRegenerate) {
      const question = canRegenerate ? '[c]onfirm / [e]dit / [r]egenerate / [a]bort: ' : '[c]onfirm / [e]dit / [a]bort: ';
      for (;;) {
        const answer = await ask(question);
        if (answer === null) return 'abort';
        const normalized = answer.trim().toLowerCase();
        if (normalized === 'c' || normalized === 'confirm') return 'confirm';
        if (normalized === 'e' || normalized === 'edit') return 'edit';
        if (canRegenerate && (normalized === 'r' || normalized === 'regenerate')) return 'regenerate';
        if (normalized === 'a' || normalized === 'abort') return 'abort';
        stdout.write(canRegenerate ? 'Please enter c, e, r, or a.\n' : 'Please enter c, e, or a.\n');
      }
    },
    async edit(current) {
      const edited = editViaEditor(current);
      if (edited !== undefined) return edited === '' ? current : edited;

      stdout.write('Could not use an editor; enter a single-line replacement instead.\n');
      const answer = (await ask('New value (blank to keep current): '))?.trim() ?? '';
      return answer === '' ? current : answer;
    },
  };
}

/** One line from stdin, or null on EOF / Ctrl-C so callers can treat it as abort instead of hanging. */
async function ask(query: string): Promise<string | null> {
  const readline = createInterface({ input: stdin, output: stdout });
  const closed = new Promise<null>((resolve: (value: null) => void) => readline.once('close', () => resolve(null)));
  readline.once('SIGINT', () => readline.close());
  try {
    const answer = await Promise.race([readline.question(query), closed]);
    if (answer === null) stdout.write('\n');
    return answer;
  } finally {
    readline.close();
  }
}

/** Open the user's git editor on `initial`; undefined when no editor could be run. */
export function editViaEditor(initial: string): string | undefined {
  const editor = resolveEditor();
  if (editor === undefined) return undefined;

  const dir = mkdtempSync(join(tmpdir(), 'git-wizzard-edit-'));
  const file = join(dir, 'EDIT_MSG');

  try {
    writeFileSync(file, `${initial}\n\n${EDIT_INSTRUCTIONS}`, 'utf8');
    // Same contract as git: the editor setting is a shell snippet (e.g. "code --wait").
    const result = spawnSync(`${editor} "${file}"`, { stdio: 'inherit', shell: true });
    return result.status === 0 ? stripComments(readFileSync(file, 'utf8')) : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** git's own choice (GIT_EDITOR, core.editor, VISUAL, EDITOR, then its default), else VISUAL/EDITOR. */
function resolveEditor(): string | undefined {
  const fromGit = spawnSync('git', ['var', 'GIT_EDITOR'], { encoding: 'utf8' });
  const editor = fromGit.status === 0 ? fromGit.stdout.trim() : '';
  if (editor !== '') return editor;
  return processEnv['VISUAL'] || processEnv['EDITOR'] || undefined;
}
