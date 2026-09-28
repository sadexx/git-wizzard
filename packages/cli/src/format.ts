import { styleText } from 'node:util';

export type StyleFormat = 'bold' | 'dim' | 'green' | 'red' | 'cyan' | 'yellow';

/** Applies a terminal style to text; `plain` leaves it untouched. */
export type Style = (format: StyleFormat, text: string) => string;

export const plain: Style = (_format: StyleFormat, text: string) => text;

/**
 * Color only for a terminal that supports it. `hasColors()` also honors NO_COLOR,
 * FORCE_COLOR, and TERM=dumb, so piped or redirected output stays plain.
 */
export function styleFor(stream: NodeJS.WriteStream): Style {
  return stream.isTTY === true && stream.hasColors()
    ? (format: StyleFormat, text: string) => styleText(format, text, { validateStream: false })
    : plain;
}

export type PatchLineKind = 'header' | 'hunk' | 'add' | 'del' | 'context';

/**
 * Classify each line of a unified diff. Tracks whether we are inside a hunk, so a
 * removed line whose text starts with "--" is still a deletion, not a file header.
 */
export function classifyPatch(patch: string): Array<{ readonly line: string; readonly kind: PatchLineKind }> {
  let inHunk = false;
  return patch.split('\n').map((line: string) => {
    if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('@@')) inHunk = true;

    let kind: PatchLineKind;
    if (line.startsWith('@@')) kind = 'hunk';
    else if (!inHunk) kind = 'header';
    else if (line.startsWith('+')) kind = 'add';
    else if (line.startsWith('-')) kind = 'del';
    else kind = 'context';
    return { line, kind };
  });
}

const PATCH_STYLES: Record<PatchLineKind, StyleFormat | undefined> = {
  header: 'bold',
  hunk: 'cyan',
  add: 'green',
  del: 'red',
  context: undefined,
};

export function stylePatch(patch: string, style: Style): string {
  return classifyPatch(patch)
    .map(({ line, kind }: { line: string; kind: PatchLineKind }) => {
      const format = PATCH_STYLES[kind];
      return format === undefined || line === '' ? line : style(format, line);
    })
    .join('\n');
}

const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/**
 * Spinner plus elapsed seconds on `stream` while `work` runs, erased when it settles.
 * Silent unless the stream is an interactive terminal, so pipes and logs stay clean.
 */
export async function withProgress<T>(
  label: string,
  work: () => Promise<T>,
  stream: Pick<NodeJS.WriteStream, 'isTTY' | 'write'> = process.stderr,
): Promise<T> {
  if (stream.isTTY !== true || process.env['TERM'] === 'dumb') return work();
  const started = Date.now();
  let frame = 0;
  const draw = (): void => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    stream.write(`\r${SPINNER_FRAMES.charAt(frame % SPINNER_FRAMES.length)} ${label}${seconds > 0 ? ` (${seconds}s)` : ''}`);
    frame += 1;
  };
  draw();
  const timer = setInterval(draw, 80);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    stream.write('\r\x1b[2K');
  }
}

/** "1 file", "2 files". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
