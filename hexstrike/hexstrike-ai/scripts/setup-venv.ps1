$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root

$venvPath = Join-Path $root ".venv"
if (-not (Test-Path $venvPath)) {
  python -m venv $venvPath
}

& "$venvPath\Scripts\Activate.ps1"
python -m pip install --upgrade pip
pip install -r requirements.txt

Write-Host "HexStrike venv ready. Start with: python hexstrike_server.py"
