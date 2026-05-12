const { spawnSync } = require('child_process');

const skipBrowserInstall =
  String(process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD || '').toLowerCase() === 'true' ||
  String(process.env.PUPPETEER_SKIP_DOWNLOAD || '').toLowerCase() === 'true' ||
  String(process.env.PUPPETEER_SKIP_BROWSER_DOWNLOAD || '').toLowerCase() === 'true';

if (skipBrowserInstall) {
  console.log('[postinstall] Skipping Puppeteer browser install because a Puppeteer skip flag is set.');
  process.exit(0);
}

const result = spawnSync('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status || 0);
