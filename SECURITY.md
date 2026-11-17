# Security

## Reporting a vulnerability

Please report security issues **privately** using GitHub's
[private vulnerability reporting](https://github.com/willperacchio/claudewrapped/security/advisories/new),
not a public issue. You'll get a response within a few days.

Especially interesting:

- any way for data from a user's transcripts (prompts, file paths, project names, code) to reach the generated page or the share card
- any way to make the page run code other than its own two scripts, or make a network request
- anything that makes the CLI read, write or execute outside what's described below

## What the tool does

- **Reads** `*.jsonl` transcripts under `~/.claude/projects`, `~/.config/claude/projects` or `$CLAUDE_CONFIG_DIR/projects` (or `--dir`). It writes nothing there.
- **Writes** one HTML file: by default into a new private temp folder (`0700`, file `0600`), or to `--out`.
- **Runs** one external program: your OS's "open this file" command (`open`, `xdg-open` or `explorer.exe`), with the file path passed as an argument, never through a shell. `--no-open` skips it.
- **Never** makes network requests, has no dependencies and no install scripts.

## How the privacy guarantee is enforced

`lib/guard.js` rebuilds the page's data field by field. Only finite numbers, dates, model names and entries from fixed lists in `lib/catalog.js` can pass. `npm test` runs a hostile history through the whole pipeline and fails if anything from it reaches the output.

The page itself ships a Content-Security-Policy that allows only its own two scripts (pinned by SHA-256 hash) and blocks all network access.
