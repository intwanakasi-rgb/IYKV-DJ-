const appearanceDefaults = Object.freeze({
  mixerStyle:'vertical', waveformLayout:'stacked', waveformHeight:60, waveformSeconds:12,
  interfaceDensity:'comfortable', interfaceTheme:'dark', interfaceSize:100,
  defaultPerformanceTab:'hotcues', meterMode:'peak', meterHold:1000,
  showJog:true, showOverview:true, showBottomMeters:true, reduceMotion:false,
});

function readMidiMappings() {
  try {
    const saved = JSON.parse(localStorage.getItem('iykMidiMappings') || '{}');
    if (!saved || Array.isArray(saved) || typeof saved !== 'object') return {};
    return Object.fromEntries(Object.entries(saved).filter(([, mapping]) => {
      if (!mapping || typeof mapping !== 'object') return false;
      if (mapping.action) return /^(play|cue)-[0-3]$/.test(mapping.action);
      return mapping.role === 'crossfader' ||
        (['volume', 'trim', 'filter', 'low', 'mid', 'high', 'tempo', 'effect-amount'].includes(mapping.role) &&
          ['0', '1', '2', '3'].includes(String(mapping.deck)));
    }));
  } catch {
    return {};
  }
}

function saveMidiMappings() {
  try {
    localStorage.setItem('iykMidiMappings', JSON.stringify(state.midiMappings));
    return true;
  } catch {
    setStatus('Controller mapping works for this session; browser storage could not save it');
    return false;
  }
}

const deckState = [
  {
    id: 0,
    audio: null,
    source: null,
    gainNode: null,
    low: null,
    mid: null,
    high: null,
    analyser: null,
    effectNodes: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    waveform: null,
    fileName: 'No track loaded',
    bpm: 120,
    baseBpm: 120,
    lastSeek: 0,
    pausedAt: 0,
    startedAt: 0,
    autoMix: false,
    cuePoint: 0,
    loopStart: null,
    loopEnd: null,
    frequencyBuffer: null,
  },
  {
    id: 1,
    audio: null,
    source: null,
    gainNode: null,
    low: null,
    mid: null,
    high: null,
    analyser: null,
    effectNodes: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    waveform: null,
    fileName: 'No track loaded',
    bpm: 120,
    baseBpm: 120,
    lastSeek: 0,
    pausedAt: 0,
    startedAt: 0,
    autoMix: false,
    cuePoint: 0,
    loopStart: null,
    loopEnd: null,
    frequencyBuffer: null,
  },
];

// Extra decks use independent channel levels; the crossfader controls A/B.
for (const id of [2, 3]) deckState.push({ ...deckState[0], id });
const deckLetter = (id) => 'ABCD'[id];

const state = {
  audioContext: null,
  masterGain: null,
  crossfader: 50,
  autoMix: false,
  autoMixStarting: false,
  autoMixRunId: 0,
  midiPickup: new Map(),
  deckCount: 2,
  crates: [], activeCrate: null,
  queue: [], queueEnabled: false, queueEpoch: 0, queueBusy: false,
  queueActive: 0, queueUpcoming: null, favouritesOnly: false,
  prepareChain: Promise.resolve(), headphoneReady: false,
  library: [],
  selectedDeck: null,
  database: null,
  recorder: null,
  recordingChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null,
  recordingStopping: false,
  autoMixFrame: null,
  midiAccess: null,
  masterAnalyser: null,
  masterFrequencyBuffer: null,
  midiMappings: readMidiMappings(),
  midiLearning: false,
  settings: {
    appearance: {...appearanceDefaults},
    masterVolume: 90,
    autoMixDuration: 12,
    crossfaderCurve: 'equal-power',
    decks: [
      { volume: 80, low: 0, mid: 0, high: 0, tempo: 0, effect: 'off', effectAmount: 50 },
      { volume: 80, low: 0, mid: 0, high: 0, tempo: 0, effect: 'off', effectAmount: 50 },
    ],
  },
};

for (const id of [2, 3]) state.settings.decks.push({ ...state.settings.decks[0] });
for (const settings of state.settings.decks) Object.assign(settings, { trim: 0, filter: 0 });

function setDeckCount(count) {
  state.deckCount = Number(count) === 4 ? 4 : 2;
  document.querySelector('.workspace')?.classList.toggle('four-decks', state.deckCount === 4);
  if (state.deckCount === 2) {
    for (const id of [2, 3]) { endScratch(getDeckById(id),false); if (getDeckById(id).isPlaying) pauseDeck(id); getDeckById(id).pfl = false; }
    updateHeadphoneMix();
    if (Number(midiTarget.value.slice(-1)) >= 2) midiTarget.value = 'play-0';
    if (state.selectedDeck >= 2) state.selectedDeck = null;
  }
  for (const id of [2, 3]) {
    document.getElementById(`deck${deckLetter(id)}`).hidden = state.deckCount === 2;
    document.getElementById(`channel${deckLetter(id)}`).hidden = state.deckCount === 2;
    document.getElementById(`waveLane${deckLetter(id)}`).hidden = state.deckCount === 2;
  }
  for (const option of midiTarget.options) {
    const hidden = Number(option.value.slice(-1)) >= state.deckCount;
    option.disabled = hidden;
    option.hidden = hidden;
  }
  try { localStorage.setItem('iykDeckCount', String(state.deckCount)); } catch {}
  for (const id of ['syncMaster', 'syncTarget']) {
    const select = document.getElementById(id);
    if (Number(select.value) >= state.deckCount) select.value = id === 'syncMaster' ? '0' : '1';
    for (const option of select.options) option.disabled = Number(option.value) >= state.deckCount;
  }
  renderPlaylist();
}

const statusPill = document.getElementById('statusPill');
const playlistEl = document.getElementById('playlist');
const crossfaderInput = document.getElementById('crossfader');
const syncBpmBtn = document.getElementById('syncBpmBtn');
const toggleAutoMixBtn = document.getElementById('toggleAutoMixBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const fileInput = document.getElementById('fileInput');
const hiddenFileInput = document.getElementById('hiddenFileInput');
const recordBtn = document.getElementById('recordBtn');
const recordTime = document.getElementById('recordTime');
const midiLearnBtn = document.getElementById('midiLearnBtn');
const midiTarget = document.getElementById('midiTarget');
const audioStatus = document.getElementById('audioStatus');
const settingsDialog = document.getElementById('settingsDialog');

function openLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('iyk-decklab-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveTrackToLibrary(track) {
  return new Promise((resolve, reject) => {
    const transaction = state.database.transaction('tracks', 'readwrite');
    transaction.objectStore('tracks').put(track);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function readLibrary() {
  return new Promise((resolve, reject) => {
    const request = state.database.transaction('tracks').objectStore('tracks').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function formatTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function getDeckById(deckId) {
  return deckState[deckId];
}

function ensureContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.9;
    state.masterAnalyser = state.audioContext.createAnalyser();
    state.masterAnalyser.fftSize = 256;
    state.masterFrequencyBuffer = new Uint8Array(state.masterAnalyser.fftSize);
    if (state.audioContext.createDynamicsCompressor) {
      state.limiter = state.audioContext.createDynamicsCompressor();
      state.limiter.threshold.value = -1;
      state.limiter.knee.value = 0;
      state.limiter.ratio.value = 20;
      state.limiter.attack.value = 0.003;
      state.limiter.release.value = 0.08;
      state.masterGain.connect(state.limiter);
      state.limiter.connect(state.masterAnalyser);
    } else state.masterGain.connect(state.masterAnalyser);
    state.masterAnalyser.connect(state.audioContext.destination);
    state.masterStereo = createStereoTap(state.audioContext, state.masterAnalyser);
  }
  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }
}

function buildDeckGraph(deck) {
  ensureContext();

  if (!deck.audio) {
    createAudioElementForDeck(deck);
  }

  if (deck.source) {
    return;
  }

  const gainNode = state.audioContext.createGain();
  const low = state.audioContext.createBiquadFilter();
  const mid = state.audioContext.createBiquadFilter();
  const high = state.audioContext.createBiquadFilter();
  const analyser = state.audioContext.createAnalyser();
  const dryGain = state.audioContext.createGain();
  const filter = state.audioContext.createBiquadFilter();
  const filterGain = state.audioContext.createGain();
  const delay = state.audioContext.createDelay(1);
  const delayFeedback = state.audioContext.createGain();
  const delayGain = state.audioContext.createGain();
  const reverb = state.audioContext.createConvolver();
  const reverbGain = state.audioContext.createGain();
  const distortion = state.audioContext.createWaveShaper();
  const distortionGain = state.audioContext.createGain();
  const impulse = state.audioContext.createBuffer(2, state.audioContext.sampleRate * 1.8, state.audioContext.sampleRate);
  for (let c=0;c<2;c++) { const pcm=impulse.getChannelData(c); for(let n=0;n<pcm.length;n++) pcm[n]=(Math.random()*2-1)*Math.pow(1-n/pcm.length,3); }
  reverb.buffer=impulse; reverbGain.gain.value=0; distortionGain.gain.value=0;
  distortion.oversample='2x';

  low.type = 'lowshelf';
  low.frequency.value = 250;
  low.gain.value = 0;

  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.gain.value = 0;

  high.type = 'highshelf';
  high.frequency.value = 4000;
  high.gain.value = 0;

  gainNode.gain.value = 0.8;
  analyser.fftSize = 1024;
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  delay.delayTime.value = 0.28;
  delayFeedback.gain.value = 0.35;
  dryGain.gain.value = 1;
  filterGain.gain.value = 0;
  delayGain.gain.value = 0;

  deck.source = state.audioContext.createMediaElementSource(deck.audio);
  deck.source.connect(low);
  low.connect(mid);
  mid.connect(high);
  const trimNode = state.audioContext.createGain();
  const toneFilter = state.audioContext.createBiquadFilter();
  toneFilter.type = 'lowpass'; toneFilter.frequency.value = 20000;
  const preAnalyser = state.audioContext.createAnalyser();
  preAnalyser.fftSize = 256;
  high.connect(trimNode); trimNode.connect(toneFilter); toneFilter.connect(preAnalyser);
  preAnalyser.connect(gainNode);
  deck.trimNode = trimNode; deck.toneFilter = toneFilter; deck.preAnalyser = preAnalyser;
  deck.peakSamples = new Float32Array(preAnalyser.fftSize);
  gainNode.connect(dryGain);
  dryGain.connect(analyser);
  gainNode.connect(filter);
  filter.connect(filterGain);
  filterGain.connect(analyser);
  gainNode.connect(delay);
  delay.connect(delayGain);
  delayGain.connect(analyser);
  delay.connect(delayFeedback);
  delayFeedback.connect(delay);
  gainNode.connect(reverb); reverb.connect(reverbGain); reverbGain.connect(analyser);
  gainNode.connect(distortion); distortion.connect(distortionGain); distortionGain.connect(analyser);
  analyser.connect(state.masterGain);
  deck.stereoMeter = createStereoTap(state.audioContext, analyser);

  deck.gainNode = gainNode;
  deck.low = low;
  deck.mid = mid;
  deck.high = high;
  deck.analyser = analyser;
  deck.effectNodes = { dryGain, filter, filterGain, delay, delayFeedback, delayGain, reverbGain, distortion, distortionGain };
  deck.frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
}

function createAudioElementForDeck(deck) {
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  audio.volume = 1;
  deck.audio = audio;

  audio.addEventListener('loadedmetadata', () => {
    deck.duration = audio.duration || 0;
    updateDeckAudioFromControls(deck.id);
    updateDeckView(deck);
  });

  audio.addEventListener('timeupdate', () => {
    deck.currentTime = audio.currentTime || 0;
    if (deck.loopEnd !== null && audio.currentTime >= deck.loopEnd) {
      audio.currentTime = deck.loopStart + (audio.currentTime - deck.loopEnd) % (deck.loopEnd - deck.loopStart);
    }
    const seek = document.querySelector(`input[data-role="seek"][data-deck="${deck.id}"]`);
    if (seek && deck.duration) seek.value = String(Math.round((audio.currentTime / deck.duration) * 1000));
    updateDeckView(deck);
  });

  audio.addEventListener('ended', () => {
    deck.isPlaying = false;
    const playButton = document.querySelector(`[data-action="play"][data-deck="${deck.id}"]`);
    if (playButton) playButton.textContent = '▶';
    statusPill.textContent = 'Playback ended';
  });

  audio.addEventListener('error', () => setStatus(`Could not decode ${deck.fileName}. Try another audio format.`));
}

function updateDeckView(deck) {
  const trackTitle = document.getElementById(`trackName${deckLetter(deck.id)}`);
  const timeEl = document.getElementById(`time${deckLetter(deck.id)}`);
  const durationEl = document.getElementById(`duration${deckLetter(deck.id)}`);
  const bpmEl = document.getElementById(`bpm${deckLetter(deck.id)}`);
  const suffix = deckLetter(deck.id);

  if (trackTitle) {
    trackTitle.textContent = deck.fileName;
  }

  if (timeEl) {
    timeEl.textContent = formatTime(deck.currentTime);
  }

  if (durationEl) {
    durationEl.textContent = `−${formatTime(deck.duration - deck.currentTime)}`;
  }

  if (bpmEl) {
    bpmEl.textContent = deck.bpmKnown ? `${deck.bpmEstimated ? '≈ ' : ''}${deck.bpm.toFixed(1)} BPM` : (state.library.find(item => item.id === deck.libraryId)?.preparing ? 'Analysing…' : '— BPM');
  }

  const looping = deck.loopEnd !== null && deck.loopEnd > deck.loopStart;
  const loopButton = document.querySelector(`[data-action="loop"][data-deck="${deck.id}"]`);
  if (loopButton) { loopButton.setAttribute('aria-pressed', String(looping)); loopButton.textContent = looping ? 'LOOP ON' : 'LOOP'; }
  const loopLabel = document.getElementById(`loopState${suffix}`);
  if (loopLabel) { loopLabel.classList.toggle('loop-active', looping); if (looping) loopLabel.textContent = `LOOP · ${Math.round((deck.loopEnd-deck.loopStart)*deck.baseBpm/60)} BEATS`; }
  drawVisualizer(deck);
}

function drawVisualizer(deck) {
  if (deck.audio) {
    if (deck.loopEnd !== null && deck.loopEnd > deck.loopStart && deck.audio.currentTime >= deck.loopEnd) {
      deck.audio.currentTime = deck.loopStart + (deck.audio.currentTime - deck.loopEnd) % (deck.loopEnd - deck.loopStart);
    }
    deck.currentTime = deck.audio.currentTime || 0;
  }
  for (const detail of [false, true]) {
    const canvas = document.getElementById(`${detail ? 'detail' : 'visual'}${deckLetter(deck.id)}`);
    if (!canvas || !canvas.getContext) continue;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.fillStyle = '#0e1018'; ctx.fillRect(0, 0, width, height);
    const duration = deck.duration || 1;
    const span = detail ? state.settings.appearance.waveformSeconds * (deck.audio?.playbackRate || 1) : duration;
    const start = detail ? deck.currentTime - span * 0.3 : 0;
    const toX = time => (time - start) / span * width;
    if (deck.loopEnd !== null && deck.loopEnd > deck.loopStart) {
      ctx.fillStyle = '#35cf8733';
      ctx.fillRect(toX(deck.loopStart),0,toX(deck.loopEnd)-toX(deck.loopStart),height);
    }
    const peaks = deck.waveform;
    if (peaks?.length) {
      ctx.fillStyle = ['#a27aee', '#5aabed', '#55d7ac', '#f0b75d'][deck.id];
      for (let x = 0; x < width; x += Math.max(1, ratio)) {
        const time = start + x / width * span;
        if (time < 0 || time >= duration) continue;
        const bin = Math.min(peaks.length - 1, Math.floor(time / duration * peaks.length));
        const amplitude = peaks[bin] * height * 0.45;
        ctx.fillRect(x, height / 2 - amplitude, Math.max(1, ratio), Math.max(1, amplitude * 2));
      }
    } else {
      ctx.fillStyle = '#9d91ad'; ctx.font = `${11 * ratio}px sans-serif`;
      ctx.fillText(deck.libraryId ? (state.library.find(item => item.id === deck.libraryId)?.preparing ? 'Preparing waveform / BPM…' : 'Waveform unavailable · try ANALYSE') : 'Load a track', 12 * ratio, height * .55);
    }
    if (detail && deck.bpmKnown) {
      const beat = 60 / deck.baseBpm, anchor = deck.gridOffset || 0;
      for (let index = Math.ceil((start - anchor) / beat); anchor + index * beat < start + span; index++) {
        const time = anchor + index * beat;
        if (time < 0) continue;
        ctx.fillStyle = index % 4 === 0 ? '#f4e7ff99' : '#f4e7ff30';
        ctx.fillRect(toX(time), 0, ratio, height);
      }
    }
    for (const time of [deck.cuePoint, ...(deck.hotCues || [])]) {
      if (time === null || !Number.isFinite(time)) continue;
      ctx.fillStyle = '#f6cd70'; ctx.fillRect(toX(time), 0, 2 * ratio, height * .25);
    }
    if(deck.slipTimeline){const t=deck.slipTimeline;ctx.fillStyle='#53efa9';ctx.fillRect(toX(t.position+(state.audioContext.currentTime-t.clock)*t.rate),0,2*ratio,height);}
    ctx.fillStyle = '#ffffff'; ctx.fillRect(toX(deck.currentTime), 0, 2 * ratio, height);
  }
}

function setStatus(message) {
  statusPill.textContent = message;
}

function updateMasterMeter() {
  updateCentralDeckMeters();
}

function runAutoMix() {
  const startedAt = performance.now(), runId = state.autoMixRunId;
  const startValue = state.crossfader;
  const incomingDeck = state.autoMixIncoming;
  const outgoingDeck = getDeckById(1 - incomingDeck);
  const endValue = incomingDeck === 1 ? 100 : 0;
  const duration = (state.transitionSeconds || state.settings.autoMixDuration) * 1000;
  const audioStart = state.audioContext?.currentTime;
  const scheduled = Number.isFinite(audioStart) && deckState.slice(0,2).every(deck => typeof deck.gainNode?.gain.setValueCurveAtTime === 'function');
  if (scheduled) {
    for (const deck of deckState.slice(0,2)) {
      const volume = Number(document.querySelector(`input[data-role="volume"][data-deck="${deck.id}"]`).value) / 100 * .8;
      const values = new Float32Array(128);
      for (let n=0;n<values.length;n++) {
        const position = (startValue + (endValue-startValue)*n/(values.length-1))/100;
        values[n] = volume * (state.settings.crossfaderCurve === 'linear' ? deck.id===0 ? 1-position : position : deck.id===0 ? Math.cos(position*Math.PI/2) : Math.sin(position*Math.PI/2));
      }
      deck.gainNode.gain.cancelScheduledValues(audioStart);
      deck.gainNode.gain.setValueCurveAtTime(values,audioStart,duration/1000);
    }
  }
  let finished = false;
  const finish = () => {
    if (finished || !state.autoMix || state.autoMixRunId !== runId) return;
    finished = true; clearTimeout(state.fadeTimer);
    crossfaderInput.value = String(endValue); state.crossfader = endValue;
    for (const deck of deckState.slice(0,2)) deck.gainNode?.gain.cancelScheduledValues?.(state.audioContext.currentTime);
    applyCrossfader(); state.autoMix = false; pauseDeck(outgoingDeck.id);
    if (state.queueEnabled) {
      state.queueActive = incomingDeck; state.queueUpcoming = null;
      toggleAutoMixBtn.textContent = 'STOP AUTOMIX'; renderQueue();
    } else toggleAutoMixBtn.textContent = 'AUTOMIX';
    setStatus('Transition complete');
  };
  const update = now => {
    if (!state.autoMix || state.autoMixRunId !== runId) return;
    const progress = Math.min(1, (now-startedAt)/duration);
    crossfaderInput.value = String(startValue+(endValue-startValue)*progress);
    state.crossfader = Number(crossfaderInput.value);
    if (!scheduled) applyCrossfader();
    if (progress<1) state.autoMixFrame=requestAnimationFrame(update); else finish();
  };
  state.fadeTimer=setTimeout(finish,duration+25);
  state.fadeTimer?.unref?.();
  state.autoMixFrame=requestAnimationFrame(update);
}

async function startDeckPlayback(deck) {
  try {
    const resume = state.audioContext.resume();
    const playback = deck.audio.play();
    await Promise.all([resume, playback]);
    if (deck.audio.paused) return false;
    deck.isPlaying = true;
    document.querySelector(`[data-action="play"][data-deck="${deck.id}"]`).textContent = 'Ⅱ';
    return true;
  } catch (error) {
    setStatus(`Unable to play ${deck.fileName}: ${error.message}`);
    return false;
  }
}

async function mixLoadedDecks() {
  const mixDecks = deckState.slice(0, 2);
  const loadedDecks = mixDecks.filter((deck) => deck.objectUrl);
  if (loadedDecks.length !== 2) {
    setStatus('Load a track on both decks before auto mix');
    return;
  }

  toggleAutoMixBtn.disabled = true;
  state.autoMixStarting = true;
  const runId = ++state.autoMixRunId;
  let outgoingDeck = state.queueEnabled ? getDeckById(state.queueActive) : mixDecks.find((deck) => deck.isPlaying);
  if (!outgoingDeck) outgoingDeck = getDeckById(state.crossfader > 50 ? 1 : 0);
  const incomingDeck = getDeckById(1 - outgoingDeck.id);

  // Select the audible source before starting either track. Otherwise a
  // centred crossfader plays both tracks at full mix level during startup.
  crossfaderInput.value = outgoingDeck.id === 0 ? '0' : '100';
  applyCrossfader();
  if (!incomingDeck.isPlaying) incomingDeck.audio.currentTime = incomingDeck.cuePoint || 0;
  try {
    const startPromises = [incomingDeck]
      .filter((deck) => !deck.isPlaying)
      .map((deck) => startDeckPlayback(deck));
    const startedDecks = await Promise.all(startPromises);
    if (runId !== state.autoMixRunId) { if (!incomingDeck.audio.paused) pauseDeck(incomingDeck.id); return; }
    if (startedDecks.some((started) => !started)) { cancelAutoMix(); return; }

    state.autoMixIncoming = incomingDeck.id;
    state.autoMix = true;
    toggleAutoMixBtn.textContent = 'CANCEL MIX';
    setStatus(`Mixing into deck ${deckLetter(incomingDeck.id)}`);
    runAutoMix();
  } finally {
    if (runId === state.autoMixRunId) state.autoMixStarting = false;
    toggleAutoMixBtn.disabled = state.autoMixStarting;
  }
}

function cancelAutoMix() {
  if (state.queueEnabled && state.queueUpcoming !== null && !state.autoMix && !state.autoMixStarting) {
    const id = getDeckById(state.queueUpcoming).libraryId;
    if (id) state.queue.unshift(id);
  }
  clearTimeout(state.fadeTimer);
  if (state.audioContext) for (const deck of deckState.slice(0,2)) {
    deck.gainNode?.gain.cancelScheduledValues?.(state.audioContext.currentTime);
  }
  state.queueEnabled = false;
  state.queueEpoch += 1;
  state.queueUpcoming = null;
  state.queueBusy = false;
  state.autoMixRunId += 1;
  state.autoMix = false;
  state.autoMixStarting = false;
  cancelAnimationFrame(state.autoMixFrame);
  toggleAutoMixBtn.disabled = false;
  toggleAutoMixBtn.textContent = 'AUTOMIX';
  applyCrossfader();
  try { localStorage.setItem('iykQueue', JSON.stringify(state.queue)); } catch {}
  renderQueue();
  setStatus('Auto mix cancelled');
}

function startRecording() {
  if (!window.MediaRecorder || !state.audioContext?.createMediaStreamDestination) {
    setStatus('Recording is not supported in this browser');
    return;
  }
  const destination = state.audioContext.createMediaStreamDestination();
  const recordingSource = state.masterAnalyser || state.masterGain;
  recordingSource.connect(destination);
  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']
    .find((type) => MediaRecorder.isTypeSupported(type));
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    recordingSource.disconnect(destination);
    destination.stream.getTracks().forEach((track) => track.stop());
    setStatus(`Could not start recording: ${error.message}`);
    return;
  }
  state.recordingChunks = chunks;
  state.recorder = recorder;
  state.recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  state.recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const download = document.createElement('a');
    download.href = URL.createObjectURL(blob);
    download.download = `IYK-DeckLab-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    download.click();
    setTimeout(() => URL.revokeObjectURL(download.href), 1000);
    recordingSource.disconnect(destination);
    destination.stream.getTracks().forEach((track) => track.stop());
    state.recordingStopping = false;
    recordBtn.disabled = false;
    state.recordingChunks = [];
    setStatus('Recording download requested');
  });
  state.recorder.start(1000);
  state.recordingStartedAt = Date.now();
  recordBtn.classList.add('is-recording');
  recordBtn.querySelector('.record-dot + span').textContent = 'Stop';
  state.recordingTimer = setInterval(() => {
    recordTime.textContent = formatTime((Date.now() - state.recordingStartedAt) / 1000);
  }, 250);
  setStatus('Recording master mix');
}

function toggleRecording() {
  if (state.recordingStopping) return;
  if (state.recorder?.state === 'recording') {
    state.recordingStopping = true;
    recordBtn.disabled = true;
    state.recorder.stop();
    clearInterval(state.recordingTimer);
    recordBtn.classList.remove('is-recording');
    recordBtn.querySelector('.record-dot + span').textContent = 'Record';
    recordTime.textContent = '00:00';
    return;
  }
  ensureContext();
  startRecording();
}

function midiMappingKey(event) {
  const deviceId = event.currentTarget?.id || event.target?.id || 'device';
  return `${deviceId}:${event.data[0]}:${event.data[1]}`;
}

function beginSlip(deck,kind) {
  if(deck.slipMode && deck.isPlaying && !deck.slipTimeline) deck.slipTimeline={kind,position:deck.audio.currentTime,clock:state.audioContext.currentTime,rate:deck.audio.playbackRate};
}
function finishSlip(deck,kind) {
  const timeline=deck.slipTimeline;
  if(!timeline || (kind && timeline.kind!==kind)) return;
  deck.audio.currentTime=Math.max(0,Math.min(deck.duration, timeline.position+(state.audioContext.currentTime-timeline.clock)*timeline.rate));
  deck.slipTimeline=null;
}
async function beginScratch(deck) {
  if(!deck.vinylMode || !deck.objectUrl || deck.scratchGesture) return;
  const token={wasPlaying:deck.isPlaying,position:deck.audio.currentTime,last:performance.now()};deck.scratchGesture=token;
  try {
    ensureContext();await state.audioContext.resume();
    const item=state.library.find(item=>item.id===deck.libraryId);
    if(!item || item.file.size>100*1024*1024) throw Error('Scratch preparation requires a loaded track under 100 MB');
    let decoded=deck.scratchDecoded?.file===item.file ? deck.scratchDecoded.promise : null;
    if(!decoded){decoded=state.audioContext.decodeAudioData(await item.file.arrayBuffer());deck.scratchDecoded={file:item.file,promise:decoded};}
    decoded=await decoded;
    if(decoded.duration>1800)throw Error('Scratch preparation supports tracks up to 30 minutes');
    state.scratchModule ||= state.audioContext.audioWorklet.addModule(new URL('./scratch-worklet.js',import.meta.url));
    await state.scratchModule;
    if(deck.scratchGesture!==token)return;
    beginSlip(deck,'scratch');deck.audio.pause();
    const node=new AudioWorkletNode(state.audioContext,'decklab-scratch',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    token.node=node;
    node.port.onmessage=({data})=>{if(deck.scratchGesture===token){token.position=data.position;deck.audio.currentTime=data.position;}};
    const channels=Array.from({length:Math.min(2,decoded.numberOfChannels)},(_,c)=>decoded.getChannelData(c).slice());
    node.port.postMessage({type:'load',channels,sampleRate:decoded.sampleRate,position:token.position},channels.map(channel=>channel.buffer));
    node.connect(deck.low);
    setStatus(`Vinyl scratch ready on deck ${deckLetter(deck.id)}`);
  }catch(error){if(deck.scratchGesture===token){endScratch(deck);setStatus(`Scratch unavailable: ${error.message}`);}}
}
function moveScratch(deck,seconds) {
  const token=deck.scratchGesture;if(!token?.node)return;
  const now=performance.now(), elapsed=Math.max(.008,(now-token.last)/1000);token.last=now;
  token.node.port.postMessage({type:'move',speed:seconds/elapsed});
}
function endScratch(deck,resume=true) {
  const token=deck.scratchGesture;if(!token)return;
  deck.scratchGesture=null;token.node?.port.postMessage({type:'stop'});token.node?.disconnect();token.node?.port.close();
  if(token.node)deck.audio.currentTime=token.position;
  finishSlip(deck,'scratch');
  if(resume && token.wasPlaying)void startDeckPlayback(deck);
}
function flx2Mapping(status, number, bank = 0) {
  const channel=status&15, type=status&240, deck=channel+bank;
  if(channel<2 && type===144 && [11,12].includes(number)) return {action:`${number===11?'play':'cue'}-${deck}`};
  if(channel<2 && type===176) {
    const role={0:'tempo',7:'high',11:'mid',15:'low',19:'volume'}[number];
    if(role) return {role,deck:String(deck)}; // MSB; matching LSB messages are ignored.
  }
  if(channel===6 && type===176) {
    if(number===31) return {role:'crossfader',deck:null};
    if(number===23 || number===24) return {role:'filter',deck:String(bank+number-23)};
  }
  return null;
}
function handleFlx2Extra(event, bank) {
  const [status,number,value]=event.data, channel=status&15, type=status&240;
  const deck=channel+bank;
  // SHIFT + SMART FADER is the FLX2's SMART CFX message.
  if(channel===6 && type===144 && number===9 && value>0) {
    for(const id of [bank,bank+1]) {
      const select=document.querySelector(`[data-role="effect"][data-deck="${id}"]`);
      const target=getDeckById(id);
      if(select.value==='off') select.value=target.lastControllerEffect || 'echo';
      else { target.lastControllerEffect=select.value; select.value='off'; }
      select.dispatchEvent(new Event('change',{bubbles:true}));
      setPerformanceTab(id,'effects');
    }
    setStatus('FLX2 effects toggled for the selected deck pair. CFX knobs control effect amount; centre is dry.');
    return true;
  }
  if(channel<2 && type===176 && [33,34,35,41].includes(number)) {
    const target=getDeckById(deck), delta=value-64;
    if(target.vinylMode && target.scratchGesture){moveScratch(target,delta*.025);return true;}
    if(target.audio && target.objectUrl && delta) target.audio.currentTime=Math.max(0,Math.min(target.duration||0,target.audio.currentTime+delta*.025));
    return true;
  }
  if(type===144 && value>0 && channel<2 && number===84) {
    document.querySelector(`[data-action="pfl"][data-deck="${deck}"]`)?.click(); return true;
  }
  if(type===144 && value>0 && [7,9].includes(channel) && number<8) {
    void triggerHotCue(bank+(channel===9?1:0),number); return true;
  }
  if(type===144 && value>0 && channel<2 && number===88) {
    document.getElementById('syncMaster').value=String(bank+(channel===0?1:0));
    document.getElementById('syncTarget').value=String(deck);
    document.getElementById('syncBpmBtn')?.click(); return true;
  }
  return false;
}
function isFlx2Input(input) {
  const selected=document.getElementById('controllerProfile')?.value;
  const profile=['auto','flx2','learn'].includes(selected)?selected:'auto';
  return profile==='flx2' || (profile==='auto' && /DDJ[\s_-]*FLX[\s_-]*2/i.test(input?.name || ''));
}
function controllerReport(message) {
  const output=document.getElementById('controllerStatus');
  if(output) output.textContent=message;
}
function onMidiMessage(event) {
  const source=event.currentTarget || event.target;
  controllerReport(`Receiving: ${source?.name || 'MIDI input'} · ${Array.from(event.data).map(v=>v.toString(16).padStart(2,'0')).join(' ')} · ${isFlx2Input(source)?'DDJ-FLX2 preset':'MIDI Learn mapping'}`);
  const [status, number, value] = event.data;
  const type = status & 0xf0;
  if (event.data.length !== 3 || ![0x80, 0x90, 0xb0].includes(type) ||
      number > 127 || value > 127) return;
  const flxDevice=isFlx2Input(source), channel=status&15;
  const activeBank=state.deckCount===4 && document.getElementById('controllerBank')?.value==='cd'?2:0;
  if(!state.midiLearning && flxDevice && channel<2 && number===54 && [128,144].includes(type)) {
    const deck=getDeckById(channel+activeBank);
    if(type===144 && value>0)void beginScratch(deck);else endScratch(deck);
    return;
  }
  const released = type === 0x80 || (type === 0x90 && value === 0);
  if (released) {
    if(!state.midiLearning && flxDevice && [7,9].includes(channel) && number<8)finishSlip(getDeckById(activeBank+(channel===9?1:0)),'hotcue');
    if (!state.midiLearning) {
      const status = type === 0x80 ? (event.data[0] & 0x0f) | 0x90 : event.data[0];
      const releaseKey = midiMappingKey({currentTarget:event.currentTarget, target:event.target, data:[status,number,0]});
      const device=event.currentTarget || event.target;
      const bank=state.deckCount===4 && document.getElementById('controllerBank')?.value==='cd'?2:0;
      const mapping = (document.getElementById('controllerProfile')?.value==='flx2' ? null : state.midiMappings[releaseKey]) || (isFlx2Input(device) ? flx2Mapping(status,number,bank) : null);
      if (mapping?.action?.startsWith('cue-')) cueRelease(Number(mapping.action.split('-')[1]));
    }
    return;
  }
  const key = midiMappingKey(event);
  if (state.midiLearning) {
    const separator = midiTarget.value.lastIndexOf('-');
    const role = separator < 0 ? midiTarget.value : midiTarget.value.slice(0, separator);
    const deck = separator < 0 ? null : midiTarget.value.slice(separator + 1);
    const isAction = role === 'play' || role === 'cue';
    if (!isAction && type !== 0xb0) {
      setStatus('Move a MIDI knob or fader to assign this continuous control');
      return;
    }
    if (isAction && value === 0) return;
    state.midiMappings[key] = isAction
      ? { action: midiTarget.value }
      : { role, deck };
    state.midiPickup.delete(key);
    const saved = saveMidiMappings();
    state.midiLearning = false;
    midiLearnBtn.classList.remove('is-learning');
    midiLearnBtn.textContent = 'MIDI LEARN';
    if (saved) setStatus(`Assigned MIDI control to ${midiTarget.selectedOptions[0].text}`);
    return;
  }

  const input=event.currentTarget || event.target;
  const flx=isFlx2Input(input);
  const bank=state.deckCount===4 && document.getElementById('controllerBank')?.value==='cd'?2:0;
  const learned=document.getElementById('controllerProfile')?.value==='flx2' ? null : state.midiMappings[key];
  if(flx && !learned && handleFlx2Extra(event,bank)) return;
  let target = learned || (flx ? flx2Mapping(status,number,bank) : null);
  if (!target) return;
  const cfx=flx && !learned && type===176 && (status&15)===6 && [23,24].includes(number);
  if(cfx) {
    const effect=document.querySelector(`[data-role="effect"][data-deck="${target.deck}"]`)?.value;
    if(effect && effect!=='off') target={role:'effect-amount',deck:target.deck,centred:true};
  }
  if (type === 0xb0 && value === 0 && target.action?.startsWith('cue-')) { cueRelease(Number(target.action.split('-')[1])); return; }
  if (target.role && type === 0xb0) {
    const control = target.role === 'crossfader'
      ? crossfaderInput
      : document.querySelector(`[data-role="${target.role}"][data-deck="${target.deck}"]`);
    if (!control || control.type !== 'range') return;
    const min = Number(control.min), max = Number(control.max);
    const current = (Number(control.value) - min) / (max - min);
    const position = target.centred ? Math.min(1, Math.abs(value-63.5)/63.5) : value / 127;
    const pickup = state.midiPickup.get(key);
    // Re-arm if the mouse or another control changed the software value.
    const acquired = pickup?.acquired && Math.abs(current - pickup.applied) < 0.015;
    const crossed = pickup && (pickup.previous - current) * (position - current) <= 0;
    if (!target.centred && !acquired && Math.abs(position - current) > 2 / 127 && !crossed) {
      state.midiPickup.set(key, { previous: position, acquired: false });
      return;
    }
    control.value = String(min + position * (max - min));
    control.dispatchEvent(new Event('input', { bubbles: true }));
    state.midiPickup.set(key, {
      previous: position, acquired: true,
      applied: (Number(control.value) - min) / (max - min),
    });
  } else if (target.action && value > 0) {
    const [action, deck] = target.action.split('-');
    if (action === 'play') {
      const target = getDeckById(Number(deck));
      if (target.cueHeld) target.cueLatched = true;
      else { if (state.queueEnabled && Number(deck) < 2) cancelAutoMix(); togglePlay(Number(deck)); }
    }
    if (action === 'cue') cuePress(Number(deck));
  }
}

async function initializeMidi() {
  if (!navigator.requestMIDIAccess) {
    midiLearnBtn.disabled = true;
    midiLearnBtn.title = 'Web MIDI is unavailable in this browser';
    controllerReport('Web MIDI is unavailable in this environment. Use the latest desktop app or Chrome/Edge on HTTPS.');
    return;
  }
  try {
    state.midiAccess = await navigator.requestMIDIAccess({sysex:false});
    midiLearnBtn.disabled=false;
    const connectInputs = async () => {
      state.midiPickup.clear();
      const inputs = [...state.midiAccess.inputs.values()].filter((input) => input.state === 'connected');
      const errors=[];
      for (const input of inputs) {
        input.onmidimessage=onMidiMessage;
        try { if(input.open) await input.open(); } catch(error) { errors.push(`${input.name}: ${error.message}`); }
      }
      controllerReport(inputs.length ? `Detected: ${inputs.map(input=>input.name || '(unnamed MIDI port)').join(', ')}. Move a knob or press Play to check incoming messages.${errors.length?' Cannot open: '+errors.join('; '):''}` : 'No MIDI input ports found. Connect USB, close other DJ apps, then click Connect controller again.');
      setStatus(inputs.length ? `Controller connected: ${inputs.map(input=>input.name).join(', ')}. DDJ-FLX2 preset automatic; other devices use MIDI Learn.` : 'No MIDI controller found. Connect USB, close other DJ apps and reconnect.');
      audioStatus.textContent = inputs.length
        ? `MIDI ${inputs.length} CONNECTED`
        : 'AUDIO ENGINE IDLE';
    };
    state.midiAccess.onstatechange = connectInputs;
    await connectInputs();
  } catch (error) {
    midiLearnBtn.title = 'MIDI access was not granted';
    controllerReport(`MIDI permission/open error: ${error.message}`);
    setStatus(navigator.userAgent.includes('Electron/') ? `Controller access failed: ${error.message}. Install desktop 0.2.2 or later, restart, and reconnect.` : `Controller access failed: ${error.message}. Allow MIDI access in site permissions, then reconnect.`);
  }
}

async function loadTrackForDeck(deckId, file, options = {}) {
  const deck = getDeckById(deckId);
  ensureContext();

  if (!file) return;
  if (deck.isPlaying) {
    setStatus('Pause the deck before replacing its track');
    return;
  }
  if (!options.forQueue && (state.queueEnabled || state.autoMix || state.autoMixStarting)) cancelAutoMix();
  endScratch(deck,false);deck.scratchDecoded=null;deck.slipTimeline=null;
  deck.currentTime = 0;
  deck.duration = 0;

  deck.fileName = options.name || file.name.replace(/\.[^/.]+$/, '');
  deck.bpm = Number(options.bpm || deck.baseBpm || 120);
  deck.baseBpm = deck.bpm;
  deck.bpmKnown = Boolean(options.bpmKnown);
  deck.bpmEstimated = Boolean(options.bpmEstimated);
  deck.waveform = options.waveform || null;
  deck.hotCues = Array.from({length:8}, (_, index) => Number.isFinite(options.hotCues?.[index]) ? options.hotCues[index] : null);
  deck.gridOffset = options.gridOffset || 0;
  deck.cuePoint = Number(options.cuePoint || 0);
  deck.libraryId = options.id || crypto.randomUUID();
  deck.loopStart = Number.isFinite(options.loopStart) ? options.loopStart : null;
  deck.loopEnd = Number.isFinite(options.loopEnd) ? options.loopEnd : null;
  document.getElementById(`loopState${deckLetter(deckId)}`).textContent = deck.loopEnd === null ? 'OFF' : 'ON';

  if (deck.audio) URL.revokeObjectURL(deck.objectUrl || '');
  deck.objectUrl = URL.createObjectURL(file);
  deck.audio.src = deck.objectUrl;
  deck.audio.load();

  buildDeckGraph(deck);
  updateDeckAudioFromControls(deckId);
  applyDeckEffects(deckId);

  const item = {
    id: deck.libraryId,
    name: deck.fileName,
    type: file.type,
    size: file.size,
    addedAt: options.addedAt || Date.now(),
    bpm: deck.baseBpm, bpmKnown: deck.bpmKnown, bpmEstimated: deck.bpmEstimated,
    hotCues: deck.hotCues, waveform: deck.waveform, gridOffset: deck.gridOffset, duration: options.duration || 0,
    cuePoint: deck.cuePoint,
    loopStart: deck.loopStart,
    loopEnd: deck.loopEnd,
    file,
  };
  if (!options.fromLibrary) {
    try {
      try {
    await saveTrackToLibrary(item);
  } catch {
    setStatus('Track markers could not be saved; they remain available this session');
  }
      setStatus(`Added ${deck.fileName} to library`);
    } catch (error) {
      setStatus(`Loaded ${deck.fileName}; local library storage is unavailable`);
    }
    state.library = state.library.filter((track) => track.id !== item.id);
    state.library.push(item);
  }

  renderPlaylist();
  updateDeckView(deck);
  renderHotCues(deck);
  const bpmInput = document.querySelector(`[data-role="bpm"][data-deck="${deckId}"]`);
  if (bpmInput) bpmInput.value = deck.bpmKnown ? String(deck.baseBpm) : '';
  setStatus(`Loaded ${deck.fileName} on deck ${deckLetter(deckId)}`);
  // Prepare on load without delaying transport or repeating cached analysis.
  const loadedItem = state.library.find(track => track.id === deck.libraryId);
  if (loadedItem && !loadedItem.waveform?.length) void prepareTrack(loadedItem);
}

function renderPlaylist() {
  playlistEl.innerHTML = '';
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const sortBy = document.getElementById('sortSelect').value;
  const tracks = state.library
    .filter((item) => item.name.toLowerCase().includes(query) && (!state.favouritesOnly || item.favourite) && (!state.activeCrate || item.crates?.includes(state.activeCrate)))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : sortBy === 'bpm' ? (a.bpmKnown ? a.bpm : 0) - (b.bpmKnown ? b.bpm : 0) : sortBy === 'duration' ? (a.duration || 0) - (b.duration || 0) : b.addedAt - a.addedAt);

  tracks.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'track-row';
    const name = document.createElement('button');
    name.className = 'track-name';
    name.type = 'button';
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${item.bpmKnown ? (item.bpmEstimated ? '≈' : '') + Number(item.bpm).toFixed(1) : '—'} BPM · ${formatTime(item.duration || 0)}`;
    const deckActions = document.createElement('div');
    deckActions.className = 'deck-load-actions';
    Array.from({ length: state.deckCount }, (_, id) => id).forEach((deckId) => {
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.textContent = deckLetter(deckId);
      loadButton.title = `Load ${item.name} on deck ${deckLetter(deckId)}`;
      loadButton.addEventListener('click', () => loadTrackForDeck(deckId, item.file, { ...item, fromLibrary: true }));
      deckActions.appendChild(loadButton);
    });
    const favourite = document.createElement('button');
    favourite.type = 'button'; favourite.textContent = item.favourite ? '★' : '☆';
    favourite.setAttribute('aria-label', `Favourite ${item.name}`);
    favourite.addEventListener('click', async () => { item.favourite = !item.favourite; await persistTrack(item); renderPlaylist(); });
    const prepare = document.createElement('button');
    prepare.type = 'button'; prepare.textContent = item.preparing ? '…' : 'ANALYSE'; prepare.disabled = Boolean(item.preparing);
    prepare.addEventListener('click', () => prepareTrack(item));
    const queue = document.createElement('button');
    queue.type = 'button'; queue.textContent = '+ QUEUE'; queue.addEventListener('click', () => enqueueTrack(item.id));
    const crateButton = document.createElement('button'); crateButton.type = 'button'; crateButton.textContent = '+ CRATE';
    crateButton.addEventListener('click', async () => {
      const id = document.getElementById('crateDestination').value;
      if (!state.crates.some(crate => crate.id === id)) { setStatus('Create or choose a destination crate first'); return; }
      item.crates = [...new Set([...(item.crates || []), id])]; await persistTrack(item); renderCrates(); renderPlaylist();
    });
    if (state.activeCrate) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '− CRATE';
      remove.addEventListener('click', async () => { item.crates = (item.crates || []).filter(id => id !== state.activeCrate); await persistTrack(item); renderCrates(); renderPlaylist(); });
      deckActions.append(remove);
    }
    deckActions.prepend(meta, favourite, prepare, queue, crateButton);
    li.draggable = true;
    li.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', item.id));
    li.append(name, deckActions);

    name.addEventListener('click', () => {
      const deckId = state.selectedDeck ?? (deckState[0].isPlaying ? 1 : 0);
      state.selectedDeck = null;
      loadTrackForDeck(deckId, item.file, { ...item, fromLibrary: true });
    });

    playlistEl.appendChild(li);
  });
  document.getElementById('trackCount').textContent = String(state.library.length);
  document.getElementById('librarySummary').textContent = `${state.library.length} track${state.library.length === 1 ? '' : 's'} in library`;
  document.getElementById('libraryEmpty').hidden = state.library.length > 0;
}

function togglePlay(deckId) {
  const deck = getDeckById(deckId);
  if (deckId >= state.deckCount) return;
  if (!deck.objectUrl) {
    setStatus(`Load a track on deck ${deckLetter(deckId)} before playing`);
    return;
  }

  if (deck.isPlaying) {
    pauseDeck(deckId);
    return;
  }

  startDeckPlayback(deck).then((started) => {
    if (started) setStatus(`Playing ${deck.fileName}`);
  });
}

function pauseDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.audio) return;
  endScratch(deck,false);deck.slipTimeline=null;
  deck.audio.pause();
  deck.isPlaying = false;
  document.querySelector(`[data-action="play"][data-deck="${deckId}"]`).textContent = '▶';
  setStatus(`Paused ${deck.fileName}`);
}

function cueDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.audio || !deck.objectUrl) return;
  pauseDeck(deckId);
  if (deck.loopEnd !== null && (deck.cuePoint < deck.loopStart || deck.cuePoint >= deck.loopEnd)) {
    deck.loopStart = null; deck.loopEnd = null; saveLoop(deck);
    document.getElementById(`loopState${deckLetter(deckId)}`).textContent = 'OFF';
  }
  deck.audio.currentTime = deck.cuePoint || 0;
  deck.currentTime = deck.audio.currentTime;
  updateDeckView(deck);
  setStatus(`Returned to cue on ${deck.fileName}`);
}

async function cuePress(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.objectUrl || deckId >= state.deckCount) return;
  if (state.queueEnabled && deckId < 2) cancelAutoMix();
  if (deck.isPlaying) { deck.cueHeld = false; cueDeck(deckId); return; }
  deck.audio.currentTime = deck.cuePoint || 0;
  deck.cueHeld = true; deck.cueLatched = false;
  const started = await startDeckPlayback(deck);
  if (started && !deck.cueHeld && !deck.cueLatched) cueDeck(deckId);
}

function cueRelease(deckId) {
  const deck = getDeckById(deckId);
  const held = deck.cueHeld;
  deck.cueHeld = false;
  if (held && !deck.cueLatched) cueDeck(deckId);
  deck.cueLatched = false;
}

async function saveCue(deck) {
  const item = state.library.find((track) => track.id === deck.libraryId);
  if (!item) return;
  item.cuePoint = deck.cuePoint;
  try {
    await saveTrackToLibrary(item);
  } catch {
    setStatus('Track markers could not be saved; they remain available this session');
  }
}

function applyDeckEffects(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.effectNodes) return;

  const effect = document.querySelector(`[data-role="effect"][data-deck="${deckId}"]`).value;
  const amount = Number(document.querySelector(`[data-role="effect-amount"][data-deck="${deckId}"]`).value) / 100;
  const { dryGain, filter, filterGain, delay, delayFeedback, delayGain, reverbGain, distortion, distortionGain } = deck.effectNodes;
  dryGain.gain.value=1; filterGain.gain.value=0; delayGain.gain.value=0;
  reverbGain.gain.value=0; distortionGain.gain.value=0; delayFeedback.gain.value=.35;
  filter.Q.value=.7;
  if (['filter','highpass','bandpass'].includes(effect)) {
    dryGain.gain.value=1-amount; filterGain.gain.value=amount;
    filter.type=effect==='filter'?'lowpass':effect;
    filter.frequency.value=effect==='filter'?18000*(350/18000)**amount:effect==='highpass'?80*(5000/80)**amount:200*(5000/200)**amount;
    if(effect==='bandpass') filter.Q.value=2;
  } else if (effect==='echo' || effect==='dub') {
    delayGain.gain.value=amount*.7;
    delay.delayTime.value=effect==='dub'?Math.min(.95,60/(deck.baseBpm||120)*.75):.28;
    delayFeedback.gain.value=effect==='dub'?.55:.35;
  } else if(effect==='reverb') {
    dryGain.gain.value=1-amount*.35; reverbGain.gain.value=amount*.8;
  } else if(effect==='drive') {
    const curve=new Float32Array(2048), strength=1+amount*35;
    for(let n=0;n<curve.length;n++){const x=n*2/(curve.length-1)-1;curve[n]=Math.tanh(x*strength)/Math.tanh(strength);}
    distortion.curve=curve; dryGain.gain.value=1-amount; distortionGain.gain.value=amount*.5;
  }
  document.getElementById(`effectValue${deckLetter(deckId)}`).textContent = `${Math.round(amount * 100)}%`;
}

function saveSettings() {
  try {
    localStorage.setItem('iykDeckLabSettings', JSON.stringify(state.settings));
  } catch (error) {
    setStatus(`Could not save settings: ${error.message}`);
  }
}

function restoreSettings() {
  const stored = localStorage.getItem('iykDeckLabSettings');
  if (!stored) return;

  try {
    const saved = JSON.parse(stored);
    restoreAppearance(saved?.appearance);
    if (Number.isFinite(saved.masterVolume)) state.settings.masterVolume = Math.max(0, Math.min(100, saved.masterVolume));
    if (Number.isFinite(saved.autoMixDuration)) state.settings.autoMixDuration = Math.max(4, Math.min(30, saved.autoMixDuration));
    if (saved.crossfaderCurve === 'linear' || saved.crossfaderCurve === 'equal-power') {
      state.settings.crossfaderCurve = saved.crossfaderCurve;
    }
    if (Array.isArray(saved.decks)) {
      saved.decks.forEach((deck, index) => {
        if (!deck || !state.settings.decks[index]) return;
        const ranges = {
          volume: [0, 100], trim: [-12, 12], filter: [-100, 100],
          low: [-12, 12],
          mid: [-12, 12],
          high: [-12, 12],
          tempo: [-10, 10],
          effectAmount: [0, 100],
        };
        Object.entries(ranges).forEach(([key, [min, max]]) => {
          if (Number.isFinite(deck[key])) state.settings.decks[index][key] = Math.max(min, Math.min(max, deck[key]));
        });
        if (['off','filter','echo','highpass','bandpass','dub','reverb','drive'].includes(deck.effect)) state.settings.decks[index].effect = deck.effect;
      });
    }
  } catch (error) {
    setStatus(`Saved settings could not be read: ${error.message}`);
  }
}

function syncSettingsControls() {
  const settings = state.settings;
  syncAppearanceSettings();
  applyAppearance();
  for (const deck of deckState) setPerformanceTab(deck.id,settings.appearance.defaultPerformanceTab);
  document.getElementById('masterVolume').value = String(settings.masterVolume);
  document.getElementById('masterVolumeValue').textContent = `${settings.masterVolume}%`;
  document.getElementById('autoMixDuration').value = String(settings.autoMixDuration);
  document.getElementById('autoMixDurationValue').textContent = `${settings.autoMixDuration} sec`;
  document.getElementById('crossfaderCurve').value = settings.crossfaderCurve;

  settings.decks.forEach((deck, deckId) => {
    Object.entries(deck).forEach(([role, value]) => {
      const control = document.querySelector(`[data-role="${role === 'effectAmount' ? 'effect-amount' : role}"][data-deck="${deckId}"]`);
      if (control) control.value = String(value);
    });
    applyDeckEffects(deckId);
  });
}

function toggleLoop(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.audio || !deck.duration) {
    setStatus('Load a track before setting a loop');
    return;
  }
  if (deck.loopEnd !== null) {
    deck.loopStart = null;
    deck.loopEnd = null;
    finishSlip(deck,'loop');
    saveLoop(deck);
    document.getElementById(`loopState${deckLetter(deckId)}`).textContent = 'OFF';
    setStatus(`Loop disabled on deck ${deckLetter(deckId)}`);
    return;
  }
  if (!deck.bpmKnown) { setStatus('Analyse or enter the track BPM before using beat loops'); return; }
  const beatDuration = 60 / Math.max(1, deck.baseBpm);
  const beats = Number(document.querySelector(`[data-role="loop-length"][data-deck="${deckId}"]`)?.value || 4);
  const position = deck.audio.currentTime;
  deck.loopStart = deck.bpmKnown ? Math.max(0, (deck.gridOffset || 0) + Math.floor((position - (deck.gridOffset || 0)) / beatDuration) * beatDuration) : position;
  beginSlip(deck,'loop');
  deck.loopEnd = Math.min(deck.duration, deck.loopStart + beatDuration * beats);
  if (deck.loopEnd <= deck.loopStart) { deck.loopStart = null; deck.loopEnd = null; return; }
  saveLoop(deck);
  document.getElementById(`loopState${deckLetter(deckId)}`).textContent = `${beats} BEATS`;
  setStatus(`${beats} beat loop set on deck ${deckLetter(deckId)}`);
}

async function saveLoop(deck) {
  const item = state.library.find((track) => track.id === deck.libraryId);
  if (!item) return;
  item.loopStart = deck.loopStart;
  item.loopEnd = deck.loopEnd;
  try {
    await saveTrackToLibrary(item);
  } catch {
    setStatus('Track markers could not be saved; they remain available this session');
  }
}

function stopAllDecks() {
  if (state.queueEnabled || state.autoMix || state.autoMixStarting) cancelAutoMix();
  deckState.forEach((deck) => {
    if (deck.audio) {
      deck.audio.pause();
      deck.audio.currentTime = 0;
      deck.isPlaying = false;
      document.querySelector(`[data-action="play"][data-deck="${deck.id}"]`).textContent = '▶';
    }
    deck.currentTime = 0;
    updateDeckView(deck);
  });

  setStatus('All decks stopped');
}

function syncBpm() {
  const masterId = Number(document.getElementById('syncMaster').value || 0);
  const targetId = Number(document.getElementById('syncTarget').value || 1);
  const master = getDeckById(masterId), target = getDeckById(targetId);
  if (masterId === targetId || masterId >= state.deckCount || targetId >= state.deckCount) {
    setStatus('Choose different visible master and target decks'); return;
  }
  if (!master.objectUrl || !target.objectUrl || !master.bpmKnown || !target.bpmKnown) {
    setStatus('Analyse both tracks or enter their BPM before syncing'); return;
  }
  const tempoControl = document.querySelector(`input[data-role="tempo"][data-deck="${targetId}"]`);
  const requestedPitch = (master.bpm / target.baseBpm - 1) * 100;
  tempoControl.value = String(Math.max(-10, Math.min(10, requestedPitch)));
  updateDeckAudioFromControls(targetId); saveSettings();
  if (Math.abs(requestedPitch) <= 10 && master.isPlaying && target.isPlaying) {
    const masterBeat = ((master.audio.currentTime - (master.gridOffset || 0)) * master.baseBpm / 60 % 1 + 1) % 1;
    const targetBeat = ((target.audio.currentTime - (target.gridOffset || 0)) * target.baseBpm / 60 % 1 + 1) % 1;
    let delta = masterBeat - targetBeat;
    if (delta > .5) delta -= 1; if (delta < -.5) delta += 1;
    target.audio.currentTime = Math.max(0, Math.min(target.duration || Infinity, target.audio.currentTime + delta * 60 / target.baseBpm));
  }
  setStatus(Math.abs(requestedPitch) > 10
    ? `Sync limited to ±10%: deck ${deckLetter(targetId)} is ${target.bpm.toFixed(1)} BPM`
    : `Deck ${deckLetter(targetId)} synced to ${deckLetter(masterId)}. Check estimated grids by ear.`);
}

function applyCrossfader() {
  const value = Number(crossfaderInput.value);
  state.crossfader = value;

  deckState.forEach((deck) => {
    const volume = Number(document.querySelector(`input[data-role="volume"][data-deck="${deck.id}"]`)?.value ?? 80) / 100;
    const position = value / 100;
    const balance = deck.id >= 2 ? 1 : state.settings.crossfaderCurve === 'linear'
      ? deck.id === 0 ? 1 - position : position
      : deck.id === 0 ? Math.cos(position * Math.PI / 2) : Math.sin(position * Math.PI / 2);
    if (deck.gainNode) deck.gainNode.gain.value = volume * balance * 0.8;
  });
}

function updateDeckAudioFromControls(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.gainNode) return;

  const volumeSlider = document.querySelector(`input[data-role="volume"][data-deck="${deckId}"]`);
  const lowSlider = document.querySelector(`input[data-role="low"][data-deck="${deckId}"]`);
  const midSlider = document.querySelector(`input[data-role="mid"][data-deck="${deckId}"]`);
  const highSlider = document.querySelector(`input[data-role="high"][data-deck="${deckId}"]`);
  const tempoSlider = document.querySelector(`input[data-role="tempo"][data-deck="${deckId}"]`);

  const volume = Number(volumeSlider?.value ?? 80) / 100;
  const low = Number(lowSlider?.value || 0);
  const mid = Number(midSlider?.value || 0);
  const high = Number(highSlider?.value || 0);
  const pitch = Number(tempoSlider?.value || 0);
  const tempo = deck.baseBpm * (1 + pitch / 100);

  const position = state.crossfader / 100;
  const balance = deckId >= 2 ? 1 : state.settings.crossfaderCurve === 'linear'
    ? deckId === 0 ? 1 - position : position
    : deckId === 0 ? Math.cos(position * Math.PI / 2) : Math.sin(position * Math.PI / 2);
  deck.gainNode.gain.value = volume * balance * 0.8;
  deck.low.gain.value = low;
  deck.mid.gain.value = mid;
  deck.high.gain.value = high;
  const trim = Number(document.querySelector(`[data-role="trim"][data-deck="${deckId}"]`)?.value || 0);
  const filter = Number(document.querySelector(`[data-role="filter"][data-deck="${deckId}"]`)?.value || 0);
  if (deck.trimNode) deck.trimNode.gain.value = 10 ** (trim / 20);
  if (deck.toneFilter) {
    deck.toneFilter.type = filter > 0 ? 'highpass' : 'lowpass';
    deck.toneFilter.frequency.value = filter > 0 ? 20 * (1000 ** (filter / 100)) : 20000 * (0.001 ** (-filter / 100));
  }
  Object.assign(state.settings.decks[deckId], { trim, filter });
  deck.bpm = tempo;
  document.getElementById(`tempoValue${deckLetter(deckId)}`).textContent = `${pitch > 0 ? '+' : ''}${pitch.toFixed(1)}%`;
  Object.assign(state.settings.decks[deckId], { volume: Number(volumeSlider?.value ?? 80), low, mid, high, tempo: pitch });

  if (deck.audio) {
    deck.audio.playbackRate = tempo / deck.baseBpm || 1;
  }

  syncMixerControlVisuals(deckId);
  updateDeckView(deck);
}

function bindDeckInputs() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const deckId = Number(button.dataset.deck);
      const action = button.dataset.action;

      if (action === 'load') {
        state.selectedDeck = deckId;
        hiddenFileInput.dataset.deck = String(deckId);
        hiddenFileInput.click();
        return;
      }

      if (action === 'play') {
        const deck = getDeckById(deckId);
        if (deck.cueHeld) { deck.cueLatched = true; return; }
        if (state.queueEnabled && deckId < 2) cancelAutoMix();
        togglePlay(deckId);
      }

      if (action === 'pause') {
        if (state.queueEnabled && deckId < 2) cancelAutoMix();
        pauseDeck(deckId);
      }

      // CUE uses pointer/key press-and-release handlers below.
      if (action === 'loop') toggleLoop(deckId);
    });
  });

  document.querySelectorAll('input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const role = input.dataset.role;
      const deckId = Number(input.dataset.deck);

      if (role === 'volume' && deckId < 2 && (state.autoMix || state.autoMixStarting)) cancelAutoMix();
      if (role === 'volume' || role === 'low' || role === 'mid' || role === 'high' || role === 'tempo' || role === 'trim' || role === 'filter') {
        updateDeckAudioFromControls(deckId);
        saveSettings();
      }
      if (role === 'effect-amount') {
        state.settings.decks[deckId].effectAmount = Number(input.value);
        applyDeckEffects(deckId);
        saveSettings();
      }
      if (role === 'seek') {
        const deck = getDeckById(deckId);
        if (deck.audio && deck.duration) deck.audio.currentTime = (Number(input.value) / 1000) * deck.duration;
      }
    });
  });

  crossfaderInput.addEventListener('input', () => {
    if (state.queueEnabled || state.autoMix || state.autoMixStarting) cancelAutoMix();
    applyCrossfader();
  });
  crossfaderInput.addEventListener('input', saveSettings);

  syncBpmBtn.addEventListener('click', syncBpm);
  stopAllBtn.addEventListener('click', stopAllDecks);
  recordBtn.addEventListener('click', toggleRecording);
  midiLearnBtn.addEventListener('click', async () => {
    if (!state.midiAccess) await initializeMidi();
    if (!state.midiAccess) return;
    state.midiLearning = !state.midiLearning;
    midiLearnBtn.classList.toggle('is-learning', state.midiLearning);
    midiLearnBtn.textContent = state.midiLearning ? 'PRESS A CONTROL' : 'MIDI LEARN';
    setStatus(state.midiLearning ? 'Press a MIDI control to assign it' : 'MIDI learn cancelled');
  });
  const profile=document.getElementById('controllerProfile');
  try { profile.value=localStorage.getItem('iykControllerProfile') || 'auto'; } catch {}
  profile.addEventListener('change',()=>{state.midiPickup.clear();try{localStorage.setItem('iykControllerProfile',profile.value);}catch{} controllerReport('Profile changed. Move a control to test incoming MIDI.');});
  document.getElementById('connectControllerBtn').addEventListener('click', () => {
    document.querySelector('.mapping-details').open=true;
    document.getElementById('controllerStatus').scrollIntoView({block:'nearest'});
    void initializeMidi();
  });
  document.getElementById('controllerBank').addEventListener('change', () => {
    for (const deck of deckState) {endScratch(deck);finishSlip(deck);if (deck.cueHeld) cueRelease(deck.id);}
    state.midiPickup.clear();
    setStatus('Controller deck pair changed. Move faders through the on-screen position to pick up control.');
  });
  document.getElementById('searchInput').addEventListener('input', renderPlaylist);
  document.getElementById('sortSelect').addEventListener('change', renderPlaylist);
  document.getElementById('settingsBtn').addEventListener('click', () => settingsDialog.showModal());
  document.getElementById('masterVolume').addEventListener('input', (event) => {
    state.settings.masterVolume = Number(event.target.value);
    state.masterGain.gain.value = state.settings.masterVolume / 100;
    document.getElementById('masterVolumeValue').textContent = `${state.settings.masterVolume}%`;
    saveSettings();
  });
  document.getElementById('autoMixDuration').addEventListener('input', (event) => {
    state.settings.autoMixDuration = Number(event.target.value);
    document.getElementById('autoMixDurationValue').textContent = `${state.settings.autoMixDuration} sec`;
    saveSettings();
  });
  document.getElementById('crossfaderCurve').addEventListener('change', (event) => {
    state.settings.crossfaderCurve = event.target.value;
    applyCrossfader();
    saveSettings();
  });
  document.querySelectorAll('[data-role="effect"]').forEach((select) => {
    select.addEventListener('change', () => {
      const deckId = Number(select.dataset.deck);
      state.settings.decks[deckId].effect = select.value;
      applyDeckEffects(deckId);
      saveSettings();
    });
  });
  window.addEventListener('resize', () => deckState.forEach(drawVisualizer));

  toggleAutoMixBtn.addEventListener('click', () => {
    if (state.queueEnabled || state.autoMix) {
      cancelAutoMix();
      return;
    }
    startAutoMix();
  });

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    fileInput.value = '';
    let unsaved = 0;
    for (const file of files) {
      const item = {
        id: crypto.randomUUID(), name: file.name.replace(/\.[^/.]+$/, ''),
        type: file.type, size: file.size, addedAt: Date.now(), bpm: 120, bpmKnown: false,
        cuePoint: 0, loopStart: null, loopEnd: null, file,
      };
      state.library.push(item);
      try { await saveTrackToLibrary(item); } catch { unsaved += 1; }
    }
    renderPlaylist();
    setStatus(`Imported ${files.length} track(s)${unsaved ? `; ${unsaved} available for this session only` : ''}. Use A or B to load a deck.`);
  });

  hiddenFileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    const deckId = Number(hiddenFileInput.dataset.deck || 0);

    if (file) {
      loadTrackForDeck(deckId, file);
    }

    hiddenFileInput.value = '';
  });
}

async function init() {
  restoreSettings();
  deckState.forEach((deck) => {
    createAudioElementForDeck(deck);
    buildDeckGraph(deck);
    updateDeckView(deck);
  });

  bindDeckInputs();
  bindClassicControls();
  const deckCountControl = document.getElementById('deckCount');
  try { deckCountControl.value = localStorage.getItem('iykDeckCount') === '4' ? '4' : '2'; } catch {}
  setDeckCount(deckCountControl.value);
  deckCountControl.addEventListener('change', () => setDeckCount(deckCountControl.value));
  try {
    state.database = await openLibraryDatabase();
    state.library = await readLibrary();
    restoreCrates();
    restoreQueue();
    renderPlaylist();
  } catch (error) {
    setStatus('Local library storage is unavailable in this browser');
  }
  crossfaderInput.value = localStorage.getItem('iykCrossfader') || '50';
  audioStatus.textContent = 'WEB AUDIO · DEFAULT OUTPUT';
  syncSettingsControls();
  state.masterGain.gain.value = state.settings.masterVolume / 100;
  applyCrossfader();
  crossfaderInput.addEventListener('change', () => localStorage.setItem('iykCrossfader', crossfaderInput.value));
  deckState.forEach((deck) => updateDeckAudioFromControls(deck.id));

  let lastDisplayFrame = 0;
  const animationLoop = (now) => {
    if (state.settings.appearance.reduceMotion && now - lastDisplayFrame < 100) { requestAnimationFrame(animationLoop); return; }
    lastDisplayFrame = now;
    deckState.forEach((deck) => {
      if (deck.analyser) {
        updateDeckView(deck);
        updateChannelMeter(deck);
      }
    });
    updateMasterMeter();
    requestAnimationFrame(animationLoop);
  };

  requestAnimationFrame(animationLoop);
  setInterval(() => queueTick().catch(error => { cancelAutoMix(); setStatus(error.message); }), 200);
}

window.addEventListener('load', init);


// Preparation runs serially; expensive PCM analysis runs in a worker.
function analysePcm(samples, sampleRate) {
  const bins = 4000;
  const peaks = new Array(bins).fill(0);
  const frameSize = Math.max(1, Math.round(sampleRate / 100));
  const frames = Math.ceil(samples.length / frameSize);
  const energy = new Float32Array(frames);
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const value = Math.abs(samples[index]);
    const bin = Math.min(bins - 1, Math.floor(index / samples.length * bins));
    if (value > peaks[bin]) peaks[bin] = value;
    energy[Math.floor(index / frameSize)] += value * value;
    peak = Math.max(peak, value);
  }
  const onset = new Float32Array(frames);
  let strongest = 0, anchorFrame = 0;
  for (let index = 1; index < frames; index++) {
    onset[index] = Math.max(0, Math.sqrt(energy[index]) - Math.sqrt(energy[index - 1]));
    if (index < 1000 && onset[index] > strongest) { strongest = onset[index]; anchorFrame = index; }
  }
  // Restrict candidate tempo to 60–180; half/double-time ambiguity is exposed as an estimate.
  let best = 0, bestLag = 0;
  const rate = sampleRate / frameSize;
  for (let lag = Math.round(rate * 60 / 180); lag <= Math.round(rate); lag++) {
    let score = 0;
    const limit = Math.min(frames, 18000);
    for (let index = lag; index < limit; index++) score += onset[index] * onset[index - lag];
    score /= Math.max(1, limit - lag);
    if (score > best) { best = score; bestLag = lag; }
  }
  return {
    waveform: peaks, duration: samples.length / sampleRate,
    bpm: bestLag && best > 0.00001 ? Math.round(60 * rate / bestLag * 10) / 10 : null,
    gridOffset: anchorFrame / rate, peak,
  };
}

async function analyseInWorker(samples, sampleRate) {
  if (typeof Worker === 'undefined') throw Error('Track preparation requires Web Worker support');
  const code = `const analyse = (${analysePcm.toString()}); onmessage = ({data}) => { try { postMessage({result:analyse(data.samples,data.sampleRate)}); } catch(error) { postMessage({error:error.message}); } };`;
  const url = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
  const worker = new Worker(url);
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Track analysis timed out')), 90000);
      worker.onmessage = ({data}) => { clearTimeout(timeout); data.error ? reject(Error(data.error)) : resolve(data.result); };
      worker.onerror = () => { clearTimeout(timeout); reject(Error('Track analysis failed')); };
      worker.postMessage({samples, sampleRate}, [samples.buffer]);
    });
  } finally { worker.terminate(); URL.revokeObjectURL(url); }
}

async function persistTrack(track) {
  try { await saveTrackToLibrary(track); }
  catch { setStatus('Changes available for this session; local storage could not save them'); }
}

function prepareTrack(item) {
  if (!item || item.preparing) return state.prepareChain;
  item.preparing = true;
  renderPlaylist();
  const task = async () => {
    try {
      // PCM processing runs in a worker; playback can continue during preparation.
      if (item.file.size > 100 * 1024 * 1024) throw Error('File too large for browser preparation (100 MB limit); set BPM manually');
      ensureContext();
      setStatus(`Analysing ${item.name}`);
      const decoded = await state.audioContext.decodeAudioData(await item.file.arrayBuffer());
      if (decoded.duration > 1800) throw Error('Prepare tracks shorter than 30 minutes; set BPM manually for longer recordings');
      // Average channels at 8kHz to bound worker-transfer size.
      const step = Math.max(1, Math.floor(decoded.sampleRate / 8000));
      const mono = new Float32Array(Math.ceil(decoded.length / step));
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const data = decoded.getChannelData(channel);
        for (let n = 0; n < mono.length; n++) mono[n] += data[n * step] / decoded.numberOfChannels;
      }
      const result = await analyseInWorker(mono, decoded.sampleRate / step);
      item.waveform = result.waveform; item.duration = decoded.duration;
      if (!item.bpmManual && result.bpm) {
        item.bpm = result.bpm; item.bpmKnown = true; item.bpmEstimated = true; item.gridOffset = result.gridOffset;
      }
      delete item.preparing;
      await persistTrack(item);
      for (const deck of deckState.filter(deck => deck.libraryId === item.id)) {
        deck.waveform = item.waveform;
        {
          deck.baseBpm = item.bpm || 120; deck.bpmKnown = Boolean(item.bpmKnown);
          deck.bpmEstimated = Boolean(item.bpmEstimated); deck.gridOffset = item.gridOffset || 0;
          // Metadata updates must not change an already playing track's rate.
          deck.bpm = deck.baseBpm * (deck.audio?.playbackRate || 1);
          updateDeckView(deck);
          document.querySelector(`[data-role="bpm"][data-deck="${deck.id}"]`).value = item.bpmKnown ? String(item.bpm) : '';
        }
      }
      setStatus(result.bpm ? 'Waveform ready. BPM is an estimate: check the grid and correct if needed.' : 'Waveform ready; no reliable BPM found. Set BPM manually.');
    } catch (error) { setStatus(error.message); }
    finally { delete item.preparing; renderPlaylist(); }
  };
  state.prepareChain = state.prepareChain.then(task, task);
  return state.prepareChain;
}

function renderHotCues(deck) {
  document.querySelectorAll(`[data-action="hotcue"][data-deck="${deck.id}"]`).forEach(button => {
    const time = deck.hotCues?.[Number(button.dataset.pad)];
    button.classList.toggle('is-set', Number.isFinite(time));
    button.title = Number.isFinite(time) ? `${formatTime(time)} · Shift+click to clear` : 'Set hot cue';
  });
}

async function triggerHotCue(deckId, index, clear = false) {
  const deck = getDeckById(deckId);
  if (!deck.objectUrl || deckId >= state.deckCount) return;
  if (state.queueEnabled && deckId < 2) cancelAutoMix();
  deck.hotCues ||= new Array(8).fill(null);
  if (clear) deck.hotCues[index] = null;
  else if (Number.isFinite(deck.hotCues[index])) {
    if (deck.loopEnd !== null && (deck.hotCues[index] < deck.loopStart || deck.hotCues[index] >= deck.loopEnd)) {
      deck.loopStart = null; deck.loopEnd = null; saveLoop(deck);
      document.getElementById(`loopState${deckLetter(deckId)}`).textContent = 'OFF';
    }
    beginSlip(deck,'hotcue');
    deck.audio.currentTime = deck.hotCues[index];
    if (!deck.isPlaying) await startDeckPlayback(deck);
  } else deck.hotCues[index] = deck.audio.currentTime;
  renderHotCues(deck);
  const item = state.library.find(track => track.id === deck.libraryId);
  if (item) { item.hotCues = [...deck.hotCues]; await persistTrack(item); }
  renderHotCues(deck);
}

function updateChannelMeter(deck) {
  for(const mode of ['vinyl','slip'])document.querySelector(`[data-mode="${mode}"][data-deck="${deck.id}"]`)?.setAttribute('aria-pressed',String(Boolean(deck[`${mode}Mode`])));
  updateStereoMeter(deck.stereoMeter, deckLetter(deck.id));
  const jog = document.querySelector(`.jog[data-deck="${deck.id}"]`);
  if (jog) { jog.setAttribute('aria-valuemax', String(deck.duration || 0)); jog.setAttribute('aria-valuenow', String(deck.currentTime || 0)); }
}

function persistQueue() {
  try { localStorage.setItem('iykQueue', JSON.stringify(state.queue)); } catch {}
  renderQueue();
}
function restoreQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('iykQueue') || '[]');
    state.queue = Array.isArray(saved) ? saved.filter(id => state.library.some(track => track.id === id)) : [];
  } catch { state.queue = []; }
  renderQueue();
}
function enqueueTrack(id) { state.queue.push(id); persistQueue(); }
function renderQueue() {
  const list = document.getElementById('queueList');
  list.innerHTML = '';
  state.queue.forEach((id, index) => {
    const track = state.library.find(item => item.id === id);
    const li = document.createElement('li'); li.textContent = track?.name || 'Missing track';
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${track?.name || 'track'} from queue`);
    remove.addEventListener('click', () => { state.queue.splice(index, 1); persistQueue(); });
    li.append(remove); list.append(li);
  });
  document.getElementById('queueCount').textContent = String(state.queue.length);
  document.getElementById('queueStatus').textContent = state.queueEnabled
    ? `Playing deck ${deckLetter(state.queueActive)}${state.queueUpcoming !== null ? ' · next track ready' : ' · waiting for next track'}`
    : 'Add tracks using + QUEUE, then Start. A/B only.';
}

function waitForTrack(deck) {
  if (deck.audio.readyState >= 1 && Number.isFinite(deck.audio.duration)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timeout); deck.audio.removeEventListener('loadedmetadata', ready); deck.audio.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const ready = () => finish(); const failed = () => finish(Error(`Cannot decode ${deck.fileName}`));
    const timeout = setTimeout(() => finish(Error(`Timed out loading ${deck.fileName}`)), 15000);
    deck.audio.addEventListener('loadedmetadata', ready); deck.audio.addEventListener('error', failed);
  });
}

async function startAutoMix() {
  if (state.queueEnabled) { cancelAutoMix(); renderQueue(); return; }
  const epoch = ++state.queueEpoch;
  let active = deckState.slice(0, 2).find(deck => deck.isPlaying && (deck.id === 0 ? state.crossfader <= 50 : state.crossfader >= 50));
  if (!active) active = getDeckById(0);
  state.queueActive = active.id; state.queueEnabled = true; state.queueBusy = true;
  try {
    if (!active.objectUrl) {
      const id = state.queue[0]; const item = state.library.find(track => track.id === id);
      if (!item) throw Error('Add tracks to the Automix queue first');
      await loadTrackForDeck(active.id, item.file, {...item, fromLibrary:true, forQueue:true});
      await waitForTrack(active);
      if (epoch !== state.queueEpoch) return;
      state.queue.shift(); persistQueue();
    }
    if (epoch !== state.queueEpoch) return;
    pauseDeck(1 - active.id);
    crossfaderInput.value = active.id === 0 ? '0' : '100'; applyCrossfader();
    if (!active.isPlaying && !await startDeckPlayback(active)) throw Error('Could not start Automix playback');
    if (epoch !== state.queueEpoch) { pauseDeck(active.id); return; }
    toggleAutoMixBtn.textContent = 'STOP AUTOMIX';
    setStatus('Automix on: the next song starts near the current track’s end');
    renderQueue();
  } catch (error) { cancelAutoMix(); setStatus(error.message); }
  finally { if (epoch === state.queueEpoch) state.queueBusy = false; }
}

async function queueTick(force = false) {
  if (!state.queueEnabled || state.queueBusy || state.autoMix || state.autoMixStarting) return;
  const epoch = state.queueEpoch;
  const active = getDeckById(state.queueActive);
  if (state.queueUpcoming === null && state.queue.length) {
    const id = state.queue[0]; const item = state.library.find(track => track.id === id);
    if (!item) { state.queue.shift(); persistQueue(); return; }
    const incoming = getDeckById(1 - active.id);
    state.queueBusy = true;
    try {
      pauseDeck(incoming.id);
      await loadTrackForDeck(incoming.id, item.file, {...item, fromLibrary:true, forQueue:true});
      await waitForTrack(incoming);
      if (epoch !== state.queueEpoch) return;
      incoming.audio.currentTime = incoming.cuePoint || 0;
      state.queueUpcoming = incoming.id; state.queue.shift(); persistQueue();
    } catch (error) {
      if (epoch === state.queueEpoch) { state.queue.shift(); persistQueue(); setStatus(`${error.message}; skipped queued track`); }
    } finally { if (epoch === state.queueEpoch) state.queueBusy = false; }
  }
  if (epoch !== state.queueEpoch || !state.queueEnabled) return;
  if(active.scratchGesture)return;
  const remaining = Math.max(0, (active.audio.duration - active.audio.currentTime) / (active.audio.playbackRate || 1));
  if (state.queueUpcoming === null) {
    if (active.audio.ended) { cancelAutoMix(); renderQueue(); setStatus('Automix queue finished'); }
    return;
  }
  if (!Number.isFinite(remaining)) return;
  if (!force && (active.loopEnd !== null || remaining > state.settings.autoMixDuration)) return;
  state.transitionSeconds = Math.min(state.settings.autoMixDuration, Math.max(.1, remaining));
  await mixLoadedDecks();
}

async function refreshHeadphoneOutputs() {
  const select = document.getElementById('headphoneOutput');
  const status = document.getElementById('outputStatus');
  if (!navigator.mediaDevices?.enumerateDevices || typeof Audio.prototype.setSinkId !== 'function') {
    status.textContent = 'Separate headphone device selection is unavailable in this runtime.'; return;
  }
  try {
    if (navigator.mediaDevices.selectAudioOutput) await navigator.mediaDevices.selectAudioOutput();
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput' && !['default', 'communications', ''].includes(device.deviceId));
    select.innerHTML = '<option value="">Disabled</option>';
    devices.forEach((device, index) => {
      const option = document.createElement('option'); option.value = device.deviceId; option.textContent = device.label || `Output ${index + 1}`; select.append(option);
    });
    status.textContent = devices.length ? 'Choose a physically separate headphone output; master uses the system default. Multi-channel ASIO routing is not available.' : 'No selectable outputs exposed. Check OS/browser audio permissions and reconnect your audio device.';
  } catch (error) { status.textContent = `Output discovery: ${error.message}`; }
}

async function selectHeadphoneOutput(id) {
  ensureContext();
  const previous = state.headphoneAudio;
  if (previous) { previous.pause(); previous.srcObject = null; }
  state.headphoneReady = false;
  if (!id) { document.getElementById('headphoneStatus').textContent = 'Headphones disabled'; return; }
  try {
    if (!state.headphoneBus) {
      const ctx = state.audioContext;
      state.headphoneBus = ctx.createGain(); state.headphoneBus.gain.value = .7;
      state.headphoneDestination = ctx.createMediaStreamDestination(); state.headphoneBus.connect(state.headphoneDestination);
      state.headphoneMaster = ctx.createGain(); state.headphoneMaster.gain.value = 0;
      state.masterAnalyser.connect(state.headphoneMaster); state.headphoneMaster.connect(state.headphoneBus);
      for (const deck of deckState) {
        deck.cueGain = ctx.createGain(); deck.cueGain.gain.value = 0;
        deck.preAnalyser.connect(deck.cueGain); deck.cueGain.connect(state.headphoneBus);
      }
    }
    const audio = new Audio(); state.headphoneAudio = audio;
    await audio.setSinkId(id);
    audio.srcObject = state.headphoneDestination.stream;
    await state.audioContext.resume(); await audio.play();
    state.headphoneReady = true;
    updateHeadphoneMix();
    document.getElementById('headphoneStatus').textContent = 'Headphones ready · PFL selects cue channels';
  } catch (error) { document.getElementById('headphoneStatus').textContent = `Headphone output failed: ${error.message}`; }
}

function updateHeadphoneMix() {
  if (!state.headphoneBus) return;
  const blend = Number(document.getElementById('headphoneBlend').value) / 100;
  state.headphoneBus.gain.value = Number(document.getElementById('headphoneVolume').value) / 100;
  state.headphoneMaster.gain.value = blend;
  for (const deck of deckState) if (deck.cueGain) deck.cueGain.gain.value = state.headphoneReady && deck.pfl ? 1 - blend : 0;
}

function bindClassicControls() {
  bindAboutSettings();
  bindAppearanceSettings();
  for (const button of document.querySelectorAll('[data-action="cue"]')) {
    const id = Number(button.dataset.deck);
    button.addEventListener('pointerdown', event => { if (event.button !== 0) return; button.setPointerCapture(event.pointerId); cuePress(id); });
    button.addEventListener('pointerup', () => cueRelease(id));
    button.addEventListener('pointercancel', () => cueRelease(id));
    button.addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key) && !event.repeat) { event.preventDefault(); cuePress(id); } });
    button.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); cueRelease(id); } });
  }
  document.querySelectorAll('[data-action="hotcue"]').forEach(button => button.addEventListener('click', event => {if(button.skipSlipClick){button.skipSlipClick=false;return;}triggerHotCue(Number(button.dataset.deck), Number(button.dataset.pad), event.shiftKey);}));
  document.querySelectorAll('[data-action="prepare"]').forEach(button => button.addEventListener('click', () => prepareTrack(state.library.find(item => item.id === getDeckById(Number(button.dataset.deck)).libraryId))));
  document.querySelectorAll('[data-action="set-cue"]').forEach(button => button.addEventListener('click', () => {
    const deck = getDeckById(Number(button.dataset.deck)); if (!deck.objectUrl) return;
    deck.cuePoint = deck.audio.currentTime; saveCue(deck); setStatus(`Cue set at ${formatTime(deck.cuePoint)}`);
  }));
  document.querySelectorAll('[data-role="bpm"]').forEach(input => input.addEventListener('change', async () => {
    const bpm = Number(input.value); if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return;
    const deck = getDeckById(Number(input.dataset.deck));
    deck.baseBpm = bpm; deck.bpmKnown = true; deck.bpmEstimated = false;
    updateDeckAudioFromControls(deck.id);
    const item = state.library.find(track => track.id === deck.libraryId);
    if (item) { Object.assign(item, {bpm, bpmKnown:true, bpmEstimated:false, bpmManual:true}); await persistTrack(item); renderPlaylist(); }
  }));
  document.querySelectorAll('[data-action="grid"]').forEach(button => button.addEventListener('click', async () => {
    const deck = getDeckById(Number(button.dataset.deck)); if (!deck.objectUrl) return;
    deck.gridOffset = deck.audio.currentTime;
    const item = state.library.find(track => track.id === deck.libraryId);
    if (item) { item.gridOffset = deck.gridOffset; await persistTrack(item); }
    setStatus('Beat anchor set. Check BPM and grid against the track.');
  }));
  document.querySelectorAll('[data-action="pfl"]').forEach(button => button.addEventListener('click', () => {
    if (!state.headphoneReady) { setStatus('Configure a separate headphone output in Settings first'); return; }
    const deck = getDeckById(Number(button.dataset.deck)); deck.pfl = !deck.pfl; button.setAttribute('aria-pressed', String(deck.pfl)); updateHeadphoneMix();
  }));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    const deck=getDeckById(Number(button.dataset.deck)), mode=button.dataset.mode;
    deck[`${mode}Mode`]=!deck[`${mode}Mode`];
    if(mode==='vinyl' && !deck.vinylMode)endScratch(deck);
    if(mode==='slip' && !deck.slipMode)finishSlip(deck);
    button.setAttribute('aria-pressed',String(deck[`${mode}Mode`]));
    setStatus(`${mode.toUpperCase()} ${deck[`${mode}Mode`]?'ON':'OFF'} on deck ${deckLetter(deck.id)}`);
  }));
  document.querySelectorAll('[data-action="hotcue"]').forEach(button=>{
    const release=()=>finishSlip(getDeckById(Number(button.dataset.deck)),'hotcue');
    button.addEventListener('pointerdown',event=>{const deck=getDeckById(Number(button.dataset.deck));if(deck.slipMode && deck.isPlaying && Number.isFinite(deck.hotCues?.[Number(button.dataset.pad)]) && !event.shiftKey){button.skipSlipClick=true;button.setPointerCapture(event.pointerId);void triggerHotCue(deck.id,Number(button.dataset.pad));}});
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('keyup',release);
  });
  document.querySelectorAll('.jog').forEach(jog => {
    const deck = getDeckById(Number(jog.dataset.deck)); let last = null;
    const seek = delta => { if (deck.objectUrl) { if (state.queueEnabled && deck.id < 2) cancelAutoMix(); deck.audio.currentTime = Math.max(0, Math.min(deck.duration || 0, deck.audio.currentTime + delta)); } };
    jog.addEventListener('pointerdown', event => { if(deck.vinylMode)void beginScratch(deck); last = event.clientX; jog.setPointerCapture(event.pointerId); });
    jog.addEventListener('pointermove', event => { if (last !== null) { if(deck.vinylMode)moveScratch(deck,(event.clientX-last)*.015);else seek((event.clientX - last) * .015); last = event.clientX; } });
    jog.addEventListener('pointerup', () => { last = null;endScratch(deck); }); jog.addEventListener('pointercancel', () => { last = null;endScratch(deck); });
    jog.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); seek(event.key === 'ArrowLeft' ? -.1 : .1); } });
  });
  for (const action of ['nudge-up','nudge-down']) document.querySelectorAll(`[data-action="${action}"]`).forEach(button => {
    const deck = getDeckById(Number(button.dataset.deck));
    button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); if (deck.objectUrl) deck.audio.playbackRate = (1 + state.settings.decks[deck.id].tempo / 100) * (action === 'nudge-up' ? 1.04 : .96); });
    const release = () => { if (deck.audio) deck.audio.playbackRate = 1 + state.settings.decks[deck.id].tempo / 100; };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
  });
  document.querySelectorAll('.deck').forEach((article, id) => {
    article.addEventListener('pointerdown', () => { state.focusDeck = id; });
    article.addEventListener('dragover', event => event.preventDefault());
    article.addEventListener('drop', event => { event.preventDefault(); const item = state.library.find(track => track.id === event.dataTransfer.getData('text/plain')); if (item) loadTrackForDeck(id, item.file, {...item, fromLibrary:true}); });
  });
  window.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, select, textarea, button, [role="slider"]') || document.querySelector('dialog[open]')) return;
    const id = state.focusDeck || 0;
    if (event.code === 'Space') { event.preventDefault(); if (state.queueEnabled && id < 2) cancelAutoMix(); togglePlay(id); }
    if (/^Digit[1-8]$/.test(event.code)) { event.preventDefault(); triggerHotCue(id, Number(event.code.slice(-1))-1, event.shiftKey); }
  });
  window.addEventListener('keyup',event=>{if(/^Digit[1-8]$/.test(event.code))finishSlip(getDeckById(state.focusDeck||0),'hotcue');});
  document.getElementById('startQueueBtn').addEventListener('click', () => startAutoMix());
  document.getElementById('mixNowBtn').addEventListener('click', () => { if (!state.queueEnabled) { setStatus('Start Automix first'); return; } queueTick(true).catch(error => { cancelAutoMix(); setStatus(error.message); }); });
  document.getElementById('clearQueueBtn').addEventListener('click', () => { cancelAutoMix(); state.queue = []; persistQueue(); });
  for (const [id, favourites] of [['allTracksBtn', false], ['favouritesBtn', true]]) document.getElementById(id).addEventListener('click', () => { state.favouritesOnly = favourites; state.activeCrate = null; document.getElementById('allTracksBtn').classList.toggle('active', !favourites); document.getElementById('favouritesBtn').classList.toggle('active', favourites); renderPlaylist(); });
  document.getElementById('createCrateBtn').addEventListener('click', createCrate);
  document.getElementById('refreshOutputsBtn').addEventListener('click', refreshHeadphoneOutputs);
  document.getElementById('headphoneOutput').addEventListener('change', event => selectHeadphoneOutput(event.target.value));
  for (const id of ['headphoneBlend','headphoneVolume']) document.getElementById(id).addEventListener('input', updateHeadphoneMix);
}

function restoreCrates() {
  try {
    const saved = JSON.parse(localStorage.getItem('iykCrates') || '[]');
    state.crates = Array.isArray(saved) ? saved.filter(crate => typeof crate.id === 'string' && typeof crate.name === 'string') : [];
  } catch { state.crates = []; }
  renderCrates();
}
function renderCrates() {
  const list = document.getElementById('crateList'), destination = document.getElementById('crateDestination');
  const selected = destination.value;
  list.innerHTML = ''; destination.innerHTML = '<option value="">Choose destination crate</option>';
  state.crates.forEach(crate => {
    const row = document.createElement('div');
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${crate.name} (${state.library.filter(item => item.crates?.includes(crate.id)).length})`;
    button.addEventListener('click', () => { state.activeCrate = crate.id; state.favouritesOnly = false; renderPlaylist(); });
    row.append(button); list.append(row);
    const option = document.createElement('option'); option.value = crate.id; option.textContent = crate.name; destination.append(option);
  });
  if (state.crates.some(crate => crate.id === selected)) destination.value = selected;
}
function createCrate() {
  const input = document.getElementById('crateName'); const name = input.value.trim().slice(0,60);
  if (!name || state.crates.some(crate => crate.name.toLowerCase() === name.toLowerCase())) { setStatus('Enter a new crate name'); return; }
  const crate = {id:crypto.randomUUID(), name}; state.crates.push(crate); input.value = '';
  try { localStorage.setItem('iykCrates', JSON.stringify(state.crates)); } catch { setStatus('Crate created for this session only'); }
  renderCrates(); document.getElementById('crateDestination').value = crate.id;
}

function restoreAppearance(saved) {
  if (!saved || typeof saved !== 'object') return;
  const target = state.settings.appearance;
  const choices = {
    mixerStyle:['vertical','horizontal','knobs'], waveformLayout:['stacked','decks'],
    interfaceDensity:['comfortable','compact'], interfaceTheme:['dark','contrast','daylight'],
    defaultPerformanceTab:['hotcues','effects'], meterMode:['peak','rms'],
  };
  for (const [key, values] of Object.entries(choices)) if (values.includes(saved[key])) target[key] = saved[key];
  if (Number.isFinite(saved.waveformHeight)) target.waveformHeight = Math.max(35,Math.min(120,Math.round(saved.waveformHeight/5)*5));
  for (const [key,values] of Object.entries({waveformSeconds:[6,12,24],interfaceSize:[100,115,130],meterHold:[0,1000,3000]})) {
    if (values.includes(saved[key])) target[key] = saved[key];
  }
  for (const key of ['showJog','showOverview','showBottomMeters','reduceMotion']) if (typeof saved[key] === 'boolean') target[key] = saved[key];
}
function syncAppearanceSettings() {
  for (const [key,value] of Object.entries(state.settings.appearance)) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
  }
  document.getElementById('waveformHeightValue').textContent = `${state.settings.appearance.waveformHeight} px`;
}
function applyAppearance() {
  const value = state.settings.appearance;
  const body = document.body;
  body.dataset.mixerStyle = value.mixerStyle;
  body.dataset.waveformLayout = value.waveformLayout;
  body.dataset.showBottomMeters = String(value.showBottomMeters);
  body.dataset.density = value.interfaceDensity;
  body.dataset.theme = value.interfaceTheme;
  body.dataset.showJog = String(value.showJog);
  body.dataset.showOverview = String(value.showOverview);
  body.dataset.interfaceSize = String(value.interfaceSize);
  document.documentElement.style.setProperty('--wave-height',`${value.waveformHeight}px`);
  document.documentElement.style.setProperty('--text-scale',String(value.interfaceSize/100));
  const rack = document.getElementById('waveformRack');
  rack.hidden = value.waveformLayout !== 'stacked';
  for (const deck of deckState) {
    const canvas = document.getElementById(`detail${deckLetter(deck.id)}`);
    if (value.waveformLayout === 'stacked') document.getElementById(`waveLane${deckLetter(deck.id)}`).append(canvas);
    else {
      const article = document.querySelector(`.deck-${deckLetter(deck.id).toLowerCase()}`);
      article.insertBefore(canvas, article.querySelector('.wave-frame'));
    }
    syncMixerControlVisuals(deck.id);
  }
}
function setPerformanceTab(id, tab, focus = false) {
  const letter = deckLetter(id), effects = tab === 'effects';
  const hot = document.getElementById(`hotTab${letter}`), fx = document.getElementById(`fxTab${letter}`);
  hot.setAttribute('aria-selected',String(!effects)); fx.setAttribute('aria-selected',String(effects));
  hot.tabIndex = effects ? -1 : 0; fx.tabIndex = effects ? 0 : -1;
  document.getElementById(`hotPanel${letter}`).hidden = effects;
  document.getElementById(`fxPanel${letter}`).hidden = !effects;
  if (focus) (effects ? fx : hot).focus();
}
function syncMixerControlVisuals(id) {
  document.querySelectorAll(`.channel-strip input[data-deck="${id}"]:not(.channel-fader)`).forEach(input => {
    const label = input.closest('.mixer-control'); if (!label) return;
    const value = Number(input.value), min = Number(input.min), max = Number(input.max);
    label.style.setProperty('--knob-angle',`${-135+(value-min)/(max-min)*270}deg`);
    label.querySelector('output').textContent = `${value > 0 ? '+' : ''}${value}${input.dataset.role === 'filter' ? '%' : ' dB'}`;
  });
}
function bindAppearanceSettings() {
  for (const [key, initial] of Object.entries(appearanceDefaults)) {
    const input = document.getElementById(key);
    input.addEventListener('input', () => {
      state.settings.appearance[key] = typeof initial === 'boolean' ? input.checked : typeof initial === 'number' ? Number(input.value) : input.value;
      applyAppearance(); syncAppearanceSettings(); saveSettings();
      if (key === 'defaultPerformanceTab') for (const deck of deckState) setPerformanceTab(deck.id,input.value);
    });
  }
  document.getElementById('resetAppearanceBtn').addEventListener('click', () => {
    state.settings.appearance = {...appearanceDefaults};
    applyAppearance(); syncAppearanceSettings(); saveSettings();
    for (const deck of deckState) setPerformanceTab(deck.id,'hotcues');
  });
  document.querySelectorAll('[data-tab]').forEach(button => {
    const id = Number(button.dataset.deck);
    button.addEventListener('click', () => setPerformanceTab(id,button.dataset.tab));
    button.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();
        setPerformanceTab(id,event.key === 'Home' ? 'hotcues' : event.key === 'End' ? 'effects' : button.dataset.tab === 'effects' ? 'hotcues' : 'effects',true);
      }
    });
  });
  document.querySelectorAll('[data-fx]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.deck);
    const select = document.querySelector(`[data-role="effect"][data-deck="${id}"]`);
    select.value = button.dataset.fx; select.dispatchEvent(new Event('change',{bubbles:true}));
  }));
  document.querySelectorAll('.mixer-control input').forEach(input => {
    let drag = null;
    input.addEventListener('pointerdown', event => {
      if (state.settings.appearance.mixerStyle !== 'knobs' || event.button !== 0) return;
      event.preventDefault(); input.focus(); input.setPointerCapture(event.pointerId);
      drag = {y:event.clientY,value:Number(input.value)};
    });
    input.addEventListener('pointermove', event => {
      if (!drag) return;
      const min=Number(input.min),max=Number(input.max),step=Number(input.step || 1);
      input.value=String(Math.round(Math.max(min,Math.min(max,drag.value+(drag.y-event.clientY)*(max-min)/150))/step)*step);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    input.addEventListener('pointerup', () => {drag=null;}); input.addEventListener('pointercancel', () => {drag=null;});
    input.addEventListener('dblclick', () => {input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));});
  });
}
function createStereoTap(ctx, output) {
  if (!ctx.createChannelSplitter) return null;
  const input = ctx.createGain(); input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2); output.connect(input); input.connect(split);
  const channels = [0,1].map(index => {
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256; split.connect(analyser,index);
    return {analyser, samples:new Float32Array(analyser.fftSize),held:0,holdUntil:0};
  });
  return {input,split,channels};
}
function calculateMeter(samples, mode) {
  let peak = 0, squares = 0;
  for (const value of samples) {peak=Math.max(peak,Math.abs(value));squares+=value*value;}
  return {peak, level:mode === 'rms' ? Math.sqrt(squares/Math.max(1,samples.length)) : peak};
}
function updateCentralDeckMeters() {
  // L means left deck A and R means right deck B here, not master stereo.
  state.deckPairMeter ||= {channels:[0,1].map(id => ({
    samples:new Float32Array(256), held:0, holdUntil:0,
    analyser:{getFloatTimeDomainData(out) {
      out.fill(0);
      const tap = deckState[id].stereoMeter;
      if (!tap) return;
      for (const channel of tap.channels) {
        channel.analyser.getFloatTimeDomainData(channel.samples);
        for (let n=0;n<out.length;n++) out[n]=Math.max(out[n],Math.abs(channel.samples[n] || 0));
      }
    }}
  }))};
  updateStereoMeter(state.deckPairMeter, 'Master');
}
function updateStereoMeter(tap, prefix) {
  if (!tap) return;
  const settings=state.settings.appearance, now=performance.now();
  tap.channels.forEach((channel,index) => {
    channel.analyser.getFloatTimeDomainData(channel.samples);
    const {peak,level}=calculateMeter(channel.samples,settings.meterMode);
    const db=20*Math.log10(Math.max(.00001,level));
    const shown=Math.max(0,Math.min(1,(db+60)/60));
    if (shown>=channel.held || now>channel.holdUntil) {channel.held=shown;channel.holdUntil=now+settings.meterHold;}
    const rail=document.getElementById(`meter${prefix}${index===0?'L':'R'}`);
    if (!rail) return;
    rail.querySelector('.meter-cover').style.height=`${(1-shown)*100}%`;
    const hold=rail.querySelector('.meter-hold'); hold.hidden=settings.meterHold===0;hold.style.bottom=`${channel.held*100}%`;
    rail.classList.toggle('is-clipping',peak>=.99);
    rail.setAttribute('aria-valuenow',Math.min(1,level).toFixed(3)); rail.setAttribute('aria-valuetext',`${db.toFixed(1)} dBFS`);
  });
}

function setSettingsTab(tab, focus = false) {
  const about = tab === 'about';
  const mixerButton = document.getElementById('mixerSettingsTab');
  const aboutButton = document.getElementById('aboutSettingsTab');
  mixerButton.setAttribute('aria-selected',String(!about)); aboutButton.setAttribute('aria-selected',String(about));
  mixerButton.tabIndex = about ? -1 : 0; aboutButton.tabIndex = about ? 0 : -1;
  document.getElementById('mixerSettingsPanel').hidden = about;
  document.getElementById('aboutSettingsPanel').hidden = !about;
  if (focus) (about ? aboutButton : mixerButton).focus();
}
function bindAboutSettings() {
  const stats=window.DECKLAB_BUILD?.downloads;
  document.getElementById('aboutDownloadCount').textContent=Number.isSafeInteger(stats?.total)&&stats.total>=0 ? stats.total.toLocaleString() : 'Unavailable';
  document.getElementById('aboutDownloadsUpdated').textContent=stats?.updatedAt && Number.isFinite(Date.parse(stats.updatedAt)) ? new Date(stats.updatedAt).toLocaleDateString() : 'Not yet verified';
  document.getElementById('aboutVersion').textContent = window.DECKLAB_BUILD ? `${window.DECKLAB_BUILD.version} · build ${window.DECKLAB_BUILD.build || 'local'}` : 'Development build';
  document.getElementById('aboutRuntime').textContent = navigator.userAgent.includes('Electron/') ? 'Desktop' : 'Web browser';
  for (const [id,tab] of [['mixerSettingsTab','mixer'],['aboutSettingsTab','about']]) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => setSettingsTab(tab));
    button.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();
        setSettingsTab(event.key === 'Home' ? 'mixer' : event.key === 'End' ? 'about' : tab === 'mixer' ? 'about' : 'mixer',true);
      }
    });
  }
  document.getElementById('settingsBtn').addEventListener('click', () => setSettingsTab('mixer'));
}
