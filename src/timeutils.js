// timeutils.js — reading the times you type, and formatting countdowns.
(function (root) {
  const MIN = 60 * 1000;
  const pad2 = (n) => String(n).padStart(2, '0');

  // 24-hour clock time, HH:MM.
  function clock(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtSeconds(s) {
    if (s >= 3600) {
      // One hour or more: H:MM or HH:MM
      return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60));
    }
    // Under one hour: M:SS or MM:SS
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }

  // msLeft > 0 counts down; once overdue it shows the elapsed time as a negative number.
  function formatCountdown(msLeft) {
    if (msLeft > 0) return fmtSeconds(Math.ceil(msLeft / 1000));
    const s = Math.floor(-msLeft / 1000);
    return s === 0 ? '0:00' : '-' + fmtSeconds(s);
  }

  function atTime(base, h, m, dayOffset) {
    const d = new Date(base);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m, 0, 0).getTime();
  }

  // Reads what was typed. Returns { kind: 'none' } (blank), { kind: 'ok', due } or { kind: 'error' }.
  // mode 'next':    a clock time means its next occurrence (later today, or tomorrow if passed).
  // mode 'nearest': a clock time means the occurrence closest to opts.ref (used when editing).
  function parseTime(input, now, opts) {
    const mode = (opts && opts.mode) || 'next';
    const s = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return { kind: 'none' };
    let m;

    // Minutes from now: +45, +45m, +1:30, +2h
    if ((m = s.match(/^\+(\d{1,4})m?$/))) {
      const mins = +m[1];
      return mins > 0 ? { kind: 'ok', due: now + mins * MIN } : { kind: 'error' };
    }
    if ((m = s.match(/^\+(\d{1,3})[:.h](\d{1,2})$/))) {
      const mins = +m[1] * 60 + +m[2];
      return +m[2] < 60 && mins > 0 ? { kind: 'ok', due: now + mins * MIN } : { kind: 'error' };
    }
    if ((m = s.match(/^\+(\d{1,3})h$/))) {
      return +m[1] > 0 ? { kind: 'ok', due: now + +m[1] * 60 * MIN } : { kind: 'error' };
    }

    // Clock time: 14:30, 14.30, 1430, 930, 9
    let h, mi;
    if ((m = s.match(/^(\d{1,2})[:.h](\d{1,2})$/))) { h = +m[1]; mi = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})(\d{2})$/))) { h = +m[1]; mi = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})$/))) { h = +m[1]; mi = 0; }
    else return { kind: 'error' };
    if (h > 23 || mi > 59) return { kind: 'error' };

    if (mode === 'nearest' && opts && opts.ref != null) {
      let best = null;
      for (const off of [-1, 0, 1]) {
        const c = atTime(opts.ref, h, mi, off);
        if (best === null || Math.abs(c - opts.ref) < Math.abs(best - opts.ref)) best = c;
      }
      return { kind: 'ok', due: best };
    }
    let due = atTime(now, h, mi, 0);
    if (due <= now) due = atTime(now, h, mi, 1);
    return { kind: 'ok', due };
  }

  // "today", "tomorrow", "yesterday", or a short date.
  function dayLabel(ms, now) {
    const days = Math.round((atTime(ms, 0, 0, 0) - atTime(now, 0, 0, 0)) / (24 * 60 * MIN));
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  const api = { clock, formatCountdown, parseTime, dayLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimeUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
