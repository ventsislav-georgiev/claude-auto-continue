#!/usr/bin/env node
// auto-continue — PostToolUse hook
//
// When a tool returns a known recoverable error, inject fix guidance as
// `additionalContext` so the model knows exactly how to recover instead of
// giving up or asking the user.
//
// Silent-fails on every error — must never block tool execution flow.

const { matchError } = require('./known-errors');

let raw = '';
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const toolName = data.tool_name || '';
    const resp = data.tool_response;

    // tool_response shapes vary by tool. Collect every string that could
    // hold an error message, then run pattern matching across all of them.
    const candidates = [];
    const push = v => { if (typeof v === 'string' && v) candidates.push(v); };

    if (typeof resp === 'string') {
      push(resp);
    } else if (resp && typeof resp === 'object') {
      push(resp.error);
      push(resp.stderr);
      push(resp.message);
      push(resp.content);
      if (Array.isArray(resp.content)) {
        for (const item of resp.content) {
          if (item && typeof item === 'object') push(item.text);
          else push(item);
        }
      }
      // Some tools surface errors only via boolean flag — capture full text.
      if (resp.is_error === true || resp.isError === true) {
        push(JSON.stringify(resp));
      }
    }

    let hit = null;
    for (const text of candidates) {
      hit = matchError(toolName, text);
      if (hit) break;
    }

    if (hit) {
      const msg =
        '[auto-continue] Recoverable error detected (' + hit.id + '). ' +
        hit.fix + ' Do not stop — continue the task.';
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: msg
        }
      }));
    }
  } catch (e) {
    // Silent fail — never break tool flow
  }
});
