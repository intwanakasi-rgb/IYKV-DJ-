# IYK DeckLab

**Free DJ practice and mixing software by Intwana Yase Kasi.** No accounts, subscriptions, feature paywalls, advertisements or mandatory cloud service. Local music stays on the device.

## Classic workspace

- Two/four decks around a central channel mixer; track browser and Automix queue underneath.
- Per-channel gain, three-band EQ, bipolar filter, vertical level fader, peak meter and PFL.
- Scrolling prepared waveform, full-track overview, cue markers, estimated beat grid, elapsed/remaining time, editable BPM and beat anchor.
- Jog seeking, temporary pitch nudges, selectable beat loops, eight persistent hot cues per track, filter/echo effects and keyboard controls.
- Browser search, BPM/duration/name sorting, favourites, custom crates, drag-to-deck loading and persistent local audio library.
- Channel-aware Web MIDI Learn with soft takeover, cue press/release, gain, filter, EQ, pitch, effect amount and level targets. Physical devices are not certified.
- Master recording and output peak protection through a Web Audio compressor.

The native desktop audio engine described in `docs/ARCHITECTURE.md` is still future work. This release uses Web Audio and HTML media, including in Electron. It is not equivalent to VirtualDJ's professional engine.

## Version and downloads

Current version: **0.2.0**. Open **Settings → About & Downloads** to see the running version, web/desktop runtime and Windows/web build download links. Version metadata is generated from `package.json` before web and desktop builds, so both interfaces display the same release number. Settings opens on Mixer & Layout; About is a separate keyboard-accessible tab. About includes Other IYK Apps with a link to https://iykhub.online/.

The download counter sums GitHub release installer asset counts, excluding drafts, checksums, package archives and development workflow ZIP downloads. Counts are fetched during web/Windows builds using the workflow token, embedded as a dated snapshot, and never require shipping a token to users. Failed refreshes retain the last verified snapshot. No published releases currently means zero release downloads, even if development ZIPs have been downloaded.

The main-branch Pages workflow builds the same interface as desktop, uploads `IYK-DeckLab-Web` for download and deploys to GitHub Pages. First-time hosting must be enabled in repository **Settings → Pages → Source: GitHub Actions**; the connector used for development cannot change this administrative setting. If deployment is not enabled, the static web artifact is still available to download or host elsewhere.

## Mixer appearance and performance tabs

The default layout uses **vertical mixer sliders** and **stacked waveforms above the decks**. In Settings, choose vertical sliders, rotary knobs or horizontal sliders. Knobs support vertical dragging, keyboard arrows and double-click to reset to zero; channel volume remains a vertical fader in every mode. Changing control style does not reset the mix.

Each channel has **two coloured L/R level bars** beside its controls, measured independently after channel level and effects. The master output also has separate L/R bars. Meters use a −60 to 0 dBFS display scale, green/yellow/red regions, clipping indicators and optional peak hold; choose Peak or RMS mode in Settings. These are digital signal meters, not calibrated hardware meters.

Each deck has **Hot Cues** and **Effects** tabs. Effects has its own selector/amount and quick Off, Low-pass and Echo buttons. Tabs work with mouse and keyboard arrows. Choose the default deck tab in Settings.

Other saved preferences include waveform placement (stacked or within decks), height and zoom, comfortable/compact spacing, dark/high-contrast/daylight themes, text size, jog-wheel and overview visibility, reduced display motion, meter mode and peak-hold duration. Reset appearance restores these defaults without changing channel levels or audio settings. Device and music data are not reset.

## First session

1. Import audio files. Importing never replaces a playing track.
2. Loading a track automatically prepares its waveform and estimates BPM. Use **ANALYSE** to retry preparation if needed. Analysis is local, serialised, and uses a worker. For browser memory limits, files must be at most 100 MB and decoded tracks at most 30 minutes.
3. Load a track with A/B/C/D or drag it onto a deck. Verify estimated BPM (`≈`), correct the BPM field if necessary, and use **SET BEAT** on a known beat. Analysis cannot reliably infer musical downbeats or variable-tempo grids.
4. Use **SET CUE** to store a cue explicitly. CUE during playback returns to that cue; when paused, hold CUE to preview and release to return. Press Play while holding CUE to keep playing.
5. An empty hot-cue pad saves its position. A filled pad jumps and starts playback. Shift+click clears it. Click a deck to select it for keyboard control: Space toggles playback; number keys 1–8 trigger pads when not editing another control.
6. SYNC has selectable master and target decks. It matches tempo within ±10% and aligns running tracks to their grid phase. Verify estimated grids by ear. It does not continuously correct drift or provide phrase/variable-tempo sync.

A/B use the crossfader. C/D are independent channels controlled by their faders. Switching to two decks pauses C/D and disables their headphone cues.

## Queued Automix

Use **+ QUEUE** on tracks and press **START** or **AUTOMIX**. If no track is loaded, the first queued track loads into A. The next track preloads into the other A/B deck but stays paused until the outgoing track approaches its end. Automix fades using the configured transition length, pauses the outgoing deck and continues through the queue. **MIX NOW** starts the transition early. An active loop holds automatic advance until disabled or Mix Now is pressed.

Stopping Automix leaves the audible track playing for manual control. **Stop all** stops playback and automation. Moving the A/B crossfader or manually operating an A/B transport cancels automation. Queue contents persist but automation never starts automatically after reopening. C/D are not part of the queue.

Fades use audio-clock gain curves and desktop background throttling is disabled. Browsers can still throttle background queue timers. For unattended playback, verify the desktop build on the actual machine.

## Headphone preview

Open **Settings → Refresh devices**, select a physically separate headphone device, and use channel **PFL** buttons. Set headphone level and cue/master blend there. Cue audio is tapped before the channel fader, so tracks can be previewed with their master channel muted.

This requires `setSinkId` support and output devices exposed by the runtime/permissions. Master uses the system default device. Do not select that same physical output for headphones. Device-based routing is not ASIO or channel-pair routing on a professional multichannel interface. Hardware routing and latency must be tested on the target setup. An unavailable output is reported explicitly; the application does not simulate headphone separation.

## Library and crates

Create a crate in the browser sidebar, choose its destination in the toolbar, and use **+ CRATE** on any track. Select the crate to view its tracks; **− CRATE** removes membership without deleting audio. Favourites, cues, loops, preparation data and audio files are stored in IndexedDB. Crate definitions, settings, MIDI mappings and queue IDs are local preferences. Browser profile removal deletes this local data; there is no cloud backup.

Track names come from filenames. Full ID3/artwork/key analysis, filesystem folder browsing and external-drive relocation are not implemented.

## Run and test

Use Node.js 22.12 or newer and npm.

```sh
npm ci
npm run web:dev
npm run desktop
```

Browser MIDI generally requires HTTPS/localhost and a compatible browser. All platforms require actual audio/controller testing.

```sh
npm test
npm run check
npm run web:build
npx playwright install chromium
npm run test:browser
```

The browser test serves the app locally, generates its own WAV tracks, checks real audio graph output, worker preparation, cue preview, hot cues, crates/favourites, queue progression, persistence and responsive layout. It does not certify physical audio hardware. `CHROMIUM_EXECUTABLE` can select an existing Chromium binary. Test-only hooks are added by the test server and are absent from the shipped application.

## Desktop installers and release downloads

```sh
npm run package:win
npm run package:linux
```

Packaging explicitly uses `--publish never`; installers are uploaded as workflow artifacts. The Windows workflow builds pull requests and main. An artifact ZIP expires after 14 days and private-repository downloads require access.

[Windows builds](https://github.com/intwanakasi-rgb/IYKV-DJ-/actions/workflows/windows.yml) · [Releases](https://github.com/intwanakasi-rgb/IYKV-DJ-/releases)

Publishing a `v*` tag or manually running **Publish Windows release** now requires trusted signing credentials, signs the app/installer, verifies their Authenticode signatures and timestamps, and uploads the installer plus checksum using the workflow token. The direct latest-installer link works only after a release exists. Repository privacy still controls access. Development artifacts are unsigned and may show SmartScreen’s Unknown publisher warning. Signed release support is prepared, but no signing certificate has been configured; see [Windows signing setup](docs/WINDOWS_SIGNING.md). Windows builds, Linux packaging, macOS and mobile support must not be represented as hardware-verified until tested. Android/iOS apps and macOS packaging are not implemented.

## Remaining professional release work

Native low-latency audio/device routing, ASIO, multichannel headphone outputs, sample-accurate loops, scratch-quality jog/HID/DVS handling, hardware presets/LED output, stems, sampler, video/karaoke/broadcasting, robust recording-to-disk/crash recovery, metadata/key detection and variable-tempo grids remain future work. Browser analysis estimates are a preparation aid, not a guarantee of correct beat/downbeat detection.

Project code is MIT licensed. Build/runtime dependency notices must accompany distributions; no copyrighted music, sample packs or ML models are bundled. Playwright is used only for development tests.

Effects per deck: low-pass, high-pass, band-pass, echo, beat-timed dub delay, reverb and drive, with an amount control and Off.

Windows downloads now use the latest release installer directly. Successful main-branch Windows builds publish an explicitly labelled unsigned development release with SHA256 checksums. Signed releases still require the signing credentials and verification workflow.

DDJ-FLX2: connect with USB, click **Connect controller**, and allow MIDI permission. Its factory MIDI preset applies automatically by device name; saved MIDI Learn mappings take priority. Under Controller Mapping choose A/B or C/D (four-deck mode). Supported: Play/Cue, EQ, tempo/faders (MSB resolution with soft takeover), filter, PFL, Sync, hot-cue pad mode 1 and relative jog seeking. VINYL enables PCM scratching; LEDs, Smart Fader and hardware audio/headphone routing are not implemented by this preset. Preset tested with synthetic messages, not physical hardware. Source: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf

FLX2 effects (0.2.3): SHIFT + SMART FADER toggles the selected effect for both decks in the active pair (Echo if no previous choice). Select individual effects in each deck's Effects tab. With an effect enabled, its CFX knob adjusts wet amount (centre dry, either extreme full); with effects off it controls the normal filter. 0.3.0 adds VINYL PCM scratching and SLIP; see docs/VDJ_COMPARISON.md for limits.

0.3.0: per-deck VINYL/SLIP buttons; FLX2 platter touch starts PCM scratching and release resumes playback, with Slip restoring the uninterrupted timeline. [VirtualDJ comparison and roadmap](docs/VDJ_COMPARISON.md).
