# CrimsonFin FileList searchable API backend add-on

This upgrades **only the Requests companion** from the v1.2.5 desktop project. It does not replace your desktop app, libraries, nginx, Funnel, Tailscale or qBittorrent.

Changes:
- FileList `search-torrents` API used to find specific titles beyond the 100 most recent RSS entries.
- Requires the FileList **username** (not the Jellyfin username). Uses `FILELIST_API_PASSKEY` if set; otherwise securely reads the passkey from the existing server-side `RSS_FEED_URL`.
- RSS remains a fallback. No tracker credentials are returned to clients.
- 30-minute per-title cache; at most 100 API searches per hour per Requests process (under FileList's documented 150/hour cap).
- Existing administrator review and download selection unchanged; no automatic approvals enabled by this update.

## Desktop -> server installation

1. Extract the zip on the *desktop*, and send the file:

    scp ~/Downloads/CrimsonFin-FileList-API-Upgrade/requests_service.py jigglebiggle@192.168.1.105:~/requests_service-filelist-api.py

2. On the **server**:

    sudo cp -a /opt/crimsonfin-requests/requests_service.py /opt/crimsonfin-requests/requests_service.py.pre-filelist-api
    sudo install -m 644 ~/requests_service-filelist-api.py /opt/crimsonfin-requests/requests_service.py
    sudo python3 -m py_compile /opt/crimsonfin-requests/requests_service.py
    sudo nano /etc/crimsonfin-requests.env

   Add a line at the bottom: `FILELIST_API_USERNAME=your_actual_filelist_username`.
   Existing `RSS_FEED_URL` must have a working `passkey=` field. Alternatively add `FILELIST_API_PASSKEY=<your-new-passkey>`.
   The username is your FileList login, not your Jellyfin login; keep passkeys private.

3. Restart and test:

    sudo systemctl restart crimsonfin-requests
    sudo systemctl status crimsonfin-requests --no-pager
    curl -fsS http://127.0.0.1:8097/requests/health

4. In CrimsonFin -> Media Requests, use Choose RSS release for a previously unmatched title. Despite its old label the endpoint now checks the searchable API and recent RSS. Refresh the request and if necessary use Retry.

Rollback:

    sudo cp -a /opt/crimsonfin-requests/requests_service.py.pre-filelist-api /opt/crimsonfin-requests/requests_service.py
    sudo systemctl restart crimsonfin-requests

## Cautions

FileList's API response shape and live permissions were not tested with your actual account. A mocked API response and 9 existing service tests passed. A real query should be verified before relying on it.

The API user and RSS passkey are stored only server-side. Because the passkey and other credentials have appeared in screenshots/chat, regenerate them before allowing users to access the system.
