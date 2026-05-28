# claude-auto-continue

Claude Code plugin. Detects known recoverable tool errors and forces the agent to **continue** instead of stopping or asking the user.

## Why

Example error that historically stopped the agent mid-task:

```
⏺ Update(/path/to/file.swift)
  Error: File has not been read yet. Read it first before writing to it.
```

The fix is mechanical (Read the file, then retry Update), but the model sometimes terminates the turn instead of recovering. `auto-continue` watches for these patterns and:

1. **PostToolUse** — injects fix guidance back into the next model turn so it knows how to recover.
2. **Stop** — if the model tries to stop with an unresolved known error, blocks the stop and injects a "continue the task" reason.

Per-session cap (`AUTO_CONTINUE_MAX`, default `3`) prevents infinite loops.

## Built-in patterns

| ID | Trigger | Recovery |
|---|---|---|
| `file-not-read` | `File has not been read yet` (Edit/Write/NotebookEdit) | Read the file, retry |
| `edit-string-not-found` | `String to replace not found` | Re-Read, retry with verbatim match |
| `edit-identical-strings` | `old_string and new_string ... same` | Reconsider the change |
| `edit-not-unique` | `not unique` / `N matches` | Widen old_string or `replace_all: true` |
| `file-missing` | `File does not exist` / `ENOENT` | Verify path with Glob, retry |
| `bash-timeout` | `Command timed out` | Run in background or narrow scope |
| `transient-network` | `ECONNRESET` / `502` / `503` / `504` | Retry once |
| `rate-limit` | `429` / `rate limit` | Sleep, retry |

Edit `hooks/known-errors.js` to add, remove, or tune patterns. Hooks load it dynamically — no rebuild.

## Install

### As a Claude Code plugin (preferred)

From this directory:

```bash
# point Claude Code at the plugin
claude plugin install /path/to/claude-auto-continue
```

Or symlink it into your plugin cache and enable via `~/.claude/plugins/installed_plugins.json`.

### Manual hook install (no plugin system)

Add to `~/.claude/settings.json`:

```jsonc
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-auto-continue/hooks/post-tool-use.js",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-auto-continue/hooks/stop-handler.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## Config

| Env var | Default | Meaning |
|---|---|---|
| `AUTO_CONTINUE_MAX` | `3` | Max forced continuations per session |

Counter file: `$TMPDIR/claude-auto-continue-<session-id>.count`. Delete to reset mid-session.

## How it decides to continue

Stop hook walks the tail of the transcript newest-first and inspects only the **most recent** `tool_result` block. If that block has `is_error: true` and its text matches a known pattern, the stop is blocked. A subsequent successful `tool_result` cancels the trigger — the error is treated as already resolved.

`stop_hook_active: true` on the hook input short-circuits the check, so the plugin never recurses with itself.

## Safety

- Silent-fails on every internal exception — never blocks tool execution or session termination on its own bugs.
- Counter cap is hard. Once hit, the stop is allowed through and a one-line diagnostic goes to stderr.
- Pattern table is a deny-listed allowlist: only matching `is_error: true` strings trigger a continue. Unmatched errors fall through to normal stop behavior.

## Test it

```bash
# Sanity-check the matcher
node -e 'const {matchError} = require("./hooks/known-errors"); console.log(matchError("Edit", "Error: File has not been read yet. Read it first before writing to it."))'
```

Expected: prints the `file-not-read` entry.
