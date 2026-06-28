[CmdletBinding()]
param(
  [string]$DataFile = "",
  [string]$BackupDir = "",
  [switch]$NoManifest
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dataFile = if ($DataFile) { $DataFile } elseif ($env:FORMSPEAR_DATA_FILE) { $env:FORMSPEAR_DATA_FILE } else { Join-Path $root "data\formspear.db.json" }
$backupDir = if ($BackupDir) { $BackupDir } else { Join-Path $root "backups" }

if (-not (Test-Path -LiteralPath $dataFile)) {
  throw "Data file not found: $dataFile"
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $backupDir "formspear-$stamp.json"
Copy-Item -LiteralPath $dataFile -Destination $target -Force

$hash = Get-FileHash -LiteralPath $target -Algorithm SHA256
$bytes = (Get-Item -LiteralPath $target).Length

if (-not $NoManifest) {
  $manifest = [ordered]@{
    version = 1
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    sourcePath = (Resolve-Path -LiteralPath $dataFile).Path
    backupPath = (Resolve-Path -LiteralPath $target).Path
    bytes = $bytes
    sha256 = $hash.Hash.ToLowerInvariant()
    restoreCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\restore-data.ps1 -BackupFile `"$target`""
  }
  $manifestPath = "$target.manifest.json"
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

Write-Output $target
