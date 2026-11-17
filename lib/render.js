'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE = path.join(__dirname, '..', 'web', 'index.html');
const MARKER = '/*__WRAPPED_DATA__*/null';
const LOOSE = "script-src 'unsafe-inline'";

// The command we advertise, derived from package.json so the two can never drift apart.
// The package is scoped (@willperacchio/…): only that npm account can publish under the scope,
// so the command people copy can't be taken over by a lookalike package.
const CTA = 'npx ' + require('../package.json').name;
const SITE = 'https://willperacchio.github.io/claudewrapped/';

const OG = `<meta property="og:type" content="website">
<meta property="og:title" content="Claude Wrapped">
<meta property="og:description" content="Your year in Claude Code, Spotify Wrapped style. Runs 100% on your machine.">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${SITE}">`;

const swap = (html, marker, value) => {
  if (!html.includes(marker)) throw new Error('template marker missing: ' + marker);
  return html.replace(marker, () => value);
};

// stats === null leaves the page on its built-in sample data (--demo, and the public site).
// hosted: true adds link-preview tags and the anti-framing guard for the public demo.
function render(stats, { hosted = false } = {}) {
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  if (!html.includes(MARKER) || !html.includes(LOOSE)) throw new Error('template marker missing');
  if (hosted && stats != null) throw new Error('the hosted site must never contain real stats');
  html = swap(html, "/*__CTA__*/''", JSON.stringify(CTA));
  html = swap(html, '/*__HOSTED__*/false', hosted ? 'true' : 'false');
  html = swap(html, '<!--__HEAD_EXTRA__-->', hosted ? OG : '');
  if (stats != null) {
    // Escape "<" so no string can ever close the <script> tag.
    const json = JSON.stringify(stats).replace(/</g, '\\u003c');
    html = html.replace(MARKER, () => json);
  }
  // Lock the page to exactly the scripts we ship: the Content-Security-Policy lists their hashes,
  // so an injected or altered script will not run, and no request can leave the page.
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  if (hashes.length !== 2) throw new Error('unexpected script count in template');
  return html.replace(LOOSE, () => `script-src ${hashes.join(' ')}`);
}

module.exports = { render, CTA, SITE };
