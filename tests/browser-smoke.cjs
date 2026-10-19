// Uses generated PCM only; never uploads audio or needs an external service.
const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

function wav(seconds = 8, frequency = 220) {
  const rate = 16000, length = rate * seconds;
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(length * 2, 40);
  for (let n = 0; n < length; n++) {
    const time = n / rate;
    const envelope = (time % .5) < .04 ? .7 : .08;
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * envelope * 32767), 44 + n * 2);
  }
  return buffer;
}

(async () => {
  const errors = [];
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(request.url.split('?')[0]);
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.js', 'styles.css'].includes(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    let body = fs.readFileSync(path.join(root, file), 'utf8');
    // Instrument only this test server; production app exposes no test globals.
    if (file === 'app.js') body += '\nwindow.decklabTest = {state,deckState,prepareTrack,cuePress,cueRelease,queueTick};';
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,
      executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,
      args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--autoplay-policy=no-user-gesture-required']});
    const page = await browser.newPage({viewport:{width:1600,height:1000}});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => Boolean(window.decklabTest?.state.database));
    assert.equal(await page.locator('.deck:visible').count(), 2);
    await page.selectOption('#deckCount', '4');
    assert.equal(await page.locator('.channel-strip:visible').count(), 4);
    await page.selectOption('#deckCount', '2');
    await page.setInputFiles('#fileInput', [0,1,2].map(n => ({name:`Test ${n+1}.wav`,mimeType:'audio/wav',buffer:wav(8,220+n*110)})));
    await page.waitForFunction(() => window.decklabTest.state.library.length === 3);
    await page.locator('.track-row').filter({hasText:'Test 1'}).getByRole('button',{name:'A',exact:true}).click();
    await page.waitForFunction(() => window.decklabTest.deckState[0].duration > 0);
    await page.locator('[data-action="prepare"][data-deck="0"]').click();
    await page.waitForFunction(() => Boolean(window.decklabTest.deckState[0].waveform?.length), null, {timeout:30000});
    assert.ok(await page.evaluate(() => window.decklabTest.deckState[0].bpmKnown));
    await page.locator('[data-role="bpm"][data-deck="0"]').fill('120');
    await page.locator('[data-role="bpm"][data-deck="0"]').dispatchEvent('change');
    await page.evaluate(() => { window.decklabTest.deckState[0].audio.currentTime = 1; });
    await page.locator('[data-action="set-cue"][data-deck="0"]').click();
    await page.locator('[data-action="hotcue"][data-deck="0"][data-pad="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="hotcue"][data-deck="0"][data-pad="0"]').classList.contains('is-set'));
    await page.locator('[data-action="play"][data-deck="0"]').click();
    await page.waitForFunction(() => window.decklabTest.deckState[0].isPlaying);
    await page.waitForFunction(() => {
      const data = new Float32Array(256); window.decklabTest.state.masterAnalyser.getFloatTimeDomainData(data);
      return data.some(value => Math.abs(value) > .005);
    });
    await page.locator('[data-action="pause"][data-deck="0"]').click();
    // Press-and-release actually previews and returns, without replacing cue.
    const cue = page.locator('[data-action="cue"][data-deck="0"]');
    const cueBox = await cue.boundingBox(); await page.mouse.move(cueBox.x + cueBox.width/2,cueBox.y + cueBox.height/2); await page.mouse.down();
    await page.waitForFunction(() => window.decklabTest.deckState[0].isPlaying);
    await page.mouse.up();
    await page.waitForFunction(() => !window.decklabTest.deckState[0].isPlaying);
    assert.ok(Math.abs(await page.evaluate(() => window.decklabTest.deckState[0].audio.currentTime) - 1) < .2);
    await page.getByRole('button',{name:'Stop all'}).click();
    // Analyse is persistent, favourites are functional, reload never resumes audio.
    await page.locator('.track-row').filter({hasText:'Test 1'}).getByRole('button',{name:'Favourite Test 1',exact:true}).click();
    await page.getByRole('button',{name:'FAVOURITES',exact:true}).click();
    assert.equal(await page.locator('.track-row').count(),1);
    await page.getByRole('button',{name:'ALL TRACKS',exact:true}).click();
    await page.locator('#crateName').fill('Amapiano');
    await page.locator('#createCrateBtn').click();
    await page.locator('.track-row').filter({hasText:'Test 1'}).getByRole('button',{name:'+ CRATE',exact:true}).click();
    await page.locator('#crateList').getByRole('button',{name:'Amapiano (1)',exact:true}).click();
    assert.equal(await page.locator('.track-row').count(),1);
    await page.getByRole('button',{name:'ALL TRACKS',exact:true}).click();
    for (const name of ['Test 2','Test 3']) await page.locator('.track-row').filter({hasText:name}).getByRole('button',{name:'+ QUEUE',exact:true}).click();
    await page.locator('#settingsBtn').click();
    await page.locator('#autoMixDuration').focus();
    await page.keyboard.press('Home');
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await page.locator('#startQueueBtn').click();
    await page.waitForFunction(() => window.decklabTest.state.queueUpcoming !== null);
    assert.equal(await page.evaluate(() => window.decklabTest.deckState[1].isPlaying), false, 'incoming must stay paused before transition');
    // Remaining time is 8 sec: it must not start the second song immediately.
    assert.equal(await page.evaluate(() => window.decklabTest.state.autoMix), false);
    await page.waitForFunction(() => window.decklabTest.state.queueActive === 1, null, {timeout:15000});
    await page.waitForFunction(() => window.decklabTest.state.queueActive === 0 && window.decklabTest.deckState[0].fileName === 'Test 3', null, {timeout:15000});
    await page.waitForFunction(() => !window.decklabTest.state.queueEnabled, null, {timeout:15000});
    assert.equal(await page.evaluate(() => window.decklabTest.deckState.slice(0,2).some(deck => deck.isPlaying)),false);
    await page.reload();
    await page.waitForFunction(() => window.decklabTest.state.library.length === 3);
    assert.equal(await page.evaluate(() => window.decklabTest.state.library.find(track => track.name === 'Test 1').hotCues[0]), 1);
    assert.equal(await page.evaluate(() => window.decklabTest.deckState.some(deck => deck.isPlaying)),false);
    await page.setViewportSize({width:640,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true,'mobile layout overflows');
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: 2/4 decks, real audio output, worker waveform/BPM, hot cues, cue preview, favourites/crates, three-track queued Automix, persistence and responsive layout.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
