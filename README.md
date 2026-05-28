# claude-auto-continue

Claude Code plugin. When a tool errors with something recoverable, the agent retries instead of stopping.

## The problem

```
⏺ Update(/path/to/file.swift)
  Error: File has not been read yet. Read it first before writing to it.
```

Fix is obvious (Read, then Update). But the model sometimes just stops. This plugin makes it continue.

## How

- **PostToolUse**: matches the error, injects a hint for the next turn.
- **Stop**: if the model tries to stop on a known error, blocks it and tells it to keep going.

Capped at `AUTO_CONTINUE_MAX` continuations per session (default `3`) so it can't loop forever.

## Patterns

| ID | Trigger | Fix |
|---|---|---|
| `file-not-read` | `File has not been read yet` | Read, retry |
| `edit-string-not-found` | `String to replace not found` | Re-Read, match verbatim |
| `edit-identical-strings` | `old_string and new_string ... same` | Reconsider |
| `edit-not-unique` | `not unique` / `N matches` | Widen or `replace_all: true` |
| `file-missing` | `File does not exist` / `ENOENT` | Glob, retry |
| `bash-timeout` | `Command timed out` | Background or narrow |
| `transient-network` | `ECONNRESET` / `502` / `503` / `504` | Retry once |
| `rate-limit` | `429` / `rate limit` | Sleep, retry |

Add or tune in `hooks/known-errors.js`. Hot-reloaded.

## Install

As a plugin:

```bash
claude plugin install /path/to/claude-auto-continue
```

Or wire the hooks manually in `~/.claude/settings.json`:

```jsonc
{
  "hooks": {
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-auto-continue/hooks/post-tool-use.js", "timeout": 5 }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-auto-continue/hooks/stop-handler.js", "timeout": 10 }] }]
  }
}
```

## Config

`AUTO_CONTINUE_MAX` — max forced continuations per session (default `3`).

Counter lives at `$TMPDIR/claude-auto-continue-<session-id>.count`. Delete to reset.

## Notes

- Only the most recent `tool_result` is inspected; a later success cancels the trigger.
- `stop_hook_active: true` short-circuits, so the plugin never recurses on itself.
- Every internal exception silent-fails — never blocks your session on its own bugs.

## Test

```bash
node -e 'const {matchError} = require("./hooks/known-errors"); console.log(matchError("Edit", "Error: File has not been read yet."))'
```

Prints the `file-not-read` entry.
