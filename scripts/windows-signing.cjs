const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { build } = require('../package.json');

function createSignedConfig(env) {
  if (!(env.WIN_CSC_LINK || env.CSC_LINK) || !(env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD)) {
    throw new Error('Signed release requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or CSC_LINK and CSC_KEY_PASSWORD). Configure a trusted code-signing certificate in GitHub Actions secrets. No unsigned release will be published.');
  }
  const publisher = env.WINDOWS_SIGNING_PUBLISHER?.trim();
  return {
    ...build,
    forceCodeSigning: true,
    win: {
      ...build.win,
      signAndEditExecutable: true,
      signExecutable: true,
      signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
        ...(publisher ? { publisherName: publisher } : {}),
      },
    },
  };
}

function main() {
  try { createSignedConfig(process.env); }
  catch (error) { console.error(error.message); return 1; }
  if (process.argv.includes('--check')) { console.log('Signing credentials are configured; validity is checked during signing and verification.'); return 0; }
  if (process.platform !== 'win32') { console.error('Build and verify signed Windows installers on Windows.'); return 1; }
  const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');
  const result = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--publish', 'never', '--config', 'electron-builder.signed.cjs'], {
    cwd: path.join(__dirname, '..'), stdio: 'inherit', env: process.env,
  });
  return result.status ?? 1;
}
module.exports = { createSignedConfig };
if (require.main === module) process.exitCode = main();
