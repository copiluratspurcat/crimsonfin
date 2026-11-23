#!/usr/bin/env bash
# Optional qBittorrent-nox setup. Run on the Jellyfin server, not on desktop clients.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run: sudo bash server/install-qbit-debian.sh';exit 1; }
if ss -ltn 2>/dev/null | grep -Eq ':[8]080[[:space:]]'; then
  echo 'Something already listens on port 8080. Do not install another instance; use the existing qBittorrent Web UI.'
  exit 1
fi
apt-get update
apt-get install -y qbittorrent-nox
getent group crimson-media >/dev/null || groupadd --system crimson-media
if ! getent passwd qbcrimson >/dev/null;then
  useradd --system --create-home --user-group --home-dir /var/lib/qbcrimson --shell /usr/sbin/nologin qbcrimson
fi
usermod -aG crimson-media qbcrimson
install -d -m 0700 -o qbcrimson -g qbcrimson /var/lib/qbcrimson/.config/qBittorrent
cat > /var/lib/qbcrimson/.config/qBittorrent/qBittorrent.conf <<'CONF'
[Preferences]
WebUI\Enabled=true
WebUI\Address=127.0.0.1
WebUI\Port=8080
WebUI\LocalHostAuth=true
CONF
chown qbcrimson:qbcrimson /var/lib/qbcrimson/.config/qBittorrent/qBittorrent.conf
chmod 0600 /var/lib/qbcrimson/.config/qBittorrent/qBittorrent.conf
cat > /etc/systemd/system/crimson-qbit.service <<'UNIT'
[Unit]
Description=CrimsonFin private qBittorrent-nox service
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=qbcrimson
Group=crimson-media
WorkingDirectory=/var/lib/qbcrimson
ExecStart=/usr/bin/qbittorrent-nox --confirm-legal-notice --webui-port=8080
Restart=on-failure
RestartSec=8
UMask=0002
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now crimson-qbit
sleep 2
ss -ltn | grep 8080 || true
cat <<'MSG'
Get the temporary WebUI password using:
  sudo journalctl -u crimson-qbit -n 90 --no-pager | grep -i 'password'
Use SSH port forwarding from your desktop to open http://127.0.0.1:8080.
Then set a permanent password in Tools -> Options -> Web UI.
Do not expose TCP 8080 to the public internet or Tailscale Funnel.
MSG
