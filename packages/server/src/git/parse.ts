import type { GitDiffFile, GitFileChange, GitFileStatus, GitStatus } from '@git-assistant/shared';

/** Parse `git status --porcelain=v2 --branch` output into a GitStatus shape. */
export function parseStatus(raw: string): GitStatus {
  const files: GitFileChange[] = [];
  let branch: string = '';
  let upstream: string | undefined;
  let ahead: number = 0;
  let behind: number = 0;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;

    if (line.startsWith('# ')) {
      const header = line.slice(2);
      if (header.startsWith('branch.head ')) {
        branch = header.slice('branch.head '.length);
      } else if (header.startsWith('branch.upstream ')) {
        upstream = header.slice('branch.upstream '.length);
      } else if (header.startsWith('branch.ab ')) {
        const [plus, minus] = header.slice('branch.ab '.length).split(' ');
        ahead = Number.parseInt((plus ?? '+0').slice(1), 10) || 0;
        behind = Number.parseInt((minus ?? '-0').slice(1), 10) || 0;
      }
      continue;
    }

    const [kind] = line;
    if (kind === '1') {
      const parts = line.split(' ');
      const [, statusCodes = '..'] = parts;
      const [indexCode = '.', workingTreeCode = '.'] = statusCodes;
      files.push({
        path: parts.slice(8).join(' '),
        index: mapStatusChar(indexCode),
        workingTree: mapStatusChar(workingTreeCode),
      });
    } else if (kind === '2') {
      const parts = line.split(' ');
      const [, statusCodes = '..'] = parts;
      const [indexCode = '.', workingTreeCode = '.'] = statusCodes;
      const [path, originalPath] = parts.slice(9).join(' ').split('\t');
      files.push({
        path: path ?? '',
        index: mapStatusChar(indexCode),
        workingTree: mapStatusChar(workingTreeCode),
        ...(originalPath !== undefined ? { originalPath } : {}),
      });
    } else if (kind === 'u') {
      files.push({
        path: line.split(' ').slice(10).join(' '),
        index: 'conflicted',
        workingTree: 'conflicted',
      });
    } else if (kind === '?') {
      files.push({ path: line.slice(2), index: 'unmodified', workingTree: 'untracked' });
    } else if (kind === '!') {
      files.push({ path: line.slice(2), index: 'unmodified', workingTree: 'ignored' });
    }
  }

  return {
    branch,
    ahead,
    behind,
    isClean: files.length === 0,
    files,
    ...(upstream !== undefined ? { upstream } : {}),
  };
}

/** Parse `git diff --numstat` output. Binary files appear as `-\t-\t<path>`. */
export function parseNumstat(raw: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [add = '', del = ''] = parts;
    const binary = add === '-' || del === '-';
    files.push({
      path: parts.slice(2).join('\t'),
      additions: binary ? 0 : Number.parseInt(add, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(del, 10) || 0,
      binary,
    });
  }
  return files;
}

/**
 * Maps a git procelain-v2 status code (one of the two XY characters) to the
 * normalized domain status. `.` means "unmodified in this position"; unknown
 * codes (e.g. `T` type-change) normalize to `modified`.
 */
function mapStatusChar(code: string): GitFileStatus {
  switch (code) {
    case '.':
      return 'unmodified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'U':
      return 'conflicted';
    case 'M':
    case 'T':
    default:
      return 'modified';
  }
}
