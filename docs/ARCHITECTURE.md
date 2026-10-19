# Architecture Decision

## Status

Proposed native foundation; not implemented in the current prototype. The runnable Phase 1 code still uses browser Web Audio.

## Decision

Evaluate **RtAudio + RtMidi** as the C++ platform I/O boundary for the native audio engine. The project's current upstream README documents Linux ALSA/JACK/PulseAudio/OSS, macOS CoreAudio/JACK, and Windows DirectSound/ASIO/WASAPI. The upstream license files currently identify both libraries as MIT. Preserve their copyright/license notices in binary distributions and track the upstream versions used.

The Windows default should be WASAPI shared mode for reliable setup, with exclusive-mode support evaluated and tested separately. ASIO may be offered only after its separately licensed SDK, build terms, and redistribution conditions have been reviewed; RtAudio's backend list does not grant rights to distribute the ASIO SDK. macOS and Linux backend availability still depends on native build libraries, permissions, and the exact target distribution.

Keep all device I/O and deck summing in one native callback. The callback must not allocate, lock, perform file access, decode, log, analyze, access the UI, or wait on another thread. Decode audio ahead of playback, feed bounded lock-free or carefully bounded SPSC queues, and expose meters through preallocated atomics or snapshots. Library scanning, waveform/BPM/key analysis, SQLite access, UI rendering, and file encoding run on worker threads. Recording consumes a preallocated copy/tap from the master path and writes off the callback.

Build the engine as a reusable C++ library with a narrow command/event interface. Desktop UI and platform shells call the same deck, mixer, transport, and session API. Platform-specific device enumeration and permissions stay behind the RtAudio/RtMidi adapters. Keep library/session data portable and versioned separately from app settings and OS device identifiers.

## Dependency/license follow-up

Before adding a decoder, database, effects, or stem model, record its exact version, license, transitive codec/model licenses, attribution, and redistribution obligations. RtAudio/RtMidi's MIT licenses do not cover ASIO SDK files, codec patent claims, music content, or any additional dependency. Do not ship a stem model until its model/runtime licenses have been checked independently.

## Acceptance gates

1. Unit-test mixing math, tempo, cue and loop boundaries, channel routing, and session migrations without hardware.
2. Test actual two-deck playback, pitch, EQ, gain, crossfader, recorder content, device loss/recovery, MIDI Learn and disconnect on documented Windows machines and devices.
3. Measure output latency, callback CPU use and dropouts at documented sample rates/buffer sizes. Do not publish target claims before repeatable tests.
4. Run long-session and offline tests, verify autosave recovery offers restore without resuming playback, and test installers on clean supported operating systems.
5. Add macOS/Linux/mobile support only after each target has a tested native build and documented setup.
