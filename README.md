# git-assistant

AI-assisted git from your terminal: write commit messages and name branches from your actual changes, using OpenAI or Google Gemini.

```console
$ git add -A
$ git-assistant commit

Commit message:
feat(auth): resolve provider credentials lazily

Git-only commands no longer require an API key.

[c]onfirm / [e]dit / [a]bort: c
Created commit 3f9a1c2e on main: feat(auth): resolve provider credentials lazily
```

`status` and `diff` work without any setup. Only `commit`, `branch`, and `pr` call a model.

## Requirements

- Node.js 22 or newer
- git
- An OpenAI or Gemini API key (for `commit`, `branch`, and `pr`)

## Install

From source:

```sh
git clone https://github.com/sadexx/git-assistant.git
cd git-assistant
npm ci
npm run build
cd packages/cli && npm link   # puts `git-assistant` on your PATH
```

## Quick start

```sh
git-assistant auth      # pick a provider, enter an API key (validated, then saved)
git add <files>
git-assistant commit    # generate a message from the staged diff, then confirm/edit/abort
```

Run `git-assistant` with no arguments for the interactive menu.

## Commands

| Command | What it does |
| --- | --- |
| `git-assistant` | Interactive UI with the same options as the commands: commit (staged or all tracked, hint, edit in your git editor, regenerate), branch (type, hint, your own name), pull request (base, hint), status, and a scrollable diff. Keys: ↑/↓ or number keys to pick, `enter` choose, `esc` back, `q` quit. |
| `git-assistant status` | Current branch, upstream, ahead/behind, and changed files. |
| `git-assistant diff [--staged]` | Unstaged (default) or staged changes with per-file line counts. |
| `git-assistant commit [-a] [--hint <text>] [-y \| --dry-run]` | Generate a commit message from **staged** changes (with `-a`, all changes to tracked files, like `git commit -a`; nothing is staged unless you confirm) in the style of your recent commits (falling back to Conventional Commits), then confirm, edit, regenerate, or abort before committing. |
| `git-assistant branch [--type <type>] [--hint <text>] [-y \| --dry-run]` | Suggest branch names for **all uncommitted work** (staged, unstaged, and new files) and create/switch to the one you confirm. `<type>` is one of `feature`, `fix`, `chore`, `refactor`, `docs`, `test`, `hotfix`. |
| `git-assistant pr [--base <branch>] [--hint <text>]` | Write a pull request title and Markdown description from the commits on this branch that aren't on `<branch>` (default: origin's default branch, else `origin/main`, `origin/master`, `main`, `master`). Prints to stdout; changes nothing. Uncommitted work isn't included. |
| `git-assistant hook install` / `uninstall` | Add (or remove) a `prepare-commit-msg` hook so a plain `git commit` opens the editor with an AI draft. |
| `git-assistant auth [--no-validate]` | Choose a provider and model, enter an API key, and save it. |
| `git-assistant auth status` | Show the provider, model, masked key, and source (environment or saved config) that the AI commands will use. Exits 1 when nothing is set up. No network. |
| `git-assistant auth logout` | Delete the saved credentials. Environment variables are not affected. |

Every command acts on the repository in the current directory. `--help` works on the program and on each command. Output is colored in a terminal and plain when piped; set `NO_COLOR=1` to turn colors off. While the model works, a spinner with elapsed seconds shows on stderr (terminal only).

A diff shows *what* changed, not *why*. Pass `--hint` to tell the model the intent, for example `git-assistant commit --hint "retry on 429 from the payments API"` (up to 500 characters).

When confirming, **regenerate** asks the model for a fresh proposal (a failed retry keeps the current one). **Edit** opens the same editor git uses (`GIT_EDITOR`, `core.editor`, `VISUAL`, `EDITOR`). Lines starting with `#` are ignored, and saving an empty text keeps the previous one. If the editor can't be used, you get a one-line prompt instead. `Ctrl-C` or `Ctrl-D` at the prompt aborts.

### Git hook

`git-assistant hook install` lets you keep using plain `git`: every `git commit` that would open the editor starts with a generated draft above git's usual comments (works with `git commit -a` and `git commit <paths>` too). Commits with `-m`/`-F`, `--amend`, merges, and squashes keep their own message. If generation fails (no credentials, network down), git's normal empty message appears and the commit is never blocked.

The hook is installed in the current repository (respecting `core.hooksPath`) and calls git-assistant at the path it was installed from; rerun `hook install` if you move it. An existing hook that git-assistant didn't write is never overwritten or removed.

### Scripting

`commit` and `branch` ask for confirmation, so without a terminal they stop with an error instead of waiting. Choose explicitly:

- `-y, --yes`: accept the generated message (or the first branch suggestion) without asking.
- `--dry-run`: print only the result to stdout and change nothing.

```sh
git-assistant commit --dry-run                    # just the message
git commit -e -m "$(git-assistant commit --dry-run)" # review it in git's own editor
git-assistant branch --dry-run | head -n1         # best branch name
git-assistant pr > pr.md && gh pr create --title "$(head -n1 pr.md)" --body "$(tail -n +3 pr.md)"
```

`pr` prints only the description to stdout (title, blank line, body); the "Describing N commits not on <base>" note goes to stderr.

## Configuration

Credentials come from the first source that provides them:

1. **Environment** (never written to disk)
   - `OPENAI_API_KEY`: use OpenAI
   - `GEMINI_API_KEY` or `GOOGLE_API_KEY`: use Gemini
   - `GIT_ASSISTANT_PROVIDER`: `openai` or `gemini`; required to choose when both keys are set
   - `GIT_ASSISTANT_MODEL`: override the model used with the key above
2. **Saved config** at `~/.git-assistant/config.json`, written by `git-assistant auth` with `0600` permissions.

Run `git-assistant auth status` to see which source wins.

Default models: `gpt-5.4-mini` (OpenAI) and `gemini-3.6-flash` (Gemini).

> **Privacy:** `commit`, `branch`, and `pr` send the changed file names and the diff to your chosen provider. The diff is capped at about 6,000 characters, shared across files so one large file can't hide the rest; lockfiles and minified or source-map files are named but their diffs are left out. `commit` also sends the current branch name and the subjects of your last 10 commits so it can match your style; `pr` sends the branch names and the messages of the commits it describes. `status` and `diff` never leave your machine.

## How it works

The project is an npm workspace with three packages:

- **`packages/server`** is an [MCP](https://modelcontextprotocol.io) server that exposes git tools (`get_status`, `get_diff`, `suggest_branch_name`, `generate_commit_message`, `generate_pr_description`, `create_commit`, `create_branch`). It never holds API keys. When it needs text generated, it asks the client via MCP *sampling*.
- **`packages/cli`** is the `git-assistant` command. It starts the server as a subprocess and answers sampling requests with your configured provider. Credentials are resolved only when a tool actually samples.
- **`packages/shared`** holds the schemas, the `Result` type, and typed errors used by both sides.

Because the server is a standard MCP server, any MCP client that supports sampling can use its tools directly:

```sh
npm run inspect -w packages/server   # open it in the MCP Inspector
```

## Development

```sh
npm ci
npm run build   # builds shared → server → cli
npm test        # builds and runs every package's tests (node:test)
```

Tests are colocated with sources as `*.test.ts` and run from the compiled `dist/`.
