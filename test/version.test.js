// Checks version numbers and the Windows update script. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { APP_VERSION, compareVersions } = require('../src/version.js');
const { buildSwapScript } = require('../update-script.js');

test('version.js matches package.json', () => {
  assert.strictEqual(APP_VERSION, require('../package.json').version);
});
test('compareVersions', () => {
  assert.strictEqual(compareVersions('1.2.0', '1.1.9'), 1);
  assert.strictEqual(compareVersions('v1.10.0', '1.9.0'), 1);
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
  assert.strictEqual(compareVersions('1.2.0', '1.2.1'), -1);
});
test('update script waits, swaps the file, and reopens the app', () => {
  const s = buildSwapScript('C:\\Users\\Kyle\\Desktop\\Task-Timer.exe', 'C:\\Users\\Kyle\\Desktop\\Task-Timer.exe.download');
  assert.match(s, /move \/y "C:\\Users\\Kyle\\Desktop\\Task-Timer\.exe\.download" "C:\\Users\\Kyle\\Desktop\\Task-Timer\.exe"/);
  assert.match(s, /start "" "C:\\Users\\Kyle\\Desktop\\Task-Timer\.exe"/);
  assert.match(s, /ping -n 2/);
  assert.ok(s.includes('\r\n'), 'uses Windows line endings');
});
