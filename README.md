# 🎁 Claude Wrapped

**Your year in Claude Code, Spotify Wrapped style.**

```bash
npx claudewrapped
```

That's it. In about 10 seconds you get a story-mode recap of your year with Claude Code, plus a share card for your timeline.

> 🔒 **100% local.** It reads your transcripts on your machine and writes one HTML file. No servers, no uploads, no analytics. The page makes zero network requests.

## What's inside

- **Minutes together.** How long you and Claude actually spent working (overlapping sessions aren't double-counted).
- **Peak hour.** A 24-hour radial clock of when you prompt. Night owl? Sunrise shipper?
- **Your Top Tools.** Bash, Read, Edit… *"You're in the top 100% of Bash users."*
- **Your top genre.** Your most-edited language, with an honorable mention if Markdown beat it (it usually does).
- **The terminal.** Your most-run commands, plus the `rm -rf` and `git push --force` counters.
- **Lines of code.** What Claude wrote for you, measured against the Linux kernel.
- **Token economics.** A receipt for your year: tokens read and written, in Moby-Dicks, and the total at API prices.
- **Claude's catchphrase.** How many times Claude said *"You're absolutely right!"* (or, on newer models, how many em dashes it used instead).
- **The vibe check.** Your please and thank-you count vs. your wtf count. Are you on the good list?
- **Greatest hits.** Your most-said word, Esc presses, "continue"s, and your longest prompt.
- **Showing up.** A heatmap calendar, your longest streak, and your busiest day.
- **Your Claude personality.** One of 16 archetypes, each with its own drawn mark and colors: The Night Shift, The Rubber Stamp, The Esc Artist, The Octopus…
- **A share card.** A 1080×1350 poster made for X, Instagram and LinkedIn, in six colorways. Save it, copy it, or open a prefilled post.

## Privacy, specifically

Claude Wrapped is built so that **your data can't leak into the page, even by accident**:

- Prompts are only scanned with fixed patterns (`please`, `wtf`, `continue`…). Only the **counts** are kept.
- File paths become a **language name** (`.ts` → TypeScript). The path itself is thrown away.
- Shell commands become a **verb from an allowlist** (`git`, `npm`, `grep`…). Arguments, script names and anything unknown are dropped.
- Project names, session IDs, MCP server names and custom slash commands are **never** output. They're bucketed or counted instead.
- Every string on the page comes from a fixed vocabulary in [`lib/catalog.js`](lib/catalog.js). Everything else is a number or a date.

Don't trust us? Look at exactly what goes into the page:

```bash
npx claudewrapped --json
```

## Options

```
--year <yyyy>   Which year to wrap (default: this year)
--all           Use all local history
--out <file>    Where to write the HTML (default: your temp dir)
--no-open       Don't open the browser
--json          Print the exact data that goes into the page
--demo          See it with sample data
--dir <path>    Custom transcripts directory
```

## FAQ

**Why does my Wrapped only cover the last month?**
Claude Code deletes transcripts older than 30 days by default. To keep a whole year for next December, add this to `~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 365 }
```

**Is the $ number what I paid?**
No. It's an estimate of what your token usage would cost at public API rates. On a subscription plan your bill is different (and that's sort of the joke). You can hide it on the share card.

**Where does it read from?**
`~/.claude/projects` and `~/.config/claude/projects`, or `$CLAUDE_CONFIG_DIR/projects`. Subagent transcripts count toward tools and tokens, but not toward your prompts.

**Requirements?**
Node 18+. No dependencies.

---

Unofficial fan project. Not affiliated with or endorsed by Anthropic or Spotify. Made with Claude Code, obviously.
