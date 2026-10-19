# DeckLab compared with VirtualDJ — 19 October 2026

DeckLab is a free local-first prototype, not yet a replacement for VirtualDJ at a professional gig. This compares the repository implementation with VirtualDJ's published manual; it is not a measured audio-quality or latency benchmark.

| Area | DeckLab | VirtualDJ / remaining work |
| --- | --- | --- |
| Layout | Two/four decks, stacked waves, mixer, Hot Cues/Effects tabs, library/crates | Refine four-deck proportions, resize panels, consistent focus states and controller feedback. |
| Scratch / Slip | 0.3.0 adds stereo PCM forward/reverse scratching in an AudioWorklet; Slip resumes the underlying clock after scratch, loops and held hot cues | VDJ has established Vinyl/CD jog behaviour and Slip. DeckLab needs hardware tuning, smoother motion, latency benchmarks and edge-case soak testing. |
| Controller | FLX2 basic MIDI preset, CFX effects, manual A/B–C/D bank, MIDI Learn | VDJ documents native FLX2 integration. DeckLab lacks verified LED feedback, comprehensive pad modes and many controller profiles. |
| Audio | Browser/Electron Web Audio, optional separate-device PFL | VDJ supports broader audio setups and ASIO latency options. Native multi-output audio and reliable FLX2 headphone routing are high priority. |
| Preparation / sync | Estimated BPM/grid, manual beat anchor, limited tempo sync | Improve difficult/variable BPM detection, grid editor, key analysis and tested time stretching/key lock. |
| Library | Import, search, crates, favourites, local storage | Add folders/watch folders, metadata editing, missing-file recovery, history, portable backups and large-library performance checks. |
| Effects | Seven audio effects plus Off, one selection per deck | Add beat divisions, multi-parameter controls, FX chains and better gain matching. Test with the FLX2. |
| Performance | Eight hot cues and beat loops | Add sampler banks, beat jump, loop roll, saved loops and richer pad modes. |
| Stems | None | VDJ separates stems and offers stem controls. This requires a separate local model, processing and hardware-budget project. |
| Automix | A/B queue and end-of-track gain crossfade | Add saved transition points, phrase-aware transitions, configurable deck routing and robust unattended tests. |
| Video / karaoke / DVS / broadcast | Not implemented | These are documented VDJ features; lower priority than dependable audio mixing. |
| Platforms / delivery | Windows installer and web build; Linux build configuration | Signed Windows releases, update notifications, tested macOS/Linux packages and clearer version/build identity. |

## Recommended order

1. Make FLX2 controls, master/headphone routing, scratch release and transport reliable under real hardware tests.
2. Fix loudness/gain consistency, crackles, latency and long-set stability before adding visual features.
3. Finish beat grids, key analysis, pitch/key lock and quantised loops/cues.
4. Improve library backups, history and missing-file recovery.
5. Add sampler, beat jump and advanced pad modes; evaluate offline stems afterwards.

## Where DeckLab can stand out

Keep every implemented feature and controller mapping free. Offer a guided FLX2 setup with useful connection diagnostics, offline preparation for modest laptops, accessible readable controls, and optional Amapiano/Gqom/Afro-house preparation presets after testing with real tracks. Do not label genre presets as better detection until measured.

## 0.3.0 scratch limits

First Vinyl touch decodes the track locally; wait for “Vinyl scratch ready” before moving. Supported preparation limits: 100 MB compressed file, 30 minutes. Scratch follows jog movement with signed PCM playback; it does not yet implement motorised platter torque, inertia/backspin modelling, DVS or professional key-locked scratching. Slip timing follows the audio clock. Physical FLX2 latency and sound quality remain unverified. Pressing Pause/Stop cancels scratch; turning Vinyl off releases it. The FLX2's two physical decks control the selected pair.

## Primary references

- https://virtualdj.com/manuals/virtualdj/interface/decks/deckbasics.html
- https://virtualdj.com/manuals/virtualdj/appendix/optionslist.html
- https://virtualdj.com/help/stems.html
- https://virtualdj.com/manuals/virtualdj/settings/audiosetup.html
- https://virtualdj.com/manuals/hardware/alphatheta/ddjflx2/setup.html
- https://virtualdj.com/manuals/virtualdj.html
