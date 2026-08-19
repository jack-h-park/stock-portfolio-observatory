"""Parse 삼성증권 주식보상계좌 거래내역확인서 PDFs into normalized transaction rows.

WHY THIS EXISTS: this account is where RSUs vest, and nothing read it. It is a
small account — it can hold no shares at all — which is exactly why it went
unnoticed for so long: a position of zero looks identical to an account nobody
parses. What it does hold is history the portfolio never saw: dividends across
several payments, the tax withheld against them, and the vest-date cost of every
share that later moved to Toss.

That last part is the one that matters beyond this account. Vested shares leave
here for Toss as transfers, and `toss_statements.py` already names them: Toss's
own holdings do not reconcile
with its order history because the shares arrived by transfer, and a transfer is
not an order. Toss records its side as 타사대체입고 with the cost carried across,
so the lots were never wrong — but the account those shares came FROM was
invisible, along with the income it earned while holding them.

A THIRD LAYOUT. 미래에셋 spreads one transaction across three physical table
rows; Toss has no table structure at all and is read by x-coordinate. This one
is the friendly case: `extract_tables()` returns a real 12-column table and one
transaction is ONE row. The catch is that every cell carries TWO stacked values,
because the header itself is two rows deep:

    거래일자   거래명   거래수량   거래금액   제세금/대출이자   현금잔액        …
    거래번호   종목명   거래단가   정산금액   수수료/Fee        잔고수량/…      …

So `거래수량` and `거래단가` are the two lines of one cell, not two columns. Cell
text is split on newline and read by position.

NOT EVERY CELL IS TWO LINES, which is why the split is tolerant rather than
strict. 상대계좌명 runs to three (`박현웅` / `토스증권(주)` / `13701045831`) and
처리점 wraps mid-name (`수원금융센터 1` / `지점`). Requiring exactly two would
drop the transfers — the rows this parser exists for.

WHAT THE STATEMENT PROVES ABOUT ITSELF. Two independent checks, neither computed
by this script:

  잔고수량, a running share count on every row, audits the quantities the same
  way Toss's 잔고 does — `check_share_balances` in extract-kr-statements.py.

  입금액합계 / 출금액합계 / 증감, printed in a summary table on the last page,
  audit the cash. Verified against a hand sum before this parser was written:
  입금액합계 39,159 is the sum of 거래금액 on the inbound rows, NOT 정산금액 —
  the difference is the ₩5,990 withheld, which is also exactly why 증감 20,429
  and the closing 현금잔액 14,439 differ. Reading 정산금액 there would look
  plausible and be wrong by the tax.
"""

import re
import unicodedata

import pdfplumber


def nfc(value):
    """Composed Hangul. The literals here are composed; PDF text may not be."""
    return unicodedata.normalize("NFC", value or "")


DATE_CELL = re.compile(r"^\d{4}/\d{2}/\d{2}$")

# 거래명 → the shared vocabulary in ingest-stock-data.mjs. Anything absent is
# reported by the caller rather than dropped: an unmapped 거래명 is a movement
# the portfolio never hears about.
TYPE_MAP = {
    # Shares. 대체입고 is the vest — the company delivering shares into the
    # account — and carries the vest-date price in 거래단가 while 거래금액 stays
    # 0, since no cash changed hands. That unit price IS the cost basis, and
    # lot_cost() falls back to quantity × 단가 for exactly this shape.
    "대체입고": "TRANSFER_IN",
    # 타사출고 is the matching side of Toss's 타사대체입고. Booked as a transfer
    # and not a sale: it moves the position, it does not realize a gain.
    "타사출고": "TRANSFER_OUT",
    # Income.
    "배당금입금": "DIVIDEND",
    # 예탁금이용료 under a shorter name than 미래에셋 prints. Interest on the
    # cash the dividends left behind — ₩69 in total, kept because income the
    # portfolio does not see is the failure this pipeline keeps rediscovering,
    # and ₩69 is not a different kind of missing than ₩69,000.
    "이용료입금": "INTEREST",
    # Cash leaving for a bank account. No ticker and no quantity, so the lot
    # walk skips it; it is kept for the cash trail and for the 출금액합계 check.
    "이체출금": "TRANSFER_OUT",
}

# Column index → what the two stacked lines of that cell mean. Written out
# because the pairing is the whole trick of this layout.
COL_DATE, COL_NAME, COL_QTY, COL_AMOUNT = 0, 1, 2, 3
COL_TAX_FEE, COL_BALANCE, COL_COUNTERPARTY, COL_CURRENCY = 4, 5, 6, 8


def lines(cell):
    """The stacked values in one cell, blanks dropped."""
    return [part.strip() for part in nfc(cell).split("\n") if part.strip()]


def line_at(cell, index):
    parts = lines(cell)
    return parts[index] if index < len(parts) else ""


def number(value):
    raw = nfc(str(value or "")).strip().replace(",", "")
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def classify(raw_type):
    return TYPE_MAP.get(raw_type)


# The shape the ingest splits on: everything before the bracket becomes
# `brokerage`, everything inside becomes `account_type`.
DEFAULT_ACCOUNT = "삼성증권"


def account_label(cell):
    """`삼성증권(주식보상)` — read from the 계좌번호 line, not hard-coded.

    The statement prints `7162023456-01 종합(주식보상)(비대면)`. Two bracketed
    groups: the product (주식보상) and the channel it was opened through
    (비대면). The first is the account type the portfolio cares about; the
    second says nothing about what the account holds, so it is dropped rather
    than concatenated into a label nobody would recognise.
    """
    groups = re.findall(r"\(([^)]+)\)", nfc(cell))
    kind = next((g for g in groups if g not in ("비대면", "대면")), "")
    return f"{DEFAULT_ACCOUNT}({kind})" if kind else DEFAULT_ACCOUNT


def parse(path, source_name, password, report):
    """(transaction rows, printed totals) for one 거래내역확인서.

    `report(kind, detail)` collects everything that could not be handled, for the
    caller to print. Nothing is dropped silently.
    """
    out = []
    totals = None
    account = DEFAULT_ACCOUNT
    with pdfplumber.open(path, password=password or "") as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables() or []:
                for row in table:
                    cells = [c or "" for c in row]
                    if len(cells) >= 2 and nfc(cells[0]).strip() == "계좌번호":
                        account = account_label(cells[1])
                        continue
                    if len(cells) >= 7 and nfc(cells[0]).strip().startswith("입금액합계"):
                        totals = {
                            "inflow": number(cells[1]),
                            "outflow": number(cells[3]),
                            "net": number(cells[6]),
                        }
                        continue
                    if len(cells) < 12:
                        continue
                    date = line_at(cells[COL_DATE], 0)
                    if not DATE_CELL.match(date):
                        continue  # header, or the account block at the top

                    raw_type = line_at(cells[COL_NAME], 0)
                    # 통화코드 is 'KRW' on the rows that have a security leg and
                    # '0' on the ones that do not. Anything else would mean a
                    # foreign holding in an account that has only ever held
                    # a foreign-currency line — reported rather than quietly
                    # booked as won.
                    currency = line_at(cells[COL_CURRENCY], 0)
                    if currency not in ("", "0", "KRW"):
                        report(
                            "unexpected-currency",
                            f"{date} {raw_type}: 통화코드 {currency} ({source_name} p{page_no})",
                        )

                    out.append({
                        "date": date.replace("/", "-"),
                        "raw_type": raw_type,
                        "name": line_at(cells[COL_NAME], 1),
                        "quantity": number(line_at(cells[COL_QTY], 0)),
                        "unit_price": number(line_at(cells[COL_QTY], 1)),
                        # 거래금액 is the gross consideration and 정산금액 what
                        # actually settled; on a dividend they differ by the
                        # withholding. Both are kept — the totals check reads
                        # the first, the cash trail the second.
                        "gross": number(line_at(cells[COL_AMOUNT], 0)),
                        "settlement": number(line_at(cells[COL_AMOUNT], 1)),
                        "tax": number(line_at(cells[COL_TAX_FEE], 0)),
                        "fee": number(line_at(cells[COL_TAX_FEE], 1)),
                        "cash_balance": number(line_at(cells[COL_BALANCE], 0)),
                        # 잔고수량 — the broker's own running share count.
                        "share_balance": number(line_at(cells[COL_BALANCE], 1)),
                        "counterparty": " ".join(lines(cells[COL_COUNTERPARTY])),
                        "page": page_no,
                    })
    return out, totals, account


def check_totals(rows, totals, source_name, report):
    """Sum the parsed rows against the totals the statement printed for itself.

    Cash-side counterpart to the 잔고수량 continuity check. A row dropped by a
    layout change moves one of these sums and nothing else would notice: the
    remaining rows still parse, still balance against each other, and still look
    entirely reasonable.
    """
    if not totals:
        report("no-totals", f"{source_name}: no 입금액합계 row found to check the parse against")
        return
    inflow = sum(r["gross"] for r in rows if r["gross"] > 0 and r["raw_type"] != "이체출금")
    outflow = sum(r["gross"] for r in rows if r["raw_type"] == "이체출금")
    for label, parsed, printed in (
        ("입금액합계", inflow, totals["inflow"]),
        ("출금액합계", outflow, totals["outflow"]),
        ("증감", inflow - outflow, totals["net"]),
    ):
        if abs(parsed - printed) > 0.5:
            report(
                "totals-break",
                f"{source_name}: {label} parsed {parsed:,.0f} but the statement prints {printed:,.0f}",
            )
