#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/stream-relay"
mkdir -p "$install_dir" "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
if [[ "$source_dir" != "$install_dir" ]]; then cp -a "$source_dir/." "$install_dir/"; fi
chmod +x "$install_dir/stream-relay" "$install_dir/chrome_crashpad_handler" "$install_dir/chrome-sandbox"
python3 - "$install_dir" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/stream-relay.desktop" <<'PY'
import sys
from pathlib import Path
folder=Path(sys.argv[1]);exe=str(folder/'stream-relay').replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')
Path(sys.argv[2]).write_text('[Desktop Entry]\nType=Application\nName=UniversalCollab\nComment=Stream controls and approved collaborations\nExec="'+exe+'"\nIcon=video-display\nTerminal=false\nCategories=AudioVideo;Network;\nStartupWMClass=stream-relay\n')
PY
printf 'Installed. Open UniversalCollab from your application menu.\n'
