"""Extract crypto activity from exchange PDFs into a single JSON snapshot.

Two document families, neither of which is a holdings export:

  Bithumb 거래내역확인서   — every transaction, WITH a running per-asset balance
                             and a running KRW balance on each row.
  Robinhood Crypto         — one monthly statement carrying that month's activity
    Monthly Statement        plus a month-end quantity snapshot per symbol.

Both are therefore self-verifying: the derived position can be checked against a
balance the exchange itself printed, on a row we did not compute. That matters
more here than for the stock side, because NEITHER venue gives us a holdings
export — the position only exists as the sum of its transactions, and a summed
position with nothing to check it against is exactly the silent-wrong-number
failure this repo keeps hitting.

The file list arrives on stdin as JSON rather than being globbed here, so
scripts/source-files.mjs stays the single place that decides which files are
read. Globbing again in Python would be a second, drifting answer.
"""

import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}:\d{2}$")
CONTROL_RE = re.compile(r"[\x00-\x1f]")

# Half a row pitch. Both documents vertically centre a cell whose content wraps,
# so a fragment can sit ABOVE its own row's date line — see rows_by_anchor.
ROW_TOLERANCE = 14


def clean(value):
    """Strip the PDF's glyph separators and compose Hangul.

    Bithumb's generator emits U+0001 BETWEEN glyphs, so extract_text() returns
    '거래내역\\x01확인서' and the header cell '정산금액\\x01(\\x01수수료포함\\x01)'.
    Every literal comparison against a header name therefore failed and the
    parser found no columns at all — silently, producing zero rows rather than
    an error. Compose to NFC as well: macOS and this PDF disagree on Hangul
    normalisation the same way the filesystem does.
    """
    return unicodedata.normalize("NFC", CONTROL_RE.sub("", str(value or ""))).strip()


def clean_lines(value):
    """clean() applied per line, so line structure survives."""
    return "\n".join(clean(line) for line in str(value or "").split("\n"))


def number(value):
    raw = str(value or "").strip().replace(",", "").replace("$", "")
    if not raw or raw in ("--", "-"):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def column_bounds(right_edges):
    """Split points midway between consecutive column RIGHT edges.

    Both documents right-align every value to its column, while left edges move
    with the digit count — "0.00010000" and "0.0001" start 39pt apart and end at
    the same x. Splitting on right edges is therefore stable where splitting on
    left edges or centres is not.
    """
    return [(right_edges[i] + right_edges[i + 1]) / 2 for i in range(len(right_edges) - 1)]


def column_of(x1, bounds):
    for index, bound in enumerate(bounds):
        if x1 <= bound:
            return index
    return len(bounds)


def rows_by_anchor(words, bounds, is_anchor, columns):
    """Group words into records keyed on the row each one is vertically nearest.

    Not "everything until the next anchor": when a cell's content is too wide it
    wraps onto a second line and the cell is re-centred, which can push the first
    fragment ABOVE the row's own date. One Robinhood price
    ($100652.68338957) does exactly this — its head sits between the previous
    row and its own, and sequential grouping filed it under the previous
    transaction, leaving the real row with no price and dropping it entirely.

    Words further than half a row pitch from every anchor are discarded, which
    is also what keeps page footers out of the last record.
    """
    anchors = sorted({round(w["top"], 1) for w in words if is_anchor(w)})
    if not anchors:
        return []
    records = {a: {i: [] for i in range(columns)} for a in anchors}
    for word in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        text = clean(word["text"])
        if not text:
            continue
        top = round(word["top"], 1)
        nearest = min(anchors, key=lambda a: abs(a - top))
        if abs(nearest - top) > ROW_TOLERANCE:
            continue
        records[nearest][column_of(word["x1"], bounds)].append(text)
    return [records[a] for a in anchors]


def cell(record, index):
    """A column's fragments joined back together.

    Joined without a separator on purpose: multiple fragments in one column mean
    a single wrapped value, not two values.
    """
    return "".join(record[index]) if record.get(index) else ""


UNIT_RE = re.compile(r"^[A-Z]{2,6}$")


def numeric_cell(record, index):
    """A column's numeric content, with the unit token dropped.

    Bithumb prints the unit on a second line inside the same column — 거래수량
    holds "0.00072753" and "BTC" — so joining the column verbatim yields
    "0.00072753BTC", which parses as nothing. Dropping bare unit tokens first
    still lets a genuinely wrapped number rejoin from its fragments.
    """
    parts = [p for p in record.get(index, []) if not UNIT_RE.match(p)]
    return "".join(parts)


# ---------------------------------------------------------------------------
# Bithumb 거래내역확인서
# ---------------------------------------------------------------------------

BITHUMB_HEADERS = [
    "거래일시",
    "자산명",
    "거래구분",
    "거래수량",
    "체결가격",
    "거래금액",
    "정산금액(수수료포함)",
    "가상자산잔고",
    "통화별잔고",
    "비고",
]

# 매수/매도 are trades; 입금/출금 cover BOTH cash movements and coin movements —
# the same word means "KRW deposit" on a 원화 row and "coin received" on an asset
# row, so the asset column has to disambiguate. A staking payout arrives as an
# ETH 입금 whose only distinguishing mark is the reason in 비고; without that it
# is indistinguishable from an inbound transfer from an external wallet.
BITHUMB_TYPES = {"매수": "BUY", "매도": "SELL", "입금": "DEPOSIT", "출금": "WITHDRAWAL"}

# 비고 on a cash deposit holds the counterparty or the reason. The exchange's own
# name means the exchange paid you (points shop, promo); an interest or staking
# label means the same. Anything else — normally the account holder's own name —
# is the holder moving their own money in, which is NOT income.
#
# This is a heuristic on free text, and it is allowed to be: everything it
# classifies flows through data/manual-mappings.json downstream, and any row it
# cannot place is surfaced on /data-ops rather than being silently booked. One
# real row has an EMPTY 비고 (a 2024-12-04 promo credit whose reason the PDF
# omits entirely), so no rule over this column can be complete.
CASH_REWARD_HINTS = ("이자", "스테이킹", "보상", "이벤트", "예치금이용료", "포인트", "빗썸")
COIN_REWARD_HINTS = ("이자", "스테이킹", "보상", "이벤트", "포인트")


def bithumb_columns(page):
    words = page.extract_words()
    header = {}
    for word in words:
        text = clean(word["text"])
        if text in BITHUMB_HEADERS and text not in header:
            header[text] = word["x1"]
    if len(header) < len(BITHUMB_HEADERS):
        return None, None
    bounds = column_bounds([header[name] for name in BITHUMB_HEADERS])
    header_bottom = max(w["bottom"] for w in words if clean(w["text"]) in BITHUMB_HEADERS)
    return bounds, header_bottom


def bithumb_issue_info(page):
    # clean_lines, not clean: clean() strips ALL control characters, newline
    # included, which would run the header line into the value line below it.
    text = clean_lines(page.extract_text())
    issued = re.search(r"발급일자[:：]\s*(\d{4}-\d{2}-\d{2})", text)
    # 조회분류/조회자산 record which filters were applied when the document was
    # issued. A statement pulled with a narrowed filter looks identical to a
    # complete one, so we carry these through and assert on them downstream
    # rather than trusting that an export was unfiltered.
    scope = re.search(
        r"(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(\S+)",
        text,
    )
    return {
        "periodStart": scope.group(1) if scope else "",
        "periodEnd": scope.group(2) if scope else "",
        "issuedDate": issued.group(1) if issued else "",
        "scopeTypes": scope.group(3) if scope else "",
        "scopeAssets": scope.group(4) if scope else "",
    }


def parse_bithumb(path, venue, account):
    transactions = []
    info = {}
    with pdfplumber.open(path) as pdf:
        pages = len(pdf.pages)
        for page_index, page in enumerate(pdf.pages):
            if not info:
                info = bithumb_issue_info(page)
            bounds, header_bottom = bithumb_columns(page)
            if bounds is None:
                continue
            words = [w for w in page.extract_words() if w["top"] > header_bottom]
            records = rows_by_anchor(
                words,
                bounds,
                lambda w: column_of(w["x1"], bounds) == 0 and DATE_RE.match(clean(w["text"])),
                len(BITHUMB_HEADERS),
            )
            for record in records:
                row = parse_bithumb_record(record, venue, account, path.name, page_index + 1)
                if row:
                    transactions.append(row)

    return transactions, info, pages


def parse_bithumb_record(record, venue, account, filename, page):
    stamp = record[0]
    date = next((t for t in stamp if DATE_RE.match(t)), "")
    time = next((t for t in stamp if TIME_RE.match(t)), "")
    if not date:
        return None

    asset = record[1][0] if record[1] else ""
    raw_type = record[2][0] if record[2] else ""
    if not asset or raw_type not in BITHUMB_TYPES:
        return None

    quantity = number(numeric_cell(record, 3))
    price = number(numeric_cell(record, 4))
    amount = number(numeric_cell(record, 5))
    settlement = number(numeric_cell(record, 6))
    asset_balance = number(numeric_cell(record, 7))
    cash_balance = number(numeric_cell(record, 8))
    note = " ".join(record[9]) if record[9] else ""

    is_cash = asset == "KRW"
    kind = BITHUMB_TYPES[raw_type]
    if kind == "DEPOSIT":
        hints = CASH_REWARD_HINTS if is_cash else COIN_REWARD_HINTS
        matched = any(hint in note for hint in hints)
        if is_cash:
            kind = "CASH_REWARD" if matched else "CASH_IN"
        else:
            kind = "REWARD" if matched else "TRANSFER_IN"
    elif kind == "WITHDRAWAL":
        kind = "CASH_OUT" if is_cash else "TRANSFER_OUT"

    # 정산금액 is the only fee-bearing figure the PDF prints: it is the cash
    # actually moved, 거래금액 the cash before fees. The difference is the fee.
    # The .xlsx export has an explicit fee column and agrees with this to the
    # won on all 55 trades, which is how we know the direction is right.
    fee = None
    if not is_cash and amount is not None and settlement is not None:
        fee = round(abs(abs(settlement) - amount), 4)

    return {
        "venue": venue,
        "account": account,
        "currency": "KRW",
        "date": date,
        "time": time,
        "symbol": "" if is_cash else asset,
        "isCash": is_cash,
        "rawType": raw_type,
        "type": kind,
        "quantity": quantity,
        "price": price,
        "amount": amount,
        "settlement": settlement,
        "fee": fee,
        "assetBalance": asset_balance,
        "cashBalance": cash_balance,
        "note": note,
        "source": filename,
        "page": page,
    }


# ---------------------------------------------------------------------------
# Robinhood Crypto monthly statement
# ---------------------------------------------------------------------------

# FEE is absent from the two earliest statements (2024-11, 2024-12) and present
# from 2025-01 on, so the column set is read per page rather than assumed.
RH_ACTIVITY_HEADERS = ["DATE", "TYPE", "DEBIT", "CREDIT", "PRICE", "VALUE", "FEE"]
RH_TYPES = {"Crypto Purchase": "BUY", "Crypto Sale": "SELL", "Crypto Reward": "REWARD"}
RH_HOLDING_RE = re.compile(
    r"^(?P<name>.+?)\s+(?P<quantity>[\d.]+)\s+(?P<symbol>[A-Z]{2,6})\s+\$(?P<value>[\d,.]+)\s+(?P<pct>[\d.]+)%$"
)
RH_QUANTITY_RE = re.compile(r"^([\d.]+)([A-Z]{2,6})$")


def rh_activity_columns(page):
    words = page.extract_words()
    header = {}
    for word in words:
        text = clean(word["text"])
        if text in RH_ACTIVITY_HEADERS and text not in header:
            header[text] = word["x1"]
    names = [name for name in RH_ACTIVITY_HEADERS if name in header]
    if not {"DATE", "DEBIT", "CREDIT", "PRICE", "VALUE"}.issubset(header):
        return None, None, None
    bounds = column_bounds([header[name] for name in names])
    header_bottom = max(w["bottom"] for w in words if clean(w["text"]) in RH_ACTIVITY_HEADERS)
    return bounds, header_bottom, names


def parse_robinhood(path, venue, account):
    transactions = []
    snapshot = []
    period_start = period_end = ""
    with pdfplumber.open(path) as pdf:
        pages = len(pdf.pages)
        for page_index, page in enumerate(pdf.pages):
            text = clean_lines(page.extract_text())
            for line in text.split("\n"):
                line = line.strip()
                start = re.match(r"^PERIOD START (\d{4}-\d{2}-\d{2})", line)
                if start:
                    period_start = start.group(1)
                end = re.match(r"^PERIOD END (\d{4}-\d{2}-\d{2})", line)
                if end:
                    period_end = end.group(1)
                holding = RH_HOLDING_RE.match(line)
                if holding and "CRYPTOCURRENCY" not in line:
                    snapshot.append(
                        {
                            "venue": venue,
                            "account": account,
                            "currency": "USD",
                            "symbol": holding.group("symbol"),
                            "name": holding.group("name").strip(),
                            "quantity": number(holding.group("quantity")),
                            "nativeMarketValue": number(holding.group("value")),
                            "source": path.name,
                        }
                    )

            if "ACCOUNT ACTIVITY" not in text:
                continue
            bounds, header_bottom, names = rh_activity_columns(page)
            if bounds is None:
                continue
            words = [w for w in page.extract_words() if w["top"] > header_bottom]
            records = rows_by_anchor(
                words,
                bounds,
                lambda w: column_of(w["x1"], bounds) == 0 and DATE_RE.match(clean(w["text"])),
                len(names),
            )
            for record in records:
                row = parse_robinhood_activity(record, names, venue, account, path.name, page_index + 1)
                if row:
                    transactions.append(row)

    # The month-end snapshot is dated by the statement period: the holdings block
    # prints its value date only inside a column header we do not parse, and
    # PERIOD END is that same day.
    for row in snapshot:
        row["asOfDate"] = period_end

    return transactions, snapshot, period_start, period_end, pages


def parse_robinhood_activity(record, names, venue, account, filename, page):
    def column(name):
        return cell(record, names.index(name)) if name in names else ""

    date = column("DATE")
    if not DATE_RE.match(date):
        return None
    raw_type = " ".join(record[names.index("TYPE")]) if "TYPE" in names else ""
    if not raw_type.startswith("Crypto"):
        return None

    debit, credit = column("DEBIT"), column("CREDIT")
    side = credit if credit not in ("", "--") else debit
    match = RH_QUANTITY_RE.match(side)
    if not match:
        return None
    quantity = number(match.group(1))
    # A debit is crypto leaving the account. Signing it here means the position
    # is a plain sum downstream, with no per-type sign table to keep in step.
    if quantity is not None and credit in ("", "--"):
        quantity = -quantity

    return {
        "venue": venue,
        "account": account,
        "currency": "USD",
        "date": date,
        "time": "",
        "symbol": match.group(2),
        "isCash": False,
        "rawType": raw_type,
        "type": RH_TYPES.get(raw_type, raw_type.upper()),
        "quantity": quantity,
        "price": number(column("PRICE")),
        "amount": number(column("VALUE")),
        "settlement": None,
        "fee": number(column("FEE")) or 0.0,
        "assetBalance": None,
        "cashBalance": None,
        "note": "",
        "source": filename,
        "page": page,
    }


# ---------------------------------------------------------------------------

def main():
    request = json.load(sys.stdin)
    out_path = Path(request["outPath"])

    documents = []
    transactions = []
    snapshots = []

    def stamp_document_order(rows, period_end):
        """Record each row's position within its document, newest first.

        Both venues print newest-first, and Bithumb repeats a timestamp across
        the parts of one split fill (three rows share 2026-07-29 09:23:19). The
        running balance differs on each of those rows, so "the latest balance"
        cannot be found by timestamp alone — sorting by date would pick one of
        the three arbitrarily and report a position that is real but stale by
        two fills. Document order is the only total order available, so carry
        it explicitly rather than relying on array order surviving downstream.
        """
        for index, row in enumerate(rows):
            row["order"] = index
            row["docPeriodEnd"] = period_end

    for entry in request.get("files", []):
        path = Path(entry["filename"])
        if not path.exists():
            continue
        venue = entry["venue"]
        account = entry.get("account") or venue

        if entry["category"] == "bithumb_statement":
            rows, info, pages = parse_bithumb(path, venue, account)
            stamp_document_order(rows, info.get("periodEnd", ""))
            transactions.extend(rows)
            documents.append(
                {
                    "name": f"bithumb_statement:{path.stem}",
                    "category": "bithumb_statement",
                    "filename": path.name,
                    "path": str(path),
                    "venue": venue,
                    "account": account,
                    "pages": pages,
                    "rowCount": len(rows),
                    "metrics": {
                        **info,
                        "trade_count": sum(1 for r in rows if r["type"] in ("BUY", "SELL")),
                        "asset_count": len({r["symbol"] for r in rows if r["symbol"]}),
                    },
                }
            )
        elif entry["category"] == "robinhood_crypto_statement":
            rows, snapshot, start, end, pages = parse_robinhood(path, venue, account)
            stamp_document_order(rows, end)
            transactions.extend(rows)
            snapshots.extend(snapshot)
            documents.append(
                {
                    "name": f"robinhood_crypto_statement:{path.stem}",
                    "category": "robinhood_crypto_statement",
                    "filename": path.name,
                    "path": str(path),
                    "venue": venue,
                    "account": account,
                    "pages": pages,
                    "rowCount": len(rows),
                    "metrics": {
                        "periodStart": start,
                        "periodEnd": end,
                        "snapshot_symbols": len(snapshot),
                    },
                }
            )

    transactions.sort(key=lambda r: (r["date"], r["time"], r["source"]))
    snapshots.sort(key=lambda r: (r.get("asOfDate", ""), r["symbol"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "pdfplumber word-position extraction",
        "documents": documents,
        "transactions": transactions,
        "snapshots": snapshots,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {out_path}: {len(documents)} document(s), "
        f"{len(transactions)} transaction(s), {len(snapshots)} month-end snapshot row(s)"
    )


main()
