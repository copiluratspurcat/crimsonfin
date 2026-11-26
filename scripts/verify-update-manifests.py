"""Check that update manifest names and digests match the files being published."""
import base64
import hashlib
import re
import sys
from pathlib import Path


def verify(directory, manifest, extension, version):
    content = (directory / manifest).read_text(encoding="utf-8")
    if not re.search(rf"^version: {re.escape(version)}$", content, re.MULTILINE):
        raise SystemExit(f"{manifest} version does not match {version}")
    for field in ("path", "sha512"):
        match = re.search(rf"^{field}: ([^\r\n]+)$", content, re.MULTILINE)
        if not match:
            raise SystemExit(f"{manifest} is missing {field}")
        if field == "path":
            filename = match.group(1)
        else:
            digest = match.group(1)
    files = re.findall(r"^[ \t]*- url: ([^\r\n]+)\r?\n[ \t]+sha512: ([^\r\n]+)$", content, re.MULTILINE)
    if not filename.endswith(extension) or (filename, digest) not in files:
        raise SystemExit(f"{manifest} has an invalid primary installer reference")
    for filename, digest in files:
        if not re.fullmatch(r"[\w.-]+", filename):
            raise SystemExit(f"{manifest} has an invalid installer filename")
        payload = directory / filename
        if not payload.is_file():
            raise SystemExit(f"{manifest} points to missing file {filename}")
        with payload.open("rb") as file:
            actual = base64.b64encode(hashlib.file_digest(file, "sha512").digest()).decode()
        if actual != digest:
            raise SystemExit(f"{manifest} checksum does not match {filename}")
        print(f"Verified {manifest} → {filename}")


if __name__ == "__main__":
    root = Path(sys.argv[1])
    verify(root, "latest.yml", ".exe", sys.argv[2])
    verify(root, "latest-linux.yml", ".AppImage", sys.argv[2])
