const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {createSignedConfig} = require('../scripts/windows-signing.cjs');

test('signed release refuses missing or partial signing credentials', () => {
  for (const env of [{},{WIN_CSC_LINK:'test.pfx'},{WIN_CSC_KEY_PASSWORD:'test-password'}]) {
    assert.throws(() => createSignedConfig(env), /No unsigned release will be published/);
  }
});
test('signed profile signs executables and forces signing without embedding credentials', () => {
  const env = {WIN_CSC_LINK:'private-cert-reference', WIN_CSC_KEY_PASSWORD:'secret-password',WINDOWS_SIGNING_PUBLISHER:'Verified Publisher'};
  const config = createSignedConfig(env);
  assert.equal(config.forceCodeSigning,true);
  assert.equal(config.win.signAndEditExecutable,true);
  assert.equal(config.win.signExecutable,true);
  assert.equal(config.win.signtoolOptions.publisherName,'Verified Publisher');
  assert.ok(!JSON.stringify(config).includes(env.WIN_CSC_LINK));
  assert.ok(!JSON.stringify(config).includes(env.WIN_CSC_KEY_PASSWORD));
});
test('signing preflight fails before building and does not expose credential values', () => {
  const env = {...process.env};
  for (const key of ['CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD']) delete env[key];
  const result = spawnSync(process.execPath,[path.join(__dirname,'../scripts/windows-signing.cjs'),'--check'],{env,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Configure a trusted code-signing certificate/);
});
