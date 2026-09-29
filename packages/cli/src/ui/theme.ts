import { styleText } from 'node:util';
import type { Style, StyleFormat } from '#format.js';

/** Ink only runs in a terminal, but still honor NO_COLOR / FORCE_COLOR / TERM=dumb. */
const ansi: boolean = process.stdout.hasColors?.() === true;

function apply(format: 'bold' | 'dim' | 'green' | 'red', text: string): string {
  return ansi ? styleText(format, text, { validateStream: false }) : text;
}

/** The UI is monochrome: emphasis through bold and dim only; colors collapse to plain text. */
export const mono: Style = (format: StyleFormat, text: string) =>
  format === 'bold' || format === 'dim' ? apply(format, text) : format === 'cyan' ? apply('dim', text) : text;

/** Diffs are the one exception: added/removed lines keep green/red; hunk headers are dim. */
export const diffStyle: Style = (format: StyleFormat, text: string) =>
  format === 'green' || format === 'red' ? apply(format, text) : mono(format, text);
