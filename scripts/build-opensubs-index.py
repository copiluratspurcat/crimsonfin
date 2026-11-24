#!/usr/bin/env python3
"""Build the Romanian-only lookup index from the OpenSubtitles TSV export."""
import argparse
import gzip
import os
import sqlite3
import tempfile
from pathlib import Path

COLUMNS = (
    "IDSubtitle", "ISO639", "ImdbID", "SeriesIMDBParent", "SeriesSeason",
    "SeriesEpisode", "MovieReleaseName", "SubSumCD", "SubAddDate",
)
ROMANIAN = {"ro", "rum", "ron"}


def number(value):
    value = value.strip().strip('\"').removeprefix("tt")
    return int(value) if value.isascii() and value.isdecimal() and len(value) <= 12 else None


def build(source, output):
    if output.exists():
        raise FileExistsError(output)
    with tempfile.TemporaryDirectory(prefix=".opensubs-index-", dir=output.parent) as directory:
        staging = Path(directory) / output.name
        with gzip.open(source, "rt", encoding="utf-8-sig", errors="replace") as export:
            header = export.readline().rstrip("\r\n").split("\t")
            indexes = [header.index(key) for key in COLUMNS]
            lang_index = header.index("ISO639")
            total = skipped = 0
            db = sqlite3.connect(staging)
            try:
                with db:
                    db.execute("""CREATE TABLE subz_metadata (
                        IDSubtitle INTEGER PRIMARY KEY, ISO639 TEXT, ImdbID INTEGER,
                        SeriesIMDBParent INTEGER, SeriesSeason INTEGER, SeriesEpisode INTEGER,
                        MovieReleaseName TEXT, SubSumCD INTEGER, SubAddDate TEXT
                    )""")
                    batch = []
                    for line in export:
                        fields = line.rstrip("\r\n").split("\t")
                        if len(fields) != len(header):
                            skipped += 1
                            continue
                        if fields[lang_index].strip().strip('\"').lower() not in ROMANIAN:
                            continue
                        row = [fields[index].strip('\"') for index in indexes]
                        if number(row[0]) is None:
                            skipped += 1
                            continue
                        for index in (0, 2, 3, 4, 5, 7):
                            row[index] = number(row[index])
                        row[1] = row[1].strip().lower()
                        batch.append(row)
                        if len(batch) >= 1000:
                            db.executemany("INSERT OR IGNORE INTO subz_metadata VALUES (?,?,?,?,?,?,?,?,?)", batch)
                            batch.clear()
                    db.executemany("INSERT OR IGNORE INTO subz_metadata VALUES (?,?,?,?,?,?,?,?,?)", batch)
                    db.execute("CREATE INDEX movie_subs ON subz_metadata(ImdbID, ISO639)")
                    db.execute("CREATE INDEX episode_subs ON subz_metadata(SeriesIMDBParent, SeriesSeason, SeriesEpisode, ISO639)")
                    total = db.execute("SELECT count(*) FROM subz_metadata").fetchone()[0]
                    if not total:
                        raise ValueError("Export contains no Romanian subtitle rows")
            finally:
                db.close()
        if output.exists():
            raise FileExistsError(output)
        os.rename(staging, output)
    print(f"Indexed {total} Romanian subtitle rows. Skipped {skipped} malformed export lines.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    build(options.export, options.output)
