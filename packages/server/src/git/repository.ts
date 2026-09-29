import { simpleGit, type SimpleGit } from 'simple-git';
import {
  type Result,
  type GitStatus,
  type GitDiff,
  type GitDiffFile,
  type CommitResult,
  type GitError,
  type ValidationError,
  ok,
  err,
  gitError,
  parseWithSchema,
  gitStatusSchema,
  gitDiffSchema,
  commitResultSchema,
  type CreateBranchOutput,
  createBranchOutputSchema,
} from '@git-wizzard/shared';
import { parseStatus, parseNumstat } from '#git/parse.js';

export type RepoError = GitError | ValidationError;

/**
 * Thin wrapper over simple-git. Runs porcelain git commands, delegates parsing
 * to pure functions, and validates the parsed result through shared schemas so
 * a parser bug surfaces as a ValidationError rather than malformed data.
 */
export class GitRepository {
  private readonly git: SimpleGit;
  private readonly baseDir: string;

  private constructor(git: SimpleGit, baseDir: string) {
    this.git = git;
    this.baseDir = baseDir;
  }

  static async open(baseDir: string = process.cwd()): Promise<Result<GitRepository, GitError>> {
    const git = simpleGit(baseDir);
    try {
      if (!(await git.checkIsRepo())) {
        return err(gitError('not_a_repository', `Not a git repository: ${baseDir}`));
      }
    } catch (cause) {
      return err(gitError('command_failed', `Failed to inspect repository at ${baseDir}`, cause));
    }
    return ok(new GitRepository(git, baseDir));
  }

  public async status(): Promise<Result<GitStatus, RepoError>> {
    let raw: string;
    try {
      raw = await this.git.raw(['status', '--porcelain=v2', '--branch']);
    } catch (cause) {
      return err(gitError('command_failed', 'git status failed', cause));
    }
    return parseWithSchema(gitStatusSchema, parseStatus(raw));
  }

  public async diff(staged: boolean): Promise<Result<GitDiff, RepoError>> {
    return this.diffOf(staged ? ['--cached'] : [], staged);
  }

  /** The branch a PR most likely targets: origin's default branch, else main/master (remote first). */
  public async defaultBase(): Promise<string | undefined> {
    const originHead = await this.git.raw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
    for (const candidate of [originHead.trim(), 'origin/main', 'origin/master', 'main', 'master']) {
      if (candidate !== '' && (await this.hasCommit(candidate))) return candidate;
    }
    return undefined;
  }

  public async hasCommit(ref: string): Promise<boolean> {
    return (await this.git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim() !== '';
  }

  /** Non-merge commits on HEAD but not on `base` (oldest first, bodies indented) and the diff since they diverged. */
  public async branchChanges(
    base: string,
  ): Promise<Result<{ commits: number; log: string; diff: GitDiff }, RepoError>> {
    const range = `${base}..HEAD`;
    let count: string;
    let log: string;
    try {
      count = await this.git.raw(['rev-list', '--count', '--no-merges', range]);
      log = await this.git.raw(['log', '--no-merges', '--reverse', '--format=- %s%n%w(0,2,2)%b', range]);
    } catch (cause) {
      return err(gitError('command_failed', 'git log failed', cause));
    }
    const diff = await this.diffOf([`${base}...HEAD`], false);
    if (!diff.ok) return diff;
    return ok({ commits: Number.parseInt(count, 10), log: log.replace(/\n{2,}/g, '\n').trim(), diff: diff.value });
  }

  private async diffOf(scope: string[], staged: boolean): Promise<Result<GitDiff, RepoError>> {
    let numstat: string;
    let patch: string;
    try {
      numstat = await this.git.raw(['diff', '--numstat', ...scope]);
      patch = await this.git.raw(['diff', ...scope]);
    } catch (cause) {
      return err(gitError('command_failed', 'git diff failed', cause));
    }
    const files = parseNumstat(numstat);
    const additions = files.reduce((sum: number, file: GitDiffFile) => sum + file.additions, 0);
    const deletions = files.reduce((sum: number, file: GitDiffFile) => sum + file.deletions, 0);
    return parseWithSchema(gitDiffSchema, { staged, additions, deletions, files, patch });
  }

  /** Subjects of the latest non-merge commits, newest first; empty when HEAD has no commits yet. */
  public async recentSubjects(limit: number = 10): Promise<Result<string[], RepoError>> {
    let raw: string;
    try {
      // `git log` fails on an unborn HEAD; probe HEAD instead of parsing git's error text.
      if ((await this.git.raw(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() === '') {
        return ok([]);
      }
      raw = await this.git.raw(['log', '--no-merges', `-n${limit}`, '--format=%s']);
    } catch (cause) {
      return err(gitError('command_failed', 'git log failed', cause));
    }
    return ok(raw.split('\n').filter((line: string) => line.trim() !== ''));
  }

  /** What a commit would contain: the index, or with `all` (`git commit -a`) every tracked change since HEAD. */
  public async commitDiff(all: boolean): Promise<Result<GitDiff, RepoError>> {
    // ponytail: before the first commit there is no HEAD to diff against, so `all` shows only the index.
    return all && (await this.hasCommit('HEAD')) ? this.diffOf(['HEAD'], true) : this.diff(true);
  }

  /** Commit staged changes (or all tracked changes). Refuses when there is nothing to commit. */
  public async createCommit(message: string, all: boolean = false): Promise<Result<CommitResult, RepoError>> {
    const changes = await this.commitDiff(all);
    if (!changes.ok) return changes;
    if (changes.value.files.length === 0) {
      return err(gitError('nothing_to_commit', all ? 'No changes to tracked files to commit' : 'No staged changes to commit'));
    }
    try {
      await this.git.commit(message, [], all ? { '--all': null } : {});
    } catch (cause) {
      return err(gitError('command_failed', 'git commit failed', cause));
    }
    let sha: string;
    let branch: string;
    try {
      sha = (await this.git.revparse(['HEAD'])).trim();
      branch = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    } catch (cause) {
      return err(gitError('command_failed', 'Failed to read HEAD after commit', cause));
    }
    const [summary = message] = message.split('\n');
    return parseWithSchema(commitResultSchema, { sha, branch, summary });
  }

  public async createBranch(name: string): Promise<Result<CreateBranchOutput, RepoError>> {
    try {
      await this.git.checkoutLocalBranch(name);
    } catch (cause) {
      return err(gitError('command_failed', `Failed to create branch ${name}`, cause));
    }
    return parseWithSchema(createBranchOutputSchema, { branch: name, created: true });
  }

  get directory(): string {
    return this.baseDir;
  }
}
