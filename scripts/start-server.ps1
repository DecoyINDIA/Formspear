$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if (-not $env:PORT) {
  $env:PORT = "4173"
}

$logPath = Join-Path $root "data\server.log"
$node = "C:\Program Files\nodejs\node.exe"

& $node (Join-Path $root "src\server.js") *> $logPath
