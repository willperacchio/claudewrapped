'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE = path.join(__dirname, '..', 'web', 'index.html');
const MARKER = '/*__WRAPPED_DATA__*/null';
const LOOSE = "script-src 'unsafe-inline'";

// stats === null leaves the page on its built-in sample data (--demo).
function render(stats) {
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  if (!html.includes(MARKER) || !html.includes(LOOSE)) throw new Error('template marker missing');
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

module.exports = { render };
