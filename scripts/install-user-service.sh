#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/crimsonfin.service" <<SERVICE
[Unit]
Description=CrimsonFin Jellyfin client gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=$NODE $REPO/server/index.mjs
Restart=always
RestartSec=4
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=default.target
SERVICE
systemctl --user daemon-reload
systemctl --user enable --now crimsonfin.service
printf '\nInstalled user service. Check with: systemctl --user status crimsonfin\n'
printf 'For boot-time startup without logging in run: sudo loginctl enable-linger %s\n' "$(id -un)"
