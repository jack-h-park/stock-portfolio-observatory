"""Parse Mirae Asset 거래내역증명서 PDFs into the normalized Korea payload TSVs.

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

import os
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
OUT_DIR = Path(os.environ.get("STOCK_KR_STATEMENTS_DIR", Path.cwd() / "data/kr-statements"))
PDF_PASSWORD = os.environ.get("STOCK_PDF_PASSWORD", "")

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
    "Amount (KRW)", "Settlement (KRW)", "Unit Price", "Fee", "Tax", "Balance",
    "Source", "Page",
]
DIVIDEND_COLUMNS = ["Date", "Account", "Symbol", "Name", "Amount (KRW)", "Type", "Source", "Page"]


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
                row = {
                    "Date": a[0].strip().replace("/", "-"),
                    "Account": account,
                    "Type": mapped,
                    "Raw Type": raw_type,
                    "Ticker": clean_ticker(a[4]),
                    "Name": clean_name(b[4]),
                    "Quantity": number(b[2]),
                    "Amount (KRW)": number(a[6]),
                    "Settlement (KRW)": number(b[6]) or number(a[6]),
                    "Unit Price": number(b[3]),
                    "Fee": number(a[5]),
                    "Tax": number(b[5]),
                    "Balance": number(b[7]),
                    "Source": name,
                    "Page": page_no,
                }
                transactions.append(row)
                if mapped == "DIVIDEND":
                    dividends.append({
                        "Date": row["Date"],
                        "Account": account,
                        "Symbol": row["Ticker"],
                        "Name": row["Name"],
                        "Amount (KRW)": row["Amount (KRW)"],
                        "Type": raw_type,
                        "Source": name,
                        "Page": page_no,
                    })
                count += 1
            print(f"[kr-statement] {name}: {count} transaction(s) from {len(pdf.pages)} page(s)")

    transactions.sort(key=lambda r: (r["Date"], r["Source"], r["Page"]))
    dividends.sort(key=lambda r: (r["Date"], r["Source"], r["Page"]))

    write_tsv(OUT_DIR / "transactions.tsv", TRANSACTION_COLUMNS, transactions)
    write_tsv(OUT_DIR / "dividends.tsv", DIVIDEND_COLUMNS, dividends)

    print(f"\nWrote {OUT_DIR}/transactions.tsv ({len(transactions)} rows)")
    print(f"Wrote {OUT_DIR}/dividends.tsv ({len(dividends)} rows)")

    if skipped_locked:
        # Loud, because a skipped statement is a period of trading the portfolio
        # will simply not contain — the same silent gap this script exists to close.
        print(f"\nWARNING: {len(skipped_locked)} statement(s) could not be opened "
              f"(set STOCK_PDF_PASSWORD): {', '.join(skipped_locked)}", file=sys.stderr)
    if unmapped:
        print("\nWARNING: unmapped 거래종류 — these rows were dropped:", file=sys.stderr)
        for raw, n in sorted(unmapped.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>5}  {raw}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
