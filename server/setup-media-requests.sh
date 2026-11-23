#!/usr/bin/env bash
# Interactive installer for an existing Debian/Ubuntu Jellyfin server.
# No secrets are written to source folders or printed in logs.
set -Eeuo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run: sudo bash server/setup-media-requests.sh'; exit 1; fi
if [[ ! -e /etc/os-release ]] || ! command -v apt-get >/dev/null; then echo 'This installer supports Debian/Ubuntu apt hosts only.'; exit 1; fi
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/requests_service.py" ]] || { echo 'Place script next to requests_service.py'; exit 1; }
cat <<'TXT'
CrimsonFin Media Requests setup — use only sources you are authorized to download.
This will NOT format disks, change your existing Funnel, or publish any passkeys.
Mountpoints must exist, be active mounts, and remain mounted after reboot.
TXT
lsblk -o NAME,FSTYPE,LABEL,SIZE,MOUNTPOINTS
read -r -p 'ADATA mountpoint (e.g. /mnt/ADATA): ' ADATA
read -r -p 'WD mountpoint (e.g. /mnt/WD): ' WD
ADATA=$(realpath -e -- "$ADATA")
WD=$(realpath -e -- "$WD")
for target in "$ADATA" "$WD"; do
  if [[ "$target" == '/' ]] || ! mountpoint -q -- "$target"; then
    echo "Not an active non-root mount: $target";exit 1
  fi
  if [[ "$target" == *$'\n'* || "$target" == *'"'* || "$target" == *'%'* ]];then
    echo 'Unsupported path character in mountpoint';exit 1
  fi
done
[[ "$ADATA" != "$WD" ]] || { echo 'ADATA and WD must differ'; exit 1; }
# A writable mountpoint check is deliberately conservative.
for target in "$ADATA" "$WD"; do
  [[ -w "$target" ]] || { echo "Root cannot write $target (read-only mount?)"; exit 1; }
done
read -r -p 'qBittorrent Web UI username [admin]: ' QBIT_USER; QBIT_USER=${QBIT_USER:-admin}
read -r -s -p 'qBittorrent Web UI password (set in its Web UI first): ' QBIT_PASS; echo
[[ -n "$QBIT_PASS" ]] || { echo 'Set a permanent qBittorrent Web UI password first.'; exit 1; }
read -r -s -p 'FileList RSS passkey (paste from your account; input hidden): ' FEED_KEY;echo
[[ "$FEED_KEY" =~ ^[a-zA-Z0-9]{20,128}$ ]] || { echo 'Unexpected FileList passkey format.'; exit 1; }
read -r -p 'Allow automatic unique RSS matches? [y/N]: ' AUTO
if [[ "$AUTO" =~ ^[Yy]$ ]];then APPROVE=true;else APPROVE=false;fi
# Use immutable trusted source configuration. Never ask the desktop for tracker credentials.
RSS_URL="https://filelist.io/rss.php?feed=dl&cat=24,15,6,26,20,2,3,4,19,1,27,21,23&passkey=$FEED_KEY"
apt-get update
apt-get install -y nginx python3 curl
getent group crimson-media >/dev/null || groupadd --system crimson-media
if ! getent passwd crimson-requests >/dev/null;then
  useradd --system --gid crimson-media --home-dir /var/lib/crimsonfin-requests --shell /usr/sbin/nologin crimson-requests
fi
# Create these folders only inside already-mounted disks.
for disk in "$ADATA" "$WD";do
  for folder in Movies 'TV Shows';do
    if [[ ! -d "$disk/$folder" ]];then install -d -m 2775 -o crimson-requests -g crimson-media "$disk/$folder";fi
    chgrp crimson-media "$disk/$folder" || true
    chmod g+rwx "$disk/$folder" || true
  done
done
# Owner of qBittorrent must be able to write the media folders; change to match existing service.
QBIT_SYSTEM_USER=$(systemctl show qbittorrent-nox@qbittorrent.service -p User --value 2>/dev/null || true)
if [[ -n "$QBIT_SYSTEM_USER" ]] && getent passwd "$QBIT_SYSTEM_USER" >/dev/null;then
  usermod -aG crimson-media "$QBIT_SYSTEM_USER"
fi
if getent passwd qbcrimson >/dev/null;then usermod -aG crimson-media qbcrimson;fi
if getent passwd jellyfin >/dev/null;then usermod -aG crimson-media jellyfin;fi
install -d -m 0750 -o crimson-requests -g crimson-media /var/lib/crimsonfin-requests
install -d -m 0755 /opt/crimsonfin-requests
install -m 0644 "$HERE/requests_service.py" /opt/crimsonfin-requests/requests_service.py
install -m 0755 "$HERE/feed-diagnostics.py" /opt/crimsonfin-requests/feed-diagnostics.py
# Secure env file creation, no secrets in Bash history or on command line.
env_file=/etc/crimsonfin-requests.env
if [[ -f "$env_file" ]];then cp -p "$env_file" "$env_file.bak.$(date +%Y%m%d%H%M%S)";chmod 0600 "$env_file";fi
escape_systemd_env(){ local text="$1";text=${text//\\/\\\\};text=${text//\"/\\\"};printf '%s' "$text"; }
{
  printf '%s\n' 'JELLYFIN_URL=http://127.0.0.1:8096' 'REQUEST_HOST=127.0.0.1' 'REQUEST_PORT=8787' 'REQUEST_DB=/var/lib/crimsonfin-requests/requests.sqlite'
  printf 'MEDIA_DRIVES="ADATA=%s;WD=%s"\n' "$(escape_systemd_env "$ADATA")" "$(escape_systemd_env "$WD")"
  printf 'STORAGE_PATHS="ADATA=%s;WD=%s"\n' "$(escape_systemd_env "$ADATA")" "$(escape_systemd_env "$WD")"
  printf '%s\n' 'REQUIRE_MOUNTPOINTS=true' 'MOVIES_FOLDER=Movies' 'SHOWS_FOLDER="TV Shows"'
  printf 'RSS_FEED_URL="%s"\n' "$RSS_URL"
  printf '%s\n' 'RSS_ALLOWED_HOSTS=filelist.io' 'TORRENT_ENDPOINT_PATHS=/download.php' 'QBITTORRENT_URL=http://127.0.0.1:8080'
  printf 'QBITTORRENT_USER="%s"\n' "$(escape_systemd_env "$QBIT_USER")"
  printf 'QBITTORRENT_PASSWORD="%s"\n' "$(escape_systemd_env "$QBIT_PASS")"
  printf '%s\n' 'RSS_CHECK_SECONDS=90' 'MIN_FREE_GB=20' 'MAX_DOWNLOAD_GB=100' 'MAX_OPEN_REQUESTS_PER_USER=8' 'ALLOW_PRIVATE_DOWNLOAD_HOSTS=false'
  printf 'AUTO_APPROVE=%s\n' "$APPROVE"
} | (umask 077; cat > "$env_file")
chmod 0600 "$env_file";chown root:root "$env_file"
unset QBIT_PASS FEED_KEY RSS_URL
cat > /etc/systemd/system/crimsonfin-requests.service <<UNIT
[Unit]
Description=CrimsonFin Jellyfin media request companion
After=network-online.target jellyfin.service
Wants=network-online.target
[Service]
Type=simple
User=crimson-requests
Group=crimson-media
WorkingDirectory=/opt/crimsonfin-requests
EnvironmentFile=/etc/crimsonfin-requests.env
ExecStart=/usr/bin/python3 /opt/crimsonfin-requests/requests_service.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/crimsonfin-requests "$ADATA" "$WD"
UMask=0002
[Install]
WantedBy=multi-user.target
UNIT
# Do not override an unrelated Nginx site.
if [[ -e /etc/nginx/sites-available/crimsonfin ]]; then
  cp -p /etc/nginx/sites-available/crimsonfin /etc/nginx/sites-available/crimsonfin.backup.$(date +%Y%m%d%H%M%S)
fi
install -m 0644 "$HERE/nginx-crimsonfin.conf.example" /etc/nginx/sites-available/crimsonfin
ln -sfn ../sites-available/crimsonfin /etc/nginx/sites-enabled/crimsonfin
nginx -t
systemctl enable --now nginx
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now crimsonfin-requests
if systemctl is-active --quiet crimson-qbit;then systemctl restart crimson-qbit;fi
printf '\nHealth checks (do not include feed passkey):\n'
curl -fsS http://127.0.0.1:8787/health || :
printf '\n'
curl -fsS http://127.0.0.1:8097/requests/health || :
printf '\n'
cat <<'END'
NEXT STEPS:
1. Ensure qBittorrent-nox is running on 127.0.0.1:8080, with the Web UI username/password entered above.
2. Ensure the qBittorrent service user is in crimson-media, then restart it and Jellyfin.
3. Add both ADATA/Movies and WD/Movies to Jellyfin Movies library; add both 'TV Shows' folders to Series library.
4. Test http://127.0.0.1:8097/System/Info/Public and http://127.0.0.1:8097/requests/health before changing Tailscale Funnel.
5. Only then run: sudo tailscale funnel --bg 8097
6. In CrimsonFin, local server = http://192.168.1.105:8097 ; remote Funnel address stays unchanged.
7. If using AUTO_APPROVE=false, a Jellyfin admin must approve downloads first.
END
