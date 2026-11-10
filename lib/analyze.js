'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./catalog');
const { pickPersonality } = require('./personality');

const MIN = 60 * 1000;
const ACTIVE_GAP = 15 * MIN; // gaps longer than this don't count as "time together"
const BUCKET = 15 * MIN; // granularity for "sessions running at once"
const KEEP_TYPES = new Set(['user', 'assistant', 'system', 'attachment']);
const HARNESS_TAG = /^\s*<([a-z][a-z0-9]*-[a-z0-9-]+)>/; // <command-name>, <task-notification>, …
const TYPE_PREFIX = Buffer.from('{"type":"');
const ATTACHMENT = Buffer.from('{"type":"attachment"');
const QUEUED = Buffer.from('"queued_command"');
const TOOL_USE_ID = Buffer.from('"tool_use_id"');
const INTERRUPTED = Buffer.from('[Request interrupted by user');
const IS_ERROR = Buffer.from('"is_error":true');
const TIMESTAMP = Buffer.from('"timestamp":"');

// Yields each line of a file as a Buffer (no string decoding).
async function* readLines(file) {
  let pending = []; // pieces of a line that spans chunks
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    let start = 0;
    for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, start)) {
      let line = chunk.subarray(start, nl);
      if (pending.length) { pending.push(line); line = Buffer.concat(pending); pending = []; }
      if (line.length && line[line.length - 1] === 13) line = line.subarray(0, line.length - 1);
      if (line.length) yield line;
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  }
  if (pending.length) yield Buffer.concat(pending);
}

function defaultRoots(dir) {
  const c = [];
  if (dir) c.push(dir);
  else {
    for (const d of (process.env.CLAUDE_CONFIG_DIR || '').split(',').filter(Boolean)) c.push(path.join(d.trim(), 'projects'));
    c.push(path.join(os.homedir(), '.config', 'claude', 'projects'));
    c.push(path.join(os.homedir(), '.claude', 'projects'));
  }
  return [...new Set(c)].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

function listTranscripts(roots) {
  const out = [];
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 6 && e.name !== 'tool-results' && e.name !== 'memory') walk(p, depth + 1); }
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  for (const r of roots) { const before = out.length; walk(r, 0); for (let i = before; i < out.length; i++) out[i] = { file: out[i], root: r }; }
  return out;
}

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const countRe = (re, s) => { re.lastIndex = 0; let n = 0; while (re.exec(s)) n++; return n; };
const lines = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

async function analyze(opts = {}) {
  const roots = defaultRoots(opts.dir);
  const files = listTranscripts(roots);
  const year = opts.year || null;
  const onProgress = opts.onProgress || (() => {});

  // --- accumulators (raw identifiers live only in these local Sets and are never returned) ---
  const seenLine = new Set();
  const seenTool = new Set();
  const usageByMsg = new Map(); // msgKey → {model, in, out, cr, cw5, cw1h, fast, web}
  const sessions = new Map(); // sessionId → {ts: [], toolsSincePrompt, maxTools}
  const projects = new Set();
  const filesTouched = new Set();
  const allTs = [];
  const buckets = new Map(); // 15-min bucket → Set(sessionId)
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const days = new Map();
  const activeDays = new Set();
  const tools = new Map();
  const langs = new Map();
  const langsRead = new Map();
  const cmds = new Map();
  const slash = new Map();
  const models = new Map();
  const words = Object.fromEntries(C.USER_PHRASES.map(([k]) => [k, 0]));
  Object.assign(words, { continue: 0, approve: 0, yelled: 0 });
  const claude = Object.fromEntries(C.CLAUDE_PHRASES.map(([k]) => [k, 0]));
  claude.emDashes = 0;
  const T = {
    prompts: 0, promptChars: 0, longestPrompt: 0, toolCalls: 0, toolErrors: 0, subagents: 0,
    linesWritten: 0, linesRemoved: 0, images: 0, interruptions: 0, slashCommands: 0, bangCommands: 0,
    compactions: 0, apiErrors: 0, thinkingBlocks: 0, webSearches: 0, webFetches: 0, questionsAsked: 0,
    bashTotal: 0, rmrf: 0, forcePush: 0, sudo: 0, gitCommits: 0, installs: 0,
  };
  let minTs = Infinity, maxTs = -Infinity;
  let currentProject = '';

  const inYear = (d) => !year || d.getFullYear() === year;
  const session = (id) => {
    let s = sessions.get(id);
    if (!s) { s = { ts: [], toolsSincePrompt: 0, maxTools: 0 }; sessions.set(id, s); }
    return s;
  };
  const markActive = (sid, ms, d) => {
    allTs.push(ms);
    session(sid).ts.push(ms);
    activeDays.add(localDay(d));
    const b = Math.floor(ms / BUCKET);
    let set = buckets.get(b);
    if (!set) { set = new Set(); buckets.set(b, set); }
    set.add(sid);
    if (ms < minTs) minTs = ms;
    if (ms > maxTs) maxTs = ms;
  };

  function onPrompt(o, text, d, ms) {
    T.prompts++;
    T.promptChars += text.length;
    if (text.length > T.longestPrompt) T.longestPrompt = text.length;
    hours[d.getHours()]++;
    weekdays[d.getDay()]++;
    inc(days, localDay(d));
    const s = session(o.sessionId);
    s.toolsSincePrompt = 0;
    const sample = text.length > 20000 ? text.slice(0, 20000) : text;
    const lower = sample.toLowerCase();
    for (const [k, , re] of C.USER_PHRASES) words[k] += countRe(re, lower);
    const trimmed = lower.trim();
    if (C.CONTINUE_RE.test(trimmed)) words.continue++;
    if (C.APPROVE_RE.test(trimmed)) words.approve++;
    const letters = sample.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && letters === letters.toUpperCase()) words.yelled++;
  }

  function onBash(cmd) {
    T.bashTotal++;
    if (/\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i.test(cmd)) T.rmrf++;
    if (/\bgit\s+push\b[^\n;&|]*(?:--force\b|--force-with-lease\b|\s-f\b)/.test(cmd)) T.forcePush++;
    if (/(?:^|[\s;&|(])sudo\s/.test(cmd)) T.sudo++;
    if (/\bgit\s+commit\b/.test(cmd)) T.gitCommits++;
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+add\b/.test(cmd)) T.installs++;
    const body = cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, ' ');
    // Leading verb of each chained command (not pipe helpers like `| head`). `cd` is
    // excluded — Claude prefixes nearly everything with it, so it'd win every year.
    const seen = new Set();
    for (const seg of body.split(/&&|\|\||[;\n]/)) {
      const toks = seg.trim().replace(/^[({!\s]+/, '').split(/\s+/);
      while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || C.CMD_PREFIX_SKIP.has(toks[0]))) toks.shift();
      if (!toks[0]) continue;
      const v = toks[0].replace(/^.*\//, '').toLowerCase();
      if (v !== 'cd' && C.CMD_ALLOW.has(v) && !seen.has(v)) { seen.add(v); inc(cmds, v); }
    }
  }

  function onToolUse(b, mainThread, sid) {
    if (!b.id || seenTool.has(b.id)) return;
    seenTool.add(b.id);
    T.toolCalls++;
    const label = C.toolLabel(b.name);
    if (label) inc(tools, label);
    if (mainThread) {
      const s = session(sid);
      s.toolsSincePrompt++;
      if (s.toolsSincePrompt > s.maxTools) s.maxTools = s.toolsSincePrompt;
    }
    const inp = b.input && typeof b.input === 'object' ? b.input : {};
    const fp = inp.file_path || inp.notebook_path || inp.path;
    switch (label) {
      case 'Agent': T.subagents++; break;
      case 'WebSearch': T.webSearches++; break;
      case 'WebFetch': T.webFetches++; break;
      case 'Ask You': T.questionsAsked++; break;
      case 'Bash': if (typeof inp.command === 'string') onBash(inp.command); break;
      case 'Read': { const l = C.langOf(fp); if (l) inc(langsRead, l); break; }
      case 'Write': case 'Edit': {
        const l = C.langOf(fp);
        if (l) inc(langs, l);
        if (typeof fp === 'string') filesTouched.add(fp);
        if (b.name === 'Write') T.linesWritten += lines(inp.content);
        else if (Array.isArray(inp.edits)) for (const e of inp.edits) { T.linesWritten += lines(e && e.new_string); T.linesRemoved += lines(e && e.old_string); }
        else { T.linesWritten += lines(inp.new_string || inp.new_source); T.linesRemoved += lines(inp.old_string); }
        break;
      }
    }
  }

  function handle(o, fileIsSide) {
    if (!o || !o.timestamp) return;
    const d = new Date(o.timestamp);
    const ms = d.getTime();
    if (!Number.isFinite(ms) || !inYear(d)) return;
    const side = o.isSidechain === true || fileIsSide;
    if (o.uuid) { if (seenLine.has(o.uuid)) return; seenLine.add(o.uuid); }
    const sid = o.sessionId || 'unknown';
    if (!side && (o.type === 'user' || o.type === 'assistant')) projects.add(currentProject);

    if (o.type === 'assistant') {
      const m = o.message || {};
      if (m.model && m.model !== '<synthetic>') {
        const key = (m.id || o.uuid) + '|' + (o.requestId || '');
        const u = m.usage || {};
        const prev = usageByMsg.get(key);
        const cc = u.cache_creation || {};
        const rec = {
          model: m.model,
          in: u.input_tokens || 0,
          out: u.output_tokens || 0,
          cr: u.cache_read_input_tokens || 0,
          cw1h: cc.ephemeral_1h_input_tokens || 0,
          cw5: cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null
            ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0),
          fast: u.speed === 'fast',
          web: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
        };
        if (!prev || rec.out >= prev.out) usageByMsg.set(key, rec);
        if (!prev && !side) inc(models, m.model);
      }
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b) continue;
          if (b.type === 'tool_use') onToolUse(b, !side, sid);
          else if (b.type === 'thinking' || b.type === 'redacted_thinking') T.thinkingBlocks++;
          else if (b.type === 'text' && !side && typeof b.text === 'string') {
            for (const [k, re] of C.CLAUDE_PHRASES) claude[k] += countRe(re, b.text);
            claude.emDashes += (b.text.match(/—/g) || []).length;
          }
        }
      }
      if (!side) markActive(sid, ms, d);
      return;
    }

    if (o.type === 'system') {
      if (o.subtype === 'compact_boundary') T.compactions++;
      else if (o.subtype === 'api_error') T.apiErrors++;
      return;
    }

    if (o.type === 'attachment') {
      const a = o.attachment || {};
      // Prompts typed while Claude was busy. Skip ones from other sessions ("peer") and task notifications.
      const typedByYou = a.origin ? a.origin.kind === 'human' || a.origin.kind === 'user' : a.commandMode === 'prompt';
      if (!side && a.type === 'queued_command' && typeof a.prompt === 'string' && typedByYou) {
        if (a.prompt.trim() && !HARNESS_TAG.test(a.prompt)) { onPrompt(o, a.prompt, d, ms); markActive(sid, ms, d); }
      }
      return;
    }

    if (o.type !== 'user') return;
    const c = o.message && o.message.content;
    let text = '';
    let imgs = 0;
    let hasToolResult = false;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      const parts = [];
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_result') {
          hasToolResult = true;
          if (b.is_error) T.toolErrors++;
        } else if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
        else if (b.type === 'image') imgs++;
      }
      text = parts.join('\n');
    }
    if (side) return;
    if (/^\[Request interrupted by user/m.test(text)) { T.interruptions++; return; }
    if (hasToolResult || o.toolUseResult || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) return;
    const tag = text.match(HARNESS_TAG);
    if (tag) {
      if (tag[1] === 'command-name') {
        const m = text.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        if (m) { T.slashCommands++; inc(slash, C.SLASH_BUILTIN.has(m[1]) ? '/' + m[1] : 'custom'); markActive(sid, ms, d); }
      } else if (tag[1] === 'bash-input') { T.bangCommands++; markActive(sid, ms, d); }
      return;
    }
    if (/^\s*(?:\[SYSTEM NOTIFICATION|\[Image[: ]|Caveat: The messages below|This session is being continued)/.test(text)) return;
    if (!text.trim() && !imgs) return;
    T.images += imgs;
    onPrompt(o, text, d, ms);
    markActive(sid, ms, d);
  }

  // --- stream every transcript ---
  // Lines are inspected as raw bytes first; most of the volume (tool outputs, request
  // snapshots) is skipped or counted without ever being decoded or JSON-parsed.
  let done = 0;
  for (const { file, root } of files) {
    const fileIsSide = /[\\/](?:subagents|workflows)[\\/]/.test(file);
    currentProject = path.relative(root, file).split(/[\\/]/)[0];
    try {
      for await (const buf of readLines(file)) {
        if (buf[0] !== 123) continue; // '{'
        if (buf.indexOf(TYPE_PREFIX) === 0) {
          const end = buf.indexOf(34, 9); // '"'
          if (!KEEP_TYPES.has(buf.toString('latin1', 9, end))) continue;
          if (buf.indexOf(ATTACHMENT) === 0 && buf.indexOf(QUEUED) === -1) continue;
        }
        if (buf.indexOf(TOOL_USE_ID) !== -1 && buf.indexOf(INTERRUPTED) === -1) {
          // Tool result: we only need "did it fail?" (and only for this year).
          if (year) {
            const t = buf.lastIndexOf(TIMESTAMP);
            if (t !== -1 && new Date(buf.toString('latin1', t + 13, t + 37)).getFullYear() !== year) continue;
          }
          for (let i = buf.indexOf(IS_ERROR); i !== -1; i = buf.indexOf(IS_ERROR, i + 1)) T.toolErrors++;
          continue;
        }
        let o;
        try { o = JSON.parse(buf.toString('utf8')); } catch { continue; }
        try { handle(o, fileIsSide); } catch { /* one weird line shouldn't ruin Wrapped */ }
      }
    } catch { /* unreadable file → skip */ }
    onProgress(++done, files.length);
  }

  // --- time math ---
  const activeMinutes = (arr) => {
    if (arr.length < 2) return arr.length ? 1 : 0;
    arr.sort((a, b) => a - b);
    let t = 0;
    for (let i = 1; i < arr.length; i++) t += Math.min(arr[i] - arr[i - 1], ACTIVE_GAP);
    return Math.max(1, Math.round(t / MIN));
  };
  let longestSessionMin = 0, agentMinutes = 0, maxToolsInTurn = 0, realSessions = 0;
  for (const s of sessions.values()) {
    if (!s.ts.length) continue;
    realSessions++;
    const m = activeMinutes(s.ts);
    agentMinutes += m;
    if (m > longestSessionMin) longestSessionMin = m;
    if (s.maxTools > maxToolsInTurn) maxToolsInTurn = s.maxTools;
  }
  const minutes = activeMinutes(allTs);
  let maxParallel = 0;
  for (const set of buckets.values()) if (set.size > maxParallel) maxParallel = set.size;

  const sortedDays = [...activeDays].sort();
  let longestStreak = 0, run = 0, prev = null;
  for (const ds of sortedDays) {
    const cur = new Date(ds + 'T12:00:00');
    run = prev && Math.round((cur - prev) / 86400000) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = cur;
  }
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const totalPrompts = Math.max(1, T.prompts);
  const share = (hs) => hs.reduce((n, h) => n + hours[h], 0) / totalPrompts;

  // --- tokens & cost ---
  const tok = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let usd = 0;
  const modelMsgs = new Map();
  for (const u of usageByMsg.values()) {
    tok.input += u.in; tok.output += u.out; tok.cacheRead += u.cr; tok.cacheWrite += u.cw5 + u.cw1h;
    const info = C.modelInfo(u.model);
    const [pi, po, pcr] = info ? info.price : [3, 15, 0.3];
    let cost = (u.in * pi + u.out * po + u.cr * pcr + u.cw5 * pi * 1.25 + u.cw1h * pi * 2) / 1e6;
    if (u.fast) cost *= 2;
    usd += cost + u.web * 0.01;
  }
  for (const [id, n] of models) {
    const info = C.modelInfo(id);
    if (info) inc(modelMsgs, info.label, n);
  }
  const modelTotal = [...modelMsgs.values()].reduce((a, b) => a + b, 0) || 1;

  // --- the ONLY thing that leaves this function ---
  const toolList = top(tools, 8);
  const topPhrase = C.USER_PHRASES.filter(([, label]) => label)
    .map(([k, label]) => ({ label, count: words[k] }))
    .concat([{ label: 'continue', count: words.continue }, { label: 'yes', count: words.approve }])
    .sort((a, b) => b.count - a.count)[0];

  const stats = {
    schema: 1,
    year: year || 'all',
    generated: localDay(new Date()),
    range: Number.isFinite(minTs) ? { from: localDay(new Date(minTs)), to: localDay(new Date(maxTs)) } : null,
    totals: {
      prompts: T.prompts, sessions: realSessions, projects: projects.size, activeDays: activeDays.size,
      minutes, agentMinutes, toolCalls: T.toolCalls, toolErrors: T.toolErrors, subagents: T.subagents,
      filesTouched: filesTouched.size, linesWritten: T.linesWritten, linesRemoved: T.linesRemoved,
      images: T.images, interruptions: T.interruptions, slashCommands: T.slashCommands,
      bangCommands: T.bangCommands, compactions: T.compactions, apiErrors: T.apiErrors,
      thinkingBlocks: T.thinkingBlocks, webSearches: T.webSearches, webFetches: T.webFetches,
      questionsAsked: T.questionsAsked,
    },
    time: {
      hours, weekdays,
      peakHour: hours.indexOf(Math.max(...hours)),
      peakWeekday: weekdays.indexOf(Math.max(...weekdays)),
      nightShare: share([22, 23, 0, 1, 2, 3, 4]),
      dawnShare: share([5, 6, 7, 8]),
      weekendShare: (weekdays[0] + weekdays[6]) / totalPrompts,
      longestStreak, longestSessionMin, maxParallel, maxToolsInTurn,
      busiestDay: busiest ? { date: busiest[0], prompts: busiest[1] } : null,
      days: Object.fromEntries([...days.entries()].sort()),
    },
    tools: toolList,
    languages: top(langs.size ? langs : langsRead, 8),
    bash: {
      total: T.bashTotal, top: top(cmds, 8), rmrf: T.rmrf, forcePush: T.forcePush, sudo: T.sudo,
      gitCommits: T.gitCommits, installs: T.installs,
    },
    tokens: { ...tok, total: tok.input + tok.output + tok.cacheRead + tok.cacheWrite },
    cost: { usd: Math.round(usd * 100) / 100 },
    models: top(modelMsgs, 5).map((m) => ({ name: m.name, share: m.count / modelTotal })),
    words: {
      ...Object.fromEntries(Object.entries(words).map(([k, v]) => [k, v])),
      avgPromptChars: Math.round(T.promptChars / totalPrompts),
      longestPromptChars: T.longestPrompt,
      topPhrase: topPhrase && topPhrase.count > 0 ? topPhrase : null,
    },
    claude,
    slash: top(slash, 5),
  };
  stats.personality = pickPersonality(stats);
  stats._meta = { files: files.length };
  return stats;
}

module.exports = { analyze, defaultRoots };
