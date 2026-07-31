"""Parse Korean brokerage statements into the normalized Korea payload TSVs.

Two brokers, one lot engine. The 미래에셋 거래내역증명서 layout is handled here;
the Toss 거래내역서 layout is different enough to live in `toss_statements.py`
and is imported. Both feed the same FIFO walk below, so a transfer OUT of
미래에셋 and the matching transfer IN to Toss are replayed in one timeline.

WHY THIS EXISTS: the Korea side of the portfolio was populated once, by hand, on
2026-07-15 and never again — the extraction that produced
`.codex_sheet_payloads/*.tsv` left no script behind, so every Korean trade since
then is invisible to the dashboard, the briefing and the tax planner. This is
that step, made repeatable.

The certificates are the authoritative record: the broker issues them, they carry
the source page of every line, and they need no credentials to re-read. A
statement covers a fixed period, so re-running this is idempotent — the same PDFs
always yield the same rows.

LAYOUT. One transaction spans THREE physical table rows, twelve columns wide:

    row A  거래일자 │ 거래종류 │      │      │ 종목번호  │ 수수료   │ 거래금액 │ 예수금잔액 │ …
    row B  거래번호 │ 원번호   │ 거래수량│ 단가  │ 종목명    │ 제세금합 │ 입출금액 │ 유가잔고   │ …
    row C  상대금융기관│       │상대계좌번호│    │ 상대고객명 │(CD기)은행│         │ 대출상환금액│ …

The three header rows repeat on every page and are skipped by the same date-shape
test that finds records, so no page-boundary bookkeeping is needed.

CASH LEGS ARE DROPPED ON PURPOSE. A single purchase emits both `주식매수입고`
(the shares) and `주식매수출금` (the cash), and the broker does not pair them
one-to-one — same-day buys settle against one withdrawal. Emitting both would
double-count the trade. The securities leg carries ticker, quantity and price, so
it is the one kept; the cash leg's information already lives in its 거래금액.

Reads STOCK_PDF_PASSWORD for the 주식종합 statements, which are encrypted. The
ISA statements are not.
"""

import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toss_statements  # noqa: E402  (needs the path above)

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
OUT_DIR = Path(os.environ.get("STOCK_KR_STATEMENTS_DIR", Path.cwd() / "data/kr-statements"))
PDF_PASSWORD = os.environ.get("STOCK_PDF_PASSWORD", "")
TOSS_SNAPSHOT_PATH = Path(os.environ.get("STOCK_TOSS_SNAPSHOT_PATH", Path.cwd() / "data/toss-snapshot.json"))
TOSS_ACCOUNT = os.environ.get("STOCK_TOSS_ACCOUNT_LABEL", "토스증권")

# macOS hands back decomposed Hangul from the filesystem while the literals here
# are composed; comparing the two forms silently matches nothing.
def nfc(value):
    return unicodedata.normalize("NFC", value or "")


DATE_CELL = re.compile(r"^\d{4}/\d{2}/\d{2}$")

# 거래종류 → the shared vocabulary in ingest-stock-data.mjs. Anything absent from
# this table is reported at the end rather than silently dropped: an unmapped
# type is a transaction the portfolio never hears about, which is the exact
# failure this pipeline keeps rediscovering.
TYPE_MAP = {
    # securities in/out — these carry ticker, quantity and price
    "주식매수입고": "BUY",
    "해외주식매수입고": "BUY",
    "소수해외매수입고": "BUY",
    "외화채권매수입고": "BUY",
    "장내당일채권매수입고": "BUY",
    "공모주입고": "BUY",
    "주식매도출고": "SELL",
    "해외주식매도출고": "SELL",
    "외화채권매도출고": "SELL",
    "소수해외매도출고": "SELL",
    "배당주입고": "REINVEST",
    "채권만기상환출고(해외)": "CORPORATE_ACTION",
    "액면분할입고(해외)": "STOCK_SPLIT",
    "액면분할출고(해외)": "STOCK_SPLIT",
    "신주인수권증서입고": "CORPORATE_ACTION",
    "신주인수권증서말소출고": "CORPORATE_ACTION",
    "해외주식티커변경": "CORPORATE_ACTION",
    # Reversals undo an earlier entry. Mapped rather than dropped so the
    # correction stays visible; `Raw Type` keeps what actually happened.
    "해외리버설(취소)출금": "CORPORATE_ACTION",
    "해외권리입금취소": "CORPORATE_ACTION",
    # income
    "배당금입금": "DIVIDEND",
    "배당금외화입금": "DIVIDEND",
    "ETF/상장클래스 분배금입금": "DIVIDEND",
    "배당단수주대금입금": "DIVIDEND",
    "예탁금이용료입금": "INTEREST",
    "외화예탁금이용료입금": "INTEREST",
    "채권이자외화입금": "INTEREST",
    "사채이자입금": "INTEREST",
    "해외주식현지과세환급금": "OTHER_INCOME",
    "세금환급": "OTHER_INCOME",
    "선환전차액입금": "OTHER_INCOME",
    "무상단수주대금입금": "OTHER_INCOME",
    # movements between accounts and institutions
    "이체출고": "TRANSFER_OUT",
    "이체송금": "TRANSFER_OUT",
    "외화출금": "TRANSFER_OUT",
    "이체입금": "TRANSFER_IN",
    "이체입금(오픈)": "TRANSFER_IN",
    "외화입금": "TRANSFER_IN",
    "소수해외대체입고": "TRANSFER_IN",
    "계좌대체입금": "INTERNAL_TRANSFER",
    "계좌대체출금": "INTERNAL_TRANSFER",
    "외화계좌대체입금": "INTERNAL_TRANSFER",
    "외화계좌대체출금": "INTERNAL_TRANSFER",
    # currency exchange: two legs of one conversion
    "외화매수원화출금": "JOURNAL",
    "외화매수원화출금(미수)": "JOURNAL",
    "외화매수외화입금": "JOURNAL",
    "외화매도외화출금": "JOURNAL",
    "외화매도원화입금": "JOURNAL",
    # withholding
    "배당세금출금": "FEE",
    "배당세출금": "FEE",
    "이자소득세출금": "FEE",
    "외화채권원화세금출금": "FEE",
    "외화예탁금세금출금": "FEE",
    "선환전차액출금": "FEE",
}

# The cash counterpart of a trade already represented by its securities leg.
CASH_LEG_TYPES = {
    "주식매수출금",
    "해외주식매수출금",
    "주식매도입금",
    "해외주식매도입금",
    "외화채권매수외화출금",
    "외화채권매도외화입금",
    "채권만기상환외화입금",
    "장내당일채권매수대금출금",
    "공모주청약대금출금",
    "공모주청약환불금",
}


def number(value):
    raw = nfc(str(value or "")).strip().replace(",", "")
    if not raw or raw in {"-", "0"}:
        return 0.0 if raw == "0" else 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def clean_name(value):
    # 종목명 wraps mid-word inside its cell, and the certificates suffix the share
    # class onto the company name (`카카오보통주`). Neither belongs in a label.
    name = " ".join(nfc(str(value or "")).split())
    return re.sub(r"(보통주|우선주)$", "", name).strip()


def clean_ticker(value):
    return re.sub(r"^A", "", nfc(str(value or "")).strip())


def open_pdf(path):
    for candidate in (None, PDF_PASSWORD):
        if candidate is None:
            try:
                return pdfplumber.open(path)
            except Exception:
                continue
        if not candidate:
            continue
        try:
            return pdfplumber.open(path, password=candidate)
        except Exception:
            continue
    return None


def account_label(pdf):
    """`미래에셋증권(ISA)` — the brokerage/account-type shape the ingest splits on."""
    for page in pdf.pages[:3]:
        for table in page.extract_tables():
            for row in table:
                cells = [nfc(c) for c in row if c]
                for i, cell in enumerate(cells):
                    if cell.strip() == "계좌유형" and i + 1 < len(cells):
                        kind = cells[i + 1].strip()
                        if "ISA" in kind:
                            return "미래에셋증권(ISA)"
                        return f"미래에셋증권({kind})"
    return "미래에셋증권"


def records(pdf, source_name):
    """Yield (page_number, rowA, rowB, rowC) for every transaction in the file."""
    for page_no, page in enumerate(pdf.pages, start=1):
        for table in page.extract_tables():
            if not table or len(table[0]) < 12:
                continue
            for i, row in enumerate(table):
                first = nfc(row[0] or "").strip()
                if not DATE_CELL.match(first):
                    continue
                a = [nfc(c) for c in row]
                b = [nfc(c) for c in table[i + 1]] if i + 1 < len(table) else [""] * 12
                c = [nfc(c) for c in table[i + 2]] if i + 2 < len(table) else [""] * 12
                yield page_no, a, b, c


def write_tsv(path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        fh.write("\t".join(columns) + "\n")
        for row in rows:
            fh.write("\t".join(str(row.get(col, "")) for col in columns) + "\n")


TRANSACTION_COLUMNS = [
    "Date", "Account", "Type", "Raw Type", "Ticker", "Name", "Quantity",
    "Currency", "Native Amount", "FX Rate",
    "Amount (KRW)", "Settlement (KRW)", "Unit Price", "Fee", "Tax", "Balance",
    "Source", "Page",
]
DIVIDEND_COLUMNS = [
    "Date", "Account", "Symbol", "Name", "Currency", "Native Amount", "FX Rate",
    "Amount (KRW)", "Type", "Source", "Page",
]


def amount_of(row_a, row_b, row_c):
    """(currency, native amount, fx rate, KRW amount) for one record.

    The certificate uses a different column per currency: a KRW trade fills
    거래금액 and leaves 외화거래금액 empty, a USD trade does the reverse and names
    the currency in 통화코드. Reading only the KRW column — as the first cut of
    this parser did — silently books every foreign trade at zero, which is worse
    than missing them: the row is present, so nothing looks wrong.

    Only the trades carry 환율; the dividends do not. Rather than invent a rate,
    the foreign amount and its currency are passed through and the KRW column is
    left EMPTY, not zero, so the ingest can convert with the historical FX table
    it already owns and can tell "not converted yet" from "actually zero".
    """
    krw = number(row_a[6])
    native_krw_raw = nfc(row_a[6]).strip()
    foreign_raw = nfc(row_a[8]).strip()
    if native_krw_raw or not foreign_raw:
        return "KRW", krw, "", krw
    currency = nfc(row_b[10]).strip() or "USD"
    native = number(row_a[8])
    rate = number(row_c[9])
    return currency, native, (rate or ""), (round(native * rate, 2) if rate else "")


TAXLOT_COLUMNS = [
    "Account", "Ticker", "Name", "Acquired Date", "Open Quantity",
    "Currency", "Native Cost Basis", "Native Unit Cost",
    "Cost Basis (KRW)", "Unit Cost", "Holding Days", "As Of Date", "Tax Term", "Source",
]
REALIZED_COLUMNS = [
    "Account", "Ticker", "Name", "Acquired Date", "Sold Date", "Quantity Sold",
    "Currency", "Native Cost Basis", "Native Proceeds",
    "Cost Basis (KRW)", "Proceeds (KRW)", "Realized G/L (KRW)",
    "Holding Days", "Tax Term", "Source",
]

# Shares arriving and leaving. A transfer moves a position between accounts — it
# consumes lots but is NOT a disposal, so it produces no realized gain. Booking
# the 19 transfers to Toss as sales would invent capital gains that were never
# realized and were never taxable.
OPENING_TYPES = {"BUY", "REINVEST", "TRANSFER_IN"}
CLOSING_TYPES = {"SELL", "TRANSFER_OUT"}
# "More than a year", so a lot held exactly 365 days is still short-term. The
# boundary is not academic: three ISA lots sit exactly on it.
LONG_TERM_DAYS = 365


def lot_cost(quantity, unit_price, native_amount):
    """Total cost of a lot, preferring the amount the certificate actually booked.

    quantity × unit price is not universally the cost: a Korean bond quotes 단가
    per 10,000 of face value, so a 700,000-face purchase at 7,116 cost ₩498,120,
    not ₩4.98 billion. The 거래금액 column is already the true consideration, so
    it wins wherever the certificate fills it in. Transfers leave it empty — no
    cash changed hands — and there the carried unit price is all there is.
    """
    if native_amount > 0:
        return native_amount
    return quantity * unit_price


def days_between(start, end):
    from datetime import date
    y1, m1, d1 = (int(x) for x in start.split("-"))
    y2, m2, d2 = (int(x) for x in end.split("-"))
    return (date(y2, m2, d2) - date(y1, m1, d1)).days


def tax_term(days):
    return "Long-term" if days > LONG_TERM_DAYS else "Short-term"


def build_lots(transactions, as_of):
    """Replay every transaction in order, consuming lots first-in-first-out.

    FIFO is an assumption, stated here rather than buried: the certificates
    record what left the account, not which lot the broker chose. Where the
    broker used a different method the per-lot split will differ from its own
    filing — which is why the year-end statement, not this, is the tax record.
    """
    open_lots = {}
    taxlots, realized, notes = [], [], []

    for r in sorted(transactions, key=lambda x: (x["Date"], x["Source"], int(x["Page"]))):
        ticker, qty = r["Ticker"], float(r["Quantity"] or 0)
        if not ticker or qty <= 0:
            continue
        key = (r["Account"], ticker)
        kind, unit = r["Type"], float(r["Unit Price"] or 0)

        # A split is booked as an out and one-or-more ins, and the certificate has
        # ALREADY restated the per-lot unit cost across them (SCHD: 19 @ 82.31017
        # out, 57 in across four lots whose costs still sum to the same 1,563.90).
        # So a split needs no arithmetic of its own — only the direction, which
        # lives in the raw type rather than the normalized one. An earlier version
        # tried to redistribute the cost itself, mistook the second inbound row for
        # another outbound, and silently emptied the position.
        # Corporate actions move a position too, and 출고 means it left: a matured
        # bond is redeemed by 채권만기상환출고, rights lapse by 신주인수권증서말소출고.
        # Leaving them out of the lot walk left the redeemed US Treasury sitting in
        # the account a year past maturity — a position the dashboard would show
        # and no statement would contradict. Anything without a direction in its
        # name (a ticker change) is neither and is skipped.
        if kind in ("STOCK_SPLIT", "CORPORATE_ACTION"):
            if "입고" in r["Raw Type"]:
                kind = "TRANSFER_IN"
            elif "출고" in r["Raw Type"]:
                kind = "TRANSFER_OUT"
            else:
                continue

        if kind in OPENING_TYPES:
            cost = lot_cost(qty, unit, float(r["Native Amount"] or 0))
            open_lots.setdefault(key, []).append({
                "acquired": r["Date"], "qty": qty, "unit": cost / qty if qty else 0,
                "currency": r["Currency"], "source": r["Source"], "name": r["Name"],
            })
        elif kind in CLOSING_TYPES:
            remaining = qty
            held = open_lots.get(key, [])
            # Same reason as the cost side: the booked consideration beats
            # quantity × price, so a bond's 단가 convention cannot distort proceeds.
            sale_unit = lot_cost(qty, unit, float(r["Native Amount"] or 0)) / qty if qty else 0
            while remaining > 1e-9 and held:
                lot = held[0]
                take = min(lot["qty"], remaining)
                if kind == "SELL":
                    cost = take * lot["unit"]
                    proceeds = take * sale_unit
                    days = days_between(lot["acquired"], r["Date"])
                    realized.append({
                        "Account": r["Account"], "Ticker": ticker, "Name": lot["name"] or r["Name"],
                        "Acquired Date": lot["acquired"], "Sold Date": r["Date"],
                        "Quantity Sold": round(take, 8),
                        "Currency": lot["currency"],
                        "Native Cost Basis": round(cost, 4), "Native Proceeds": round(proceeds, 4),
                        "Cost Basis (KRW)": round(cost, 2) if lot["currency"] == "KRW" else "",
                        "Proceeds (KRW)": round(proceeds, 2) if lot["currency"] == "KRW" else "",
                        "Realized G/L (KRW)": round(proceeds - cost, 2) if lot["currency"] == "KRW" else "",
                        "Holding Days": days, "Tax Term": tax_term(days), "Source": r["Source"],
                    })
                lot["qty"] -= take
                remaining -= take
                if lot["qty"] <= 1e-9:
                    held.pop(0)
            if remaining > 1e-6:
                # Shares left an account that never recorded them arriving: the
                # opening side is in a statement we do not have. Named, not
                # silently absorbed into a zero-cost lot.
                notes.append(f"{r['Date']} {r['Account']} {ticker}: "
                             f"{remaining:g} unit(s) disposed with no matching open lot ({r['Raw Type']})")

    for (account, ticker), held in sorted(open_lots.items()):
        for lot in held:
            if lot["qty"] <= 1e-9:
                continue
            days = days_between(lot["acquired"], as_of)
            cost = lot["qty"] * lot["unit"]
            taxlots.append({
                "Account": account, "Ticker": ticker, "Name": lot["name"],
                "Acquired Date": lot["acquired"], "Open Quantity": round(lot["qty"], 8),
                "Currency": lot["currency"],
                "Native Cost Basis": round(cost, 4), "Native Unit Cost": round(lot["unit"], 4),
                "Cost Basis (KRW)": round(cost, 2) if lot["currency"] == "KRW" else "",
                "Unit Cost": round(lot["unit"], 2) if lot["currency"] == "KRW" else "",
                "Holding Days": days, "As Of Date": as_of,
                "Tax Term": tax_term(days), "Source": lot["source"],
            })
    return taxlots, realized, notes


def share_direction(row):
    """+1 if a row adds shares, -1 if it removes them, 0 if it moves none.

    Same rule the lot walk uses: 입고/출고 in the raw label decides for the
    corporate actions, whose normalized type says only that something happened.
    """
    kind = row["Type"]
    if kind in ("STOCK_SPLIT", "CORPORATE_ACTION"):
        if "입고" in row["Raw Type"]:
            return 1
        if "출고" in row["Raw Type"]:
            return -1
        return 0
    if kind in OPENING_TYPES:
        return 1
    if kind in CLOSING_TYPES:
        return -1
    return 0


def check_share_balances(rows, report):
    """Replay each symbol against the 잔고 the statement printed for it.

    Toss prints a running share count after every row, so the broker has
    already done this sum. Comparing against it audits the parse using nothing
    this script computed: a dropped row, a misread quantity or a cell assigned
    to the wrong column all show up as a break, and none of them would show up
    anywhere else — a wrong quantity still produces a perfectly plausible lot.

    A break is reported rather than corrected. The printed 잔고 is evidence
    about what the account held, not a licence to invent the row that would
    explain it.
    """
    running = {}
    breaks = 0
    for row in sorted(rows, key=lambda r: (r["Date"], r["Source"], r["Page"])):
        direction = share_direction(row)
        quantity = float(row["Quantity"] or 0)
        if not direction or not quantity or not row["Ticker"]:
            continue
        key = row["Ticker"]
        expected = running.get(key, 0.0) + direction * quantity
        printed = float(row["Balance"] or 0)
        if abs(expected - printed) > 1e-6:
            breaks += 1
            report(
                "share-balance-break",
                f"{row['Date']} {key}: {running.get(key, 0.0):g} {direction * quantity:+g} "
                f"= {expected:g}, but the statement prints 잔고 {printed:g} "
                f"({row['Raw Type']}, {row['Source']} p{row['Page']})",
            )
        running[key] = printed
    return breaks


def load_toss_snapshot(report):
    if TOSS_SNAPSHOT_PATH.exists():
        return json.loads(TOSS_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    # Not fatal: every 2025-onward row names its security by KRX code and
    # resolves without the snapshot. Only the ISIN-era rows and the handful of
    # code-less names need it, and they are reported if they then fail.
    report("no-snapshot", f"{TOSS_SNAPSHOT_PATH} not found — names and ISINs cannot be resolved to symbols")
    return None


def check_lots_against_snapshot(taxlots, snapshot, report):
    """Name any open Toss lot the broker's own API does not hold.

    The statements end before the snapshot does, so a lot can legitimately
    outlive its position — but it can also be a position that quietly stopped
    existing. This project has been caught by that once already, with a matured
    bond the lot walk kept holding a year past redemption, so the case gets a
    name rather than a silent row in taxlots.tsv.
    """
    if not snapshot:
        return
    held = {
        item.get("symbol")
        for account in snapshot.get("accounts", [])
        for item in (account.get("holdings") or {}).get("items") or []
    }
    if not held:
        return
    for lot in taxlots:
        if nfc(lot["Account"]) != TOSS_ACCOUNT or lot["Ticker"] in held:
            continue
        report(
            "open-lot-not-held",
            f"{lot['Ticker']} ({lot['Name']}) {lot['Open Quantity']} unit(s) acquired "
            f"{lot['Acquired Date']} at cost {lot['Cost Basis (KRW)']} — open in the statements, "
            f"absent from /api/v1/holdings",
        )


def toss_transactions(statements_dir, snapshot, report):
    """Toss 거래내역서 rows in the shared TRANSACTION_COLUMNS shape.

    `report(kind, detail)` collects everything that could not be handled, for
    the caller to print. Nothing is dropped silently.

    Both statement sections report WON — the 달러 section prints the won value
    of a foreign trade and puts the rate in 환율 (see toss_statements.py) — so
    `Currency` is KRW throughout and `FX Rate` is provenance rather than
    something the ingest must multiply by.
    """
    pdfs = [p for p in sorted(statements_dir.glob("*.pdf")) if "토스증권" in nfc(p.name)]
    if not pdfs:
        return []

    by_name, by_isin = toss_statements.load_symbol_index(snapshot)

    out = []
    for pdf_path in pdfs:
        name = nfc(pdf_path.name)
        count = 0
        for row in toss_statements.rows(str(pdf_path), name, report):
            mapped, _label = toss_statements.classify(row["raw_type"])
            if mapped is None:
                report("unmapped-type", f"{row['raw_type']} ({name} p{row['page']})")
                continue

            ticker, how = toss_statements.resolve_symbol(row["name"], row["code"], by_name, by_isin)
            # A cash movement has no 종목: the cell holds the remitter on an
            # 이체입금 and the deposit plan's label on an 오픈뱅킹입금, so a name
            # that does not resolve there is expected rather than a failure.
            # Anywhere else it IS a failure and is named, because an unresolved
            # symbol is a lot filed under no ticker at all — and a dividend with
            # no ticker is income the position never gets credited with.
            #
            # The quantity test is what makes this safe. A 타사대체입고 also maps
            # to TRANSFER_IN, and those rows are the entire point of this parser
            # — but they move shares, so they are never treated as cash and an
            # unresolved one is still reported.
            cash_only = not row["quantity"] and mapped in (
                "TRANSFER_IN", "TRANSFER_OUT", "JOURNAL", "INTERNAL_TRANSFER",
            )
            if not ticker and row["name"] and not cash_only \
                    and row["name"] not in toss_statements.NON_SECURITY_LABELS:
                report("unresolved-symbol", f"{row['name']} ({row['raw_type']}, {name} p{row['page']})")
            elif how == "unresolved-isin":
                report("unresolved-isin", f"{row['name']} ({row['code']}) kept as its own ticker")

            out.append({
                "Date": row["date"],
                "Account": TOSS_ACCOUNT,
                "Type": mapped,
                "Raw Type": row["raw_type"],
                "Ticker": ticker,
                "Name": row["name"],
                "Quantity": row["quantity"],
                "Currency": "KRW",
                # 거래대금 is the consideration, and it is 0 on a 타사대체입고 —
                # no cash changed hands. lot_cost() then falls back to
                # quantity x 단가, which is exactly the cost the sending broker
                # carried across, and is the whole reason the statements can
                # rebuild these lots when the order history cannot.
                "Native Amount": row["gross"],
                "FX Rate": row["rate"] or "",
                "Amount (KRW)": row["gross"],
                "Settlement (KRW)": row["settlement"],
                "Unit Price": row["unit_price"],
                "Fee": row["fee"],
                # 제세금 is the all-in withholding line and is present in both
                # sections; 거래세 exists only in the 원화 one. They are summed
                # rather than picked between so a Korean sale's transaction tax
                # cannot go missing just because this account has not made one.
                "Tax": row["tax"] + row["trade_tax"],
                # 잔고, the running SHARE count — the same thing 미래에셋 files
                # here as 유가잔고, not the 잔액 cash balance printed beside it.
                # It is the broker's own count after each row, which makes it an
                # audit of the parse that owes nothing to this script's
                # arithmetic: see the 잔고 continuity check below.
                "Balance": row["share_balance"],
                "Source": name,
                "Page": row["page"],
            })
            count += 1
        print(f"[toss-statement] {name}: {count} transaction(s)")
    breaks = check_share_balances(out, report)
    print(f"[toss-statement] 잔고 continuity: {len(out)} row(s) checked, {breaks} break(s)")
    return out


def main():
    statements_dir = None
    for child in sorted(DATA_DIR.iterdir()) if DATA_DIR.exists() else []:
        if child.is_dir() and "국내증권사" in nfc(child.name):
            statements_dir = child
            break
    if statements_dir is None:
        print(f"ERROR: no 국내증권사 statement directory under {DATA_DIR}", file=sys.stderr)
        return 1

    pdfs = [p for p in sorted(statements_dir.glob("*.pdf")) if "미래에셋" in nfc(p.name)]
    if not pdfs:
        print(f"ERROR: no 미래에셋 statements in {statements_dir}", file=sys.stderr)
        return 1

    transactions = []
    dividends = []
    unmapped = {}
    skipped_locked = []
    unconverted = 0
    toss_problems = {}

    for pdf_path in pdfs:
        name = nfc(pdf_path.name)
        if "잔고증명서" in name:
            continue  # positions, not transactions — used separately as a checkpoint
        pdf = open_pdf(str(pdf_path))
        if pdf is None:
            skipped_locked.append(name)
            continue
        with pdf:
            account = account_label(pdf)
            count = 0
            for page_no, a, b, c in records(pdf, name):
                raw_type = a[1].strip()
                if raw_type in CASH_LEG_TYPES:
                    continue
                mapped = TYPE_MAP.get(raw_type)
                if mapped is None:
                    unmapped[raw_type] = unmapped.get(raw_type, 0) + 1
                    continue
                currency, native, rate, krw = amount_of(a, b, c)
                if currency != "KRW" and krw == "":
                    unconverted += 1
                row = {
                    "Date": a[0].strip().replace("/", "-"),
                    "Account": account,
                    "Type": mapped,
                    "Raw Type": raw_type,
                    "Ticker": clean_ticker(a[4]),
                    "Name": clean_name(b[4]),
                    "Quantity": number(b[2]),
                    "Currency": currency,
                    "Native Amount": native,
                    "FX Rate": rate,
                    "Amount (KRW)": krw,
                    "Settlement (KRW)": number(b[6]) if currency == "KRW" else "",
                    "Unit Price": number(b[3]),
                    "Fee": number(a[5]),
                    "Tax": number(b[5]),
                    "Balance": number(b[7]),
                    "Source": name,
                    "Page": page_no,
                }
                transactions.append(row)
                # The dividends table is the income table — the US side files
                # every isIncomeType() row there too, and the ingest checks the
                # two counts agree. Deposit interest and tax refunds are income
                # the portfolio should see, so they belong here with 배당; `Type`
                # keeps the 거래종류 that distinguishes them.
                if mapped in ("DIVIDEND", "INTEREST", "OTHER_INCOME"):
                    dividends.append({
                        "Date": row["Date"],
                        "Account": account,
                        "Symbol": row["Ticker"],
                        "Name": row["Name"],
                        "Currency": currency,
                        "Native Amount": native,
                        "FX Rate": rate,
                        "Amount (KRW)": krw,
                        "Type": raw_type,
                        "Source": name,
                        "Page": page_no,
                    })
                count += 1
            print(f"[kr-statement] {name}: {count} transaction(s) from {len(pdf.pages)} page(s)")

    def report(kind, detail):
        toss_problems.setdefault(kind, []).append(detail)

    toss_snapshot = load_toss_snapshot(report)
    toss_rows = toss_transactions(statements_dir, toss_snapshot, report)
    transactions.extend(toss_rows)
    # Toss files income under 거래구분 the same way 미래에셋 does, so the same
    # rule puts it in the income table: the ingest checks that the two counts
    # agree, and a dividend present in one and absent from the other fails it.
    for row in toss_rows:
        if row["Type"] in ("DIVIDEND", "INTEREST", "OTHER_INCOME"):
            dividends.append({
                "Date": row["Date"],
                "Account": row["Account"],
                "Symbol": row["Ticker"],
                "Name": row["Name"],
                "Currency": row["Currency"],
                "Native Amount": row["Native Amount"],
                "FX Rate": row["FX Rate"],
                "Amount (KRW)": row["Amount (KRW)"],
                "Type": row["Raw Type"],
                "Source": row["Source"],
                "Page": row["Page"],
            })

    transactions.sort(key=lambda r: (r["Date"], r["Source"], r["Page"]))
    dividends.sort(key=lambda r: (r["Date"], r["Source"], r["Page"]))

    as_of = os.environ.get("STOCK_KR_AS_OF") or (max(r["Date"] for r in transactions) if transactions else "")
    taxlots, realized, lot_notes = build_lots(transactions, as_of)
    check_lots_against_snapshot(taxlots, toss_snapshot, report)

    write_tsv(OUT_DIR / "transactions.tsv", TRANSACTION_COLUMNS, transactions)
    write_tsv(OUT_DIR / "dividends.tsv", DIVIDEND_COLUMNS, dividends)
    write_tsv(OUT_DIR / "taxlots.tsv", TAXLOT_COLUMNS, taxlots)
    write_tsv(OUT_DIR / "realized.tsv", REALIZED_COLUMNS, realized)

    by_currency = {}
    for r in transactions:
        by_currency[r["Currency"]] = by_currency.get(r["Currency"], 0) + 1
    print(f"\nWrote {OUT_DIR}/transactions.tsv ({len(transactions)} rows: "
          f"{', '.join(f'{c} {n}' for c, n in sorted(by_currency.items()))})")
    print(f"Wrote {OUT_DIR}/dividends.tsv ({len(dividends)} rows)")
    print(f"Wrote {OUT_DIR}/taxlots.tsv ({len(taxlots)} open lot(s), as of {as_of})")
    print(f"Wrote {OUT_DIR}/realized.tsv ({len(realized)} realized lot(s))")
    if lot_notes:
        print(f"\nWARNING: {len(lot_notes)} lot issue(s) — a disposal with no open lot means "
              f"the opening side is in a statement we do not have:", file=sys.stderr)
        for note in lot_notes[:20]:
            print(f"  {note}", file=sys.stderr)
        if len(lot_notes) > 20:
            print(f"  … and {len(lot_notes) - 20} more", file=sys.stderr)
    if unconverted:
        print(f"{unconverted} foreign row(s) carry no 환율 — 'Amount (KRW)' left empty "
              f"for the ingest to convert from the historical FX table.")

    if skipped_locked:
        # Loud, because a skipped statement is a period of trading the portfolio
        # will simply not contain — the same silent gap this script exists to close.
        print(f"\nWARNING: {len(skipped_locked)} statement(s) could not be opened "
              f"(set STOCK_PDF_PASSWORD): {', '.join(skipped_locked)}", file=sys.stderr)
    if unmapped:
        print("\nWARNING: unmapped 거래종류 — these rows were dropped:", file=sys.stderr)
        for raw, n in sorted(unmapped.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>5}  {raw}", file=sys.stderr)
    if toss_problems:
        # Same principle as the 미래에셋 side: an unmapped 거래구분 or an
        # unresolved symbol is named, because either one is a trade that never
        # reaches the portfolio and neither announces itself downstream.
        print("\nWARNING: Toss statement issues:", file=sys.stderr)
        for kind, details in sorted(toss_problems.items()):
            unique = sorted(set(details))
            print(f"  {kind}: {len(details)} row(s), {len(unique)} distinct", file=sys.stderr)
            for detail in unique[:10]:
                print(f"      {detail}", file=sys.stderr)
            if len(unique) > 10:
                print(f"      … and {len(unique) - 10} more", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
