"""Resolve overlapping 빗썸 거래내역확인서 periods so a shared day is read once.

Two statements may share days: the user downloads "everything since the last one"
and starts on the day the last one ended, or a final statement is cut on a day an
earlier one already reached. Both are read, and each shared day comes only from the
document whose period ends later — the same rule `statements_to_read` applies to
the 미래에셋 거래내역증명서 (docs/data-sources.md).

The later-ending document is the one issued later, so it is the one that can hold a
fill an earlier, same-day download missed. A row is therefore dropped from document
D only when another document E declares a period that contains the row's date and
E outranks D. Rows are never dropped by comparing their content: a split fill
legitimately repeats a timestamp, quantity and price, and only the running balance
tells its parts apart.
"""
from __future__ import annotations


def _outranks(winner, loser):
    """True when `winner` is the document that keeps a day both declare."""
    if winner["end"] != loser["end"]:
        return winner["end"] > loser["end"]
    if winner["start"] != loser["start"]:
        return winner["start"] < loser["start"]  # the longer window wins a shared end
    return winner["name"] > loser["name"]  # the same period twice: keep exactly one


def drop_overlapped_rows(documents, rows):
    """Return (kept_rows, dropped_by_source).

    `documents` is a list of {"name", "start", "end"} (ISO dates, inclusive);
    `rows` each carry `source` (a document's name) and `date`. A row whose source
    has no declared period is kept: nothing can be said about what it overlaps.
    """
    periods = {d["name"]: d for d in documents if d.get("start") and d.get("end")}
    kept, dropped = [], {}
    for row in rows:
        own = periods.get(row.get("source"))
        shadowed = own is not None and any(
            other is not own
            and other["start"] <= row["date"] <= other["end"]
            and _outranks(other, own)
            for other in periods.values()
        )
        if shadowed:
            dropped[own["name"]] = dropped.get(own["name"], 0) + 1
        else:
            kept.append(row)
    return kept, dropped
