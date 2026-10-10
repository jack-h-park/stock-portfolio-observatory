#!/usr/bin/env python3
"""Bank deposit statements in bank-statements/ → data/bank-balances.json.

Balances, not spending: each statement is reduced to one end-of-day balance per
account per day. Statements that print a running balance are read as printed and
checked for continuity; Robinhood's export prints none, so its history is walked
from one anchor balance kept in the gitignored account map.
"""
from __future__ import annotations

import csv, io, importlib.util, json, os, re, subprocess, tempfile
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
    """Rows of the converted 새마을금고 sheet: header 거래일자, 거래시간, …, 출금액, 입금액, 잔액."""
    header_at = next(i for i, r in enumerate(rows) if "거래일자" in [c.strip() for c in r])
    header = [c.strip() for c in rows[header_at]]
    col = {name: header.index(name) for name in ("거래일자", "거래시간", "출금액", "입금액", "잔액")}
    parsed = []
    for r in rows[header_at + 1:]:
        day = (r[col["거래일자"]] if len(r) > col["거래일자"] else "").strip().replace(".", "-")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        out_amt = _num(r[col["출금액"]]) or 0.0
        in_amt = _num(r[col["입금액"]]) or 0.0
        parsed.append((day, _clock(r[col["거래시간"]]), in_amt - out_amt, _num(r[col["잔액"]])))
    parsed.sort(key=lambda t: (t[0], t[1]))
    return [{"date": d, "seq": i, "description": "", "amount": a, "balance": b} for i, (d, _t, a, b) in enumerate(parsed)]


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
    # (filename prefix, institution, kind, currency, parser)
    ("chase-checking-", "chase", "checking", "USD", lambda p, f: parse_chase(p.read_text(encoding="utf-8-sig"))),
    ("boa-checking-", "boa", "checking", "USD", lambda p, f: parse_boa(p.read_text(encoding="utf-8-sig"))),
    ("robinhood-bank-checking-", "robinhood-bank", "checking", "USD", lambda p, f: parse_robinhood_bank(p.read_text(encoding="utf-8-sig"))),
    ("robinhood-bank-savings-", "robinhood-bank", "savings", "USD", lambda p, f: parse_robinhood_bank(p.read_text(encoding="utf-8-sig"))),
    ("mg-deposit-", "mg", "deposit", "KRW", lambda p, f: parse_mg_rows(_xls_rows(p, f))),
]


def _alias(account_map, institution, kind):
    for rule in account_map.get("bankAccounts", []):
        if rule.get("institution") == institution and rule.get("kind") == kind:
            return rule.get("alias") or f"{institution} {kind}"
    return f"{institution} {kind}"


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


def main():
    account_map = json.loads(MAP_PATH.read_text(encoding="utf-8")) if MAP_PATH.exists() else {}
    findings, accounts = [], []
    for prefix, institution, kind, currency, parse in FAMILIES:
        files = sorted(SOURCE_DIR.glob(f"{prefix}*")) if SOURCE_DIR.exists() else []
        if not files:
            continue
        parsed = []
        for path in files:
            try:
                rows = parse(path, findings)
            except Exception as error:  # one bad file must not cost every account
                findings.append(f"{path.name}: could not be parsed ({type(error).__name__}: {error})")
                continue
            if not rows:
                findings.append(f"{path.name}: parsed to zero rows")
                continue
            parsed.append((min(t["date"] for t in rows), path.name, rows))
        parsed.sort(key=lambda item: (item[0], item[1]))
        txns = merge_txns([rows for _, _, rows in parsed])
        alias = _alias(account_map, institution, kind)
        if not txns:
            continue
        derived = all(t["balance"] is None for t in txns)
        balances = _derive(alias, txns, account_map, findings) if derived else end_of_day(txns)
        accounts.append({
            "institution": institution, "account": alias, "kind": kind, "currency": currency, "owner": "self",
            "derived": derived, "sources": [name for _, name, _ in parsed], "balances": balances,
            "continuityBreaks": [] if derived else continuity_breaks(txns),
        })
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    document = {"generatedAt": datetime.now(timezone.utc).isoformat(), "accounts": accounts, "findings": findings}
    OUT_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"bank balances: {len(accounts)} account(s), {len(findings)} finding(s) → {OUT_PATH}")


if __name__ == "__main__":
    main()
