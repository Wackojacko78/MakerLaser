# Runs the full verification (Rust + frontend). Extra arguments are passed through:
#   .\verify-makerlaser.ps1 --fail-fast
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
node scripts/verify.mjs @args
exit $LASTEXITCODE
