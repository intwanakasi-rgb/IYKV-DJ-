function readMidiMappings() {
  try {
    const saved = JSON.parse(localStorage.getItem('iykMidiMappings') || '{}');
    if (!saved || Array.isArray(saved) || typeof saved !== 'object') return {};
    return Object.fromEntries(Object.entries(saved).filter(([, mapping]) => {
      if (!mapping || typeof mapping !== 'object') return false;
      if (mapping.action) return /^(play|cue)-[01]$/.test(mapping.action);
      return mapping.role === 'crossfader' ||
        (['volume', 'low', 'mid', 'high', 'tempo', 'effect-amount'].includes(mapping.role) &&
          ['0', '1'].includes(String(mapping.deck)));
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

const state = {
  audioContext: null,
  masterGain: null,
  crossfader: 50,
  autoMix: false,
  autoMixStarting: false,
  autoMixRunId: 0,
  midiPickup: new Map(),
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
    masterVolume: 90,
    autoMixDuration: 12,
    crossfaderCurve: 'equal-power',
    decks: [
      { volume: 80, low: 0, mid: 0, high: 0, tempo: 0, effect: 'off', effectAmount: 50 },
      { volume: 80, low: 0, mid: 0, high: 0, tempo: 0, effect: 'off', effectAmount: 50 },
    ],
  },
};

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
    state.masterGain.connect(state.masterAnalyser);
    state.masterAnalyser.connect(state.audioContext.destination);
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
  high.connect(gainNode);
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
  analyser.connect(state.masterGain);

  deck.gainNode = gainNode;
  deck.low = low;
  deck.mid = mid;
  deck.high = high;
  deck.analyser = analyser;
  deck.effectNodes = { dryGain, filter, filterGain, delay, delayFeedback, delayGain };
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
      audio.currentTime = deck.loopStart;
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
  const trackTitle = document.getElementById(`trackName${deck.id === 0 ? 'A' : 'B'}`);
  const timeEl = document.getElementById(`time${deck.id === 0 ? 'A' : 'B'}`);
  const durationEl = document.getElementById(`duration${deck.id === 0 ? 'A' : 'B'}`);
  const bpmEl = document.getElementById(`bpm${deck.id === 0 ? 'A' : 'B'}`);
  const suffix = deck.id === 0 ? 'A' : 'B';

  if (trackTitle) {
    trackTitle.textContent = deck.fileName;
  }

  if (timeEl) {
    timeEl.textContent = formatTime(deck.currentTime);
  }

  if (durationEl) {
    durationEl.textContent = formatTime(deck.duration);
  }

  if (bpmEl) {
    bpmEl.textContent = `${Math.round(deck.bpm)} BPM`;
  }

  drawVisualizer(deck);
}

function drawVisualizer(deck) {
  const canvas = document.getElementById(`visual${deck.id === 0 ? 'A' : 'B'}`);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = Math.max(1, canvas.clientWidth * window.devicePixelRatio);
  const height = Math.max(1, canvas.clientHeight * window.devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const buffer = deck.frequencyBuffer;
  if (buffer) deck.analyser.getByteFrequencyData(buffer);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);
  const bars = 96;
  const gap = 2 * window.devicePixelRatio;
  const barWidth = width / bars;
  const progress = deck.duration ? deck.currentTime / deck.duration : 0;

  for (let index = 0; index < bars; index += 1) {
    const sample = buffer ? buffer[Math.min(buffer.length - 1, Math.floor(index / bars * buffer.length))] / 255 : 0;
    const level = buffer ? sample : 0;
    const barHeight = Math.max(3 * window.devicePixelRatio, level * height * 0.82);
    const x = index * barWidth;
    ctx.fillStyle = x / width < progress ? '#b977ff' : deck.id === 0 ? '#6e57dd' : '#19bfd0';
    ctx.fillRect(x + gap / 2, (height - barHeight) / 2, Math.max(1, barWidth - gap), barHeight);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(progress * width, 0, Math.max(1, window.devicePixelRatio), height);
}

function setStatus(message) {
  statusPill.textContent = message;
}

function updateMasterMeter() {
  if (!state.masterAnalyser) return;
  const samples = state.masterFrequencyBuffer;
  state.masterAnalyser.getByteTimeDomainData(samples);
  const rms = Math.sqrt(samples.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0) / samples.length);
  const activeCount = Math.min(8, Math.round(rms * 18));
  document.querySelectorAll('.meter-track i').forEach((segment, index) => {
    segment.classList.toggle('active', index < activeCount);
    segment.classList.toggle('clipping', rms > 0.95 && index >= 6);
  });
}

function runAutoMix() {
  const startedAt = performance.now();
  const startValue = state.crossfader;
  const incomingDeck = state.autoMixIncoming;
  const outgoingDeck = getDeckById(1 - incomingDeck);
  const endValue = incomingDeck === 1 ? 100 : 0;
  const duration = state.settings.autoMixDuration * 1000;
  const update = (now) => {
    if (!state.autoMix) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    crossfaderInput.value = String(startValue + (endValue - startValue) * progress);
    applyCrossfader();
    if (progress < 1) {
      state.autoMixFrame = requestAnimationFrame(update);
    } else {
      state.autoMix = false;
      pauseDeck(outgoingDeck.id);
      toggleAutoMixBtn.textContent = 'AUTO MIX';
      setStatus('Auto mix complete');
    }
  };
  state.autoMixFrame = requestAnimationFrame(update);
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

async function startAutoMix() {
  const loadedDecks = deckState.filter((deck) => deck.objectUrl);
  if (loadedDecks.length !== deckState.length) {
    setStatus('Load a track on both decks before auto mix');
    return;
  }

  toggleAutoMixBtn.disabled = true;
  state.autoMixStarting = true;
  const runId = ++state.autoMixRunId;
  let outgoingDeck = deckState.find((deck) => deck.isPlaying);
  if (!outgoingDeck) outgoingDeck = getDeckById(state.crossfader > 50 ? 1 : 0);
  const incomingDeck = getDeckById(1 - outgoingDeck.id);

  try {
    const startPromises = deckState
      .filter((deck) => !deck.isPlaying)
      .map((deck) => startDeckPlayback(deck));
    const startedDecks = await Promise.all(startPromises);
    if (runId !== state.autoMixRunId) return;
    if (startedDecks.some((started) => !started)) return;

    state.autoMixIncoming = incomingDeck.id;
    state.autoMix = true;
    toggleAutoMixBtn.textContent = 'CANCEL MIX';
    setStatus(`Mixing into deck ${incomingDeck.id === 0 ? 'A' : 'B'}`);
    runAutoMix();
  } finally {
    if (runId === state.autoMixRunId) state.autoMixStarting = false;
    toggleAutoMixBtn.disabled = state.autoMixStarting;
  }
}

function cancelAutoMix() {
  state.autoMixRunId += 1;
  state.autoMix = false;
  state.autoMixStarting = false;
  cancelAnimationFrame(state.autoMixFrame);
  toggleAutoMixBtn.disabled = false;
  toggleAutoMixBtn.textContent = 'AUTO MIX';
  setStatus('Auto mix cancelled');
}

function startRecording() {
  if (!window.MediaRecorder || !state.audioContext?.createMediaStreamDestination) {
    setStatus('Recording is not supported in this browser');
    return;
  }
  const destination = state.audioContext.createMediaStreamDestination();
  state.masterGain.connect(destination);
  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']
    .find((type) => MediaRecorder.isTypeSupported(type));
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    state.masterGain.disconnect(destination);
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
    state.masterGain.disconnect(destination);
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

function onMidiMessage(event) {
  const [status, number, value] = event.data;
  const type = status & 0xf0;
  if (event.data.length !== 3 || ![0x80, 0x90, 0xb0].includes(type) ||
      number > 127 || value > 127) return;
  const released = type === 0x80 || (type === 0x90 && value === 0);
  if (released) return;
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

  const target = state.midiMappings[key];
  if (!target) return;
  if (target.role && type === 0xb0) {
    const control = target.role === 'crossfader'
      ? crossfaderInput
      : document.querySelector(`[data-role="${target.role}"][data-deck="${target.deck}"]`);
    if (!control || control.type !== 'range') return;
    const min = Number(control.min), max = Number(control.max);
    const current = (Number(control.value) - min) / (max - min);
    const position = value / 127;
    const pickup = state.midiPickup.get(key);
    // Re-arm if the mouse or another control changed the software value.
    const acquired = pickup?.acquired && Math.abs(current - pickup.applied) < 0.015;
    const crossed = pickup && (pickup.previous - current) * (position - current) <= 0;
    if (!acquired && Math.abs(position - current) > 2 / 127 && !crossed) {
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
    if (action === 'play') togglePlay(Number(deck));
    if (action === 'cue') cueDeck(Number(deck));
  }
}

async function initializeMidi() {
  if (!navigator.requestMIDIAccess) {
    midiLearnBtn.disabled = true;
    midiLearnBtn.title = 'Web MIDI is unavailable in this browser';
    return;
  }
  try {
    state.midiAccess = await navigator.requestMIDIAccess();
    const connectInputs = () => {
      state.midiPickup.clear();
      const inputs = [...state.midiAccess.inputs.values()].filter((input) => input.state === 'connected');
      for (const input of inputs) input.onmidimessage = onMidiMessage;
      audioStatus.textContent = inputs.length
        ? `MIDI ${inputs.length} CONNECTED`
        : 'AUDIO ENGINE IDLE';
    };
    state.midiAccess.onstatechange = connectInputs;
    connectInputs();
  } catch (error) {
    midiLearnBtn.disabled = true;
    midiLearnBtn.title = 'MIDI access was not granted';
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
  if (state.autoMix || state.autoMixStarting) cancelAutoMix();
  deck.currentTime = 0;
  deck.duration = 0;

  deck.fileName = options.name || file.name.replace(/\.[^/.]+$/, '');
  deck.bpm = Number(options.bpm || deck.baseBpm || 120);
  deck.baseBpm = deck.bpm;
  deck.cuePoint = Number(options.cuePoint || 0);
  deck.libraryId = options.id || crypto.randomUUID();
  deck.loopStart = Number.isFinite(options.loopStart) ? options.loopStart : null;
  deck.loopEnd = Number.isFinite(options.loopEnd) ? options.loopEnd : null;
  document.getElementById(`loopState${deckId === 0 ? 'A' : 'B'}`).textContent = deck.loopEnd === null ? 'OFF' : '4 BEATS';

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
    bpm: deck.baseBpm,
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
  setStatus(`Loaded ${deck.fileName} on deck ${deckId === 0 ? 'A' : 'B'}`);
}

function renderPlaylist() {
  playlistEl.innerHTML = '';
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const sortBy = document.getElementById('sortSelect').value;
  const tracks = state.library
    .filter((item) => item.name.toLowerCase().includes(query))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : b.addedAt - a.addedAt);

  tracks.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'track-row';
    const name = document.createElement('button');
    name.className = 'track-name';
    name.type = 'button';
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${item.bpm || 120} BPM`;
    const deckActions = document.createElement('div');
    deckActions.className = 'deck-load-actions';
    [0, 1].forEach((deckId) => {
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.textContent = deckId === 0 ? 'A' : 'B';
      loadButton.title = `Load ${item.name} on deck ${deckId === 0 ? 'A' : 'B'}`;
      loadButton.addEventListener('click', () => loadTrackForDeck(deckId, item.file, { ...item, fromLibrary: true }));
      deckActions.appendChild(loadButton);
    });
    deckActions.prepend(meta);
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
  if (!deck.objectUrl) {
    setStatus(`Load a track on deck ${deckId === 0 ? 'A' : 'B'} before playing`);
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
  deck.audio.pause();
  deck.isPlaying = false;
  document.querySelector(`[data-action="play"][data-deck="${deckId}"]`).textContent = '▶';
  setStatus(`Paused ${deck.fileName}`);
}

function cueDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck.audio) return;
  if (deck.isPlaying) {
    deck.cuePoint = deck.audio.currentTime;
    deck.audio.pause();
    deck.isPlaying = false;
    document.querySelector(`[data-action="play"][data-deck="${deckId}"]`).textContent = '▶';
    saveCue(deck);
  } else {
    deck.audio.currentTime = deck.cuePoint || 0;
  }
  updateDeckView(deck);
  setStatus(deck.cuePoint ? `Cue saved at ${formatTime(deck.cuePoint)}` : `Returned to cue on ${deck.fileName}`);
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
  const { dryGain, filter, filterGain, delay, delayGain } = deck.effectNodes;

  if (effect === 'filter') {
    dryGain.gain.value = 1 - amount;
    filterGain.gain.value = amount;
    filter.frequency.value = 18000 * (350 / 18000) ** amount;
    delayGain.gain.value = 0;
  } else if (effect === 'echo') {
    dryGain.gain.value = 1;
    filterGain.gain.value = 0;
    delayGain.gain.value = amount * 0.7;
    delay.delayTime.value = 0.28;
  } else {
    dryGain.gain.value = 1;
    filterGain.gain.value = 0;
    delayGain.gain.value = 0;
  }
  document.getElementById(`effectValue${deckId === 0 ? 'A' : 'B'}`).textContent = `${Math.round(amount * 100)}%`;
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
    if (Number.isFinite(saved.masterVolume)) state.settings.masterVolume = Math.max(0, Math.min(100, saved.masterVolume));
    if (Number.isFinite(saved.autoMixDuration)) state.settings.autoMixDuration = Math.max(4, Math.min(30, saved.autoMixDuration));
    if (saved.crossfaderCurve === 'linear' || saved.crossfaderCurve === 'equal-power') {
      state.settings.crossfaderCurve = saved.crossfaderCurve;
    }
    if (Array.isArray(saved.decks)) {
      saved.decks.forEach((deck, index) => {
        if (!deck || !state.settings.decks[index]) return;
        const ranges = {
          volume: [0, 100],
          low: [-12, 12],
          mid: [-12, 12],
          high: [-12, 12],
          tempo: [-10, 10],
          effectAmount: [0, 100],
        };
        Object.entries(ranges).forEach(([key, [min, max]]) => {
          if (Number.isFinite(deck[key])) state.settings.decks[index][key] = Math.max(min, Math.min(max, deck[key]));
        });
        if (['off', 'filter', 'echo'].includes(deck.effect)) state.settings.decks[index].effect = deck.effect;
      });
    }
  } catch (error) {
    setStatus(`Saved settings could not be read: ${error.message}`);
  }
}

function syncSettingsControls() {
  const settings = state.settings;
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
    saveLoop(deck);
    document.getElementById(`loopState${deckId === 0 ? 'A' : 'B'}`).textContent = 'OFF';
    setStatus(`Loop disabled on deck ${deckId === 0 ? 'A' : 'B'}`);
    return;
  }
  const beatDuration = 60 / Math.max(1, deck.baseBpm);
  deck.loopStart = deck.audio.currentTime;
  deck.loopEnd = Math.min(deck.duration, deck.loopStart + beatDuration * 4);
  saveLoop(deck);
  document.getElementById(`loopState${deckId === 0 ? 'A' : 'B'}`).textContent = '4 BEATS';
  setStatus(`4 beat loop set on deck ${deckId === 0 ? 'A' : 'B'}`);
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
  if (state.autoMix || state.autoMixStarting) cancelAutoMix();
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
  const deckA = getDeckById(0);
  const deckB = getDeckById(1);

  if (!deckA.objectUrl || !deckB.objectUrl) {
    setStatus('Load tracks to sync BPM');
    return;
  }

  const tempoControl = document.querySelector('input[data-role="tempo"][data-deck="1"]');
  const requestedPitch = (deckA.bpm / deckB.baseBpm - 1) * 100;
  tempoControl.value = String(Math.max(-10, Math.min(10, requestedPitch)));
  updateDeckAudioFromControls(1);
  saveSettings();
  setStatus(Math.abs(requestedPitch) > 10
    ? `Sync limited to ±10%: deck B is ${deckB.bpm.toFixed(1)} BPM`
    : `Deck B matched to ${deckB.bpm.toFixed(1)} BPM`);
}

function applyCrossfader() {
  const value = Number(crossfaderInput.value);
  state.crossfader = value;

  const deckA = getDeckById(0);
  const deckB = getDeckById(1);

  [deckA, deckB].forEach((deck) => {
    const volume = Number(document.querySelector(`input[data-role="volume"][data-deck="${deck.id}"]`)?.value ?? 80) / 100;
    const position = value / 100;
    const balance = state.settings.crossfaderCurve === 'linear'
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
  const balance = state.settings.crossfaderCurve === 'linear'
    ? deckId === 0 ? 1 - position : position
    : deckId === 0 ? Math.cos(position * Math.PI / 2) : Math.sin(position * Math.PI / 2);
  deck.gainNode.gain.value = volume * balance * 0.8;
  deck.low.gain.value = low;
  deck.mid.gain.value = mid;
  deck.high.gain.value = high;
  deck.bpm = tempo;
  document.getElementById(`tempoValue${deckId === 0 ? 'A' : 'B'}`).textContent = `${pitch > 0 ? '+' : ''}${pitch.toFixed(1)}%`;
  Object.assign(state.settings.decks[deckId], { volume: Number(volumeSlider?.value ?? 80), low, mid, high, tempo: pitch });

  if (deck.audio) {
    deck.audio.playbackRate = tempo / deck.baseBpm || 1;
  }

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
        togglePlay(deckId);
      }

      if (action === 'pause') {
        pauseDeck(deckId);
      }

      if (action === 'cue') {
        cueDeck(deckId);
      }
      if (action === 'loop') toggleLoop(deckId);
    });
  });

  document.querySelectorAll('input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const role = input.dataset.role;
      const deckId = Number(input.dataset.deck);

      if (role === 'volume' || role === 'low' || role === 'mid' || role === 'high' || role === 'tempo') {
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
    if (state.autoMix || state.autoMixStarting) cancelAutoMix();
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
    if (state.autoMix) {
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
        type: file.type, size: file.size, addedAt: Date.now(), bpm: 120,
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
  try {
    state.database = await openLibraryDatabase();
    state.library = await readLibrary();
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

  const animationLoop = () => {
    deckState.forEach((deck) => {
      if (deck.analyser) {
        drawVisualizer(deck);
      }
    });
    updateMasterMeter();
    requestAnimationFrame(animationLoop);
  };

  requestAnimationFrame(animationLoop);
}

window.addEventListener('load', init);

