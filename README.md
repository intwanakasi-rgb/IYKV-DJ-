# IYK DeckLab

**IYK DeckLab by Intwana Yase Kasi** is a free, local-first two-deck DJ practice project. It currently runs in a modern browser and can be packaged as an Electron desktop application. It has no account, subscription, advertisement, sample pack, or cloud dependency.

## Current status

This repository is an early Web Audio prototype, not yet a professional low-latency DJ release. The completed interface and code paths are listed below; unverified or incomplete features are not represented as supported.

| Area | Current implementation | Status |
| --- | --- | --- |
| Decks | Two local-file decks, independent transport, seek, pitch playback-rate adjustment, 3-band EQ, channel level and selectable equal-power/linear crossfader | Browser implementation; hardware/audio latency not measured |
| Effects and settings | Per-deck low-pass filter and echo with adjustable amount; saved master output level, Auto Mix duration, crossfader curve, channel, EQ, pitch and effect preferences | Preferences are stored in the current browser profile |
| Auto Mix | Starts any stopped deck before fading, checks that both tracks are loaded, and pauses the outgoing deck after the transition | Fixed tempo/beat alignment is not automatic; match BPM manually when needed |
| Sync | Matches deck B's manually selected BPM to deck A | Manual BPM values only; no automatic BPM/beat-grid analysis |
| Library | IndexedDB-backed imported audio files, search by filename, sort by added/name, select a deck using its load button | No folder scan, metadata editor, playlist/crate, or missing-file relocation |
| Cue and loop | One persistent cue point and manually started 4-beat loop per imported track | No hot-cue bank, quantisation, editable beat-grid, or automatic loop alignment |
| Recording | Captures the master mix through MediaRecorder and downloads WebM/Opus or Ogg where supported | Browser codec/container support varies; no crash recovery or tracklist sidecar |
| Controller | Basic Web MIDI Learn for transport, channel level, EQ, effect amount and crossfader; mappings persist in local storage | Chromium/secure-context dependent; no MIDI output, soft takeover, conflict editor, mapping import/export, or physical hardware verification |
| Metering | Live spectrum and master RMS meter from the audio graph | Not a calibrated peak/clipping meter |
| Platforms | Web practice build and Electron desktop packaging configuration | Windows artifact is not built/tested in this Linux workspace; macOS, Linux and mobile are not supported releases |

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm ci
npm run web:dev
```

Open the local URL printed by Vite. Browser audio and MIDI permissions depend on browser policy; MIDI usually needs HTTPS or localhost and a compatible Chromium-based browser. The application does not upload imported audio.

## Desktop builds

```sh
npm ci
npm run desktop
```

Build the Windows x64 NSIS installer on Windows:

```sh
npm ci
npm run package:win
```

Click **Download Windows** in the app to download the latest installer directly, or open [All versions](https://github.com/intwanakasi-rgb/IYKV-DJ-/releases) to choose a release. The stable direct installer link works once a release has been published. Pushing a version tag such as `v0.1.0` runs the release workflow and attaches the unsigned Windows installer and its package archive. Until a version is published, the [Windows desktop build workflow](https://github.com/intwanakasi-rgb/IYKV-DJ-/actions/workflows/windows.yml) provides a `IYK-DeckLab-Windows` artifact (available for 14 days). The installer is not code-signed; SmartScreen reputation requires a publisher certificate. A Windows runner and compatible audio hardware are needed to verify the actual desktop experience.

Build the static web version with `npm run web:build`. The Pages workflow deploys it after the repository is pushed to GitHub and GitHub Pages is enabled. No online deployment or tagged release has been performed from this workspace.

## Audio architecture decision

The inherited application is built around the browser Web Audio API, so this Phase 1 foundation preserves that runnable code rather than pretending it already has native device access. Web Audio gives this project a small, no-account practice build, but it cannot provide the promised dedicated real-time audio callback, ASIO configuration, configurable native buffer sizes, reliable headphone routing, or measured low-latency guarantees.

Before a native-engine migration, verify the exact current licenses, backend coverage, decoder terms, and supported hardware against upstream project documentation. The shortlist to evaluate is **RtAudio + RtMidi** (permissive MIT-licensed audio/MIDI layers, with backend availability dependent on platform/build), versus **miniaudio** (permissive MIT-licensed single-header audio layer; verify backend and ASIO requirements). A native engine would own playback, mixing, device routing, recording, and MIDI; UI, analysis, library indexing, and waveform rendering must communicate with it through bounded queues and stay outside the real-time callback. This repository does not bundle either framework and has not yet adopted that native architecture. JUCE's dual GPL/commercial model needs a separate distribution decision and is not included.

## Free software and licenses

Project code is MIT licensed. Electron, electron-builder, and Vite are build dependencies; their upstream licenses are MIT. Electron and its transitive runtime dependencies carry additional notices, which must be included with distributed packages. Run `npm ci` and inspect the exact lockfile/dependency license notices before publishing binaries. No audio decoders, machine-learning models, copyrighted music, or sample packs are bundled. Users are responsible for having rights to music they play or record.

## Roadmap

1. **Phase 1 foundation:** replace the Web Audio prototype with a tested native shared engine; verify independent playback, EQ, gain, pitch, loops, recording, persistence, and MIDI Learn on documented Windows hardware; add automated engine/integration tests.
2. **Performance and desktop expansion:** device routing, headphone cue, mappings and recovery; then tested macOS and documented Linux builds.
3. **Advanced tools:** hot cues, four decks, prepared stems, sampler, broadcasting, lessons.
4. **Mobile and ecosystem:** touch applications, local-network companion, practice web build, optional IYK services.

Nothing in phases 2–4 is represented as implemented. Android and iOS need native app/audio integrations and separate physical-device testing. Platform support, performance, latency, and controller compatibility must be reported only after testing on the actual target hardware.