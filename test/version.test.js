// Checks version numbers. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP_VERSION, compareVersions } = require('../src/version.js');

test('every place that stores the version agrees', () => {
  const root = path.join(__dirname, '..');
  const pkg = require('../package.json').version;
  const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version;
  const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)[1];
  assert.deepStrictEqual({ pkg, conf, cargo }, { pkg: APP_VERSION, conf: APP_VERSION, cargo: APP_VERSION });
});
test('compareVersions', () => {
  assert.strictEqual(compareVersions('1.2.0', '1.1.9'), 1);
  assert.strictEqual(compareVersions('v1.10.0', '1.9.0'), 1);
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
  assert.strictEqual(compareVersions('1.2.0', '1.2.1'), -1);
});
