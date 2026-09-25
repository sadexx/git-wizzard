import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { env as processEnv, stdin, stdout } from 'node:process';

export type Decision = { readonly kind: 'confirm'; readonly value: string } | { readonly kind: 'abort' };

export interface ActionPrompter {
  show(label: string, value: string): void;
  choose(): Promise<'confirm' | 'edit' | 'abort'>;
  edit(current: string): Promise<string>;
}

/** Pure loop: show -> choose -> (edit and repeat | confirm | abort). */
export async function resolveDecision(prompter: ActionPrompter, label: string, initial: string): Promise<Decision> {
  let value = initial;
  for (;;) {
    prompter.show(label, value);
    const choice = await prompter.choose();
    if (choice === 'confirm') return { kind: 'confirm', value };
    if (choice === 'abort') return { kind: 'abort' };
    value = await prompter.edit(value);
  }
}

export function createActionPrompter(): ActionPrompter {
  return {
    show(label, value) {
      stdout.write(`\n${label}:\n${value}\n\n`);
    },
    async choose() {
      const readline = createInterface({ input: stdin, output: stdout });
      try {
        for (;;) {
          const answer = (await readline.question('[c]confirm / [e]edit / [a]abort: ')).trim().toLowerCase();
          if (answer === 'c' || answer === 'confirm') return 'confirm';
          if (answer === 'e' || answer === 'edit') return 'edit';
          if (answer === 'a' || answer === 'abort') return 'abort';
          stdout.write('Please enter c, e, or a.\n');
        }
      } finally {
        readline.close();
      }
    },
    async edit(current) {
      const edited = editViaEditor(current);
      if (edited !== current) return edited;

      const readline = createInterface({ input: stdin, output: stdout });
      try {
        const answer = (await readline.question('New value (blank to keep current): ')).trim();
        return answer === '' ? current : answer;
      } finally {
        readline.close();
      }
    },
  };
}

function editViaEditor(initial: string): string {
  const editor = processEnv['EDITOR'] ?? processEnv['VISUAL'];
  if (editor === undefined || editor === '' || stdin.isTTY !== true) return initial;

  const dir = mkdtempSync(join(tmpdir(), 'git-assistant-edit-'));
  const file = join(dir, 'EDIT_MSG');

  try {
    writeFileSync(file, initial, 'utf8');
    const result = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
    return result.status === 0 ? readFileSync(file, 'utf8').replace(/\n+$/, '') : initial;
  } catch {
    return initial;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
