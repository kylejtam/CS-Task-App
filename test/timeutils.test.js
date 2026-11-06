// Checks that times are read and shown correctly. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { formatCountdown, parseTime, clock } = require('../src/timeutils.js');

const S = 1000, M = 60 * S, H = 60 * M;
const at = (h, m) => new Date(2026, 10, 6, h, m, 0, 0).getTime();

test('countdown: one hour or more shows H:MM', () => {
  assert.strictEqual(formatCountdown(H), '1:00');
  assert.strictEqual(formatCountdown(2 * H + 5 * M), '2:05');
  assert.strictEqual(formatCountdown(12 * H + 30 * M), '12:30');
});
test('countdown: under an hour shows M:SS / MM:SS', () => {
  assert.strictEqual(formatCountdown(H - S), '59:59');
  assert.strictEqual(formatCountdown(5 * M), '5:00');
  assert.strictEqual(formatCountdown(9 * S), '0:09');
});
test('countdown: overdue shows negative elapsed time', () => {
  assert.strictEqual(formatCountdown(0), '0:00');
  assert.strictEqual(formatCountdown(-12 * M), '-12:00');
  assert.strictEqual(formatCountdown(-(H + 5 * M)), '-1:05');
});
test('clock is 24-hour HH:MM', () => {
  assert.strictEqual(clock(at(6, 5)), '06:05');
  assert.strictEqual(clock(at(23, 59)), '23:59');
});
test('parse: blank means no time limit', () => {
  assert.deepStrictEqual(parseTime('  ', at(10, 0)), { kind: 'none' });
});
test('parse: clock times later today, or tomorrow if passed', () => {
  const now = at(10, 0);
  for (const s of ['14:30', '1430', '14.30']) assert.strictEqual(parseTime(s, now).due, at(14, 30));
  assert.strictEqual(parseTime('930', now).due, at(9, 30) + 24 * H);
  assert.strictEqual(parseTime('9', now).due, at(9, 0) + 24 * H);
  assert.strictEqual(parseTime('10:00', now).due, at(10, 0) + 24 * H);
});
test('parse: minutes from now', () => {
  const now = at(10, 0);
  assert.strictEqual(parseTime('+45', now).due, at(10, 45));
  assert.strictEqual(parseTime('+1:30', now).due, at(11, 30));
  assert.strictEqual(parseTime('+2h', now).due, at(12, 0));
});
test('parse: rejects nonsense', () => {
  for (const s of ['45', '25:00', '12:75', 'abc', '+0']) assert.strictEqual(parseTime(s, at(10, 0)).kind, 'error', s);
});
test('parse (editing): picks the occurrence nearest the old due time', () => {
  const ref = at(23, 30);
  assert.strictEqual(parseTime('00:15', at(12, 0), { mode: 'nearest', ref }).due, at(0, 15) + 24 * H);
  assert.strictEqual(parseTime('13:00', at(15, 0), { mode: 'nearest', ref: at(14, 0) }).due, at(13, 0));
});
