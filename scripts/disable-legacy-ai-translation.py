#!/usr/bin/env python3
"""One-time administrator action: disable the OLD subtitle autopilot AI fallback.

Use: sudo python3 /home/jigglebiggle/CrimsonFin-Client/scripts/disable-legacy-ai-translation.py
The non-AI CrimsonFin user timer is unaffected. Creates a private JSON backup.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile

CONFIG = Path('/etc/jellyfin-subtitle-autopilot.json')
if os.geteuid() != 0:
    raise SystemExit('Administrator privileges required to edit the existing protected service settings.')
if not CONFIG.is_file():
    raise SystemExit('Legacy subtitle autopilot configuration was not found.')
current = json.loads(CONFIG.read_text(encoding='utf-8'))
if current.get('translate_english') is False:
    print('Machine translation is already disabled.')
    raise SystemExit(0)

date = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
backup = CONFIG.with_name(f'{CONFIG.name}.backup-{date}')
shutil.copy2(CONFIG, backup)
backup.chmod(0o600)
current['translate_english'] = False
fd, temp = tempfile.mkstemp(dir=str(CONFIG.parent), prefix='.cf-autopilot.', suffix='.json')
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        json.dump(current, file, indent=2)
        file.write('\n')
    os.chmod(temp, CONFIG.stat().st_mode & 0o777)
    os.replace(temp, CONFIG)
except Exception:
    if os.path.exists(temp):
        os.unlink(temp)
    raise
print('Legacy autopilot machine-translation fallback disabled. Prior configuration backed up securely.')
print('New community-only subtitle service remains enabled.')
