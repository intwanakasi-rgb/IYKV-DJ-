param(
  [string]$InstallerPath = 'dist/desktop/IYK-DeckLab-Windows-Installer.exe',
  [string]$ApplicationPath = 'dist/desktop/win-unpacked/IYK DeckLab.exe'
)
$ErrorActionPreference = 'Stop'
foreach ($path in @($InstallerPath, $ApplicationPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing signed output: $path" }
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "Signature validation failed for ${path}: $($signature.Status)"
  }
  if ($null -eq $signature.TimeStamperCertificate) { throw "Missing trusted timestamp on $path" }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($env:WINDOWS_SIGNING_PUBLISHER -and $publisher -ne $env:WINDOWS_SIGNING_PUBLISHER.Trim()) {
    throw "Unexpected signing publisher on $path"
  }
  Write-Host "Verified signed output: $path ($publisher)"
}
$hash = Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256
"$($hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($InstallerPath))" | Set-Content -Encoding ascii 'dist/desktop/SHA256SUMS.txt'
