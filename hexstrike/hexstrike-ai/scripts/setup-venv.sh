#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

venv_path="$root/.venv"
if [ ! -d "$venv_path" ]; then
  python3 -m venv "$venv_path"
fi

# shellcheck disable=SC1091
source "$venv_path/bin/activate"
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "HexStrike venv ready. Start with: python3 hexstrike_server.py"
