# Windows publisher signing

## Why SmartScreen appears

The installer shown in the screenshot is an unsigned development artifact. Windows cannot authenticate a publisher for it. Changing app branding or CompanyName metadata does not add an Authenticode signature. A self-signed certificate does not establish public Windows trust. Do not disable SmartScreen or Defender to distribute this application.

A trusted signature identifies the verified publisher. SmartScreen also evaluates file/publisher reputation, so a correctly signed new release can still produce a warning. The already-downloaded unsigned installer does not change when this repository changes.

Official reference: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation

## Development versus release

- `npm run package:win`: unsigned development installer, with app metadata/resource editing enabled. It must not be described as trusted or warning-free.
- `npm run package:win:signed`: Windows-only build requiring signing credentials. It enables executable/installer signing and `forceCodeSigning`.
- Publish Windows release: requires signing credentials before building, validates Authenticode signatures and timestamps on both the installer and app, creates a SHA-256 checksum, then publishes.
- No paid service or certificate has been provisioned. No certificate, identity verification or trusted signature is included in this change.

## Configure an existing permitted PFX signing certificate

The prepared workflow supports a CA-trusted code-signing certificate whose key is legitimately available for PFX-based signing. In repository **Settings → Secrets and variables → Actions**, set:

| Setting | Type | Value |
| --- | --- | --- |
| `WINDOWS_CSC_LINK` | Secret | Certificate content encoded as base64, supported by electron-builder's `WIN_CSC_LINK` input |
| `WINDOWS_CSC_KEY_PASSWORD` | Secret | Password protecting the certificate |
| `WINDOWS_SIGNING_PUBLISHER` | Variable (optional) | Verified certificate publisher name, exactly as issued; if omitted the signer derives it from the certificate |

Do not paste private keys or passwords into chat, issues, commits or documentation. Do not use a public download URL for a private certificate. Only trusted release workflows should receive signing secrets; pull requests do not receive them.

If the signing provider requires a hardware token or a non-exportable cloud key, use its supported signing integration instead. This PFX workflow does not bypass token/export requirements and does not configure Microsoft Artifact Signing. Alternatively, investigate Microsoft Store MSIX distribution and its identity/certification requirements.

After merging the workflow, run **Publish Windows release** with a new version tag. A missing certificate deliberately fails before publication. A successful release includes `SHA256SUMS.txt` and a signature-verified installer. This pipeline cannot create or validate the organisation's identity itself.

## Verification and expectations

On Windows, `scripts/verify-windows-signature.ps1` requires Windows to report a Valid Authenticode signature and a timestamp for both the installer and app. It optionally checks the expected publisher identity. The release fails if these checks fail. SHA-256 checksums verify file integrity; they do not replace publisher signing or guarantee an app is safe.

The signing profile and missing-credential refusal are unit tested. Actual signing and verification remain untested until a real trusted certificate is configured. Signing does not change DJ functionality or prove the absence of malware.
