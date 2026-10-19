# Reliability review — 19 October 2026

## Fixed

- Electron's default session was accessed before `app.whenReady()`, which can prevent desktop startup. Permission setup now happens after readiness; only the local application page may request MIDI. Navigation compares a correctly encoded file URL, including on Windows.
- Auto Mix's generation counter was initialised on a deck instead of the shared state. The first run generated NaN and never entered the fade. Counter and starting state now belong to shared state.
- Echo's wet gain had no connection to the output analyser, making echo inaudible.
- Fresh imports had no deck library ID, so cue and loop writes could not locate their library entry.
- Batch import replaced deck A repeatedly, including during playback. It now imports to the library; loading an already-playing deck is rejected with an explanation.
- Loaded tracks now apply saved EQ, tempo and effects. Effective playback BPM no longer overwrites the original library BPM. Source-time loop length uses original tempo to avoid applying pitch twice.
- Sync now applies the displayed ±10% limit to the actual playback rate and saves that setting.
- Invalid saved MIDI JSON no longer crashes startup. Mapping validation rejects unknown targets.
- MIDI mappings preserve channel identity. Learn ignores releases and unsupported packets; continuous controls require CC messages. Transport also accepts CC buttons. Soft takeover prevents large fader jumps, and reconnects re-arm pickup. Tempo is available in the learn target list.
- Recording stop/download retains its own chunks and recorder reference, blocks restart while finalising, and releases the stream and in-memory chunks afterwards.

Existing MIDI mappings used channel-agnostic keys: re-learn controls after upgrading. New mappings remain local to the current profile. MIDI output, proprietary HID, jog-wheel modes, mapping import/export, and tested device presets are still future work.

## Validation

- `npm test`: focused dependency-free regression tests using the actual application code with mocked DOM, audio nodes, and MIDI events.
- `npm run check`: JavaScript syntax checks.
- `npm run web:build`: Vite production build.
- GitHub checks run the tests and web build on Windows, macOS, and Linux. This checks code portability; it does not certify native installers or hardware.

## Remaining release gates

The application still uses Web Audio/HTML media, not a native professional audio engine. There is no independent headphone output, ASIO configuration, real beat-grid sync, reliable sample-accurate looping, stems, or jog-wheel scratching. The displays are live frequency spectra, not precomputed track waveforms. BPM defaults to 120 rather than being detected.

Test an actual Windows installer, physical MIDI controller, audio interface, independent outputs, offline restart, and long sets before live performances. Mobile apps are not implemented. macOS/Linux packaging must be verified separately. Recording remains memory-backed and has no crash recovery; long recordings need a disk-backed design.
