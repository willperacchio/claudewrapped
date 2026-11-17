'use strict';
// Your "Claude personality" — the Wrapped-style archetype reveal.
// Each archetype scores a ratio against a threshold; ≥ 1 means "qualifies".

const ARCHETYPES = {
  night:     { name: 'The Night Shift',          emoji: '🌙', tagline: 'Your best ideas show up after midnight. So do your worst bugs.' },
  dawn:      { name: 'The Sunrise Shipper',      emoji: '🌅', tagline: 'Pushing to prod before the coffee finishes brewing.' },
  weekend:   { name: 'The Weekend Warrior',      emoji: '🛹', tagline: 'Saturday is just Friday with fewer meetings.' },
  polite:    { name: 'The Diplomat',             emoji: '🫖', tagline: "You say please to a computer. When the robots take over, you're on the good list." },
  rage:      { name: 'The Rage Debugger',        emoji: '🔥', tagline: '"still broken" is your love language.' },
  esc:       { name: 'The Esc Artist',           emoji: '⌨️', tagline: 'You know exactly what you want — the second Claude starts doing something else.' },
  rubber:    { name: 'The Rubber Stamp',         emoji: '✅', tagline: '"yes." "continue." "do it." A visionary of few words.' },
  novelist:  { name: 'The Novelist',             emoji: '📜', tagline: 'Your prompts have chapters. Some have footnotes.' },
  haiku:     { name: 'The Haiku Poet',           emoji: '🍃', tagline: 'Five words, maximum. Claude fills in the rest.' },
  bash:      { name: 'The Shell Shocker',        emoji: '⚡', tagline: 'Why use many tool when Bash do trick.' },
  delegator: { name: 'The Middle Manager',       emoji: '📋', tagline: 'You delegate to agents who delegate to agents.' },
  marathon:  { name: 'The Marathoner',           emoji: '🏅', tagline: 'Sessions so long they need a halftime show.' },
  parallel:  { name: 'The Octopus',              emoji: '🐙', tagline: 'Eight sessions. Two hands. Zero fear.' },
  visual:    { name: 'The Screenshot Sommelier', emoji: '📸', tagline: "A screenshot is worth a thousand prompts. You've sent a novel's worth." },
  surfer:    { name: 'The Web Surfer',           emoji: '🌊', tagline: 'Claude opened more tabs than a grad student the night before a deadline.' },
  vibe:      { name: 'The Vibe Coder',           emoji: '✨', tagline: 'You came. You prompted. You vibed.' },
};

const TRAIT_LABELS = {
  night: 'Night owl', dawn: 'Early riser', weekend: 'Weekend coder', polite: 'Polite', rage: 'Spicy',
  esc: 'Esc-happy', rubber: '"yes, continue"', novelist: 'Long-winded', haiku: 'Terse', bash: 'Bash-pilled',
  delegator: 'Delegator', marathon: 'Marathoner', parallel: 'Multitasker', visual: 'Screenshotter', surfer: 'Web surfer',
};

function pickPersonality(s) {
  const p = Math.max(1, s.totals.prompts);
  const toolTotal = Math.max(1, s.totals.toolCalls);
  const toolCount = (n) => (s.tools.find((t) => t.name === n) || { count: 0 }).count;
  const w = s.words;
  const scores = {
    night: s.time.nightShare / 0.3,
    dawn: s.time.dawnShare / 0.2,
    weekend: s.time.weekendShare / 0.35,
    polite: (w.please + w.thanks) / p / 0.25,
    rage: (w.wtf + w.spicy + w.still + w.broken) / p / 0.08,
    esc: s.totals.interruptions / p / 0.1,
    rubber: (w.continue + w.approve) / p / 0.25,
    novelist: w.avgPromptChars / 700,
    haiku: w.avgPromptChars > 0 ? 45 / w.avgPromptChars : 0,
    bash: toolCount('Bash') / toolTotal / 0.45,
    delegator: s.totals.subagents / Math.max(1, s.totals.sessions) / 3,
    marathon: s.time.longestSessionMin / 300,
    parallel: s.time.maxParallel / 5,
    visual: s.totals.images / p / 0.15,
    surfer: (toolCount('Browser') + toolCount('WebFetch') + toolCount('WebSearch')) / toolTotal / 0.25,
  };
  if (s.totals.prompts < 10) for (const k of Object.keys(scores)) scores[k] = 0;
  const ranked = Object.entries(scores).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const id = ranked.length && ranked[0][1] >= 1 ? ranked[0][0] : 'vibe';
  const traits = ranked.filter(([k, v]) => v >= 0.7 && k !== id).slice(0, 3).map(([k]) => TRAIT_LABELS[k]);
  return { id, ...ARCHETYPES[id], traits };
}

module.exports = { pickPersonality, ARCHETYPES, TRAIT_LABELS };
