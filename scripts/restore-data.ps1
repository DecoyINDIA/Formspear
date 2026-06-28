[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$DataFile = "",
  [switch]$Force,
  [switch]$SkipChecksum
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dataFile = if ($DataFile) { $DataFile } elseif ($env:FORMSPEAR_DATA_FILE) { $env:FORMSPEAR_DATA_FILE } else { Join-Path $root "data\formspear.db.json" }

if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

$backupRaw = Get-Content -Raw -LiteralPath $BackupFile
try {
  $null = $backupRaw | ConvertFrom-Json
} catch {
  throw "Backup file is not valid JSON: $BackupFile"
}

$manifestPath = "$BackupFile.manifest.json"
if ((-not $SkipChecksum) -and (Test-Path -LiteralPath $manifestPath)) {
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $hash = (Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifest.sha256 -and ($hash -ne [string]$manifest.sha256)) {
    throw "Backup checksum mismatch for $BackupFile"
  }
}

$targetDir = Split-Path -Parent $dataFile
if ($targetDir) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$preRestoreBackup = ""
if (Test-Path -LiteralPath $dataFile) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $preRestoreBackup = "$dataFile.pre-restore-$stamp"
  Copy-Item -LiteralPath $dataFile -Destination $preRestoreBackup -Force
}

if ((Test-Path -LiteralPath $dataFile) -and (-not $Force)) {
  Write-Output "Existing data file copied to $preRestoreBackup"
}

Copy-Item -LiteralPath $BackupFile -Destination $dataFile -Force

$result = [ordered]@{
  restoredAt = (Get-Date).ToUniversalTime().ToString("o")
  backupFile = (Resolve-Path -LiteralPath $BackupFile).Path
  dataFile = (Resolve-Path -LiteralPath $dataFile).Path
  preRestoreBackup = $preRestoreBackup
}

$result | ConvertTo-Json -Depth 3 -Compress
