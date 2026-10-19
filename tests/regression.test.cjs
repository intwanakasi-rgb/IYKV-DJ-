const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function harness(saved = {}) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, {
      value: '0', options: [], textContent: '', min: '0', max: '100', type: 'range',
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, dispatchEvent() {}, append() {}, appendChild() {}, setAttribute() {}, selectedOptions: [{ text: 'Test target' }],
    });
    return elements.get(key);
  };
  const context = vm.createContext({
    console, Map, Uint8Array, Event, setTimeout, clearTimeout,
    localStorage: { getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } },
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: tag => element('created:'+tag) },
    window: { addEventListener() {} }, navigator: {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    crypto: { randomUUID: () => 'new-track-id' },
  });
  vm.runInContext(appCode, context);
  return { context, element, run: (code) => vm.runInContext(code, context) };
}

test('corrupt or invalid MIDI storage cannot stop startup', () => {
  for (const value of ['broken JSON', 'null', '[]', '{"bad":{"role":"invalid"}}']) {
    assert.equal(harness({ iykMidiMappings: value }).run('Object.keys(state.midiMappings).length'), 0);
  }
});

test('MIDI channels produce distinct mappings', () => {
  const h = harness();
  assert.notEqual(h.run('midiMappingKey({data:[0x90,60,127]})'), h.run('midiMappingKey({data:[0x91,60,127]})'));
});

test('MIDI Learn ignores note releases and unsupported messages', () => {
  const h = harness();
  h.run('state.midiLearning = true');
  h.run('onMidiMessage({data:[0x80,60,64]}); onMidiMessage({data:[0x90,60,0]}); onMidiMessage({data:[0xc0,4]})');
  assert.equal(h.run('state.midiLearning'), true);
  assert.equal(h.run('Object.keys(state.midiMappings).length'), 0);
});

test('MIDI transport accepts a CC button press but not release', () => {
  const h = harness();
  h.run('globalThis.plays = 0; togglePlay = () => plays++; state.midiMappings["device:176:7"] = {action:"play-0"}');
  h.run('onMidiMessage({data:[0xb0,7,127]}); onMidiMessage({data:[0xb0,7,0]})');
  assert.equal(h.run('plays'), 1);
});

test('MIDI soft takeover waits for crossing and re-arms after mouse changes', () => {
  const h = harness();
  const slider = h.element('crossfader');
  slider.value = '50';
  h.run('state.midiMappings["device:176:7"] = {role:"crossfader"}');
  h.run('onMidiMessage({data:[0xb0,7,0]})');
  assert.equal(slider.value, '50');
  h.run('onMidiMessage({data:[0xb0,7,80]})');
  assert.ok(Number(slider.value) > 60);
  slider.value = '10';
  h.run('onMidiMessage({data:[0xb0,7,90]})');
  assert.equal(slider.value, '10');
});

test('first Auto Mix starts with a finite generation and pauses outgoing deck', async () => {
  const h = harness();
  h.run(`deckState.forEach(d => { d.objectUrl = 'blob:track'; d.audio = {currentTime:0, paused:true, pause(){this.paused=true;}}; });
    startDeckPlayback = async d => { d.isPlaying = true; return true; };
    globalThis.frames = []; requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
    globalThis.pausedDeck = null; pauseDeck = id => { pausedDeck = id; };`);
  await h.run('mixLoadedDecks()');
  assert.equal(h.run('state.autoMix'), true);
  assert.equal(h.run('state.autoMixRunId'), 1);
  h.run('frames[0](12000)');
  assert.equal(h.run('state.autoMix'), false);
  assert.equal(h.run('pausedDeck'), 0);
});

test('cancelled pending Auto Mix cannot start a fade afterwards', async () => {
  const h = harness();
  h.run(`deckState.forEach(d => { d.objectUrl = 'blob:track'; d.audio = {currentTime:0, paused:true, pause(){this.paused=true;}}; });
    globalThis.pending = [];
    startDeckPlayback = () => new Promise(resolve => pending.push(resolve));`);
  const start = h.run('mixLoadedDecks()');
  h.run('cancelAutoMix(); pending.forEach(resolve => resolve(true))');
  await start;
  assert.equal(h.run('state.autoMix'), false);
});

test('loading a new track gives cue persistence a library identity', async () => {
  const h = harness();
  h.run(`ensureContext = () => {}; buildDeckGraph = () => {};
    updateDeckAudioFromControls = () => {}; applyDeckEffects = () => {};
    renderPlaylist = () => {}; updateDeckView = () => {};
    saveTrackToLibrary = async () => {};
    deckState[0].audio = {load() {}};`);
  await h.run('loadTrackForDeck(0, {name:"test.wav", size:1, type:"audio/wav"})');
  assert.equal(h.run('deckState[0].libraryId'), h.run('state.library[0].id'));
  h.run('deckState[0].cuePoint = 12');
  await h.run('saveCue(deckState[0])');
  assert.equal(h.run('state.library[0].cuePoint'), 12);
});

test('track loading protects a playing deck', async () => {
  const h = harness();
  h.run('ensureContext = () => {}; deckState[0].isPlaying = true; deckState[0].fileName = "live track"');
  await h.run('loadTrackForDeck(0, {name:"replacement.wav"})');
  assert.equal(h.run('deckState[0].fileName'), 'live track');
});

test('sync rate stays consistent with pitch slider and saved settings', () => {
  const h = harness();
  h.element('syncTarget').value = '1';
  const slider = h.element('input[data-role="tempo"][data-deck="1"]');
  slider.value = '0';
  h.run(`deckState.forEach(d => { d.objectUrl = 'blob:track'; d.audio = {currentTime:0, paused:true, pause(){this.paused=true;}}; });
    deckState[0].bpm = 160; deckState[1].baseBpm = 100; deckState.forEach(d => d.bpmKnown = true);
    updateDeckAudioFromControls = () => {
      const pitch = Number(document.querySelector('input[data-role="tempo"][data-deck="1"]').value);
      state.settings.decks[1].tempo = pitch; deckState[1].bpm = 100 * (1 + pitch / 100);
    }; syncBpm();`);
  assert.equal(slider.value, '10');
  assert.equal(h.run('state.settings.decks[1].tempo'), 10);
  assert.ok(Math.abs(h.run('deckState[1].bpm') - 110) < 0.001);
});

test('echo wet path connects to deck output', () => {
  const h = harness();
  const nodes = [];
  const makeNode = () => {
    const node = { connections: [], connect(other) { this.connections.push(other); },
      gain: { value: 0 }, frequency: { value: 0 }, delayTime: { value: 0 }, frequencyBinCount: 512 };
    nodes.push(node); return node;
  };
  h.context.fakeContext = { createGain: makeNode, createBiquadFilter: makeNode,
    sampleRate:8000, createConvolver:makeNode, createWaveShaper:makeNode, createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}), createAnalyser: makeNode, createDelay: makeNode, createMediaElementSource: makeNode };
  h.run('ensureContext = () => {}; state.audioContext = fakeContext; deckState[0].audio = {}; buildDeckGraph(deckState[0])');
  for(const node of ['delayGain','reverbGain','distortionGain']) assert.equal(h.run(`deckState[0].effectNodes.${node}.connections.includes(deckState[0].analyser)`),true);
});

test('desktop installs permission handlers only after Electron ready', async () => {
  let ready = false, handler;
  const code = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const session = {};
  Object.defineProperty(session, 'defaultSession', { get() {
    assert.equal(ready, true, 'session used before app readiness');
    return { setPermissionRequestHandler(fn) { handler = fn; }, setPermissionCheckHandler() {} };
  } });
  class Window {
    constructor() { this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    loadFile() {}
  }
  vm.runInNewContext(code, { __dirname: path.join(__dirname, '../desktop'), process: {platform:'win32'},
    require(name) {
      if (name !== 'electron') return require(name);
      return { session, BrowserWindow: Window, shell: {}, app: {
        setName() {}, commandLine: { appendSwitch() {} }, on() {},
        whenReady() { return Promise.resolve().then(() => { ready = true; }); },
      } };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  let allowed;
  handler({ getURL: () => 'https://untrusted.example' }, 'midi', value => { allowed = value; });
  assert.equal(allowed, false);
  const {pathToFileURL}=require('node:url');
  const localUrl=pathToFileURL(path.join(__dirname,'../index.html')).href;
  for (const permission of ['midi','midiSysex']) {
    handler({getURL:()=>localUrl},permission,value=>{allowed=value;});assert.equal(allowed,true);
    handler({getURL:()=> 'https://untrusted.example'},permission,value=>{allowed=value;});assert.equal(allowed,false);
  }
});

test('loop source boundaries use original BPM when pitch is adjusted', () => {
  const h = harness();
  h.element('[data-role="loop-length"][data-deck="0"]').value = '4';
  h.run(`deckState[0].audio = {currentTime:10}; deckState[0].duration = 100;
    deckState[0].baseBpm = 120; deckState[0].bpm = 132; deckState[0].bpmKnown = true;
    saveLoop = () => {}; toggleLoop(0);`);
  assert.equal(h.run('deckState[0].loopEnd'), 12);
});

test('stored library BPM remains original after pitch adjustment', async () => {
  const h = harness();
  h.run(`ensureContext = () => {}; buildDeckGraph = () => {};
    updateDeckAudioFromControls = () => { deckState[0].bpm = 132; };
    applyDeckEffects = () => {}; renderPlaylist = () => {}; updateDeckView = () => {};
    saveTrackToLibrary = async () => {}; deckState[0].audio = {load() {}};`);
  await h.run('loadTrackForDeck(0, {name:"pitched.wav"}, {bpm:120})');
  assert.equal(h.run('state.library[0].bpm'), 120);
});

test('batch importing files leaves playback intact and stores every file', async () => {
  const h = harness();
  const handlers = {};
  h.element('fileInput').addEventListener = (name, fn) => { handlers[name] = fn; };
  h.run(`bindDeckInputs(); globalThis.savedCount = 0;
    saveTrackToLibrary = async () => { savedCount++; }; renderPlaylist = () => {};
    deckState[0].isPlaying = true; deckState[0].fileName = 'Live set';`);
  await handlers.change({target:{files:[{name:'one.wav'}, {name:'two.wav'}]}});
  assert.equal(h.run('savedCount'), 2);
  assert.equal(h.run('state.library.length'), 2);
  assert.equal(h.run('deckState[0].isPlaying'), true);
  assert.equal(h.run('deckState[0].fileName'), 'Live set');
});

test('recording finalisation blocks restart and frees chunks and stream', () => {
  const h = harness();
  h.context.Blob = Blob;
  h.context.setInterval = () => 1;
  h.context.clearInterval = () => {};
  const handlers = {};
  let stopped = false, disconnected = false, downloaded = false;
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    addEventListener(name, fn) { handlers[name] = fn; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  h.context.MediaRecorder = Recorder;
  h.context.window.MediaRecorder = Recorder;
  h.context.destination = {stream:{getTracks:() => [{stop() { stopped = true; }}]}};
  h.context.document.createElement = () => ({ click() { downloaded = true; } });
  h.context.master = {connect() {}, disconnect() { disconnected = true; }};
  h.element('recordBtn').querySelector = () => ({textContent:''});
  h.run('state.audioContext = {createMediaStreamDestination: () => destination}; state.masterGain = master; startRecording()');
  handlers.dataavailable({data:new Blob(['audio'])});
  h.run('toggleRecording(); toggleRecording()');
  assert.equal(h.run('state.recordingStopping'), true);
  handlers.stop();
  assert.equal(downloaded, true);
  assert.equal(disconnected, true);
  assert.equal(stopped, true);
  assert.equal(h.run('state.recordingStopping'), false);
  assert.equal(h.run('state.recordingChunks.length'), 0);
});

test('Auto Mix silences incoming A/B deck before starting playback and ignores C/D', async () => {
  const h = harness();
  h.element('crossfader').value = '50';
  h.run(`deckState.slice(0,2).forEach(d => {
    d.objectUrl = 'blob:track'; d.audio = {currentTime:0, paused:true, pause(){this.paused=true;}}; d.gainNode = {gain:{value:1}};
  });
  globalThis.started = [];
  startDeckPlayback = async d => {
    if (d.id === 1 && d.gainNode.gain.value !== 0) throw Error('Incoming deck audible before fade');
    started.push(d.id); d.isPlaying = true; return true;
  };`);
  await h.run('mixLoadedDecks()');
  assert.equal(h.run('state.autoMix'), true);
  assert.equal(h.run('started.join(",")'), '1');
  assert.equal(h.element('crossfader').value, '0');
});

test('extra decks have independent channel levels unaffected by crossfader', () => {
  const h = harness();
  assert.equal(h.run('deckState.length'), 4);
  assert.equal(h.run('state.settings.decks.length'), 4);
  h.run('deckState.forEach(d => d.gainNode = {gain:{value:0}})');
  h.element('input[data-role="volume"][data-deck="2"]').value = '75';
  h.element('crossfader').value = '0';
  h.run('applyCrossfader()');
  assert.ok(Math.abs(h.run('deckState[2].gainNode.gain.value') - 0.6) < 1e-9);
  h.element('crossfader').value = '100';
  h.run('applyCrossfader()');
  assert.ok(Math.abs(h.run('deckState[2].gainNode.gain.value') - 0.6) < 1e-9);
});

test('switching to two decks pauses C/D and removes their load targets', () => {
  const h = harness();
  h.element('midiTarget').options = [];
  h.run(`globalThis.paused = []; pauseDeck = id => paused.push(id); renderPlaylist = () => {};
    setDeckCount(4);`);
  assert.equal(h.run('state.deckCount'), 4);
  assert.equal(h.element('deckC').hidden, false);
  h.run('deckState[2].isPlaying = true; deckState[3].isPlaying = true; setDeckCount(2)');
  assert.equal(h.run('paused.join(",")'), '2,3');
  assert.equal(h.element('deckC').hidden, true);
});

test('PCM preparation detects 120 BPM clicks and real waveform peaks', () => {
  const h = harness();
  const result = h.run(`(() => {
    const rate=8000, pcm=new Float32Array(rate*20);
    for (let n=0;n<pcm.length;n++) pcm[n] = n % 4000 < 160 ? Math.sin(n*.5)*.8 : 0;
    return analysePcm(pcm,rate);
  })()`);
  assert.equal(result.waveform.length,4000);
  assert.ok(result.waveform.some(value => value > .7));
  assert.ok(Math.abs(result.bpm - 120) < 1);
  assert.equal(result.duration,20);
});

test('silent PCM never invents a BPM', () => {
  const h = harness();
  assert.equal(h.run('analysePcm(new Float32Array(8000),8000).bpm'),null);
});

test('CUE returns to saved cue without overwriting it while playing', () => {
  const h = harness();
  h.run(`deckState[0].objectUrl='blob:x'; deckState[0].cuePoint=4;
    deckState[0].audio={currentTime:9}; pauseDeck = () => {deckState[0].isPlaying=false;};
    updateDeckView=()=>{}; deckState[0].isPlaying=true; cueDeck(0);`);
  assert.equal(h.run('deckState[0].audio.currentTime'),4);
  assert.equal(h.run('deckState[0].cuePoint'),4);
});

test('CUE release before playback promise resolves cannot leave audio playing', async () => {
  const h = harness();
  h.run(`deckState[0].objectUrl='blob:x'; deckState[0].audio={currentTime:0};
    globalThis.finish = null; startDeckPlayback = () => new Promise(resolve => { finish=resolve; });
    globalThis.returned=0; cueDeck=()=>{returned++;};`);
  const press = h.run('cuePress(0)');
  h.run('cueRelease(0); finish(true)'); await press;
  assert.ok(h.run('returned') >= 1);
});

test('sync rejects unknown BPM instead of using the 120 fallback', () => {
  const h = harness(); h.element('syncTarget').value='1';
  h.run(`deckState[0].objectUrl='a'; deckState[1].objectUrl='b'; syncBpm();`);
  assert.match(h.element('statusPill').textContent,/Analyse both tracks/);
});

test('queued Automix preloads next track but leaves it stopped until near end', async () => {
  const h = harness();
  h.run(`state.queueEnabled=true; state.queue=["next"]; state.library=[{id:"next",file:{}}];
    state.queueActive=0; deckState[0].audio={duration:100,currentTime:10,playbackRate:1};
    deckState[1].audio={currentTime:0};
    pauseDeck=()=>{}; loadTrackForDeck=async()=>{}; waitForTrack=async()=>{};
    persistQueue=()=>{}; globalThis.mixed=false; mixLoadedDecks=async()=>{mixed=true;};`);
  await h.run('queueTick()');
  assert.equal(h.run('state.queueUpcoming'),1);
  assert.equal(h.run('mixed'),false);
  h.run('deckState[0].audio.currentTime=95'); await h.run('queueTick()');
  assert.equal(h.run('mixed'),true);
  assert.equal(h.run('state.transitionSeconds'),5);
});

test('looping track prevents automatic transition until Mix Now', async () => {
  const h = harness();
  h.run(`state.queueEnabled=true; state.queueUpcoming=1;
    deckState[0].audio={duration:100,currentTime:99,playbackRate:1}; deckState[0].loopEnd=100;
    globalThis.mixed=false; mixLoadedDecks=async()=>{mixed=true;};`);
  await h.run('queueTick()'); assert.equal(h.run('mixed'),false);
  await h.run('queueTick(true)'); assert.equal(h.run('mixed'),true);
});

test('cancelling queued preload prevents stale loading from scheduling a transition', async () => {
  const h = harness();
  h.run(`state.queueEnabled=true; state.queue=["next"]; state.library=[{id:"next",file:{}}];
    state.queueActive=0; deckState[0].audio={duration:100,currentTime:99,playbackRate:1};
    pauseDeck=()=>{}; globalThis.ready=null; loadTrackForDeck=()=>new Promise(resolve=>{ready=resolve;});
    waitForTrack=async()=>{}; globalThis.mixed=false; mixLoadedDecks=async()=>{mixed=true;};`);
  const tick = h.run('queueTick()');
  h.run('cancelAutoMix(); ready()'); await tick;
  assert.equal(h.run('state.queueUpcoming'),null);
  assert.equal(h.run('mixed'),false);
  assert.equal(h.run('state.queueBusy'),false);
});

test('PFL uses independent pre-fader gains and respects cue/master blend', () => {
  const h = harness();
  h.element('headphoneBlend').value='25'; h.element('headphoneVolume').value='60';
  h.run(`state.headphoneReady=true; state.headphoneBus={gain:{value:0}}; state.headphoneMaster={gain:{value:0}};
    deckState[0].pfl=true; deckState[0].cueGain={gain:{value:0}}; updateHeadphoneMix();`);
  assert.equal(h.run('deckState[0].cueGain.gain.value'),.75);
  assert.equal(h.run('state.headphoneMaster.gain.value'),.25);
  assert.equal(h.run('state.headphoneBus.gain.value'),.6);
});

test('MIDI CC CUE release ends preview, not just note-off', () => {
  const h = harness();
  h.run(`state.midiMappings['device:176:7']={action:'cue-0'};
    globalThis.releases=0; cueRelease=()=>{releases++;}; onMidiMessage({data:[176,7,0]});`);
  assert.equal(h.run('releases'),1);
});

test('cancel returns a preloaded unplayed track to the queue', () => {
  const h = harness();
  h.run(`state.queueEnabled=true; state.queueUpcoming=1; deckState[1].libraryId='reserved';
    state.queue=['later']; renderQueue=()=>{}; cancelAutoMix();`);
  assert.equal(h.run('state.queue.join(",")'),'reserved,later');
});

test('appearance defaults are vertical controls and stacked waves', () => {
  const h=harness();
  assert.equal(h.run('state.settings.appearance.mixerStyle'),'vertical');
  assert.equal(h.run('state.settings.appearance.waveformLayout'),'stacked');
});

test('appearance restoration validates choices and bounds without losing audio settings', () => {
  const h=harness();
  h.run(`restoreAppearance({mixerStyle:'knobs',waveformLayout:'decks',waveformHeight:500,interfaceSize:130,meterHold:3000,showJog:false});`);
  assert.equal(h.run('state.settings.appearance.mixerStyle'),'knobs');
  assert.equal(h.run('state.settings.appearance.waveformHeight'),120);
  assert.equal(h.run('state.settings.appearance.showJog'),false);
  h.run(`restoreAppearance({mixerStyle:'bad',waveformSeconds:99,interfaceSize:NaN});`);
  assert.equal(h.run('state.settings.appearance.mixerStyle'),'knobs');
  assert.equal(h.run('state.settings.appearance.waveformSeconds'),12);
  assert.equal(h.run('state.settings.masterVolume'),90);
});

test('peak and RMS meters calculate each channel independently', () => {
  const h=harness();
  const result=h.run(`({left:calculateMeter(new Float32Array([.8,-.8,0,0]),'peak'),right:calculateMeter(new Float32Array([.08,-.08,0,0]),'peak'),rms:calculateMeter(new Float32Array([.8,-.8,0,0]),'rms')})`);
  assert.ok(result.left.level>result.right.level*9);
  assert.ok(Math.abs(result.rms.level-Math.sqrt(.32))<.00001);
});


test('FLX2 factory mapping distinguishes decks, ignores 14-bit LSB and supports CD bank', () => {
 const h=harness();
 assert.equal(h.run('flx2Mapping(0x90,11).action'),'play-0');
 assert.equal(h.run('flx2Mapping(0x91,12,2).action'),'cue-3');
 assert.equal(h.run('flx2Mapping(0xb1,19).role'),'volume');
 assert.equal(h.run('flx2Mapping(0xb6,24,2).deck'),'3');
 assert.equal(h.run('flx2Mapping(0xb0,39)'),null);
 assert.equal(h.run('flx2Mapping(0xb6,31).role'),'crossfader');
});
test('FLX2 factory transport handles cue release and does not affect other devices', () => {
 const h=harness();
 h.run('globalThis.presses=[];globalThis.releases=[];cuePress=id=>presses.push(id);cueRelease=id=>releases.push(id);');
 h.run('onMidiMessage({currentTarget:{id:"flx",name:"DDJ-FLX2"},data:[0x91,12,127]});onMidiMessage({currentTarget:{id:"flx",name:"DDJ-FLX2"},data:[0x81,12,0]});');
 assert.equal(h.run('presses.join()'),'1');assert.equal(h.run('releases.join()'),'1');
 h.run('onMidiMessage({currentTarget:{id:"other",name:"Other"},data:[0x91,12,127]})');
 assert.equal(h.run('presses.length'),1);
});

test('explicit FLX2 profile works with generic port names and overrides stale learned mappings', () => {
 const h=harness();h.element('controllerProfile').value='flx2';
 h.run('globalThis.plays=[];togglePlay=id=>plays.push(id);state.midiMappings["usb:144:11"]={action:"play-1"};onMidiMessage({currentTarget:{id:"usb",name:"USB MIDI"},data:[0x90,11,127]});');
 assert.equal(h.run('plays.join()'),'0');
 assert.match(h.element('controllerStatus').textContent,/Receiving: USB MIDI/);
});
