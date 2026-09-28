import { createRequire } from 'node:module';

/** Read from this package's package.json (dist/version.js -> ../package.json) so there is one source of truth. */
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
