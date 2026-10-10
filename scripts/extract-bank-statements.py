#!/usr/bin/env python3
"""Bank deposit statements in bank-statements/ → data/bank-balances.json.

Balances, not spending: each statement is reduced to one end-of-day balance per
account per day. Statements that print a running balance are read as printed and
checked for continuity; Robinhood's export prints none, so its history is walked
from one anchor balance kept in the gitignored account map. 토스뱅크 workbooks are
one account per last4 in the file name; a Fidelity cash management account's
balance includes its core money-market position (see FIDELITY_CORE_FUNDS).
"""
from __future__ import annotations

import csv, io, importlib.util, json, os, re, subprocess, tempfile, unicodedata
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
SOURCE_DIR = DATA_DIR / "bank-statements"
OUT_PATH = Path(os.environ.get("STOCK_BANK_BALANCES_PATH", Path.cwd() / "data" / "bank-balances.json"))
MAP_PATH = Path(os.environ.get("STOCK_ACCOUNT_MAP_PATH", Path.cwd() / "data" / "accounts.local.json"))


def _num(text):
    """A money cell as a float. Accepts $, ₩, (negative) and a trailing minus; raises on other text."""
    text = (text or "").replace(",", "").replace('"', "").replace("$", "").replace("₩", "").strip()
    if text in ("", "-"):
        return None
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1].strip()
    if text.endswith("-"):
        negative, text = True, text[:-1].strip()
    value = float(text)
    return -value if negative else value


def _clock(text):
    """Zero-padded HH:MM:SS so times sort as text."""
    parts = (text or "").strip().split(":")
    return ":".join(part.zfill(2) for part in parts)


def _mdy(text):
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (text or "").strip())
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


def _csv_rows(text):
    return list(csv.reader(io.StringIO(text)))


def parse_chase(text):
    rows = _csv_rows(text)[1:]
    out = []
    for i, r in enumerate(reversed(rows)):  # the file is newest first
        if len(r) < 6 or not _mdy(r[1]):
            continue
        out.append({"date": _mdy(r[1]), "seq": i, "description": r[2], "amount": _num(r[3]) or 0.0, "balance": _num(r[5])})
    return out


def parse_boa(text):
    rows = _csv_rows(text)
    start = next(i for i, r in enumerate(rows) if r[:2] == ["Date", "Description"])
    out = []
    for i, r in enumerate(rows[start + 1:]):
        if len(r) < 4 or not _mdy(r[0]):
            continue
        out.append({"date": _mdy(r[0]), "seq": i, "description": r[1], "amount": _num(r[2]) or 0.0, "balance": _num(r[3])})
    return out


def parse_robinhood_bank(text):
    rows = _csv_rows(text)[1:]
    out = []
    for i, r in enumerate(reversed(rows)):  # newest first
        if len(r) < 3 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[0].strip()):
            continue
        out.append({"date": r[0].strip(), "seq": i, "description": r[1], "amount": _num(r[2]) or 0.0, "balance": None})
    return out


def parse_mg_rows(rows):
    """Rows of the converted 새마을금고 sheet: header 거래일자, 거래시간, …, 거래내용/메모, 출금액, 입금액, 잔액.

    The 거래내용/메모 cell (`인터넷신규`, `예적금만기 자동이체`, `전자OPI`, a sender's
    name) is kept as the description: estimate_closed_accounts reads it to follow
    money into a 예적금 the export does not list.
    """
    header_at = next(i for i, r in enumerate(rows) if "거래일자" in [c.strip() for c in r])
    header = [c.strip() for c in rows[header_at]]
    col = {name: header.index(name) for name in ("거래일자", "거래시간", "출금액", "입금액", "잔액")}
    memo_col = header.index("거래내용/메모") if "거래내용/메모" in header else None
    parsed = []
    for r in rows[header_at + 1:]:
        day = (r[col["거래일자"]] if len(r) > col["거래일자"] else "").strip().replace(".", "-")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        out_amt = _num(r[col["출금액"]]) or 0.0
        in_amt = _num(r[col["입금액"]]) or 0.0
        memo = r[memo_col].strip() if memo_col is not None and len(r) > memo_col else ""
        parsed.append((day, _clock(r[col["거래시간"]]), in_amt - out_amt, _num(r[col["잔액"]]), memo))
    parsed.sort(key=lambda t: (t[0], t[1]))
    return [{"date": d, "seq": i, "description": memo, "amount": a, "balance": b}
            for i, (d, _t, a, b, memo) in enumerate(parsed)]


# Core money-market funds a Fidelity cash account sweeps into. A row that reinvests
# into one of them moves money between the cash and the core position, but the
# `Cash Balance ($)` column INCLUDES the core position, so the balance does not
# change. Its Amount must count as 0 or "previous + amount = balance" reports a
# false break on every dividend.
FIDELITY_CORE_FUNDS = {"SPAXX", "FDRXX", "FZFXX", "SPRXX", "FCASH"}


def parse_fidelity_cma(text):
    """Fidelity cash management account history: header row by name, newest first, footer skipped."""
    rows = _csv_rows(text)
    header_at = next(i for i, r in enumerate(rows) if r and r[0].strip() == "Run Date")
    header = [c.strip() for c in rows[header_at]]
    col = {name: header.index(name) for name in ("Run Date", "Action", "Symbol", "Description", "Amount ($)", "Cash Balance ($)")}

    def cell(r, name):
        return r[col[name]] if len(r) > col[name] else ""

    body = [r for r in rows[header_at + 1:] if _mdy(cell(r, "Run Date"))]  # drops blank lines, disclaimer and `Date downloaded`
    out = []
    for i, r in enumerate(reversed(body)):  # the file is newest first
        action = cell(r, "Action").strip().upper()
        core_reinvestment = action.startswith("REINVESTMENT") and cell(r, "Symbol").strip().upper() in FIDELITY_CORE_FUNDS
        amount = 0.0 if core_reinvestment else (_num(cell(r, "Amount ($)")) or 0.0)
        out.append({"date": _mdy(cell(r, "Run Date")), "seq": i, "description": f"{action} {cell(r, 'Description').strip()}",
                    "amount": amount, "balance": _num(cell(r, "Cash Balance ($)"))})
    return out


def _cell_text(value):
    return unicodedata.normalize("NFC", str(value if value is not None else "")).strip()


def _cell_num(value):
    """A 토스뱅크 money cell: a number (`52957.0`) or text."""
    if isinstance(value, (int, float)):
        return float(value)
    return _num(_cell_text(value))


def parse_tossbank(path, findings=None, notes=None):
    """토스뱅크 거래내역 workbook (already decrypted): header row by cells, newest first, signed amounts."""
    import openpyxl

    # read_only=True reports a single row for these workbooks, so the sheet is loaded whole.
    book = openpyxl.load_workbook(path, read_only=False, data_only=True)
    rows = [list(r) for r in book.worksheets[0].iter_rows(values_only=True)]
    wanted = ("거래 일시", "거래 금액", "거래 후 잔액")
    header_at = next((i for i, r in enumerate(rows) if all(w in [_cell_text(c) for c in r] for w in wanted)), None)
    if header_at is None:
        raise ValueError("no header row with 거래 일시, 거래 금액 and 거래 후 잔액 was found")
    header = [_cell_text(c) for c in rows[header_at]]
    col = {name: header.index(name) for name in wanted}
    kind_col, memo_col = header.index("적요") if "적요" in header else None, header.index("메모") if "메모" in header else None
    # The counterparty's bank and account number. An outgoing transfer prints both;
    # an incoming one prints the bank only. Kept as the last four digits.
    inst_col = header.index("거래 기관") if "거래 기관" in header else None
    acct_col = header.index("계좌번호") if "계좌번호" in header else None
    cell = lambda r, c: _cell_text(r[c]) if c is not None and len(r) > c else ""
    parsed = []
    for r in reversed(rows[header_at + 1:]):  # newest first; reversing keeps file order for equal timestamps
        when = r[col["거래 일시"]] if len(r) > col["거래 일시"] else None
        if hasattr(when, "strftime"):
            stamp = when.strftime("%Y-%m-%d %H:%M:%S")
        else:
            m = re.fullmatch(r"(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?", _cell_text(when))
            if not m:
                continue
            stamp = f"{m.group(1)}-{m.group(2)}-{m.group(3)} {_clock(m.group(4) or '00:00:00')}"
        parsed.append((stamp, _cell_num(r[col["거래 금액"]]) or 0.0, _cell_num(r[col["거래 후 잔액"]]),
                       cell(r, kind_col), cell(r, memo_col), cell(r, inst_col), re.sub(r"\D", "", cell(r, acct_col))[-4:]))
    parsed.sort(key=lambda t: t[0])  # stable: equal timestamps stay in chronological file order
    out = [{"date": s[:10], "seq": i, "description": f"{desc} {memo}".strip(), "amount": a, "balance": b,
            "counterparty": desc, "counterpartyInstitution": inst, "counterpartyLast4": last4}
           for i, (s, a, b, desc, memo, inst, last4) in enumerate(parsed)]
    # Some rows (promotions, interest, a few deposits) print no `거래 후 잔액`. Leaving them blank would
    # drop their amount from the next row's continuity check, which then reports a false break, and
    # would leave a stale end-of-day balance when the blank row is the day's last. A blank takes the
    # previous printed balance plus its own amount; the next row's printed balance still checks it.
    filled, previous = 0, None
    for txn in out:
        if txn["balance"] is None and previous is not None:
            txn["balance"] = round(previous + txn["amount"], 2)
            filled += 1
        previous = txn["balance"]
    # Informational, not a fault: the filled values are still checked by the next
    # printed balance. It goes to `notes`, which the ingest shows without raising a
    # warning; a caller that passes no notes list gets it in findings as before.
    if filled:
        message = f"{Path(path).name}: {filled} row(s) printed no balance; each was taken as the previous balance plus its amount"
        if notes is not None:
            notes.append(message)
        elif findings is not None:
            findings.append(message)
    return out


def merge_txns(groups):
    """Combine statements chronologically, counting each transaction once per download.

    `groups` are per-file lists, earliest file first. Two identical rows inside ONE
    file are two real transactions, so a key is kept as many times as it occurs in
    the file that has the most of it (the earliest such file). An overlapping second
    download repeats rows it shares with the first and adds nothing. Rows are ordered
    by (date, file, position in file), so rows unique to a later file follow the
    earlier file's rows for a shared day; `seq` is then renumbered globally.
    """
    best = {}  # key -> (count, [(file_index, txn), ...])
    for file_index, group in enumerate(groups):
        by_key = {}
        for txn in sorted(group, key=lambda t: (t["date"], t["seq"])):
            key = (txn["date"], txn.get("description", ""), round(txn["amount"], 2), txn["balance"])
            by_key.setdefault(key, []).append((file_index, txn))
        for key, rows in by_key.items():
            if len(rows) > best.get(key, (0, None))[0]:
                best[key] = (len(rows), rows)
    picked = [row for _, rows in best.values() for row in rows]
    picked.sort(key=lambda r: (r[1]["date"], r[0], r[1]["seq"]))
    return [{**txn, "seq": i} for i, (_, txn) in enumerate(picked)]


def end_of_day(txns):
    last = {}
    for txn in sorted(txns, key=lambda t: (t["date"], t["seq"])):
        if txn["balance"] is not None:
            last[txn["date"]] = txn["balance"]
    return [{"date": d, "balance": b} for d, b in sorted(last.items())]


def walk_from_anchor(txns, anchor_date, anchor_balance):
    """End-of-day balances from one known balance at the end of `anchor_date`.

    The opening balance is the anchor minus everything up to and including the
    anchor day; a running sum from there reproduces the anchor on its own day and
    walks forwards past it. An anchor after the last transaction works the same.
    """
    ordered = sorted(txns, key=lambda t: (t["date"], t["seq"]))
    opening = anchor_balance - sum(t["amount"] for t in ordered if t["date"] <= anchor_date)
    running, by_day = opening, {}
    for txn in ordered:
        running += txn["amount"]
        by_day[txn["date"]] = round(running, 2)
    return [{"date": d, "balance": b} for d, b in sorted(by_day.items())]


def continuity_breaks(txns):
    breaks, previous = [], None
    for txn in sorted(txns, key=lambda t: (t["date"], t["seq"])):
        if txn["balance"] is None:
            continue
        if previous is not None and abs(previous + txn["amount"] - txn["balance"]) > 0.005:
            breaks.append(f"{txn['date']}: {previous:.2f} + {txn['amount']:.2f} ≠ {txn['balance']:.2f}")
        previous = txn["balance"]
    return breaks


def _fx_ledger_module():
    spec = importlib.util.spec_from_file_location("fx_ledger", Path(__file__).with_name("extract-fx-ledger.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _kr_statements_module():
    """extract-kr-statements.py, for the 미래에셋 certificate reader (`open_pdf`, `records`, `number`)."""
    spec = importlib.util.spec_from_file_location("kr_statements", Path(__file__).with_name("extract-kr-statements.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The issue filter a 미래에셋 CMA certificate prints on page 2, read despaced.
# `거래구분 CMA자동매매 제외` leaves the 발행어음 sweeps out; `거래구분 전체`
# keeps them. `CMARP/MMW포함 N` is the RP/MMW flag, says nothing about a
# 발행어음 CMA, and is printed on both kinds.
CMA_SWEEPS_EXCLUDED = "CMA자동매매제외"
CMA_SWEEPS_INCLUDED = "거래구분전체"
CMA_SWEEP_KIND = "발행어음"
CMA_REMEDY = "re-issue the 거래내역증명서 with CMA자동매매 포함, or provide a 잔고증명서"


def _cma_direction(kind):
    """+1 money in, -1 money out, 0 unknown. 매수/매도 are the 발행어음 legs."""
    if "매수" in kind:
        return -1
    if "매도" in kind or "입금" in kind:
        return 1
    if "출금" in kind or "송금" in kind:
        return -1
    return 0


def parse_mirae_cma(path, findings, notes=None):
    """미래에셋 CMA (발행어음형) 거래내역증명서 → rows whose balance is 예수금 + 발행어음 principal.

    The account's money sits in two places: 예수금 (cash) and the 발행어음 it is
    swept into. Each row of the certificate, in printed order (dates ascending,
    then 처리시각), is read as follows. Checked against a real certificate with the
    sweeps: the 예수금 walk below matched every printed 예수금잔액 (116 checks,
    0 breaks), and the account total moved only on transfers and interest.

    - Cash moves by 입출금액 (B row, col 6), never by 거래금액 (A col 6). On a
      발행어음 sell the two differ: 거래금액 is the gross proceeds (principal plus
      interest), 제세금합 (B col 5) the tax withheld, and 입출금액 the net cash,
      which is what reaches 예수금.
    - A `CMA 발행어음 매수` row prints no 예수금잔액. Its 거래수량 (B col 2) equals
      the amount: units are won of principal.
    - `CMA 발행어음 만기매도` / `중도매도` rows print 예수금잔액 after the net
      proceeds arrive. Their 거래수량 is the principal redeemed, so the interest
      earned (net of tax) is 입출금액 minus 거래수량: 만기 interest arrives inside
      the sell row, not as a row of its own.

    The account balance is printed 예수금잔액 plus principal held (Σ 매수 units −
    Σ 매도 units). Each emitted row's `amount` is how much that row moves the
    account total: the transfer for 입금/출금/송금, the net interest for a sell,
    and 0 for a buy (cash into principal). So `continuity_breaks` checks the
    total, and `end_of_day` gives the account balance. Principal held is taken as
    zero at the start of the certificate; a sell beyond it is reported.

    Fail-closed on the issue filter. A certificate that says `CMA자동매매 제외`
    leaves the sweeps out, so its 예수금잔액 is only the cash left after them; one
    that shows neither that nor a sign the sweeps are in (`거래구분 전체`, or
    발행어음 rows) cannot be told apart from it. Either way no balances are written,
    and the finding says how to get a usable certificate. Returns None then.
    """
    kr = _kr_statements_module()
    pdf = kr.open_pdf(str(path))
    if pdf is None:
        raise ValueError("could not be opened (set STOCK_PDF_PASSWORD)")
    with pdf:
        filter_text = re.sub(r"\s+", "", unicodedata.normalize("NFC", "\n".join(
            (page.extract_text() or "") for page in pdf.pages[1:3])))
        records = list(kr.records(pdf, path.name))
    if CMA_SWEEPS_EXCLUDED in filter_text:
        findings.append(
            f"{path.name}: issued with CMA자동매매 제외, so its 예수금잔액 leaves out the 발행어음 sweeps and is "
            f"not the account balance; no balances written — {CMA_REMEDY}")
        return None
    has_sweeps = any(CMA_SWEEP_KIND in a[1] for _page, a, _b, _c in records)
    if CMA_SWEEPS_INCLUDED not in filter_text and not has_sweeps:
        findings.append(
            f"{path.name}: page 2 shows neither 거래구분 전체 nor 발행어음 rows, so whether the 발행어음 sweeps are "
            f"included cannot be told; no balances written — {CMA_REMEDY}")
        return None

    out, unknown = [], {}
    principal, oversold = 0.0, False
    for seq, (_page, a, b, _c) in enumerate(records):
        kind = a[1].strip()
        direction = _cma_direction(kind)
        if not direction:
            unknown[kind] = unknown.get(kind, 0) + 1
        cash = kr.number(b[6]) if b[6].strip() else kr.number(a[6])
        if CMA_SWEEP_KIND in kind:
            units = kr.number(b[2])
            if direction < 0:
                principal += units
                change = 0.0
            else:
                principal -= units
                change = cash - units
                if principal < -0.5:
                    oversold = True
        else:
            change = direction * cash
        printed = kr.number(a[7]) if a[7].strip() else None
        out.append({"date": a[0].strip().replace("/", "-"), "seq": seq, "description": kind, "amount": change,
                    "balance": round(printed + principal, 2) if printed is not None else None})
    for kind, count in sorted(unknown.items()):
        findings.append(f"{path.name}: 거래종류 {kind} names no direction (입금/출금/송금/매수/매도); "
                        f"{count} row(s) counted as 0")
    if oversold:
        findings.append(f"{path.name}: more 발행어음 was sold than the certificate shows bought, so principal was "
                        "held before its period; balances understate it — request a certificate from the account's opening")
    return out


def _xls_rows(source, findings):
    fx = _fx_ledger_module()
    binary = fx.soffice_binary()
    if not binary:
        findings.append(f"{source.name}: no soffice binary; XLS rows were not read")
        return []
    with tempfile.TemporaryDirectory(prefix="bank-xls-") as temp_dir:
        try:
            subprocess.run(fx.soffice_convert_args(binary, temp_dir, source), capture_output=True, text=True,
                           timeout=fx.SOFFICE_TIMEOUT_SECONDS, check=True)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
            findings.append(f"{source.name}: XLS conversion failed ({type(error).__name__}); rows were not read")
            return []
        converted = Path(temp_dir) / f"{source.stem}.csv"
        return _csv_rows(converted.read_text(encoding="utf-8", errors="replace"))


FAMILIES = [
    # (filename prefix, institution, kind, currency, parser, account-key regex or None)
    # A key regex splits one prefix into one account per captured key (the last4 in the file name).
    ("chase-checking-", "chase", "checking", "USD", lambda p, f, n: parse_chase(p.read_text(encoding="utf-8-sig")), None),
    ("boa-checking-", "boa", "checking", "USD", lambda p, f, n: parse_boa(p.read_text(encoding="utf-8-sig")), None),
    ("robinhood-bank-checking-", "robinhood-bank", "checking", "USD", lambda p, f, n: parse_robinhood_bank(p.read_text(encoding="utf-8-sig")), None),
    ("robinhood-bank-savings-", "robinhood-bank", "savings", "USD", lambda p, f, n: parse_robinhood_bank(p.read_text(encoding="utf-8-sig")), None),
    ("mg-deposit-", "mg", "deposit", "KRW", lambda p, f, n: parse_mg_rows(_xls_rows(p, f)), None),
    ("tossbank-", "tossbank", "checking", "KRW", lambda p, f, n: parse_tossbank(p, f, n), r"^tossbank-(\d{4})-"),
    ("fidelity-cma-", "fidelity", "cma", "USD", lambda p, f, n: parse_fidelity_cma(p.read_text(encoding="utf-8-sig")), None),
    ("mirae-cma-", "mirae", "cma", "KRW", lambda p, f, n: parse_mirae_cma(p, f, n), None),
]

# The alias an account gets when the map has no entry for it, where
# `<institution> <kind>` would not read as the account's name.
DEFAULT_ALIASES = {("mirae", "cma"): "미래에셋 CMA"}


def _alias_rule(account_map, institution, kind, last4=None):
    """The map's bankAccounts entry for an account, or None.

    With a last4 the entry must carry that last4 (any institution); without one it is
    matched on institution and kind, as before.
    """
    for rule in account_map.get("bankAccounts", []):
        if rule.get("institution") != institution:
            continue
        if last4 is not None:
            if str(rule.get("last4") or "") == last4:
                return rule
        elif rule.get("kind") == kind:
            return rule
    return None


def _alias(account_map, institution, kind, last4=None):
    rule = _alias_rule(account_map, institution, kind, last4)
    return (rule or {}).get("alias") or (f"{institution} {last4}" if last4 else
                                         DEFAULT_ALIASES.get((institution, kind), f"{institution} {kind}"))


def _derive(alias, txns, account_map, findings):
    anchor = next((a for a in account_map.get("anchors", []) if a.get("alias") == alias), None)
    if anchor is None:
        findings.append(f"{alias}: no anchor balance in the account map; balances not derived")
        return []
    try:
        datetime.strptime(str(anchor["date"]), "%Y-%m-%d")
        balance = float(anchor["balance"])
    except (KeyError, TypeError, ValueError) as error:
        findings.append(f"{alias}: anchor is unusable ({type(error).__name__}: {error}); balances not derived")
        return []
    return walk_from_anchor(txns, str(anchor["date"]), balance)


# --- Accounts no statement covers ---------------------------------------------
#
# Money that leaves a statement account for one we hold no statement for (a 파킹통장,
# a 예적금 since matured, a closed CMA) drops out of the deposit total until it comes
# back, so the total-assets trend dips for no real reason. These estimates follow
# that money from the statements we do hold. They never enter cash_balances: the
# FBAR maxima and the freshness checks read that table, and these are estimates.

KR_DIR = DATA_DIR / "kr-statements"
# 미래에셋 종합/ISA transfers, read only to pair a CMA or 토스뱅크 transfer with its other leg.
MIRAE_TRANSFER_GLOBS = ("mirae-general-transactions-*.pdf", "mirae-isa-transactions-*.pdf")
# A counterparty bank, as 토스뱅크 prints it, whose statements this extractor reads.
STATEMENT_BANKS = {"MG새마을금고": "mg", "미래에셋증권": "mirae", "토스뱅크": "tossbank"}
PAIR_DAYS = 3
MIN_ESTIMATE_KRW = 1_000_000
ESTIMATE_ALIASES = {
    "tossbank-parking": "토스뱅크 파킹통장",
    "tossbank-savings": "토스뱅크 예적금",
    "mg-savings": "새마을금고 예적금",
    "mirae-other": "미래에셋 기타 계좌",
}


def parse_mirae_transfers(path):
    """The transfer rows of a 미래에셋 종합/ISA 거래내역증명서: 입출금, 이체, 계좌대체. Trades are skipped."""
    kr = _kr_statements_module()
    pdf = kr.open_pdf(str(path))
    if pdf is None:
        raise ValueError("could not be opened (set STOCK_PDF_PASSWORD)")
    with pdf:
        records = list(kr.records(pdf, path.name))
    out = []
    for seq, (_page, a, b, _c) in enumerate(records):
        kind = a[1].strip()
        if not re.search(r"대체|이체|송금|입금|출금", kind) or re.search(r"매수|매도|배당|이자|세금|선환전|외화|해외", kind):
            continue
        cash = kr.number(b[6]) if b[6].strip() else kr.number(a[6])
        direction = _cma_direction(kind)
        if cash and direction:
            out.append({"date": a[0].strip().replace("/", "-"), "seq": seq, "description": kind, "amount": direction * cash})
    return out


def _bucket(flow):
    """Where an unpaired transfer went, as a bucket key, or None for money that is not a balance (interest)."""
    memo, bank = flow["memo"], flow["counterpartyInstitution"]
    if flow["statement"] == "tossbank":
        if memo == "파킹통장":
            return "tossbank-parking"
        if re.search(r"예금|적금", memo) and bank in ("토스뱅크", ""):
            return "tossbank-savings"
        if "이자" in memo:
            return None
        if bank == "미래에셋증권":
            return "mirae-other"
        return f"counterparty:{memo}|{bank}"
    if flow["statement"] == "mg":
        if memo == "인터넷신규" or memo.startswith("예적금만기"):
            return "mg-savings"
        return f"counterparty:{memo}|새마을금고 내역"
    if "대체" in memo:  # 미래에셋: a 계좌대체 to or from an account other than the ones on file
        return "mirae-other"
    return f"counterparty:{memo}|미래에셋증권"


def _days(a, b):
    return abs((datetime.strptime(a, "%Y-%m-%d") - datetime.strptime(b, "%Y-%m-%d")).days)


def pair_transfers(flows):
    """Mark transfers between two statements we hold, so neither leg counts as money leaving.

    A 토스뱅크 row that names a bank we hold statements for pairs with the nearest
    opposite row of equal size in that bank's statements within PAIR_DAYS days; a
    미래에셋 CMA 계좌대체 pairs with a 종합/ISA 계좌대체 of the same day.
    """
    def pair(left, right, days):
        for a in [f for f in flows if not f["paired"] and left(f)]:
            best = None
            for b in flows:
                if b is a or b["paired"] or not right(b) or b["source"] == a["source"]:
                    continue
                if abs(a["amount"] + b["amount"]) < 1 and _days(a["date"], b["date"]) <= days:
                    gap = _days(a["date"], b["date"])
                    if best is None or gap < best[0]:
                        best = (gap, b)
            if best:
                a["paired"] = best[1]["paired"] = True

    for bank, code in STATEMENT_BANKS.items():
        pair(lambda f, bank=bank: f["statement"] == "tossbank" and f["counterpartyInstitution"] == bank,
             lambda f, code=code: f["statement"] == code, PAIR_DAYS)
    pair(lambda f: f["source"] == "mirae-cma" and "대체" in f["memo"],
         lambda f: f["source"] == "mirae-brokerage" and "대체" in f["memo"], 0)
    return flows


def held_outside(points):
    """Per day, the money outside the statements that later comes back.

    `points` are (date, outflow) in order; an outflow leaving a statement account
    is positive. The running total is clipped at zero, so money that arrives with
    no earlier outflow (salary, a sale, an inheritance) is not counted before it
    arrived. A day's value is the running total less the lowest it falls to later:
    money that never comes back (spending) counts for nothing.
    """
    running, by_day = 0.0, {}
    for date, outflow in points:
        running = max(0.0, running + outflow)
        by_day[date] = running
    days = sorted(by_day)
    out, floor = {}, float("inf")
    for date in reversed(days):
        floor = min(floor, by_day[date])
        out[date] = round(by_day[date] - floor, 2)
    return [(d, out[d]) for d in days]


def anchored(series, points, anchor):
    """Raise the days up to an anchor to the balance walked back from it.

    The walk takes the anchor balance and undoes each later outflow, clipped at
    zero. It is a floor: money that left for somewhere unseen before the anchor
    still counts, while held_outside alone would drop it.
    """
    date, balance = str(anchor["date"]), float(anchor["balance"])
    datetime.strptime(date, "%Y-%m-%d")
    by_day = {}
    for day, outflow in points:
        if day <= date:
            by_day[day] = by_day.get(day, 0.0) + outflow
    walk, running = {date: balance}, balance
    for day in sorted(by_day, reverse=True):
        walk.setdefault(day, round(running, 2))  # `running` is the balance at the end of `day`
        running = max(0.0, running - by_day[day])
    merged = dict(series)
    for day, value in walk.items():
        merged[day] = max(merged.get(day, 0.0), value)
    # A day after the anchor keeps its own value; without one the series would
    # carry the anchor forward to the next flow.
    return sorted(merged.items())


def estimate_closed_accounts(statements, transfers, account_map, findings):
    """Estimated balances of accounts held outside the statements, from the statements' own transfers.

    `statements` are (statement, source, txns) for the KRW statement accounts;
    `transfers` are 미래에셋 종합/ISA transfer rows, used only to pair legs.
    """
    flows = []
    for statement, source, txns in statements + [("mirae", "mirae-brokerage", transfers)]:
        for t in txns:
            flows.append({"statement": statement, "source": source, "date": t["date"], "seq": t["seq"],
                          "amount": t["amount"], "memo": t.get("counterparty") or t.get("description", ""),
                          "counterpartyInstitution": t.get("counterpartyInstitution", ""), "paired": False})
    pair_transfers(flows)
    buckets = {}
    for f in sorted((f for f in flows if not f["paired"]), key=lambda f: (f["date"], f["seq"])):
        key = _bucket(f)
        if key:
            buckets.setdefault(key, []).append((f["date"], -f["amount"]))
    anchors = {a.get("alias"): a for a in account_map.get("anchors", [])}
    out = []
    for key, points in sorted(buckets.items()):
        alias = ESTIMATE_ALIASES.get(key) or key.split(":", 1)[1].replace("|", " · ")
        series = held_outside(points)
        if alias in anchors:
            try:
                series = anchored(series, points, anchors[alias])
            except (KeyError, TypeError, ValueError) as error:
                findings.append(f"{alias}: the estimate's anchor cannot be read ({type(error).__name__}: {error}); not anchored")
        if max((v for _d, v in series), default=0.0) < MIN_ESTIMATE_KRW:
            continue
        balances, last = [], None
        for day, value in series:
            if value != last:
                balances.append({"date": day, "balance": value})
                last = value
        institution = {"tossbank-parking": "tossbank", "tossbank-savings": "tossbank", "mg-savings": "mg",
                       "mirae-other": "mirae"}.get(key, "counterparty")
        out.append({"institution": institution, "account": alias,
                    "currency": "KRW", "anchored": alias in anchors, "balances": balances})
    return out


def main():
    account_map = json.loads(MAP_PATH.read_text(encoding="utf-8")) if MAP_PATH.exists() else {}
    findings, notes, accounts = [], [], []
    krw_statements = []
    for prefix, institution, kind, currency, parse, key_pattern in FAMILIES:
        files = sorted(SOURCE_DIR.glob(f"{prefix}*")) if SOURCE_DIR.exists() else []
        if not files:
            continue
        by_account = {}
        for path in files:
            key = None
            if key_pattern:
                found = re.match(key_pattern, path.name)
                if not found:
                    findings.append(f"{path.name}: name carries no account key; skipped")
                    continue
                key = found.group(1)
            by_account.setdefault(key, []).append(path)
        for key, paths in sorted(by_account.items(), key=lambda item: str(item[0])):
            parsed = []
            for path in paths:
                try:
                    rows = parse(path, findings, notes)
                except Exception as error:  # one bad file must not cost every account
                    findings.append(f"{path.name}: could not be parsed ({type(error).__name__}: {error})")
                    continue
                if rows is None:  # parsed, but unusable; the parser recorded why
                    continue
                if not rows:
                    findings.append(f"{path.name}: parsed to zero rows")
                    continue
                parsed.append((min(t["date"] for t in rows), path.name, rows))
            parsed.sort(key=lambda item: (item[0], item[1]))
            txns = merge_txns([rows for _, _, rows in parsed])
            rule = _alias_rule(account_map, institution, kind, key)
            account_kind = (rule or {}).get("kind") or kind
            alias = _alias(account_map, institution, kind, key)
            if not txns:
                continue
            if currency == "KRW" and institution in ("tossbank", "mg", "mirae"):
                krw_statements.append((institution, "mirae-cma" if institution == "mirae" else f"{institution}-{key or kind}", txns))
            derived = all(t["balance"] is None for t in txns)
            balances = _derive(alias, txns, account_map, findings) if derived else end_of_day(txns)
            accounts.append({
                "institution": institution, "account": alias, "kind": account_kind, "currency": currency, "owner": "self",
                "derived": derived, "sources": [name for _, name, _ in parsed], "balances": balances,
                "continuityBreaks": [] if derived else continuity_breaks(txns),
            })
    transfers = []
    for glob in MIRAE_TRANSFER_GLOBS:
        parsed = []
        for path in sorted(KR_DIR.glob(glob)) if KR_DIR.exists() else []:
            try:
                parsed.append(parse_mirae_transfers(path))
            except Exception as error:  # an unread certificate only weakens the pairing
                findings.append(f"{path.name}: transfers could not be read for the estimates ({type(error).__name__}: {error})")
        transfers += merge_txns([[{**t, "balance": None} for t in rows] for rows in parsed])
    estimated = estimate_closed_accounts(krw_statements, transfers, account_map, findings)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    document = {"generatedAt": datetime.now(timezone.utc).isoformat(), "accounts": accounts,
                "estimatedAccounts": estimated, "findings": findings, "notes": notes}
    OUT_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"bank balances: {len(accounts)} account(s), {len(estimated)} estimated, {len(findings)} finding(s), "
          f"{len(notes)} note(s) → {OUT_PATH}")


if __name__ == "__main__":
    main()
