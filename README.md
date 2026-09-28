# git-assistant

AI-assisted git from your terminal: write commit messages and name branches from your actual changes, using OpenAI or Google Gemini.

```console
$ git add -A
$ git-assistant commit

Commit message:
feat(auth): resolve provider credentials lazily

Git-only commands no longer require an API key.

[c]confirm / [e]edit / [a]abort: c
Created commit 3f9a1c2e on main.
```

`status` and `diff` work without any setup. Only `commit` and `branch` call a model.

## Requirements

- Node.js 22 or newer
- git
- An OpenAI or Gemini API key (for `commit` and `branch`)

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
| `git-assistant` | Interactive menu: view diff, suggest a branch, generate a commit. |
| `git-assistant status` | Current branch, upstream, ahead/behind, and changed files. |
| `git-assistant diff [--staged]` | Unstaged (default) or staged changes with per-file line counts. |
| `git-assistant commit` | Generate a commit message from **staged** changes, then confirm, edit, or abort before committing. |
| `git-assistant branch [--type <type>]` | Suggest branch names for your **unstaged** changes and create/switch to the one you confirm. `<type>` is one of `feature`, `fix`, `chore`, `refactor`, `docs`, `test`, `hotfix`. |
| `git-assistant auth [--no-validate]` | Choose a provider and model, enter an API key, and save it. |

Every command acts on the repository in the current directory. `--help` works on the program and on each command.

When confirming, choosing **edit** opens `$EDITOR` (or `$VISUAL`) with the proposed text; without an editor you get a one-line prompt instead.

## Configuration

Credentials come from the first source that provides them:

1. **Environment** (never written to disk)
   - `OPENAI_API_KEY`: use OpenAI
   - `GEMINI_API_KEY` or `GOOGLE_API_KEY`: use Gemini
   - `GIT_ASSISTANT_PROVIDER`: `openai` or `gemini`; required to choose when both keys are set
   - `GIT_ASSISTANT_MODEL`: override the model used with the key above
2. **Saved config** at `~/.git-assistant/config.json`, written by `git-assistant auth` with `0600` permissions.

Default models: `gpt-5.4-mini` (OpenAI) and `gemini-3.6-flash` (Gemini).

> **Privacy:** `commit` and `branch` send the changed file names and the diff (truncated to about 6,000 characters) to your chosen provider. `status` and `diff` never leave your machine.

## How it works

The project is an npm workspace with three packages:

- **`packages/server`** is an [MCP](https://modelcontextprotocol.io) server that exposes git tools (`get_status`, `get_diff`, `suggest_branch_name`, `generate_commit_message`, `create_commit`, `create_branch`). It never holds API keys. When it needs text generated, it asks the client via MCP *sampling*.
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
