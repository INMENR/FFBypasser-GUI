const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'FFBypasser.user.js');

test('userscript exposes stable Pages update metadata', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const url = 'https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js';
  assert.match(source, /^\/\/ @version\s+1\.0\.1$/m);
  assert.match(source, new RegExp(`^// @updateURL\\s+${url.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(source, new RegExp(`^// @downloadURL\\s+${url.replaceAll('.', '\\.')}$`, 'm'));
});
