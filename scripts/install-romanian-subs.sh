#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/crimsonfin-romanian-subs.service" <<EOF
[Unit]
Description=CrimsonFin non-AI Romanian subtitle verifier
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=/usr/bin/python3 $ROOT/scripts/romanian-subtitle-audit.py --apply --limit 4
TimeoutStartSec=9min
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
Environment=PYTHONUNBUFFERED=1
EOF
cat > "$SERVICE_DIR/crimsonfin-romanian-subs.timer" <<EOF
[Unit]
Description=Check Jellyfin media for missing Romanian subtitles twice daily

[Timer]
OnCalendar=*-*-* 04,16:15:00
RandomizedDelaySec=15min
Persistent=true
Unit=crimsonfin-romanian-subs.service

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now crimsonfin-romanian-subs.timer
echo "CrimsonFin Romanian subtitle audit timer enabled (never machine-translates)."
