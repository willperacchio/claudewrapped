'use strict';
// Fixed vocabularies. Anything that reaches the Wrapped page as a string comes
// from one of these lists (or is a number / date). That's the privacy firewall:
// project names, file paths, prompts and command arguments never leave analyze().

// ---------- Tools ----------
const TOOL_ALIASES = {
  Task: 'Agent', Agent: 'Agent',
  MultiEdit: 'Edit', NotebookEdit: 'Edit', str_replace_based_edit_tool: 'Edit',
  BashOutput: 'Bash', KillShell: 'Bash', KillBash: 'Bash',
  TodoWrite: 'Todos', TodoRead: 'Todos', TaskCreate: 'Todos', TaskUpdate: 'Todos', TaskList: 'Todos',
  exit_plan_mode: 'Plan Mode', ExitPlanMode: 'Plan Mode', EnterPlanMode: 'Plan Mode',
  AskUserQuestion: 'Ask You', NotebookRead: 'Read', LS: 'LS',
};
const TOOL_ALLOW = new Set([
  'Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'Agent',
  'Todos', 'Skill', 'Ask You', 'Plan Mode', 'Workflow', 'Monitor', 'Artifact', 'SendUserFile',
  'SlashCommand', 'LSP', 'ScheduleWakeup', 'Browser', 'Computer Use', 'MCP',
]);
const TOOL_HIDE = new Set(['ToolSearch', 'SubagentHandback', 'SendMessage', 'ListAgents', 'ReadNotifications']);

function toolLabel(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1] || '';
    if (/^ccd_/.test(server)) return null; // desktop-app plumbing, not "your" tools
    if (/browser|preview|chrome|playwright|puppeteer/i.test(server)) return 'Browser';
    if (/computer-use/i.test(server)) return 'Computer Use';
    return 'MCP'; // server names can be private → bucketed
  }
  if (TOOL_HIDE.has(name)) return null;
  // Object.hasOwn: a tool literally named "constructor" must not resolve to Object.prototype
  const t = Object.hasOwn(TOOL_ALIASES, name) ? TOOL_ALIASES[name] : name;
  return TOOL_ALLOW.has(t) ? t : null;
}

// ---------- Languages ----------
const EXT_LANG = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python', ipynb: 'Jupyter', rs: 'Rust', go: 'Go', swift: 'Swift',
  kt: 'Kotlin', kts: 'Kotlin', java: 'Java', scala: 'Scala', rb: 'Ruby', php: 'PHP',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++', cs: 'C#',
  m: 'Objective-C', mm: 'Objective-C', dart: 'Dart', lua: 'Lua', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', hs: 'Haskell', ml: 'OCaml', clj: 'Clojure', r: 'R', jl: 'Julia', zig: 'Zig',
  nim: 'Nim', sol: 'Solidity', vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  md: 'Markdown', mdx: 'Markdown', rst: 'Markdown', txt: 'Plain Text',
  json: 'JSON', jsonl: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', csv: 'CSV',
  sql: 'SQL', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protobuf',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell',
  tf: 'Terraform', hcl: 'Terraform', nix: 'Nix', tex: 'LaTeX', pdf: 'PDF',
  png: 'Images', jpg: 'Images', jpeg: 'Images', gif: 'Images', webp: 'Images', svg: 'SVG',
};
const NAME_LANG = { dockerfile: 'Docker', makefile: 'Makefile', gemfile: 'Ruby', rakefile: 'Ruby', justfile: 'Makefile' };

function langOf(p) {
  if (typeof p !== 'string' || !p) return null;
  const base = p.split(/[\\/]/).pop().toLowerCase();
  if (Object.hasOwn(NAME_LANG, base)) return NAME_LANG[base];
  if (base.startsWith('dockerfile')) return 'Docker';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1);
  return Object.hasOwn(EXT_LANG, ext) ? EXT_LANG[ext] : null; // "x.constructor" is not a language
}

// ---------- Shell commands ----------
const CMD_ALLOW = new Set((
  'git gh npm npx pnpm yarn bun bunx node deno tsc tsx python python3 pip pip3 uv uvx poetry pytest ' +
  'ruby bundle rails go cargo rustc rustup make cmake docker kubectl helm terraform aws gcloud az ' +
  'vercel netlify firebase supabase wrangler flyctl heroku psql mysql sqlite3 redis-cli mongosh ' +
  'curl wget ssh scp rsync ls cat head tail grep rg find fd sed awk jq yq wc sort uniq xargs echo ' +
  'printf cd pwd mkdir rm mv cp touch chmod chown ln tar zip unzip open code which whoami source ' +
  'sleep kill pkill ps lsof top du df date diff tree brew apt apt-get swift xcodebuild xcrun pod ' +
  'java javac mvn gradle dotnet php composer mix flutter dart ffmpeg magick say osascript ' +
  'defaults launchctl systemctl jest vitest eslint prettier biome ruff black mypy playwright ' +
  'next vite turbo nx claude ollama'
).split(' '));
const CMD_PREFIX_SKIP = new Set(['sudo', 'time', 'exec', 'nohup', 'command', 'env', 'builtin']);

// ---------- Slash commands (built-ins only; custom ones may have private names) ----------
const SLASH_BUILTIN = new Set((
  'clear compact init review model resume cost context config help mcp memory permissions login ' +
  'logout doctor status agents hooks plugin plugins rewind export add-dir ide usage stats effort fast ' +
  'plan todos security-review code-review ultrareview loop schedule simplify btw release-notes ' +
  'upgrade terminal-setup vim theme output-style statusline bashes pr-comments install-github-app ' +
  'privacy-settings feedback bug exit quit skills sandbox insights'
).split(' '));

// ---------- Phrases ----------
// User prompts (scanned, never stored). label=null → never displayed verbatim.
const USER_PHRASES = [
  ['please', 'please', /\b(?:please|pls|plz)\b/g],
  ['thanks', 'thank you', /\b(?:thank you|thanks|thank u|thx|tysm|ty)\b/g],
  ['wtf', 'wtf', /\b(?:wtf|wth|what the (?:hell|heck|fuck))\b/g],
  ['spicy', null, /\b(?:fuck\w*|shit\w*|damn\w*|bullshit|ffs)\b/g],
  ['still', 'still broken', /\bstill (?:not|broken|failing|wrong|the same|happening|doesn'?t|isn'?t|seeing|getting|nothing)\b/g],
  ['broken', "it doesn't work", /\b(?:doesn'?t|does not|didn'?t|did not|isn'?t|is not|not) work(?:ing)?\b/g],
  ['why', 'why', /\bwhy\b/g],
  ['fix', 'fix', /\bfix\b/g],
  ['undo', 'undo', /\b(?:undo|revert|roll ?back)\b/g],
  ['praise', 'perfect', /\b(?:perfect|amazing|awesome|incredible|brilliant|love it|nailed it|great job|good job|beautiful)\b/g],
  ['lol', 'lol', /\b(?:lol|lmao|lmfao|haha+)\b/g],
  ['ultrathink', 'ultrathink', /\bultrathink\b/g],
  ['pop', 'make it pop', /\bmake it (?:pop|better|nicer|prettier|cleaner|look (?:good|better|nice|nicer))\b/g],
  ['sorry', 'sorry', /\b(?:sorry|my bad|oops)\b/g],
];
const CONTINUE_RE = /^(?:continue|keep going|go on|go ahead|proceed|carry on|resume)\b/;
const APPROVE_RE = /^(?:y|ya|yes|yep|yeah|yup|ok|okay|k|kk|sure|do it|go|go for it|lgtm|sounds good|ship it|approved?|yes please|perfect|great|nice)[\s.!]*$/;

// What Claude said (main thread only — what you actually saw).
const CLAUDE_PHRASES = [
  ['absolutelyRight', /\byou(?:'|’)?re absolutely right\b|\byou are absolutely right\b/gi],
  ['perfect', /\bperfect!/gi],
  ['greatQuestion', /\bgreat question\b/gi],
  ['apology', /\b(?:i apologi[sz]e|my apologies|sorry about that|i'm sorry)\b/gi],
  ['greatCatch', /\b(?:great|good|nice) (?:catch|call|point|idea)\b/gi],
  ['letMe', /\blet me\b/gi],
];

// ---------- Models & pricing ----------
// $ per million tokens: [input, output, cacheRead]. Cache writes: 5m = 1.25× input, 1h = 2× input.
function modelInfo(id) {
  if (typeof id !== 'string') return null;
  const s = id.toLowerCase();
  let fam, ver;
  let m = s.match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d)(?:-(\d{1,2}))?(?=-|$|\[|@)/);
  if (m) { fam = m[1]; ver = m[3] ? `${m[2]}.${m[3]}` : m[2]; }
  else {
    m = s.match(/claude-(\d)(?:-(\d))?-(opus|sonnet|haiku)/);
    if (!m) return null;
    fam = m[3]; ver = m[2] ? `${m[1]}.${m[2]}` : m[1];
  }
  const label = fam[0].toUpperCase() + fam.slice(1) + ' ' + ver;
  return { fam, ver, label, price: priceFor(fam, ver) };
}

function priceFor(fam, ver) {
  const v = parseFloat(ver);
  switch (fam) {
    case 'fable': case 'mythos': return ver === '5.1' ? [10, 50, 0.25] : [10, 50, 1];
    case 'opus':
      if (ver === '5.5') return [4, 20, 0.2];
      if (v >= 4.5) return [5, 25, 0.5];
      return [15, 75, 1.5];
    case 'sonnet': return v >= 5 ? [2, 10, 0.2] : [3, 15, 0.3];
    case 'haiku':
      if (v >= 5) return [0.1, 0.5, 0.01];
      if (v >= 4) return [1, 5, 0.1];
      if (ver === '3.5') return [0.8, 4, 0.08];
      return [0.25, 1.25, 0.03];
    default: return [3, 15, 0.3];
  }
}

const LANG_NAMES = new Set([...Object.values(EXT_LANG), ...Object.values(NAME_LANG), 'Docker']);

module.exports = {
  toolLabel, langOf, CMD_ALLOW, CMD_PREFIX_SKIP, SLASH_BUILTIN, TOOL_LABELS: TOOL_ALLOW, LANG_NAMES,
  USER_PHRASES, CONTINUE_RE, APPROVE_RE, CLAUDE_PHRASES, modelInfo,
};
