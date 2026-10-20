# Community submissions and free improvements — 20 October 2026

## What works today

DeckLab imports local audio files and plays an A/B Automix queue. A host can receive artist files through an existing channel, download them, preview them, import them, and use + QUEUE during a set. This is a manual submission workflow, not a connected Facebook inbox. The app has no upload server, public submission URL, Facebook integration or built-in live broadcast.

Current Automix is an end-of-track gain crossfade. It does not promise phrase matching, harmonic matching or radio-grade unattended playback. A new submission must never replace a playing deck or an already scheduled transition.

## Recommended live workflow (not implemented)

Share a session-specific submission link in a Facebook post, pinned comment or live description. Artists submit through that page; Facebook is the discovery channel. Do not rely on scraping comments or downloading Facebook video audio.

1. Host creates a session, receives a public upload link/QR and controls whether submissions are open.
2. Artist supplies display name, title, genre, optional BPM, explicit-content flag and an original audio file. They confirm permission for the intended playback/broadcast use.
3. A private inbox shows pending tracks. Host can preview through headphones, approve, reject or hold; public uploads never go straight on air.
4. Approved audio is fully downloaded, decoded and analysed before becoming eligible for the queue.
5. Host selects next track or lets Automix take the next ready track. Track states: pending → approved → preparing → ready → queued → playing → played (or rejected/failed).
6. Show the artist/title in a now-playing overlay and keep a local play history. Any broadcast integration is a separate feature.

## Backend requirements before launch

- Authenticated host access; session-scoped upload capabilities, expiry, rate limits and storage quotas.
- Enforce file size/type/duration on the server and verify actual audio decoding. Treat filenames and metadata as untrusted text.
- Private object storage, temporary download links, duplicate detection and a retryable preparation worker.
- Persisted submission IDs and idempotent queue delivery so reconnecting cannot add a track twice.
- Host-only approval. Public responses must not expose contact details, private files or host credentials.
- Pause/close submissions, delete uploads and automatic expiry after the session.
- Preload more than one ready track, silence detection, configurable transition points, loudness handling and clear fallback behaviour when uploads fail or the queue empties.
- Test slow/offline connections, corrupt files, duplicate delivery, host restart, queue changes mid-fade and a multi-hour set.

Keep uploads and DJ features free to users. Hosting, storage and bandwidth still cost the operator money; use explicit capacity limits and optional donations instead of paid access or paid queue priority. Choose hosting only after measuring expected sessions, file sizes and retention.

## Highest-value improvements

| Priority | Improvement | Reason |
| --- | --- | --- |
| 1 | Real FLX2 hardware tests, reliable cue/headphone routing and safe disconnect recovery | Stable live operation comes first. |
| 2 | Automix loudness matching, silence trimming, saved mix points, ready-track buffering and failure recovery | Submitted tracks vary widely in mastering and structure. |
| 3 | Moderated submissions with preview and artist credits | A distinct community feature with host control. |
| 4 | Beat-grid correction, better BPM detection and key lock | Makes transitions more musical. |
| 5 | History, backups, queue persistence and missing-file recovery | Protects long sets and preparation work. |
| 6 | Sampler/pad modes and tested offline stems later | Useful additions after the live path is dependable. |

## Donations shipped in 0.3.1

Top-bar and Settings → About donate links open https://iykhub.online/donate, the existing IYKHub Paystack flow. That page currently requires IYKHub sign-in and has a R5 minimum. No payment SDK, credentials or feature gate is added to DeckLab. Cancelling or ignoring a donation has no effect on playback or available features.

## Facebook and broadcasting

Collecting submissions via a link shared on Facebook is separate from broadcasting a DJ set on Facebook. Confirm the artists' permissions cover the intended use, including samples and collaborators. Check Meta's current music rules before going live; an upload or permission checkbox does not guarantee a platform will allow the broadcast.

Reference: https://www.facebook.com/legal/music_guidelines
