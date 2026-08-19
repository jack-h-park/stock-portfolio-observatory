"""Parse Toss Securities 거래내역서 PDFs into normalized transaction rows.

WHY THIS EXISTS: Toss positions come from the Open API and are current; Toss tax
lots do not — they are still the hand-made 2026-07-15 spreadsheet dump, and
`/health` reports the disagreement as `toss_holdings_lots_provenance`. The API's
order history cannot close it on its own: 18 of its 46 symbols do not reconcile
with its own holdings, mostly because the shares arrived by transfer and a
transfer is not an order (one holding's shortfall is exactly the sum of two
inbound transfers).

The statements can, and they carry something better than an average: a
`타사대체입고` row arrives LOT BY LOT with the sending broker's acquisition cost
already carried across, so no cross-referencing of the other brokerage is
needed. Verified three ways — one transferred position's inbound lots
weight-average to exactly the 미래에셋 이체출고 unit price, and to the
잔고증명서's 매입단가, to the 전.

This module only reads PDFs and returns rows. `extract-kr-statements.py` owns
the FIFO lot engine and the TSV schema, and runs both brokers through the same
one.

LAYOUT. Unlike the 미래에셋 certificates there is no table structure at all —
`extract_tables()` returns nothing, so everything here is geometry.

Each file has two sections, `원화 거래내역` and `달러 거래내역`, and they do NOT
have the same columns: the 원화 header carries 거래세 and the 달러 header does
not. One transaction is one physical line, 13 or 14 columns wide:

    거래일자 거래구분 종목명(종목코드) 환율 거래수량 거래대금 정산금액 단가 \
      수수료 [거래세] 제세금 변제/연체합 잔고 잔액

BOTH SECTIONS REPORT KRW. The 달러 section is not denominated in dollars — it
prints the won value of a foreign trade and puts the rate in 환율. Checked
rather than assumed: 마이크로소프트 on 2022-08-04 shows 단가 363,074, and MSFT
closed at $277.7 that day — 277.7 x 1,307.20 = 363,022. A dollar reading would
make it a $363,074 share. So `Currency` is KRW throughout and the rate is kept
in `FX Rate` as provenance, not as something to divide by.

WHY NOT SPLIT ON WHITESPACE. Adjacent cells touch. `잔고 0` and `잔액
14,589,413` render with no gap between them and come back as the single token
`014,589,413`; splitting a line on whitespace silently turns a ₩14.5m balance
into a ₩14 billion one. Columns are assigned by x-coordinate instead.

WHY THE HEADER IS RE-READ ON EVERY PAGE. The column anchors drift: 잔고's right
edge ranges from 747.4 to 759.0 across the 619 pages. Anchors hard-coded from
one page mis-assign cells on another, so each page's own header row supplies
them.
"""

import re
import unicodedata

import pdfplumber


def nfc(value):
    """Composed Hangul, and ordinary spaces.

    macOS hands back decomposed Hangul from the filesystem while the literals
    here are composed. Toss separately renders every space in the PDF as U+00A0,
    so `수수료 입금` typed here never matches `수수료\xa0입금` read from the page
    — one 거래구분 silently unmapped, which is one transaction the portfolio
    never hears about. The API's own security names use ordinary spaces too, so
    folding them here is also what makes `RISE 팔란티어고정테크100` resolvable.
    """
    return unicodedata.normalize("NFC", value or "").replace(" ", " ")


DATE = re.compile(r"^(\d{4})\.(\d{2})\.(\d{2})$")
NUMERIC = re.compile(r"^[\d.,]+$")

# How far a cell's right edge may sit from its header's right edge and still be
# that cell. The two differ by ~0.1pt in practice; 1.5 absorbs that without
# reaching the next column, which is never closer than 10pt.
ALIGN_TOL = 1.5
# Chars further apart than this are separate tokens. The tightest real gap
# inside a 종목명 is 1.45pt ("프로셰어즈 QQQ 3배 ETF"), so this must stay below it.
GAP_TOL = 1.2

# The columns right of 종목명, in order. 거래세 is present in the 원화 section
# and absent in the 달러 one, which is why the header is parsed rather than
# assumed.
NUMERIC_HEADERS = [
    "환율", "거래수량", "거래대금", "정산금액", "단가",
    "수수료", "거래세", "제세금", "변제/연체합", "잔고", "잔액",
]

# 거래구분 → the shared vocabulary in ingest-stock-data.mjs. Matched as a
# PREFIX, because Toss truncates the label at the column edge: the same transfer
# prints as `타사대체입고(미래에` on one page and `타사대체입고(미래에셋` on the
# next, and neither closes its bracket.
#
# Order matters only in that the longest match wins (see `classify`), so
# `이체입금(토스뱅크)` is not swallowed by `이체입금`.
TYPE_MAP = {
    # securities in and out
    "구매": "BUY",
    "판매": "SELL",
    # The whole reason this parser exists. Each row is one lot from the sending
    # broker with its acquisition cost already restated into 단가.
    "타사대체입고": "TRANSFER_IN",
    # Shares granted by a promotion — a 소수점 giveaway and a stock-quiz prize.
    # No cash leg, but a real opening lot at the 단가 the statement records, so
    # it must open one or the eventual sale has no cost to sell against.
    #
    # These were REINVEST, which was never what they are: nothing was reinvested
    # because no dividend was paid. REINVEST was standing in for "opens a lot",
    # the only property the type was being used for at the time. SHARE_REWARD
    # says what they are and carries the second half a grant has — it is income
    # at the value received, on a different basis from the eventual capital gain,
    # which REINVEST silently dropped. It is in OPENING_TYPES alongside the
    # others, so the lot still opens exactly as before.
    "소수점이벤트입고": "SHARE_REWARD",
    "주식퀴즈이벤트입고": "SHARE_REWARD",
    "주식분할입고": "STOCK_SPLIT",
    "주식분할출고": "STOCK_SPLIT",
    "신주인수권증서입고": "CORPORATE_ACTION",
    # The other end of the same event, and only Toss's wording for it: 미래에셋
    # writes 신주인수권증서말소출고, Toss writes 신주인수권증서출고, and having only
    # 미래에셋's spelling is why a zero-cost rights lot sat open for weeks
    # against a live account that had not carried them since July. The rights
    # were received 2026-06-29, the subscription closed 2026-07-22 unsubscribed,
    # and Toss recorded the lapse on page 20 of the 2026-08-01 statement — the
    # row was there the whole time and the parser dropped it as an unmapped type.
    "신주인수권증서출고": "CORPORATE_ACTION",
    # income
    "분배금": "DIVIDEND",
    "배당금입금": "DIVIDEND",
    "외화증권배당금입금": "DIVIDEND",
    "배당단주대금입금": "DIVIDEND",
    "무상단주대금입금": "OTHER_INCOME",
    "이자입금": "INTEREST",
    "외화이자입금": "INTEREST",
    "외화세금환급": "OTHER_INCOME",
    "수수료 입금": "OTHER_INCOME",
    # withholding
    "외화이자세금출금": "FEE",
    # cash in and out
    "오픈뱅킹입금": "TRANSFER_IN",
    "이체입금": "TRANSFER_IN",
    "이체입금(토스뱅크)": "TRANSFER_IN",
    "이체입금(토스증권)": "TRANSFER_IN",
    "외화이체출금": "TRANSFER_OUT",
    # currency exchange: two legs of one conversion, one printed in each section
    "환전원화출금": "JOURNAL",
    "환전원화입금": "JOURNAL",
    "환전외화입금": "JOURNAL",
    "환전외화출금": "JOURNAL",
    "환전외화입금취소": "JOURNAL",
    "환전원화입금취소": "JOURNAL",
}

_TYPES_LONGEST_FIRST = sorted(TYPE_MAP, key=len, reverse=True)


def classify(raw_type):
    """(normalized type, matched label) for a 거래구분, or (None, None).

    Longest prefix wins so `이체입금(토스뱅크)` is not read as `이체입금`.
    """
    for label in _TYPES_LONGEST_FIRST:
        if raw_type.startswith(label):
            return TYPE_MAP[label], label
    return None, None


def number(value):
    raw = nfc(str(value or "")).strip().replace(",", "")
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _lines(page):
    """Group a page's chars into visual lines, each sorted left to right."""
    rows = {}
    for ch in page.chars:
        rows.setdefault(round(ch["top"], 0), []).append(ch)
    return [sorted(rows[top], key=lambda c: c["x0"]) for top in sorted(rows)]


def _text(chars):
    return nfc("".join(c["text"] for c in chars))


def read_header(chars):
    """Column anchors from a header line, or None if this is not one.

    Returns (name_x0, [(header, right_edge), ...]) — 종목명's LEFT edge, because
    the name cell is left-aligned, and every numeric column's RIGHT edge,
    because they are right-aligned and that is what makes a touching pair like
    `잔고`+`잔액` separable.
    """
    text = _text(chars)
    if "거래일자" not in text or "거래구분" not in text:
        return None

    # Re-split the header into words so each column's own extent is known.
    words, current = [], [chars[0]]
    for ch in chars[1:]:
        if ch["x0"] - current[-1]["x1"] > GAP_TOL:
            words.append(current)
            current = [ch]
        else:
            current.append(ch)
    words.append(current)

    labels = {_text(w): (w[0]["x0"], w[-1]["x1"]) for w in words}
    if "종목명(종목코드)" not in labels:
        return None
    anchors = [(h, labels[h][1]) for h in NUMERIC_HEADERS if h in labels]
    # 환율 through 잔액 minus the optional 거래세: anything else means the
    # layout changed and guessing would misfile every cell on the page.
    if len(anchors) not in (10, 11):
        return None
    return labels["종목명(종목코드)"][0], anchors


def _trailing_number(chars, anchor):
    """Split chars into (leading text, numeric cell) for the 환율 column.

    The 환율 cell and a long 종목명 share this stretch of the page, and a name
    can carry digits of its own (`RISE 팔란티어고정테크100`). The discriminator
    is alignment, not content: a 환율 value is a contiguous run of digits whose
    right edge sits on the header's right edge. A name that happens to end in
    digits ends wherever the name ends, ~40pt short of it, so it is not mistaken
    for a rate — and a name with no digits at all cannot be.
    """
    if not chars or abs(chars[-1]["x1"] - anchor) > ALIGN_TOL:
        return chars, []
    cut = len(chars)
    while cut > 0:
        ch = chars[cut - 1]
        if not NUMERIC.match(nfc(ch["text"])):
            break
        if cut < len(chars) and chars[cut]["x0"] - ch["x1"] > GAP_TOL:
            break
        cut -= 1
    return chars[:cut], chars[cut:]


def split_row(chars, name_x0, anchors):
    """One data line → {column: text}.

    Every cell right of 종목명 is right-aligned, so a char belongs to the
    leftmost column whose right edge it does not overshoot. That single rule is
    what unfuses `967,655,449` back into 잔고 `9` and 잔액 `67,655,449`: the `9`
    stops at 잔고's right edge and the rest cannot fit inside it.
    """
    head = [c for c in chars if c["x1"] <= name_x0]
    rest = [c for c in chars if c["x1"] > name_x0]

    buckets = {h: [] for h, _ in anchors}
    overflow = []
    for ch in rest:
        for header, right in anchors:
            if ch["x1"] <= right + ALIGN_TOL:
                buckets[header].append(ch)
                break
        else:
            overflow.append(ch)

    # The 종목명 cell shares its bucket with 환율; peel the rate off the right.
    rate_anchor = dict(anchors)["환율"]
    name_chars, rate_chars = _trailing_number(buckets["환율"], rate_anchor)
    buckets["환율"] = rate_chars

    cells = {h: _text(v).strip() for h, v in buckets.items()}
    cells["종목명"] = " ".join(_text(name_chars).split())
    # 거래구분 overflows its column on the long labels (`타사대체입고(미래에셋`),
    # so the head is date + type as one string and the type is recovered by
    # prefix match rather than by position.
    cells["_head"] = _text(head).strip()
    cells["_overflow"] = _text(overflow).strip()
    return cells


# `종목명(종목코드)` names a security three different ways, all present in the
# same files:
#   카카오(A035720)                — KRX code, 2025 onward
#   마이크로소프트(US5949181045)   — ISIN, dominant 2022-2024
#   RISE 팔란티어고정테크100        — no code at all, mixed in throughout
# Toss symbols are not all six digits (`0047R0`), so the code is taken as
# whatever is inside the brackets rather than matched against a digit shape.
CODED = re.compile(r"^(?P<name>.*?)\((?P<code>[A-Z]?[0-9A-Z]{5,11})\)$")


def parse_security(cell, raw_type=""):
    """(name, code) for a 종목명 cell; code is '' when the cell carries none.

    A 타사대체입고 puts the account holder in front of the security
    (`박현웅, 삼성전자(A005930)`). That prefix is stripped only for those rows,
    not wherever a comma appears, so a security whose real name contains one
    does not lose half of itself.

    The 거래구분 label also overflows its own column on these rows — Toss
    truncates it mid-word (`타사대체입고(미래에`) and the remainder lands at the
    front of this cell — which the same strip removes.
    """
    cell = cell.strip()
    if not cell:
        return "", ""
    if raw_type.startswith("타사대체입고") and "," in cell:
        cell = cell.split(",", 1)[1].strip()
    match = CODED.match(cell)
    if not match:
        return cell, ""
    name = match.group("name").strip()
    code = match.group("code")
    # KRX codes print with an `A` prefix that is not part of the symbol, and a
    # KRX code is six characters. Matched on length rather than on six DIGITS,
    # because Toss symbols are not all numeric (`0047R0`) — a digits-only test
    # would leave `A0047R0` with its prefix and file the ETF under a symbol the
    # holdings API has never heard of. A 12-character ISIN cannot collide, and
    # the 9-character warrant codes (`<WARRANT_CODE>`) are left alone.
    if len(code) == 7 and code.startswith("A"):
        code = code[1:]
    return name, code


# Names that fill the 종목명 cell on a CASH row and are not securities at all:
# the account holder on an 이체입금, and the label of the recurring-deposit plan
# on an 오픈뱅킹입금. Listed so they are not reported as unresolved securities —
# and listed rather than inferred, so a real security that stops resolving still
# gets reported instead of being waved through as "probably a memo".
NON_SECURITY_LABELS = {"모으기일주일치", "모으기잔액부족"}


def load_symbol_index(snapshot):
    """(by_name, by_isin) → Toss symbol, from a fetch-toss.mjs snapshot.

    The statements name a security by KRX code, by ISIN, or by name alone, and
    only the first is self-describing. `/api/v1/stocks` resolves the other two
    but is a lookup, not a listing — it must be told which symbols to describe —
    so fetch-toss.mjs asks it about everything the account holds or has ordered
    and stores the answers. That population is sufficient: a security the
    statements mention is one this account traded.
    """
    by_name, by_isin = {}, {}
    for account in (snapshot or {}).get("accounts", []):
        for security in account.get("securities") or []:
            symbol = nfc(security.get("symbol"))
            if not symbol:
                continue
            for key in (security.get("name"), security.get("englishName")):
                if key:
                    by_name.setdefault(nfc(key), symbol)
            if security.get("isinCode"):
                by_isin.setdefault(nfc(security["isinCode"]), symbol)
        # Holdings carry a name too, and cost nothing to fold in as a fallback
        # for a snapshot written before securities were fetched.
        for item in (account.get("holdings") or {}).get("items") or []:
            if item.get("name") and item.get("symbol"):
                by_name.setdefault(nfc(item["name"]), nfc(item["symbol"]))
    return by_name, by_isin


ISIN = re.compile(r"^[A-Z]{2}[0-9A-Z]{9}\d$")

# Three US ETFs the API and the statements refuse to call the same thing. For a
# US ETF `/api/v1/stocks` returns the ticker as the `name` ("VTI"), while the
# statement prints the Korean marketing name and no code at all, so there is no
# string the two share and nothing to join on. Nor do the statements ever name
# these three with an ISIN, which is how the other US positions resolve.
#
# So the join was made on prices instead, and it is not a guess. Dividing each
# row's 단가 by its 환율 recovers the USD price the trade was struck at; matched
# against the order history's own `averageFilledPrice` on the same dates:
#
#   뱅가드 미국 주식 ETF          → VTI    353 shared dates, 0.7% median error (runner-up 25%)
#   아이셰어즈 선진국 대형주/중형주 ETF → URTH   350 shared dates, 0.7% median error (runner-up 16%)
#   프로셰어즈 QQQ 3배 ETF        → TQQQ    38 shared dates, 2.0% median error (runner-up 9%)
#
# TQQQ is the loosest of the three because a 3x leveraged fund moves furthest
# within a day, and it is still four times closer than anything else. All three
# are closed positions, so this affects the realized table rather than any lot
# still open.
NAME_ALIASES = {
    "뱅가드 미국 주식 ETF": "VTI",
    "아이셰어즈 선진국 대형주/중형주 ETF": "URTH",
    "프로셰어즈 QQQ 3배 ETF": "TQQQ",
}


def resolve_symbol(name, code, by_name, by_isin):
    """(symbol, how) for one security cell.

    `how` is 'code' | 'isin' | 'name' | 'unresolved' so the caller can report
    what had to be guessed at. An ISIN is kept as the symbol when the master
    list cannot place it: it still identifies the security uniquely, which a
    blank ticker does not.
    """
    if code and ISIN.match(code):
        return (by_isin.get(code) or code), ("isin" if code in by_isin else "unresolved-isin")
    if code:
        return code, "code"
    if name in by_name:
        return by_name[name], "name"
    if name in NAME_ALIASES:
        return NAME_ALIASES[name], "alias"
    return "", "unresolved"


def rows(path, source_name, on_problem):
    """Yield one dict per transaction line in one statement.

    `on_problem(kind, detail)` is called instead of dropping anything quietly —
    an unparsed line is a trade the portfolio never hears about, which is the
    failure this whole pipeline keeps rediscovering.
    """
    with pdfplumber.open(path) as pdf:
        section = ""
        name_x0, anchors = None, None
        for page_no, page in enumerate(pdf.pages, start=1):
            for chars in _lines(page):
                text = _text(chars)
                if "거래내역" in text and len(text) < 20:
                    # `원화 거래내역` / `달러 거래내역` — kept for provenance
                    # only. Both sections report won (see the module docstring).
                    section = text.strip()
                    continue
                header = read_header(chars)
                if header is not None:
                    name_x0, anchors = header
                    continue
                if not DATE.match(text[:10]) or len(text) < 11:
                    continue
                if anchors is None:
                    on_problem("no-header", f"{source_name} p{page_no}: {text[:60]}")
                    continue

                cells = split_row(chars, name_x0, anchors)
                if cells["_overflow"]:
                    on_problem("overflow", f"{source_name} p{page_no}: {cells['_overflow']}")
                head = cells["_head"]
                date_text, raw_type = head[:10], head[10:].strip()
                if not DATE.match(date_text):
                    on_problem("bad-date", f"{source_name} p{page_no}: {head[:40]}")
                    continue

                name, code = parse_security(cells["종목명"], raw_type)
                yield {
                    "date": date_text.replace(".", "-"),
                    "raw_type": raw_type,
                    "name": name,
                    "code": code,
                    "section": section,
                    "rate": number(cells.get("환율")),
                    "quantity": number(cells.get("거래수량")),
                    "gross": number(cells.get("거래대금")),
                    "settlement": number(cells.get("정산금액")),
                    "unit_price": number(cells.get("단가")),
                    "fee": number(cells.get("수수료")),
                    # 거래세 exists only in the 원화 section; 제세금 is the
                    # all-in withholding line and is present in both.
                    "trade_tax": number(cells.get("거래세")),
                    "tax": number(cells.get("제세금")),
                    "share_balance": number(cells.get("잔고")),
                    "cash_balance": number(cells.get("잔액")),
                    "source": source_name,
                    "page": page_no,
                }


if __name__ == "__main__":
    # Debug dump: `python3 scripts/toss_statements.py <pdf> [page]`
    import sys
    from collections import Counter

    target_page = int(sys.argv[2]) if len(sys.argv) > 2 else None
    problems = Counter()
    for row in rows(sys.argv[1], sys.argv[1].split("/")[-1], lambda k, d: problems.update([f"{k}: {d}"])):
        if target_page and row["page"] != target_page:
            continue
        print(row)
    for problem, count in problems.most_common(20):
        print(f"PROBLEM x{count} {problem}", file=sys.stderr)
