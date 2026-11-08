// version.js — the app's version number. Change this (and package.json) when releasing a new version.
(function (root) {
  const APP_VERSION = '1.3.0';

  // Compares two versions like "1.2.0" and "1.10.1". Returns 1 if a is newer, -1 if older, 0 if equal.
  function compareVersions(a, b) {
    const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  const api = { APP_VERSION, compareVersions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AppVersion = api;
})(typeof window !== 'undefined' ? window : globalThis);
