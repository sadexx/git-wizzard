import { spawn } from 'node:child_process';

// Test-only: drive a Node process through its prompts, typing like a person would.

/** Typed input; `null` closes stdin (Ctrl-D). */
export type Answer = string | null;

export interface Conversation {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run `node <args>`, answering each `[question, answer]` in order once the question is printed
 * (each prompt reads its own line, so answers typed ahead of time could be lost). A question that
 * never shows would leave the process waiting for input, so it is killed after 20s and the
 * conversation so far returned, for the assertions to show.
 */
export function converse(
  args: readonly string[],
  steps: ReadonlyArray<readonly [string, Answer]>,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Conversation> {
  return new Promise((resolve: (conversation: Conversation) => void) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, env: options.env ?? process.env, timeout: 20_000 });
    let stdout = '';
    let stderr = '';
    let seen = 0;
    let step = 0;
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      for (let next = steps[step]; next !== undefined; next = steps[step]) {
        const at = stdout.indexOf(next[0], seen);
        if (at === -1) break;
        seen = at + next[0].length;
        step += 1;
        if (next[1] === null) child.stdin.end();
        else child.stdin.write(next[1]);
      }
    });
    child.on('close', (code: number | null) => resolve({ code, stdout, stderr }));
  });
}

/**
 * A script that runs the CLI at `cli` with `args` as if in a terminal: the prompts show, the way they
 * do for a person, while stdin and stdout stay pipes the test can drive.
 */
export function inTerminal(cli: string, args: readonly string[]): string[] {
  const script = [
    'process.stdin.isTTY = true;',
    'process.stdin.setRawMode = () => process.stdin;',
    // A paused terminal lets the process exit; a paused pipe would keep it waiting.
    'const { pause, resume } = process.stdin;',
    'process.stdin.pause = function () { this.unref(); return pause.call(this); };',
    'process.stdin.resume = function () { this.ref(); return resume.call(this); };',
    'process.stdout.isTTY = true;',
    'process.stdout.hasColors = () => false;',
    `process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];`,
    `await import(${JSON.stringify(new URL(`file://${cli}`).href)});`,
  ].join('\n');
  return ['--input-type=module', '-e', script];
}
