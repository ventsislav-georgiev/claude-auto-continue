#!/usr/bin/env node
// auto-continue — Stop hook
//
// Inspects the tail of the session transcript for unresolved known errors.
// If found, returns `{decision: "block", reason: "..."}` to force the model
// to continue instead of stopping.
//
// Safeguards:
//   - Skips when stop_hook_active is true (already in a forced-continue loop)
//   - Per-session counter caps continues at MAX_CONTINUES (default 3)
//   - Only forces continue if the LAST assistant turn has a known error and
//     no subsequent successful tool result of the same tool
//   - Silent-fails on every error — defaults to allowing the stop

const fs = require('fs');
const path = require('path');
const os = require('os');
const { matchError } = require('./known-errors');

const MAX_CONTINUES = parseInt(process.env.AUTO_CONTINUE_MAX || '3', 10);
const TAIL_TURNS = 6; // how many recent transcript entries to scan

let raw = '';
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');

    // Never loop on ourselves
    if (data.stop_hook_active === true) {
      process.exit(0);
    }

    const transcriptPath = data.transcript_path;
    const sessionId = data.session_id || 'default';
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      process.exit(0);
    }

    // Read transcript (JSONL: one JSON object per line)
    const entries = [];
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch (_) { /* skip bad lines */ }
    }
    if (!entries.length) process.exit(0);

    // Walk the tail. For each tool_result with is_error, check pattern.
    // Track most recent error per tool_use_id, and the most recent successful
    // tool_result per tool name. If the LAST relevant tool_result is an error
    // matching our patterns, we want to continue.
    const tail = entries.slice(-TAIL_TURNS * 4); // generous slice

    // Build map: tool_use_id -> tool_name (from assistant messages)
    const toolUseIdToName = new Map();
    for (const e of tail) {
      const msg = e.message || e;
      if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === 'tool_use' && block.id && block.name) {
            toolUseIdToName.set(block.id, block.name);
          }
        }
      }
    }

    // Find the LAST tool_result block in the transcript tail.
    let lastErrorHit = null;
    let foundLater = false;
    for (let i = tail.length - 1; i >= 0; i--) {
      const e = tail[i];
      const msg = e.message || e;
      if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_result') continue;
        const toolName = toolUseIdToName.get(block.tool_use_id) || '';
        const text = extractText(block.content);
        const isError = block.is_error === true;
        if (lastErrorHit) {
          // We already found a candidate error; if a later (i.e. earlier in
          // this reverse walk we already passed) successful result for same
          // tool exists, the error is "resolved" — but since we iterate
          // newest→oldest, anything we see now is OLDER. So nothing to do.
          continue;
        }
        if (isError) {
          const hit = matchError(toolName, text);
          if (hit) {
            lastErrorHit = { hit, toolName, text };
          }
        } else {
          // Newest tool_result is a success → nothing to force-continue
          foundLater = true;
          break;
        }
        // Stop at the newest tool_result regardless
        break;
      }
      if (lastErrorHit || foundLater) break;
    }

    if (!lastErrorHit) process.exit(0);

    // Per-session continue counter — cap to prevent infinite loops
    const counterPath = path.join(
      os.tmpdir(),
      'claude-auto-continue-' + sanitize(sessionId) + '.count'
    );
    let count = 0;
    try { count = parseInt(fs.readFileSync(counterPath, 'utf8'), 10) || 0; } catch (_) {}
    if (count >= MAX_CONTINUES) {
      // Cap reached — let the stop go through, but log why
      process.stderr.write(
        '[auto-continue] cap reached (' + count + '/' + MAX_CONTINUES +
        ') for session ' + sessionId + ' — allowing stop\n'
      );
      process.exit(0);
    }
    try { fs.writeFileSync(counterPath, String(count + 1), { mode: 0o600 }); } catch (_) {}

    const reason =
      '[auto-continue ' + (count + 1) + '/' + MAX_CONTINUES + '] ' +
      lastErrorHit.hit.continue +
      ' (matched pattern: ' + lastErrorHit.hit.id + ')';

    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: reason
    }));
  } catch (e) {
    // Silent fail — never block stop on hook error
  }
});

// Pull a plain string out of the polymorphic `content` field on tool_result.
function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(b => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object') return b.text || b.content || '';
        return '';
      })
      .join('\n');
  }
  if (typeof content === 'object') return content.text || content.content || '';
  return '';
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}
