#!/usr/bin/env node
'use strict';
// Builds the public demo site into docs/ (served by GitHub Pages from main:/docs).
// It is rendered from the same template as the CLI, with sample data only.
const fs = require('fs');
const path = require('path');
const { render } = require('../lib/render');

const out = path.join(__dirname, '..', 'docs');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), render(null, { hosted: true }));
fs.writeFileSync(path.join(out, '.nojekyll'), ''); // serve files as-is, no Jekyll processing
if (!fs.existsSync(path.join(out, 'og.png'))) console.warn('note: docs/og.png (link preview image) is missing');
console.log('built docs/index.html');
