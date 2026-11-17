#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { analyze, defaultRoots } = require('../lib/analyze');
const { render } = require('../lib/render');
const pkg = require('../package.json');

const HELP = `
  claudewrapped — your year in Claude Code, Spotify Wrapped style.

  Usage
    npx claudewrapped [options]

  Options
    --year <yyyy>   Which year to wrap (default: this year)
    --all           Use all local history, not just one year
    --out <file>    Where to write the HTML (default: your temp dir)
    --no-open       Don't open the browser
    --json          Print the exact data that goes into the page, then exit
    --demo          Render with sample data (no transcripts read)
    --dir <path>    Read transcripts from a custom projects directory
    -v, --version   Print version

  Privacy
    Everything runs locally. The page contains only counts and labels from a
    fixed list (tool names, languages, model names). No prompts, file paths,
    project names or code ever make it in. Run with --json to check.
`;

function parseArgs(argv) {
  const o = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) fail(`${a} needs a value`); return v; };
    if (a === '--year') o.year = parseInt(val(), 10);
    else if (a.startsWith('--year=')) o.year = parseInt(a.slice(7), 10);
    else if (a === '--all') o.all = true;
    else if (a === '--out' || a === '-o') o.out = val();
    else if (a === '--no-open') o.open = false;
    else if (a === '--json') o.json = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--dir') o.dir = val();
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else fail(`Unknown option: ${a} (try --help)`);
  }
  if (o.year != null && !(o.year > 2000 && o.year < 3000)) fail('--year should look like 2026');
  return o;
}

function fail(msg) { process.stderr.write(`\n  ${msg}\n\n`); process.exit(1); }

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const rgb = (r, g, b) => (s) => (color ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : s);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const lime = rgb(204, 255, 61), pink = rgb(255, 95, 162), mint = rgb(61, 245, 192), sun = rgb(255, 201, 61);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function banner() {
  const t = 'C L A U D E   W R A P P E D';
  console.log('');
  console.log('  ' + lime(bold(t)) + '  ' + pink(bold(String(new Date().getFullYear()).replace(/^20/, "'"))));
  console.log('  ' + dim('your year in Claude Code · 100% local'));
  console.log('');
}

// Default output: a fresh directory only you can read (0700), and a file created 0600 that refuses to
// follow a pre-existing path. A fixed name in the shared temp dir would be readable — and plantable — by other users.
function privateTempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudewrapped-'));
  return path.join(dir, name);
}
function writePage(file, html, isPrivate) {
  if (isPrivate) fs.writeFileSync(file, html, { mode: 0o600, flag: 'wx' });
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); }
}

function openFile(file) {
  const p = process.platform;
  // Arguments are passed as an array, never through a shell. On Windows explorer.exe opens the default
  // handler without cmd.exe parsing the path.
  const [cmd, args] = p === 'darwin' ? ['open', [file]] : p === 'win32' ? ['explorer.exe', [file]] : ['xdg-open', [file]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* we print the path anyway */ }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return void console.log(HELP);
  if (o.version) return void console.log(pkg.version);
  if (!o.json) banner();

  if (o.demo) {
    if (o.json) fail('--demo and --json together? The sample data lives in web/index.html.');
    const out = o.out ? path.resolve(o.out) : privateTempFile('claude-wrapped-demo.html');
    writePage(out, render(null), !o.out);
    console.log(`  Sample Wrapped → ${out}\n`);
    if (o.open) openFile(out);
    return;
  }

  let stats;
  {
    const roots = defaultRoots(o.dir);
    if (!roots.length) fail("Couldn't find any Claude Code history (looked in ~/.claude/projects and ~/.config/claude/projects).\n  Use Claude Code for a bit, then come back. Or try --demo.");
    const tty = process.stderr.isTTY && !o.json;
    const frames = ['🎁', '🎀', '✨', '🎉'];
    const started = Date.now();
    const onProgress = (done, total) => {
      if (!tty || (done % 25 && done !== total)) return;
      const f = frames[Math.floor(Date.now() / 250) % frames.length];
      process.stderr.write(`\r  ${f}  Unwrapping ${fmt(total)} transcripts… ${Math.round((done / total) * 100)}%   `);
    };
    const year = o.all ? null : o.year || new Date().getFullYear();
    stats = await analyze({ dir: o.dir, year, onProgress });
    if (!o.all && !o.year && stats.totals.prompts === 0) {
      stats = await analyze({ dir: o.dir, year: null, onProgress }); // nothing this year yet → all-time
    }
    if (tty) process.stderr.write(`\r  ✅  Unwrapped ${fmt(stats._meta.files)} transcripts in ${((Date.now() - started) / 1000).toFixed(1)}s.            \n\n`);
    if (stats.totals.prompts === 0) fail('No prompts found in your history yet. Try --all, or --demo to see what it looks like.');
  }
  delete stats._meta;

  if (o.json) return void process.stdout.write(JSON.stringify(stats, null, 2) + '\n');

  const out = o.out ? path.resolve(o.out) : privateTempFile(`claude-wrapped-${stats.year}.html`);
  writePage(out, render(stats), !o.out);

  const p = stats.personality;
  const topTool = stats.tools[0] ? stats.tools[0].name : '—';
  console.log(`  ${bold('Your ' + (stats.year === 'all' ? 'all-time' : stats.year) + ' is wrapped.')}`);
  console.log(`  ${lime(fmt(stats.totals.minutes))} minutes together · ${pink(fmt(stats.totals.prompts))} prompts · top tool: ${mint(topTool)}`);
  console.log(`  Personality: ${p.emoji}  ${sun(bold(p.name))}`);
  console.log('');
  console.log(`  ${dim('→')} ${out}`);
  console.log(`  ${dim('Nothing left your machine. Run with --json to see exactly what is in the page.')}`);
  console.log('');
  if (o.open) openFile(out);
}

main().catch((e) => fail(`Something went sideways: ${e && e.message ? e.message : e}`));
