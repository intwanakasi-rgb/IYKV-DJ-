# Free Windows signing: application preparation

Status: not applied, not approved, no trusted certificate configured. Repository visibility checked on 21 October 2026: private. Do not claim that current installers are signed.

## Proposed route

Apply at https://signpath.org/apply.html after the maintainer decides whether to publish the source. SignPath Foundation offers free signing for qualifying open-source projects, subject to review, security requirements and manual release approval. Read https://signpath.org/terms.html before applying. MIT licensing alone does not guarantee acceptance.

Publishing this repository exposes its source and history. Review them for credentials and private material first. The assistant has not changed visibility or accepted provider terms on the maintainer's behalf.

## Application details prepared from this project

- Project: IYK DeckLab
- Maintainer: Intwana Yase Kasi; GitHub account intwanakasi-rgb
- Repository: https://github.com/intwanakasi-rgb/IYKV-DJ-
- Licence: MIT (audit bundled dependency licences as part of the application)
- Product: free Windows/web DJ software with two/four decks, FLX2 MIDI controls, waveform/BPM preparation, effects, Automix and optional moderated music submissions
- Downloads: https://github.com/intwanakasi-rgb/IYKV-DJ-/releases
- Source build: GitHub Actions, Node 22, Electron and electron-builder/NSIS
- Requested signing scope: DeckLab-branded Windows executable and final NSIS installer
- Funding: voluntary IYKHub Paystack donations; no paid feature gates
- Proposed author/reviewer/approver: repository owner, subject to their confirmation and provider requirements

## Integration after approval

Obtain the provider-assigned organisation ID, project slug, signing policy, approved artifact configuration and authentication method. Configure credentials only through repository secrets. Do not paste them into chat.

Integrate the provider's official GitHub action with the approved artifact configuration. Sign the DeckLab executable before packaging, then sign the final installer. Verify both signatures and timestamps before publishing. Do not re-sign upstream Electron or third-party binaries under this project's identity. Do not simply sign the installer while implying that the installed application is also signed.

Keep unsigned development builds clearly labelled. The existing PFX release workflow requires a separately supplied trusted certificate; it does not provision SignPath and must not be presented as the free signing integration.

## Draft code signing policy (not an approval claim)

The repository owner controls releases. Trusted signatures will be required for signed release publication, and signing credentials must never be available to pull-request code. Provider-required release approval will remain manual. Publish the final team roles and provider attribution only after acceptance and configuration.

## Data handling statement for review

DeckLab stores imported music, cues and settings locally. It sends network requests when a user connects a submission server or follows external links such as GitHub releases and IYKHub donations. Submission audio is downloaded from the host-selected server; the public upload page sends artist details and audio to that server. The server retains uploads for its documented session lifetime. IYKHub/Paystack and GitHub govern their own external services. No automatic track upload, telemetry or payment SDK is built into the DJ client.
