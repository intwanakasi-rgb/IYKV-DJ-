# Community submissions — DeckLab 0.4.0

All DeckLab features, controller support and submissions are free. Donations through IYKHub are optional and never change queue priority.

## Implemented

- A standalone Node submission server, a public mobile upload page and an inbox inside DeckLab's Library.
- Private host token; session links contain no host credential. The token remains in app memory and must be entered again after reload.
- Upload MP3/WAV/FLAC/OGG, maximum 50 MB. Server checks file signatures and size; the host app fully decodes before approval and accepts up to 30 minutes. Signature checks are not a malware scanner.
- Pending submissions, explicit-content labels, permission confirmation, headphone-only preview, approve/import, reject, close/reopen and delete session.
- Approved imports are stored locally before acknowledgement. Add to Automix is a separate action and guarded against repeated clicks. This never replaces a playing deck. Preview requires a separate output; there is no automatic fallback to the master speakers.
- File-hash duplicate detection per session, 50 submissions per session, four active sessions, 10 upload attempts per minute per network peer, and 24-hour expiry. Rejected files are deleted immediately; metadata remains until session expiry/deletion. Expiry runs each minute while the service is running and on the next request after restart.
- Optional approximate active-window RMS level matching (boost capped at +6 dB with peak headroom) and leading/trailing silence trimming for prepared tracks. These are not LUFS normalisation or phrase/beat matching. Manual cue points take priority.
- Automix waits for playable audio. Failed preload no longer removes an unrelated queue entry changed while it was loading.
- Headphone output selection ignores superseded requests and disables preview after device disconnection.

## Use locally

Requires Node 22.12+ and the repository source. The submission server has no npm runtime dependencies.

1. Generate a private random host token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Set `DECKLAB_HOST_TOKEN` in the server environment to that value. Do not put it in a URL, source code, Facebook post or screenshot.
3. Run `npm run submissions:serve` from the repository. Default listener is `127.0.0.1:8787`. Uploads and metadata are stored under `submission-data/` (excluded from git).
4. In DeckLab, expand **Community submissions**. Enter `http://127.0.0.1:8787` and the private token. Connect and create a session.
5. A localhost link works only on that computer. Open it locally for testing. A public link requires the hosting setup below.
6. Refresh the inbox while mixing. Configure headphones under Settings, preview, approve/import, then Add to Automix queue. Press Start when ready. New submissions never start themselves.
7. Stop preview before returning to deck cue monitoring. Close submissions when finished; delete the session to remove server files early. Deleting server files does not delete already imported local library copies.

## Public hosting required before sharing on Facebook

The server is implemented and tested locally; no public service has been provisioned. The normal static web build and Windows installer do not host an upload server.

Run **one Node process** on a host with persistent private storage, behind an HTTPS reverse proxy. Set:

| Environment variable | Purpose |
| --- | --- |
| `DECKLAB_HOST_TOKEN` | Required private random value, at least 32 characters; rotate by restarting with a new value. |
| `DECKLAB_DATA_DIR` | Persistent private disk directory, outside the web root. |
| `HOST` | Default `127.0.0.1`; use `0.0.0.0` only behind the deployment's firewall/proxy. |
| `PORT` | Default `8787`. |
| `DECKLAB_ORIGINS` | Comma-separated exact app origins allowed to call the host API. Defaults: `null` for Electron, local Vite addresses and `https://iykdecklab.vercel.app`. Add your own web app origin; never use `*`. |

Preserve the original Host header at the HTTPS proxy. The public form uploads to its own origin. Limit request bodies to 50 MB, set a suitable upload timeout, apply edge rate limits, and keep the data directory writable only by the service. The app rejects insecure remote HTTP and redirects when sending its host token. A proxy is treated as one network peer by the built-in rate limiter; configure per-client rate limits at the edge instead of trusting arbitrary forwarded headers.

Use the public HTTPS service origin in DeckLab, then share the generated `/s/...` link in your Facebook post, pinned comment or live description. There is no Facebook login integration or comment scraping.

This first version uses a single-host token and JSON/disk persistence; it is not a multi-tenant hosting service. Storage caps can reach approximately 10 GB across four full sessions. For a large public audience, add object storage, isolated decoding/scanning workers, a database and per-artist limits before increasing capacity. Free to users does not make bandwidth, storage or hosting free to the operator.

## Playback and broadcast limits

Artists must confirm rights for the host's announced use, including samples. A submission does not guarantee platform broadcast clearance. Check the platform's current music rules before going live. DeckLab does not broadcast directly to Facebook.

Physical FLX2 headphone routing and latency require real-device testing. This update supports a separate selectable output device, not ASIO channel routing inside a controller. Queue persistence exists; full play-history recovery, phrase-aware transitions and key lock remain future work.
