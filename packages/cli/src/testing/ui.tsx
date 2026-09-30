import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import type { ReactElement } from 'react';
import { render } from 'ink';
import type { GitStatus } from '@git-wizzard/shared';
import type { GitWizzardClient } from '#mcp/client.js';

// Test-only helpers: render an Ink tree into a fake terminal of a fixed size and drive it with keys.

export const KEY = {
  enter: '\r',
  esc: '\u001B',
  up: '\u001B[A',
  down: '\u001B[B',
  left: '\u001B[D',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
  backspace: '\u007F',
} as const;

/** A terminal that keeps only the last frame (Ink's debug mode writes whole frames). */
class FakeStdout extends EventEmitter {
  frame: string = '';
  readonly isTTY: boolean = false;
  readonly columns: number;
  rows: number;
  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  write = (text: string): boolean => {
    this.frame = text;
    return true;
  };
}

/** Keyboard input: Ink drains `read()` on every 'readable'. */
class FakeStdin extends EventEmitter {
  readonly isTTY: boolean = true;
  private readonly queue: string[] = [];
  type(data: string): void {
    this.queue.push(data);
    this.emit('readable');
  }
  read = (): string | null => this.queue.shift() ?? null;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

export interface Rendered {
  frame(): string;
  /**
   * Types each key after a pause, so the previous render's input handlers are attached. The pause
   * outlasts Ink's 20ms wait after a lone esc; a key sooner would read as alt+key.
   */
  press(...keys: string[]): Promise<void>;
  /** Types text in one go, like a paste. */
  type(text: string): Promise<void>;
  /** Polls until the frame contains `text` (Ink renders asynchronously); fails with the last frame. */
  waitFor(text: string): Promise<void>;
  resize(rows: number): void;
  /** Resolves when the app exits itself (useApp().exit). */
  exited(): Promise<unknown>;
}

/** Render `tree` in a `columns`×`rows` terminal, unmounted when the test ends. */
export function renderUi(t: TestContext, tree: ReactElement, size: { rows?: number; columns?: number } = {}): Rendered {
  const stdout = new FakeStdout(size.columns ?? 100, size.rows ?? 40);
  const stdin = new FakeStdin();
  // Plain text: run from a color terminal, Ink styles the frame, and bold/dim codes split the words.
  const frame = (): string => stripVTControlCharacters(stdout.frame);
  const instance = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(100, 40) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    // As in a real terminal: e.g. resuming after the editor (suspendTerminal) redraws only when interactive.
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  t.after(() => instance.unmount());
  return {
    frame,
    press: async (...keys: string[]) => {
      for (const key of keys) {
        await delay(30);
        stdin.type(key);
      }
    },
    type: async (text: string) => {
      await delay(30);
      stdin.type(text);
    },
    waitFor: async (text: string) => {
      for (let i = 0; i < 300; i += 1) {
        if (frame().includes(text)) return;
        await delay(10);
      }
      assert.fail(`Timed out waiting for "${text}". Last frame:\n${frame()}`);
    },
    resize: (rows: number) => {
      stdout.rows = rows;
      stdout.emit('resize');
    },
    exited: () => instance.waitUntilExit(),
  };
}

/**
 * Point HOME (where the saved config lives) at a fresh temp dir and clear credential variables,
 * restoring the environment when the test ends.
 */
export function isolateHome(t: TestContext): string {
  const saved = { ...process.env };
  const home = mkdtempSync(join(tmpdir(), 'git-wizzard-home-'));
  process.env['HOME'] = home;
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'GIT_WIZZARD_PROVIDER', 'GIT_WIZZARD_MODEL']) {
    delete process.env[key];
  }
  // Restore key by key: replacing `process.env` itself would detach it from the real environment.
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  return home;
}

/** Polls `check` until it holds, for effects outside the frame (callbacks, client calls). */
export async function eventually(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (check()) return;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${what}`);
}

/** A client whose every call fails the test unless the test provides it. */
export function fakeClient(overrides: Partial<GitWizzardClient>): GitWizzardClient {
  const unexpected = (name: string) => async (): Promise<never> => assert.fail(`unexpected ${name} call`);
  return {
    getStatus: unexpected('getStatus'),
    getDiff: unexpected('getDiff'),
    suggestBranchName: unexpected('suggestBranchName'),
    generateCommitMessage: unexpected('generateCommitMessage'),
    generatePrDescription: unexpected('generatePrDescription'),
    createCommit: unexpected('createCommit'),
    createBranch: unexpected('createBranch'),
    stageFiles: unexpected('stageFiles'),
    push: unexpected('push'),
    createPullRequest: unexpected('createPullRequest'),
    close: async () => undefined,
    ...overrides,
  };
}

export function gitStatus(fields: Partial<GitStatus>): GitStatus {
  return { branch: 'main', ahead: 0, behind: 0, isClean: true, files: [], ...fields };
}
