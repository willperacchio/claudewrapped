'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', 'web', 'index.html');
const MARKER = '/*__WRAPPED_DATA__*/null';

// stats === null leaves the page on its built-in sample data (--demo).
function render(stats) {
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  if (!html.includes(MARKER)) throw new Error('template marker missing');
  if (stats == null) return html;
  // Escape "<" so no string can ever close the <script> tag.
  const json = JSON.stringify(stats).replace(/</g, '\\u003c');
  return html.replace(MARKER, () => json);
}

module.exports = { render };
