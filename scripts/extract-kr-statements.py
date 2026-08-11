"""Parse Korean brokerage statements into the normalized Korea payload TSVs.

Three brokers, one lot engine. The 미래에셋 거래내역증명서 layout is handled here;
the Toss 거래내역서 and the 삼성증권 주식보상 거래내역확인서 are different enough
to live in `toss_statements.py` and `samsung_statements.py` and are imported. All
three feed the same FIFO walk below, so a transfer OUT of one broker and the
matching transfer IN to another are replayed in one timeline — which is what lets
52 삼성전자 shares leave the RSU account and arrive at Toss without either side
inventing a purchase or a sale.

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
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
import samsung_statements  # noqa: E402  (needs the path above)
import toss_statements  # noqa: E402  (needs the path above)

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
OUT_DIR = Path(os.environ.get("STOCK_KR_STATEMENTS_DIR", Path.cwd() / "data/kr-statements"))
PDF_PASSWORD = os.environ.get("STOCK_PDF_PASSWORD", "")
TOSS_SNAPSHOT_PATH = Path(os.environ.get("STOCK_TOSS_SNAPSHOT_PATH", Path.cwd() / "data/toss-snapshot.json"))
TOSS_ACCOUNT = os.environ.get("STOCK_TOSS_ACCOUNT_LABEL", "토스증권")

# The certificates, under STOCK_DATA_DIR. Named, not searched for: this used to
# scan every child of the data directory for one whose name contained 국내증권사,
# which needed Unicode normalisation to work at all and would have quietly picked
# the wrong folder had a second one ever matched. The directory has an ASCII name
# now, so it can simply be said. (Not to be confused with STOCK_KR_STATEMENTS_DIR
# above, which is where the parsed TSVs are WRITTEN.)
STATEMENTS_DIR = DATA_DIR / "kr-statements"

# Filenames follow the grammar in scripts/source-files.mjs:
#   <broker>-<doctype>[-<account>]-<period>[-<part>].pdf
# so the broker is the first segment and the document type the second, and both
# are plain ASCII.
MIRAE_PREFIX = "mirae-"
TOSS_PREFIX = "toss-"
SAMSUNG_PREFIX = "samsung-"
BALANCE_DOCTYPE = "-balance-"

# PDF text, not filenames: pdfplumber returns Hangul in whichever normalisation
# the generator embedded, while the literals compared against it here are
# composed. Filenames no longer need this — they are ASCII — but cell contents
# still do, and comparing two forms silently matches nothing.
def nfc(value):
    return unicodedata.normalize("NFC", value or "")


DATE_CELL = re.compile(r"^\d{4}/\d{2}/\d{2}$")
# How 미래에셋 writes a symbol change in the 종목명 column: `FB -> META`.
TICKER_CHANGE = re.compile(r"^([A-Z0-9.]{1,12})\s*->\s*([A-Z0-9.]{1,12})$")

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
    # The 2018-2019 certificate names the same two events differently — the
    # broker changed its wording somewhere in 2018, and the older file carries
    # both vocabularies. These are securities legs despite reading like cash
    # ones: `주식매수` on 2018-06-11 fills 거래수량 3 and 단가 31,810 against a
    # 거래금액 of 95,430, which is the same shape `주식매수입고` has, and there is
    # no paired 주식매수출금 to double-count against — 15 of the former against 3
    # of the latter in that file.
    "주식매수": "BUY",
    "해외주식매수결제": "BUY",
    "주식매도출고": "SELL",
    "해외주식매도출고": "SELL",
    "외화채권매도출고": "SELL",
    "소수해외매도출고": "SELL",
    # The share leg of a 주식배당, and it conveys nothing on its own. All three
    # rows on the books carry no quantity and no amount — the statement line is
    # date, type and ticker with no figures after it — and the position balance
    # is unchanged across every one of them: 096770 reads 5 before and after
    # 2022-04-26, and 7 before and after 2023-04-26. The whole entitlement was
    # fractional and settled in cash.
    #
    # The economics are in the two rows filed beside it, both already typed:
    # 배당세금출금 is the withholding and 배당단수주대금입금 is the 단수주 paid
    # out. REINVEST claimed the opposite of what happened — nothing was
    # reinvested, the cash was paid OUT — and put the row in OPENING_TYPES,
    # where it asserted a lot it never had the shares to open. CORPORATE_ACTION
    # is what a stock dividend is, and is in neither the opening nor the closing
    # set, which is what a row that moves nothing should be.
    #
    # A bigger declaration would deposit whole shares, and CORPORATE_ACTION
    # would then ignore them — so the parse loop reports a 배당주입고 that ever
    # carries a quantity rather than letting the shares go quiet.
    "배당주입고": "CORPORATE_ACTION",
    "채권만기상환출고(해외)": "CORPORATE_ACTION",
    "액면분할입고(해외)": "STOCK_SPLIT",
    "액면분할출고(해외)": "STOCK_SPLIT",
    # A reverse split, the same event running the other way. The odd-lot
    # remainder it leaves is paid out in cash, which is income and not a
    # disposal — the same treatment 무상단수주대금입금 already gets below.
    "액면병합출고": "STOCK_SPLIT",
    "액면병합입고(액면병합)": "STOCK_SPLIT",
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
    "해외주식배당금": "DIVIDEND",
    "ETF/상장클래스 분배금입금": "DIVIDEND",
    "배당단수주대금입금": "DIVIDEND",
    "예탁금이용료입금": "INTEREST",
    "예탁금이용료정기입금": "INTEREST",
    "외화예탁금이용료입금": "INTEREST",
    "채권이자외화입금": "INTEREST",
    "사채이자입금": "INTEREST",
    "해외주식현지과세환급금": "OTHER_INCOME",
    "세금환급": "OTHER_INCOME",
    "선환전차액입금": "OTHER_INCOME",
    "무상단수주대금입금": "OTHER_INCOME",
    "액면병합단수주대금": "OTHER_INCOME",
    "신규이벤트입금": "OTHER_INCOME",
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
    "환전매수": "JOURNAL",
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


# The period a statement declares for ITSELF, in the three shapes the three
# brokers print. All of them put it on page 1:
#
#   미래에셋   2026/01/01 ~ 2026/07/16                      (bare, no label)
#   토스       조회 기간 2026년 1월 1일 ~ 2026년 7월 15일
#   삼성증권   조회일자 2025-01-01 ~ 2026-07-16
#
# Read from the document rather than from the filename, and the reason is on
# record: a crypto statement named 2025년1-7월 turned out to hold
# 2026-01-01~2026-07-31, which is why `crypto_statement_periods_contiguous`
# already asserts on declared periods instead of names. The same argument
# settles it here, and one statement makes it unavoidable —
# `samsung-rsu-transactions-<ACCOUNT_LAST5>.pdf` carries no period in its name at all.
COVERAGE_RE = re.compile(
    r"(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*~\s*(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})"
    r"|(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일"
)


def coverage_period(text):
    """(start, end) as ISO dates, or (None, None) if the page does not say."""
    match = COVERAGE_RE.search(nfc(text or ""))
    if not match:
        return None, None
    parts = [g for g in match.groups() if g is not None]
    if len(parts) != 6:
        return None, None
    y1, m1, d1, y2, m2, d2 = parts
    return f"{y1}-{int(m1):02d}-{int(d1):02d}", f"{y2}-{int(m2):02d}-{int(d2):02d}"


def statement_coverage(path, report):
    """The declared period of one statement, reported rather than guessed."""
    pdf = open_pdf(str(path))
    if pdf is None:
        return None, None
    with pdf:
        text = pdf.pages[0].extract_text() if pdf.pages else ""
    start, end = coverage_period(text)
    # A 잔고증명서 states a position at an instant, not activity over a period,
    # so having no 조회기간 is what it IS rather than something missing from it.
    # Reporting it would put a finding on every run that no download can clear,
    # and a permanent warning is one people learn to scroll past.
    if end is None and BALANCE_DOCTYPE in path.name:
        return start, end
    if end is None:
        # Not fatal — the account simply falls back to its last transaction,
        # which is the old behaviour. Named because that fallback UNDERSTATES
        # how current the account is, and silently: a quiet account looks stale
        # rather than quiet, and every lot in it loses holding days it earned.
        report("no-coverage-period", f"{path.name}: page 1 declares no 조회기간 — falling back to its last transaction date")
    return start, end


# Finding kinds that mean a row was DROPPED rather than kept with a note. The
# distinction is the whole point of the report file: an unresolved ISIN still
# produces a transaction, an unmapped 거래종류 produces nothing at all.
DROPPING_KINDS = {"unmapped-type", "samsung-unmapped-type", "mirae-unmapped-type"}

# Types classified on the evidence that they carry no shares. The classification
# is only as good as that, so the day one arrives with a quantity on it, the
# parser says so instead of the shares going quiet — see 배당주입고 in TYPE_MAP.
# The row is kept either way, which is why this is a note and not a fault.
SHARELESS_TYPES = {"배당주입고"}

PART_SUFFIX_RE = re.compile(r"-\d+of\d+$")
TRAILING_NUMBER_RE = re.compile(r"-\d+$")


def statement_series(stem):
    """`mirae-isa-transactions-2022` -> `mirae-isa-transactions`.

    Broker, account and document type, with every trailing numeric segment —
    period, range, and the document numbers 미래에셋 appends — taken off. Two
    statements may only be compared inside one series, and getting this wrong is
    not a near miss: 미래에셋's 종합 and ISA are different accounts whose periods
    overlap by year, so a coarser key had the 2022-2023 종합 statement swallow
    four ISA statements whole.
    """
    stem = PART_SUFFIX_RE.sub("", stem)
    while True:
        shortened = TRAILING_NUMBER_RE.sub("", stem)
        if shortened == stem:
            return stem
        stem = shortened


def statements_to_read(pdfs, report):
    """The statements to extract, with any fully superseded ones left out.

    A 거래내역증명서 is requested for a period, so re-downloading a longer one
    hands you a document that contains the old one whole. Both then sit in the
    directory, and the extractor — which globs — reads both and counts every
    shared transaction twice. That happened: `toss-transactions-20260715.pdf`
    (2026-01-01~07-15) and `toss-transactions-20260801.pdf` (2026-01-01~08-01)
    would have double-counted seven months of Toss trading, and the only thing
    that stopped it was someone noticing the periods by eye.

    Superseding is decided on the period the DOCUMENT declares on page 1, not on
    the filename. Filenames here are typed by hand; 조회기간 is printed by the
    broker.

    Multi-part exports are grouped first, and that is the whole reason this is
    not a two-line rule. Toss splits a long period across files by row count and
    prints THE SAME 조회기간 on every part: `toss-transactions-2023-1of2` and
    `-2of2` both declare 2023-01-01~2023-12-31. Comparing files would find each
    contains the other and drop one, silently losing half of 2023 and two thirds
    of 2024 — 4,871 transactions. So `-NofM` is stripped to get the document, and
    documents are what get compared.

    Only strict containment resolves. A partial overlap has rows in each that the
    other lacks, so neither can be dropped and it is reported instead; equal
    periods across two different documents cannot happen under the naming
    grammar (the period IS the name) and so is reported rather than guessed at.
    """
    documents = {}
    for path in pdfs:
        documents.setdefault(PART_SUFFIX_RE.sub("", path.stem), []).append(path)

    coverage = {}
    for key, parts in documents.items():
        # One page-1 read per document: the parts declare the same period, so
        # reading them all would cost the same answer several times over.
        coverage[key] = statement_coverage(parts[0], report)

    superseded = {}
    series = {}
    for key in coverage:
        series.setdefault(statement_series(key), []).append(key)
    dated = sorted(
        (k, coverage[k])
        for group in series.values()
        for k in group
        if coverage[k][0] and coverage[k][1]
    )
    for i, (key, (start, end)) in enumerate(dated):
        for other, (o_start, o_end) in dated[i + 1:]:
            if statement_series(key) != statement_series(other):
                continue
            # Each pair judged once, from the lower key, so a mutual relation is
            # not reported twice as if it were two findings.
            key_in_other = o_start <= start and end <= o_end
            other_in_key = start <= o_start and o_end <= end
            if key_in_other and other_in_key:
                report(
                    "duplicate-coverage",
                    f"{key} and {other} both declare {start}~{end} — reading both would "
                    f"count every transaction twice; remove one",
                )
            elif key_in_other:
                superseded[key] = (other, start, end, o_start, o_end)
            elif other_in_key:
                superseded[other] = (key, o_start, o_end, start, end)
            elif o_start <= end and start <= o_end:
                report(
                    "partial-overlap",
                    f"{key} ({start}~{end}) and {other} ({o_start}~{o_end}) overlap without "
                    f"either containing the other — both are read, so the shared days are "
                    f"counted twice; re-download one to cover the whole span",
                )

    keep = []
    for key, parts in documents.items():
        if key in superseded:
            other, start, end, o_start, o_end = superseded[key]
            print(
                f"[kr-statements] superseded: {key} ({start}~{end}) is contained by "
                f"{other} ({o_start}~{o_end}) — {len(parts)} file(s) not read"
            )
            continue
        keep.extend(parts)
    return sorted(keep)


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


def write_as_of(path, as_of_map):
    """The per-account as-of map, on its own — not only stamped onto open lots.

    A lot only carries `As Of Date` while it stays OPEN, and 삼성증권 never has
    one: every RSU vest transfers straight to Toss inside the same statement
    period, so its taxlots.tsv rows are always empty. Reading freshness off lots
    would therefore never see this account at all — not stale, just absent from
    the file that freshness would have to be read from. The ingest needs
    somewhere to ask "how current is 삼성증권" that does not depend on it holding
    anything, which is exactly the situation it is usually in.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "accounts": as_of_map,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
#
# SHARE_REWARD opens a lot like the rest: a granted share is held and eventually
# sold, and the grant's value is its cost basis. It is the reason the two Toss
# promotion codes could be typed REINVEST for so long without a lot going
# missing — REINVEST was standing in for membership of this set.
OPENING_TYPES = {"BUY", "REINVEST", "TRANSFER_IN", "SHARE_REWARD"}
CLOSING_TYPES = {"SELL", "TRANSFER_OUT"}

# The dividends table is the income table, and this is the one list that decides
# what reaches it. All three broker blocks below used to spell the same tuple
# out separately; the ingest asserts that its own `isIncomeType()` count matches
# the number of rows here, so a type added to one side and not the other fails
# the build rather than quietly losing income.
INCOME_TYPES = ("DIVIDEND", "INTEREST", "OTHER_INCOME", "SHARE_REWARD")
# "More than a year", so a lot held exactly 365 days is still short-term. The
# boundary is not academic: three ISA lots sit exactly on it.
LONG_TERM_DAYS = 365


def value_share_reward(row):
    """Give a granted share the value it was received at, in place.

    A grant settles no cash, so the certificate leaves 거래금액 empty and puts
    everything in 단가 — which is why these rows reach here with an amount of
    zero and a real unit price. Zero is not the answer: the shares ARE income at
    what they were worth, and the same figure is the basis they will be sold
    against later.

    `lot_cost` already fell back to quantity × 단가 for exactly this shape, so
    the lot is unchanged by this; what changes is that the income side now sees
    the same number instead of nothing. 결제금액 is deliberately left alone —
    no money moved, and the settlement columns are where money movement is read.

    Not rounded, deliberately. Once the amount is filled in, `lot_cost` prefers
    it over the product it used to compute, so rounding here would quietly move
    every one of these cost bases by a fraction of a won. The figure written is
    the same float the lot was already built from.
    """
    if row["Type"] != "SHARE_REWARD":
        return row
    if (row["Native Amount"] or 0) > 0:
        return row
    quantity = row["Quantity"] or 0
    unit_price = row["Unit Price"] or 0
    value = quantity * unit_price
    if not value:
        return row
    row["Native Amount"] = value
    rate = row["FX Rate"] or 0
    # The rate rides along on every Toss row as the day's USD/KRW whatever the
    # trade's own currency, so it may only be applied when the amount is not
    # already won.
    row["Amount (KRW)"] = value if row["Currency"] == "KRW" else value * rate
    return row


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


def build_lots(transactions, as_of_by_account):
    """Replay every transaction in order, consuming lots first-in-first-out.

    Returns `(taxlots, realized, notes, carried)`. `notes` are `(kind, detail)`
    pairs so the caller can file each one under its own name — they are two
    different problems that happen to be found in the same loop, and printing
    them under one heading described only the second and mislabelled the first.

    FIFO is an assumption, stated here rather than buried: the certificates
    record what left the account, not which lot the broker chose. Where the
    broker used a different method the per-lot split will differ from its own
    filing — which is why the year-end statement, not this, is the tax record.

    `as_of_by_account` is PER ACCOUNT, and it decides every lot's holding period
    and therefore its tax term. One global date across four brokers meant the
    account with the longest-running statement set the clock for all of them:
    adding 삼성증권, whose 거래내역확인서 happens to run one day later than
    anything else, moved the shared as-of from 2026-07-15 to 2026-07-16 and
    reclassified three unrelated 미래에셋 ISA lots from short-term to long-term.
    A broker should not be able to age another broker's lots.
    """
    open_lots = {}
    taxlots, realized, notes, carried = [], [], [], []

    # A SPLIT RESTATES THE LOTS IT ALREADY HAS. It is booked as an out and one
    # or more ins, and replaying that literally closes every open lot and opens
    # new ones dated the split day — which loses the acquisition date, and with
    # it the holding period. 애플's four post-split shares read as acquired
    # 2020-08-31, 테슬라's fifteen as 2022-08-25 (its SECOND split, the first
    # having already overwritten the original), SCHD's fifty-seven as
    # 2024-10-11. Eight lots in all, and the dates are the whole basis of the
    # long/short call: SCHD's came out at 383 days, eighteen above the line.
    #
    # So the pool is scaled instead — quantity times the factor, unit cost
    # divided by it — which is what the US replay already does for the same
    # event. Total cost is preserved by construction, and no acquisition date
    # moves. This is deliberately NOT the redistribution an earlier version
    # attempted: nothing here reads the inbound rows' own per-lot costs, so
    # there is no second inbound row to mistake for an outbound.
    #
    # The factor comes from the group, not from a row, because the ins arrive
    # several at a time: SCHD's 19 out against 6 + 12 + 9 + 30 in is one 3-for-1.
    split_totals = {}
    for r in transactions:
        if r["Type"] != "STOCK_SPLIT":
            continue
        raw = nfc(r["Raw Type"])
        side = "in" if "입고" in raw else "출고" in raw and "out" or None
        if not side:
            continue
        group = split_totals.setdefault((r["Account"], r["Ticker"], r["Date"]), {"in": 0.0, "out": 0.0})
        group[side] += abs(float(r["Quantity"] or 0))
    split_factors = {
        k: g["in"] / g["out"]
        for k, g in split_totals.items()
        if g["in"] > 0 and g["out"] > 0
    }
    applied_splits = set()

    for r in sorted(transactions, key=lambda x: (x["Date"], x["Source"], int(x["Page"]))):
        ticker, qty = r["Ticker"], float(r["Quantity"] or 0)

        # A ticker change moves no shares, so it is filtered out by the quantity
        # guard below — but the OPEN LOTS have to follow the symbol, or the
        # position splits in two: one half stranded under a name the broker no
        # longer uses and never consumed by a later sale, the other short of the
        # cost basis that belonged to it.
        #
        # 미래에셋 states the change outright — `해외주식티커변경`, with `FB ->
        # META` in the name — so this reads the certificate rather than waiting
        # for someone to notice and write a manual mapping. `tickerRenames` in
        # manual-mappings.json stays for renames no statement declares (a fund
        # rebranding seen only across two brokers' exports); it runs in the
        # ingest, after these lots are already built, so it cannot do this job.
        #
        # Found when the 2020-2021 certificate arrived: FB bought 2020-07-06 sat
        # open at ₩316,052 while the 2025-10-29 sale of 4 META shares found only
        # its 3 META lots — a position closed in reality, showing as held.
        renamed = TICKER_CHANGE.match(nfc(r["Name"] or "").strip())
        if renamed and ticker:
            old_key = (r["Account"], ticker)
            new_key = (r["Account"], renamed.group(2))
            moved = open_lots.pop(old_key, [])
            if moved:
                merged = open_lots.setdefault(new_key, []) + moved
                merged.sort(key=lambda lot: lot["acquired"])
                open_lots[new_key] = merged
                # Reported apart from `notes`: that channel means a disposal
                # found no lot, which is a statement someone has to go and get.
                # This is the ordinary handling of an event the broker declared,
                # and filing it under the same warning is how a real alarm stops
                # being read.
                carried.append(f"{r['Date']} {r['Account']} {ticker} -> {renamed.group(2)}: "
                               f"{len(moved)} open lot(s) carried across ({r['Raw Type']})")
            continue

        if not ticker or qty <= 0:
            continue
        key = (r["Account"], ticker)
        kind, unit = r["Type"], float(r["Unit Price"] or 0)

        # A split restates the open lots rather than replacing them — see the
        # factor table built above. One application per (account, ticker, date):
        # the sibling rows of the same event carry no further information once
        # the ratio is known.
        if kind == "STOCK_SPLIT":
            event = (r["Account"], ticker, r["Date"])
            if event in applied_splits:
                continue
            factor = split_factors.get(event)
            held = open_lots.get(key) or []
            if factor and held:
                applied_splits.add(event)
                for lot in held:
                    lot["qty"] *= factor
                    lot["unit"] /= factor
                carried.append(
                    f"{r['Date']} {r['Account']} {ticker}: {len(held)} lot(s) restated "
                    f"x{round(factor, 6)} ({r['Raw Type']}), acquisition dates kept"
                )
                continue
            # One-sided in the statements, or nothing open to restate — the
            # inbound shares are real either way, so fall through to the
            # direction rule rather than dropping them.
            notes.append((
                "split-not-restatable",
                f"{r['Date']} {r['Account']} {ticker}: split not restatable "
                f"({'no open lot' if factor else 'one side only'}) — replayed as a "
                f"movement, so the acquisition date becomes the split date",
            ))

        # Corporate actions move a position, and 출고 means it left: a matured
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
                notes.append((
                    "disposal-without-open-lot",
                    f"{r['Date']} {r['Account']} {ticker}: "
                    f"{remaining:g} unit(s) disposed with no matching open lot ({r['Raw Type']})",
                ))

    for (account, ticker), held in sorted(open_lots.items()):
        for lot in held:
            if lot["qty"] <= 1e-9:
                continue
            as_of = as_of_by_account[account]
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
    return taxlots, realized, notes, carried


def resolve_as_of(transactions, statements_dir, report):
    """account → the date its lots are current as of.

    THE STATEMENT'S COVERAGE END, not its last transaction. The two are not the
    same and the difference is not cosmetic: 미래에셋 ISA last traded 2026-07-10
    while its 거래내역증명서 runs to 2026-07-16, and "nothing happened for six
    days" is something the certificate positively tells us. Dating those lots
    2026-07-10 would take six days of holding period away from a quiet account
    for no reason — seven ISA lots fall back across the one-year line if you do,
    which is the wrong answer arrived at confidently.

    Each account takes the NEWEST coverage among the statements that produced its
    rows, so a fresh download moves it and an old one cannot drag it back.

    `STOCK_KR_AS_OF` still pins every account to one date, for reproducing a
    past run exactly.
    """
    pinned = os.environ.get("STOCK_KR_AS_OF")
    last_tx, sources = {}, {}
    for r in transactions:
        account = r["Account"]
        last_tx[account] = max(last_tx.get(account, ""), r["Date"])
        sources.setdefault(account, set()).add(r["Source"])

    if pinned:
        return {account: pinned for account in last_tx}

    # One page-1 read per statement, shared by every account it feeds.
    coverage = {}
    for name in sorted({s for names in sources.values() for s in names}):
        coverage[name] = statement_coverage(statements_dir / name, report)[1]

    resolved = {}
    for account, names in sources.items():
        ends = [coverage[n] for n in names if coverage.get(n)]
        best = max(ends) if ends else ""
        # A coverage end BEFORE the account's own last transaction means the
        # period was misread — the rows are evidence the statement reaches
        # further than the line claims. Fall back rather than date lots into the
        # past, and say so: a wrong as-of moves holding periods silently, and
        # holding periods decide tax.
        if best and best < last_tx[account]:
            report(
                "coverage-before-transactions",
                f"{account}: declared coverage ends {best} but a transaction is dated "
                f"{last_tx[account]} — using the transaction date instead",
            )
            best = ""
        resolved[account] = best or last_tx[account]
    return resolved


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
    pdfs = statements_to_read(sorted(statements_dir.glob(f"{TOSS_PREFIX}*.pdf")), report)
    if not pdfs:
        return []

    by_name, by_isin = toss_statements.load_symbol_index(snapshot)

    out = []
    for pdf_path in pdfs:
        name = pdf_path.name
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


def samsung_transactions(statements_dir, known_tickers, report):
    """삼성증권 주식보상 rows in the shared TRANSACTION_COLUMNS shape.

    The statement names its security and never numbers it — there is no 종목번호
    column at all — so the ticker is resolved by NAME against the statements
    already parsed, which do carry both. `삼성전자` appears there thousands of
    times against 005930 and nowhere against anything else.

    Resolved this way rather than from the Toss symbol index on purpose. That
    index comes from the Open API snapshot, which needs credentials the account
    owner supplies and an IP allowlist that can stop matching; hanging a Korean
    dividend's ticker off it would mean this account silently loses its income
    attribution on exactly the days Toss is unreachable. The other statements are
    on disk and need nothing.

    An ambiguous name is refused, not guessed. 삼성전자 and 삼성전자우 are one
    character apart and are different securities with different prices.
    """
    pdfs = statements_to_read(sorted(statements_dir.glob(f"{SAMSUNG_PREFIX}*.pdf")), report)
    if not pdfs:
        return []

    out = []
    for pdf_path in pdfs:
        name = pdf_path.name
        rows, totals, account = samsung_statements.parse(str(pdf_path), name, PDF_PASSWORD, report)
        samsung_statements.check_totals(rows, totals, name, report)
        count = 0
        for row in rows:
            mapped = samsung_statements.classify(row["raw_type"])
            if mapped is None:
                report("samsung-unmapped-type", f"{row['raw_type']} ({name} p{row['page']})")
                continue

            ticker = ""
            if row["name"]:
                candidates = known_tickers.get(row["name"], set())
                if len(candidates) == 1:
                    ticker = next(iter(candidates))
                else:
                    report(
                        "samsung-unresolved-symbol",
                        f"{row['name']} matched {len(candidates)} ticker(s) in the other statements "
                        f"({row['raw_type']}, {name} p{row['page']})",
                    )

            out.append({
                "Date": row["date"],
                "Account": account,
                "Type": mapped,
                "Raw Type": row["raw_type"],
                "Ticker": ticker,
                "Name": row["name"],
                "Quantity": row["quantity"],
                "Currency": "KRW",
                # 0 on a vest and on a transfer — no cash moved — which is what
                # sends lot_cost() to quantity × 단가, the vest-date price the
                # statement carries. On a dividend it is the GROSS, matching the
                # 미래에셋 side where 거래금액 is also pre-withholding.
                "Native Amount": row["gross"],
                "FX Rate": "",
                "Amount (KRW)": row["gross"],
                "Settlement (KRW)": row["settlement"],
                "Unit Price": row["unit_price"],
                "Fee": row["fee"],
                "Tax": row["tax"],
                # 잔고수량, the running SHARE count — not 현금잔액 beside it.
                "Balance": row["share_balance"],
                "Source": name,
                "Page": row["page"],
            })
            count += 1
        print(f"[samsung-statement] {name}: {count} transaction(s) → {account}")
    breaks = check_share_balances(out, report)
    print(f"[samsung-statement] 잔고수량 continuity: {len(out)} row(s) checked, {breaks} break(s)")
    return out


def main():
    statements_dir = STATEMENTS_DIR
    if not statements_dir.is_dir():
        print(f"ERROR: no statement directory at {statements_dir}", file=sys.stderr)
        return 1

    # Defined before the first statement is opened, because resolving which
    # files to read is itself something that can have findings to report.
    parser_problems = {}

    def report(kind, detail):
        parser_problems.setdefault(kind, []).append(detail)

    pdfs = statements_to_read(sorted(statements_dir.glob(f"{MIRAE_PREFIX}*.pdf")), report)
    if not pdfs:
        print(f"ERROR: no 미래에셋 statements in {statements_dir}", file=sys.stderr)
        return 1

    transactions = []
    dividends = []
    unmapped = {}
    skipped_locked = []
    unconverted = 0

    for pdf_path in pdfs:
        name = pdf_path.name
        if BALANCE_DOCTYPE in name:
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
                if raw_type in SHARELESS_TYPES and float(row["Quantity"] or 0):
                    report(
                        "shareless-type-carried-shares",
                        f"{raw_type} {row['Ticker']} {row['Date']}: {row['Quantity']} unit(s) "
                        f"({name} p{page_no}) — typed {mapped} on the evidence that it carries "
                        f"none, and {mapped} opens no lot",
                    )
                value_share_reward(row)
                transactions.append(row)
                # The dividends table is the income table — the US side files
                # every isIncomeType() row there too, and the ingest checks the
                # two counts agree. Deposit interest and tax refunds are income
                # the portfolio should see, so they belong here with 배당; `Type`
                # keeps the 거래종류 that distinguishes them.
                #
                # Amounts are read back off `row` rather than from the locals
                # they were built from, so that anything which revalues the row
                # — `value_share_reward` above — reaches the income table too
                # instead of being silently dropped between the two appends.
                if mapped in INCOME_TYPES:
                    dividends.append({
                        "Date": row["Date"],
                        "Account": account,
                        "Symbol": row["Ticker"],
                        "Name": row["Name"],
                        "Currency": currency,
                        "Native Amount": row["Native Amount"],
                        "FX Rate": rate,
                        "Amount (KRW)": row["Amount (KRW)"],
                        "Type": raw_type,
                        "Source": name,
                        "Page": page_no,
                    })
                count += 1
            print(f"[kr-statement] {name}: {count} transaction(s) from {len(pdf.pages)} page(s)")

    toss_snapshot = load_toss_snapshot(report)
    toss_rows = toss_transactions(statements_dir, toss_snapshot, report)
    transactions.extend(toss_rows)
    # Toss files income under 거래구분 the same way 미래에셋 does, so the same
    # rule puts it in the income table: the ingest checks that the two counts
    # agree, and a dividend present in one and absent from the other fails it.
    for row in toss_rows:
        value_share_reward(row)
        if row["Type"] in INCOME_TYPES:
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

    # 삼성증권 last, because it is the one statement with no 종목번호 column and
    # resolves its security by name against everything parsed above.
    known_tickers = {}
    for row in transactions:
        if row["Name"] and row["Ticker"]:
            known_tickers.setdefault(row["Name"], set()).add(row["Ticker"])
    samsung_rows = samsung_transactions(statements_dir, known_tickers, report)
    transactions.extend(samsung_rows)
    # Same income rule as the other two brokers; the ingest checks that the
    # transaction and dividend counts agree.
    for row in samsung_rows:
        value_share_reward(row)
        if row["Type"] in INCOME_TYPES:
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

    as_of_map = resolve_as_of(transactions, statements_dir, report)
    taxlots, realized, lot_notes, lot_carried = build_lots(transactions, as_of_map)
    for line in lot_carried:
        print(f"[kr-statement] {line}", file=sys.stderr)
    check_lots_against_snapshot(taxlots, toss_snapshot, report)

    write_tsv(OUT_DIR / "transactions.tsv", TRANSACTION_COLUMNS, transactions)
    write_tsv(OUT_DIR / "dividends.tsv", DIVIDEND_COLUMNS, dividends)
    write_tsv(OUT_DIR / "taxlots.tsv", TAXLOT_COLUMNS, taxlots)
    write_tsv(OUT_DIR / "realized.tsv", REALIZED_COLUMNS, realized)
    write_as_of(OUT_DIR / "as-of.json", as_of_map)

    by_currency = {}
    for r in transactions:
        by_currency[r["Currency"]] = by_currency.get(r["Currency"], 0) + 1
    print(f"\nWrote {OUT_DIR}/transactions.tsv ({len(transactions)} rows: "
          f"{', '.join(f'{c} {n}' for c, n in sorted(by_currency.items()))})")
    print(f"Wrote {OUT_DIR}/dividends.tsv ({len(dividends)} rows)")
    as_of_shown = ", ".join(f"{a} {d}" for a, d in sorted(as_of_map.items()))
    print(f"Wrote {OUT_DIR}/taxlots.tsv ({len(taxlots)} open lot(s), as of — {as_of_shown})")
    print(f"Wrote {OUT_DIR}/realized.tsv ({len(realized)} realized lot(s))")
    # These reached stderr and stopped there, which is the same shape as the
    # `unmapped-type` failure this file already paid for: the run printed the
    # problem and every check passed. On 2026-08-10 a split stopped being
    # restatable, `split not restatable` was printed on each of six runs, and
    # nothing failed — it surfaced only because #90 happened to add a dividend
    # attribution check that tripped over the same broken date. The holding
    # period had been wrong the whole time. So they go through `report()` like
    # every other finding, and the ingest turns them into a named check.
    #
    # Neither kind drops a row, so both are notes rather than faults. That is
    # not the same as harmless: `split-not-restatable` leaves the acquisition
    # date sitting on the split, which is what decides long versus short term.
    for kind, detail in lot_notes:
        report(kind, detail)
    if lot_notes:
        kinds = {}
        for kind, _ in lot_notes:
            kinds[kind] = kinds.get(kind, 0) + 1
        summary = ", ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
        print(f"\nWARNING: {len(lot_notes)} lot issue(s) — {summary}:", file=sys.stderr)
        for _, detail in lot_notes[:20]:
            print(f"  {detail}", file=sys.stderr)
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
    if parser_problems:
        # Same principle as the 미래에셋 side: an unmapped 거래구분 or an
        # unresolved symbol is named, because either one is a trade that never
        # reaches the portfolio and neither announces itself downstream.
        print("\nWARNING: statement parser issues:", file=sys.stderr)
        for kind, details in sorted(parser_problems.items()):
            unique = sorted(set(details))
            print(f"  {kind}: {len(details)} row(s), {len(unique)} distinct", file=sys.stderr)
            for detail in unique[:10]:
                print(f"      {detail}", file=sys.stderr)
            if len(unique) > 10:
                print(f"      … and {len(unique) - 10} more", file=sys.stderr)

    # Everything above went to stderr, and stderr is where findings go to die.
    #
    # A row this parser cannot map is DROPPED — it never reaches a TSV — so the
    # ingest's own `transaction_types_mapped` cannot see it either: that check
    # counts unmapped rows among the rows it was given, and these are the rows it
    # was not given. The refresh printed `unmapped-type: 신주인수권증서출고` and
    # went on to report every check passing, while a 신주인수권 lapse silently
    # failed to close its lot. The pipeline dropped a transaction and nothing
    # failed.
    #
    # So the findings are written down as data, and ingest-stock-data.mjs turns
    # them into named checks like everything else. `drops_rows` is the part that
    # matters: an unresolved ISIN keeps its row and is a note, an unmapped type
    # loses one and is a fault.
    findings = []
    for kind, details in sorted(parser_problems.items()):
        unique = sorted(set(details))
        findings.append({
            "kind": kind,
            "rows": len(details),
            "distinct": len(unique),
            "drops_rows": kind in DROPPING_KINDS,
            "samples": unique[:10],
        })
    if unmapped:
        findings.append({
            "kind": "mirae-unmapped-type",
            "rows": sum(unmapped.values()),
            "distinct": len(unmapped),
            "drops_rows": True,
            "samples": [f"{raw} ({n} row(s))" for raw, n in sorted(unmapped.items(), key=lambda kv: -kv[1])[:10]],
        })
    report_path = OUT_DIR / "extract-report.json"
    report_path.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
        "lockedStatements": sorted(skipped_locked),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[kr-statements] wrote {report_path}: {len(findings)} finding kind(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
