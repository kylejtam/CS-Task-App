// update-script.js — builds the small Windows script that swaps in a downloaded update.
// The running app can't replace its own .exe, so this script waits for the app to close,
// moves the new file into place, and opens it again.
function buildSwapScript(target, downloaded) {
  const q = (p) => '"' + String(p).replace(/"/g, '') + '"';
  return [
    '@echo off',
    'set tries=0',
    ':retry',
    // wait about 1 second (ping is used because "timeout" doesn't work without a visible window)
    'ping -n 2 127.0.0.1 >nul',
    `move /y ${q(downloaded)} ${q(target)} >nul 2>&1`,
    'if errorlevel 1 (',
    '  set /a tries+=1',
    '  if %tries% lss 60 goto retry',
    '  exit /b 1',
    ')',
    `start "" ${q(target)}`,
    'del "%~f0"',
    '',
  ].join('\r\n');
}
module.exports = { buildSwapScript };
