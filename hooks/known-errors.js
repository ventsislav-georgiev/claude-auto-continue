// auto-continue — known recoverable error patterns
//
// Each entry:
//   id:       short stable identifier (used in continuation reason/log)
//   match:    RegExp tested against the tool error string
//   tool:     optional — only match when triggered by this tool name
//   fix:      instruction injected back to the model telling it how to recover
//   continue: instruction injected as Stop-hook `reason` to force the model
//             to try again instead of giving up
//
// Edit this file to add/remove patterns. The two hooks load it dynamically,
// no rebuild needed.

const PATTERNS = [
  {
    id: 'file-not-read',
    tool: /^(Edit|Write|NotebookEdit|MultiEdit)$/,
    match: /File has not been read yet\.?\s*Read it first before writing to it\.?/i,
    fix:
      'The target file was not Read in this session. Call the Read tool on the ' +
      'exact same absolute path first, then retry the original Edit/Write/' +
      'NotebookEdit call. Do not give up — this is recoverable.',
    continue:
      'You stopped after a "File has not been read yet" error. Read the file ' +
      'with the Read tool, then re-issue the original Edit/Write call. ' +
      'Continue the task.'
  },
  {
    id: 'edit-string-not-found',
    tool: /^(Edit|MultiEdit)$/,
    match: /(String to replace not found|old_string was not found)/i,
    fix:
      'old_string did not match. Re-Read the file to get current exact bytes ' +
      '(including indentation/whitespace), then retry Edit with a string that ' +
      'matches verbatim. Strip Read line-number prefixes before matching.',
    continue:
      'You stopped after an Edit "string not found" error. Re-Read the file, ' +
      'then retry Edit with a verbatim-matching old_string. Continue the task.'
  },
  {
    id: 'edit-identical-strings',
    tool: /^(Edit|MultiEdit)$/,
    match: /old_string and new_string (are exactly the same|must be different)/i,
    fix:
      'old_string equals new_string — no change. Re-evaluate what edit is ' +
      'actually needed and supply a genuinely different new_string.',
    continue:
      'You stopped after an Edit "no-op" error. Reconsider the change and ' +
      'retry with a different new_string. Continue the task.'
  },
  {
    id: 'edit-not-unique',
    tool: /^Edit$/,
    match: /(not unique|found \d+ matches|occurs \d+ times)/i,
    fix:
      'old_string matched multiple locations. Either widen old_string with ' +
      'more surrounding context until it is unique, or pass replace_all: true ' +
      'if every occurrence should change.',
    continue:
      'You stopped after an Edit "not unique" error. Widen old_string or use ' +
      'replace_all: true. Continue the task.'
  },
  {
    id: 'file-missing',
    match: /(File does not exist|ENOENT|no such file or directory)/i,
    fix:
      'Path does not exist. Verify with Glob or Bash `ls` on the parent dir, ' +
      'fix the path (typo / wrong cwd / wrong absolute root), then retry.',
    continue:
      'You stopped after a missing-file error. Verify the path with Glob, ' +
      'correct it, then retry. Continue the task.'
  },
  {
    id: 'bash-timeout',
    tool: /^Bash$/,
    match: /(Command timed out|timeout after|deadline exceeded)/i,
    fix:
      'Command exceeded its timeout. Re-run with run_in_background: true, ' +
      'or narrow scope, or raise the `timeout` parameter (max 600000 ms).',
    continue:
      'You stopped after a Bash timeout. Re-run in background or with narrower ' +
      'scope. Continue the task.'
  },
  {
    id: 'transient-network',
    match:
      /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|temporarily unavailable|503 Service Unavailable|502 Bad Gateway|504 Gateway Timeout)/i,
    fix:
      'Transient network error. Retry the same call once. If it fails again, ' +
      'report the failure to the user instead of retrying further.',
    continue:
      'You stopped after a transient network error. Retry the failed call ' +
      'once. Continue the task.'
  },
  {
    id: 'rate-limit',
    match: /(rate.?limit|429 Too Many Requests|quota exceeded)/i,
    fix:
      'Rate limited. Wait briefly (Bash `sleep 5`), then retry. Avoid ' +
      'parallel fan-out on the same endpoint.',
    continue:
      'You stopped after a rate-limit error. Sleep briefly, then retry. ' +
      'Continue the task.'
  }
];

// Match a tool error string against the pattern table.
// Returns { id, fix, continue } or null.
function matchError(toolName, errorText) {
  if (!errorText || typeof errorText !== 'string') return null;
  for (const p of PATTERNS) {
    if (p.tool && toolName && !p.tool.test(toolName)) continue;
    if (p.match.test(errorText)) {
      return { id: p.id, fix: p.fix, continue: p.continue };
    }
  }
  return null;
}

module.exports = { PATTERNS, matchError };
