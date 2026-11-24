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


def zipped(name, data):
    import io, zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, data)
        archive.writestr("readme.nfo", b"release notes")
    return buffer.getvalue()


class TestLocalDataset(unittest.TestCase):
    """The local opensubtitles.org dataset provider (metadata index + release dump files)."""

    def setUp(self):
        import sqlite3, tempfile
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        meta = sqlite3.connect(root / "subtitles_all.db")
        meta.execute("CREATE TABLE subz_metadata (IDSubtitle INTEGER PRIMARY KEY, MovieName TEXT, MovieYear INTEGER, ISO639 TEXT,"
                     " SubAddDate TEXT, ImdbID INTEGER, SubSumCD INTEGER, MovieReleaseName TEXT, SeriesSeason INTEGER,"
                     " SeriesEpisode INTEGER, SeriesIMDBParent INTEGER, MovieKind TEXT)")
        rows = [
            # movie tt0133093: a Romanian sub whose release matches the video, a weaker Romanian one, an English one
            (9512001, "The Matrix", 1999, "ro", "2020-01-01", 133093, 1, "The.Matrix.1999.1080p.BluRay.x264-GRP", None, None, None, "movie"),
            (9512002, "The Matrix", 1999, "ro", "2021-01-01", 133093, 1, "Matrix.DVDRip.XviD", None, None, None, "movie"),
            (9512003, "The Matrix", 1999, "en", "2021-01-01", 133093, 1, "The.Matrix.1999.1080p.BluRay.x264-GRP", None, None, None, "movie"),
            # episode S01E02 of series tt0903747, plus one indexed but absent from the dump
            (9512010, "Breaking Bad", 2008, "ro", "2019-01-01", 1054724, 1, "Breaking.Bad.S01E02.720p", 1, 2, 903747, "tv"),
            (9999999, "Missing", 2010, "ro", "2019-01-01", 1234567, 1, "Missing.2010", None, None, None, "movie"),
        ]
        meta.executemany("INSERT INTO subz_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        meta.commit(); meta.close()
        dumps = root / "dumps" / "opensubtitles.org.dump.95xxxxx.v20240306"
        dumps.mkdir(parents=True)
        dump = sqlite3.connect(dumps / "95xxxxx.db")
        dump.execute("CREATE TABLE zipfiles (num INTEGER PRIMARY KEY, name TEXT, content BLOB)")
        dump.executemany("INSERT INTO zipfiles VALUES (?,?,?)", [
            (9512001, "the.matrix.ro.zip", zipped("The.Matrix.ro.srt", make_subtitles())),
            (9512002, "matrix.ro.zip", zipped("Matrix.ro.srt", make_subtitles(romanian=False))),
            (9512010, "bb.ro.zip", zipped("Breaking.Bad.S01E02.srt", make_subtitles())),
        ])
        dump.commit(); dump.close()
        self.dataset = audit.LocalDataset.from_config({
            "OPENSUBS_METADATA_DB": str(root / "subtitles_all.db"), "OPENSUBS_DUMP_DIRS": str(root / "dumps")})

    def tearDown(self):
        for conn in [self.dataset.metadata, *self.dataset._connections.values()]:
            conn.close()
        self.folder.cleanup()

    def test_release_file_ranges(self):
        self.assertEqual([(lo, hi) for lo, hi, _ in self.dataset.ranged], [(9_500_000, 9_600_000)])
        self.assertIsNotNone(self.dataset.zipped(9512001))
        self.assertIsNone(self.dataset.zipped(9999999))

    def test_romanian_movie_from_dataset(self):
        item = {"Type": "Movie", "ProviderIds": {"Imdb": "tt0133093"}}
        video = Path("The.Matrix.1999.1080p.BluRay.x264-GRP.mkv")
        content, reason = audit.dataset_candidate(self.dataset, item, None, video, 410)
        self.assertIsInstance(content, bytes)
        self.assertIn("#9512001", reason)  # the release-name match, not the English or non-Romanian text

    def test_romanian_episode_by_series_imdb(self):
        item = {"Type": "Episode", "ParentIndexNumber": 1, "IndexNumber": 2, "ProviderIds": {}}
        content, reason = audit.dataset_candidate(self.dataset, item, 903747, Path("Breaking.Bad.S01E02.mkv"), 410)
        self.assertIsInstance(content, bytes)
        self.assertIn("#9512010", reason)

    def test_indexed_but_not_downloaded(self):
        item = {"Type": "Movie", "ProviderIds": {"Imdb": "tt1234567"}}
        content, reason = audit.dataset_candidate(self.dataset, item, None, Path("Missing.2010.mkv"), 410)
        self.assertIsNone(content)
        self.assertIn("not in the downloaded dump", reason)

    def test_no_imdb_id(self):
        content, reason = audit.dataset_candidate(self.dataset, {"Type": "Movie", "ProviderIds": {}}, None, Path("x.mkv"), 410)
        self.assertIsNone(content)
        self.assertIn("no IMDb id", reason)

    def test_zip_without_srt_or_corrupt(self):
        self.assertIsNone(audit.srt_from_zip(zipped("movie.sub", b"{1}{2}text")))
        self.assertIsNone(audit.srt_from_zip(b"not a zip"))

    def test_not_configured(self):
        self.assertIsNone(audit.LocalDataset.from_config({}))


if __name__ == "__main__":
    unittest.main()
