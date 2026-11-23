import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "cf_subtitle_audit", ROOT / "scripts" / "romanian-subtitle-audit.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def make_subtitles(cues=80, romanian=True, wrong_timing=False):
    lines = []
    for i in range(cues):
        start = i * 5
        end = start + 2
        if wrong_timing and i == 30:
            start, end = 2, 1
        def stamp(n):
            return f"{n // 3600:02}:{(n % 3600) // 60:02}:{n % 60:02},000"
        phrase = "Bună, vreau să știu ce facem acum și dacă trebuie." if romanian else "Hello, I need an answer to the question."
        lines.append(f"{i + 1}\n{stamp(start)} --> {stamp(end)}\n{phrase}\n\n")
    return "".join(lines).encode("utf-8")


class TestSubtitleAudit(unittest.TestCase):
    def test_valid_romanian_srt(self):
        srt, reason = audit.validate_srt(make_subtitles(), 410)
        self.assertIsInstance(srt, bytes)
        self.assertIn("valid cues", reason)

    def test_reject_nonromanian(self):
        valid, _ = audit.validate_srt(make_subtitles(romanian=False), 410)
        self.assertFalse(valid)

    def test_reject_wrong_duration(self):
        valid, _ = audit.validate_srt(make_subtitles(), 1200)
        self.assertFalse(valid)

    def test_reject_malformed_timing(self):
        valid, _ = audit.validate_srt(make_subtitles(wrong_timing=True), 410)
        self.assertFalse(valid)

    def test_reject_small_files(self):
        valid, _ = audit.validate_srt("1\n00:00:00,000 --> 00:00:01,000\nBună".encode("utf-8"), 400)
        self.assertFalse(valid)


if __name__ == "__main__":
    unittest.main()
