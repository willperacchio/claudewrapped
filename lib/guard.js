'use strict';
// The privacy firewall, enforced. analyze() hands its raw result to guard(), which REBUILDS
// the payload field by field: every number must be a finite number, every string must be a
// date, a model label, or a member of a fixed vocabulary. Anything else is dropped or zeroed.
// So even a malformed or hostile transcript cannot put its own text into the page.
const C = require('./catalog');
const { ARCHETYPES, TRAIT_LABELS } = require('./personality');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODEL = /^(?:Opus|Sonnet|Haiku|Fable|Mythos) \d(?:\.\d{1,2})?$/;
const VOCAB = {
  tool: C.TOOL_LABELS,
  lang: C.LANG_NAMES,
  cmd: C.CMD_ALLOW,
  slash: new Set([...C.SLASH_BUILTIN].map((s) => '/' + s).concat('custom')),
  phrase: new Set(C.USER_PHRASES.map((p) => p[1]).filter(Boolean).concat('continue', 'yes')),
  trait: new Set(Object.values(TRAIT_LABELS)),
};

const num = (v, max = 1e15) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0);
const int = (v, max) => Math.round(num(v, max));
const date = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
// numeric fields only, keys taken from our own schema (never from the data)
const nums = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(obj(o)[k])]));
const ranked = (v, vocab, n) => arr(v)
  .filter((e) => e && typeof e.name === 'string' && vocab.has(e.name))
  .slice(0, n).map((e) => ({ name: e.name, count: int(e.count) }));
const series = (v, n) => Array.from({ length: n }, (_, i) => int(arr(v)[i]));

const TOTALS = ['prompts', 'sessions', 'projects', 'activeDays', 'minutes', 'agentMinutes', 'toolCalls', 'toolErrors',
  'subagents', 'filesTouched', 'linesWritten', 'linesRemoved', 'images', 'interruptions', 'slashCommands',
  'bangCommands', 'compactions', 'apiErrors', 'thinkingBlocks', 'webSearches', 'webFetches', 'questionsAsked'];
const WORDS = ['please', 'thanks', 'wtf', 'spicy', 'still', 'broken', 'why', 'fix', 'undo', 'praise', 'lol', 'ultrathink',
  'pop', 'sorry', 'continue', 'approve', 'yelled', 'avgPromptChars', 'longestPromptChars'];
const CLAUDE = ['absolutelyRight', 'perfect', 'greatQuestion', 'apology', 'greatCatch', 'letMe', 'emDashes'];

function guard(raw) {
  const s = obj(raw), t = obj(s.time), w = obj(s.words), b = obj(s.bash);
  const hours = series(t.hours, 24), weekdays = series(t.weekdays, 7);
  const days = {};
  for (const [k, v] of Object.entries(obj(t.days))) if (DATE.test(k)) days[k] = int(v);
  const busiest = obj(t.busiestDay), tp = obj(w.topPhrase), range = obj(s.range);
  const out = {
    schema: 1,
    year: Number.isInteger(s.year) && s.year > 2000 && s.year < 3000 ? s.year : 'all',
    generated: date(s.generated),
    range: date(range.from) && date(range.to) ? { from: range.from, to: range.to } : null,
    totals: nums(s.totals, TOTALS),
    time: {
      hours, weekdays,
      peakHour: hours.indexOf(Math.max(...hours)),
      peakWeekday: weekdays.indexOf(Math.max(...weekdays)),
      nightShare: num(t.nightShare, 1), dawnShare: num(t.dawnShare, 1), weekendShare: num(t.weekendShare, 1),
      longestStreak: int(t.longestStreak), longestSessionMin: int(t.longestSessionMin),
      maxParallel: int(t.maxParallel), maxToolsInTurn: int(t.maxToolsInTurn),
      busiestDay: date(busiest.date) ? { date: busiest.date, prompts: int(busiest.prompts) } : null,
      days,
    },
    tools: ranked(s.tools, VOCAB.tool, 8),
    languages: ranked(s.languages, VOCAB.lang, 8),
    bash: { ...nums(b, ['total', 'rmrf', 'forcePush', 'sudo', 'gitCommits', 'installs']), top: ranked(b.top, VOCAB.cmd, 8) },
    tokens: nums(s.tokens, ['input', 'output', 'cacheRead', 'cacheWrite', 'total']),
    cost: { usd: Math.round(num(obj(s.cost).usd, 1e9) * 100) / 100 },
    models: arr(s.models).filter((m) => m && typeof m.name === 'string' && MODEL.test(m.name)).slice(0, 5)
      .map((m) => ({ name: m.name, share: num(m.share, 1) })),
    words: { ...nums(w, WORDS), topPhrase: typeof tp.label === 'string' && VOCAB.phrase.has(tp.label) && num(tp.count) > 0 ? { label: tp.label, count: int(tp.count) } : null },
    claude: nums(s.claude, CLAUDE),
    slash: ranked(s.slash, VOCAB.slash, 5),
  };
  return out;
}

// Personality is looked up in the fixed table by id; its text never comes from the data.
function guardPersonality(p) {
  const id = p && typeof p.id === 'string' && Object.hasOwn(ARCHETYPES, p.id) ? p.id : 'vibe';
  return { id, ...ARCHETYPES[id], traits: arr(p && p.traits).filter((x) => typeof x === 'string' && VOCAB.trait.has(x)).slice(0, 3) };
}

module.exports = { guard, guardPersonality };
