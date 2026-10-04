# Builds the MakerLaser Windows installers (.msi and .exe) from a clean checkout.
#   .\build-windows.ps1              verify, then build
#   .\build-windows.ps1 -SkipVerify  build only
param([switch]$SkipVerify)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Need([string]$Command, [string]$Hint) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "'$Command' was not found. $Hint"
  }
}
function Step([string]$Message) { Write-Host "`n>>> $Message" -ForegroundColor Cyan }
function Check([string]$What) { if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." } }

Step 'Checking prerequisites'
Need node  'Install Node.js 20 or newer from https://nodejs.org/ (or: winget install OpenJS.NodeJS.LTS)'
Need npm   'It ships with Node.js.'
Need cargo 'Install Rust: winget install Rustlang.Rustup, then open a NEW terminal and run: rustup default stable'
Need rustc 'See the Rust installation note above.'

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required (found $(node --version))." }

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
  throw 'Visual Studio Build Tools were not found. Install them: winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
}
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'The "Desktop development with C++" workload is missing from Visual Studio Build Tools.' }

Write-Host ("node  {0}`nrustc {1}`ncargo {2}" -f (node --version), (rustc --version), (cargo --version))

Step 'Installing JavaScript dependencies'
npm install
Check 'npm install'

if (-not $SkipVerify) {
  Step 'Running verification (Rust + frontend); this takes several minutes on the first run'
  node scripts/verify.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Verification failed. Read verification.log, fix the reported problems, then re-run.' }
}

Step 'Building the installers'
npm run build
Check 'npm run build'

Step 'Done. Installers:'
Get-ChildItem -Path target\release\bundle -Recurse -Include *.msi, *-setup.exe -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("  {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB)) }
