#!/usr/bin/env python3
"""Build the auditable KRW/USD exchange and transfer ledger.

Hana source statements remain authoritative for USD movements. Older PDF rows
do not contain a transaction time, KRW consideration, or applied rate, so the
rate is explicitly estimated from Hana's first published rate for that date and
the user-confirmed 90% preferential spread. Toss rates are read from the
already-normalized Korea statement TSV; two accounting legs become one event.
"""

from __future__ import annotations

import csv
import glob
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", ROOT / "private-data"))
SOURCE_DIR = DATA_DIR / "fx-statements"
KR_TSV = Path(os.environ.get("STOCK_KR_STATEMENTS_DIR", ROOT / "data/kr-statements")) / "transactions.tsv"
OUT_DIR = DATA_DIR / "outputs/stock-portfolio-observatory"
OUT_PATH = Path(os.environ.get("STOCK_FX_LEDGER_PATH", OUT_DIR / "fx-ledger.json"))
CACHE_PATH = Path(os.environ.get("STOCK_HANA_FX_CACHE_PATH", OUT_DIR / "hana-usd-reference-rates.json"))
OVERRIDES_PATH = Path(os.environ.get("STOCK_FX_TRANSFER_OVERRIDES_PATH", ROOT / "data/fx-transfer-overrides.json"))
OBSERVATIONS_PATH = Path(os.environ.get("STOCK_FX_RATE_OBSERVATIONS_PATH", ROOT / "data/fx-rate-observations.json"))
HANA_URL = "https://www.hanabank.com/cms/rate/wpfxd651_01i_01.do"
HANA_PAGE = "https://www.hanabank.com/cont/mall/mall15/mall1501/index.jsp"
PREFERENCE = 0.90


def nfc(value):
    return unicodedata.normalize("NFC", str(value or ""))


def number(value):
    text = str(value or "").strip().replace(",", "")
    if not text or text == "-":
        return 0.0
    return float(text)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


HANA_ROW = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})(?:\s+(?P<time>\d{2}:\d{2}:\d{2}))?\s+"
    r"(?P<kind>원화대가|외화대체|예금이자|외화지폐)\s+"
    r"(?:(?P<memo>.*?)\s+)?USD\s+(?P<deposit>[\d,.]+)\s+(?P<withdrawal>[\d,.]+)\s+"
    r"(?P<balance>[\d,.-]+)(?:\s+(?P<branch>.*))?$"
)


def parse_hana_pdfs():
    rows, sources = [], []
    for source in sorted(SOURCE_DIR.glob("hana-usd-history-*.pdf")):
        count = 0
        with pdfplumber.open(source) as document:
            for page_number, page in enumerate(document.pages, start=1):
                for line in nfc(page.extract_text() or "").splitlines():
                    found = HANA_ROW.match(line.strip())
                    if not found:
                        continue
                    item = found.groupdict()
                    item.update({
                        "deposit": number(item["deposit"]),
                        "withdrawal": number(item["withdrawal"]),
                        "balance": None if item["balance"] == "-" else number(item["balance"]),
                        "applied_rate": None,
                        "source": source.name,
                        "source_path": str(source),
                        "page": page_number,
                    })
                    rows.append(item)
                    count += 1
        sources.append({"filename": source.name, "path": str(source), "sha256": sha256(source), "rows": count})
    return rows, sources


def soffice_binary():
    configured = os.environ.get("STOCK_SOFFICE_BIN")
    candidates = [configured, shutil.which("soffice"), shutil.which("libreoffice")]
    candidates += glob.glob(str(Path.home() / ".cache/codex-runtimes/**/override/soffice"), recursive=True)
    return next((item for item in candidates if item and Path(item).exists()), None)


def parse_hana_xls():
    rows, sources, findings = [], [], []
    binary = soffice_binary()
    for source in sorted(SOURCE_DIR.glob("hana-usd-history-*.xls")):
        if not binary:
            findings.append(f"{source.name}: no soffice binary; XLS rows were not read")
            continue
        with tempfile.TemporaryDirectory(prefix="hana-fx-") as temp_dir:
            result = subprocess.run(
                [binary, "--headless", "--convert-to", "csv", "--outdir", temp_dir, str(source)],
                capture_output=True, text=True, timeout=60,
            )
            csv_files = list(Path(temp_dir).glob("*.csv"))
            if result.returncode or not csv_files:
                findings.append(f"{source.name}: XLS conversion failed: {result.stderr.strip()}")
                continue
            count = 0
            snapshot_balance, snapshot_date = None, None
            with csv_files[0].open(encoding="utf-8-sig", newline="") as handle:
                reader = csv.reader(handle)
                header = None
                for cells in reader:
                    cells = [nfc(cell).strip() for cell in cells]
                    if cells and cells[0] == "잔액" and len(cells) > 1:
                        snapshot_balance = number(cells[1])
                    if len(cells) > 7 and cells[6] == "조회기간" and "~" in cells[7]:
                        snapshot_date = cells[7].split("~", 1)[1].strip()
                    if cells and cells[0] == "거래일자":
                        header = {name: index for index, name in enumerate(cells)}
                        continue
                    if not header or not cells or not re.match(r"^\d{4}-\d{2}-\d{2}$", cells[0]):
                        continue
                    get = lambda key: cells[header[key]] if header[key] < len(cells) else ""
                    rows.append({
                        "date": get("거래일자"), "time": get("거래시간"), "kind": get("구분"),
                        "memo": get("적요"), "branch": get("거래점"), "deposit": number(get("입금액")),
                        "withdrawal": number(get("출금액")),
                        "balance": None if get("잔액") == "-" else number(get("잔액")),
                        "applied_rate": number(get("적용환율")) or None,
                        "source": source.name, "source_path": str(source), "page": None,
                    })
                    count += 1
            sources.append({"filename": source.name, "path": str(source), "sha256": sha256(source), "rows": count,
                            "snapshotBalanceUsd": snapshot_balance, "snapshotDate": snapshot_date})
    return rows, sources, findings


def movement_key(row):
    return (row["date"], row["kind"], round(row["deposit"], 2), round(row["withdrawal"], 2))


def merge_hana_rows(pdf_rows, xls_rows):
    # Pair richer XLS rows to annual-PDF rows one-for-one. Balance cannot be in
    # the key: after a full withdrawal the XLS prints '-' while the PDF prints
    # 0.00. Repeated equal transfers remain distinct because each key owns a
    # queue, not a single dictionary value.
    pending = {}
    for row in pdf_rows:
        pending.setdefault(movement_key(row), []).append(row)
    merged = []
    for row in xls_rows:
        key = movement_key(row)
        matches = pending.get(key, [])
        if matches:
            # The XLS is the richer representation of the same bank movement.
            original = matches.pop(0)
            row["source"] = f"{original['source']} + {row['source']}"
            row["source_path"] = original["source_path"]
            row["page"] = original["page"]
        merged.append(row)
    merged.extend(row for matches in pending.values() for row in matches)
    return sorted(merged, key=lambda row: (row["date"], row.get("time") or "", row["deposit"] - row["withdrawal"]))


def load_cache():
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8")).get("rates", {})
    except Exception:
        return {}


def fetch_rate(day, cookie):
    compact = day.replace("-", "")
    form = (
        f"ajax=true&curCd=USD&tmpInqStrDt={day}&pbldDvCd=1&pbldSqn=&"
        f"inqStrDt={compact}&inqKindCd=1&requestTarget=searchContentDiv"
    )
    response = subprocess.run(
        ["curl", "-sS", "--fail", "-b", cookie, "-L", "--data", form,
         "-H", "X-Requested-With: XMLHttpRequest", "-H", f"Referer: {HANA_PAGE}", HANA_URL],
        capture_output=True, text=True, timeout=30,
    )
    if response.returncode:
        raise RuntimeError(response.stderr.strip() or f"curl exit {response.returncode}")
    usd_row = re.search(r"미국\s+USD.*?</tr>", response.stdout, re.S)
    if not usd_row:
        raise RuntimeError("USD row missing")
    values = [number(html.unescape(re.sub(r"<[^>]+>", "", item))) for item in re.findall(r'<td class="txtAr">(.*?)</td>', usd_row.group(0), re.S)]
    if len(values) < 10:
        raise RuntimeError(f"expected 10 rate values, found {len(values)}")
    # cash buy, cash spread, cash sell, spread, TT send, TT receive,
    # traveller's cheque, base rate, USD conversion rate, change rate.
    return {"date": day, "cashBuy": values[0], "ttSend": values[4], "ttReceive": values[5], "base": values[7], "publishedSelection": "first"}


def reference_rates(days):
    cached, findings = load_cache(), []
    missing = sorted(set(days) - set(cached))
    if missing:
        with tempfile.NamedTemporaryFile(prefix="hana-cookie-", delete=False) as cookie_file:
            cookie = cookie_file.name
        try:
            initial = subprocess.run(["curl", "-sS", "--fail", "-c", cookie, HANA_PAGE], capture_output=True, text=True, timeout=30)
            if initial.returncode:
                findings.append("Hana reference-rate session could not be opened; cached dates only")
            else:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    futures = {pool.submit(fetch_rate, day, cookie): day for day in missing}
                    for future in as_completed(futures):
                        day = futures[future]
                        try:
                            cached[day] = future.result()
                        except Exception as exc:
                            findings.append(f"{day}: Hana reference rate unavailable ({exc})")
        finally:
            try:
                os.unlink(cookie)
            except OSError:
                pass
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps({"source": HANA_URL, "rates": dict(sorted(cached.items()))}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return cached, findings


def load_overrides():
    try:
        rows = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8")).get("overrides", [])
        return {(r["institution"], r["date"], r["direction"], round(r["usdAmount"], 2)): r for r in rows}
    except Exception:
        return {}


def load_rate_observations():
    try:
        rows = json.loads(OBSERVATIONS_PATH.read_text(encoding="utf-8")).get("observations", [])
        return {(r["institution"], r["date"], r["transactionTime"]): r for r in rows}
    except Exception:
        return {}


def hana_events(rows, rates):
    events, overrides, observations = [], load_overrides(), load_rate_observations()
    for row in rows:
        amount = row["deposit"] or row["withdrawal"]
        if amount <= 0:
            continue
        direction = "IN" if row["deposit"] else "OUT"
        base = {"institution": "Hana Bank", "account": "USD ...10938", "date": row["date"],
                "time": row.get("time") or None, "usd_amount": amount, "source": row["source"],
                "source_path": row["source_path"], "page": row.get("page"), "balance_usd": row.get("balance")}
        if row["kind"] == "원화대가" and "FX마켓" in (row.get("memo") or ""):
            ref = rates.get(row["date"])
            actual = row.get("applied_rate")
            observed_ref = observations.get(("Hana Bank", row["date"], row.get("time")))
            if observed_ref:
                ref = {**(ref or {}), "base": observed_ref["baseRate"], "ttSend": observed_ref["ttSendRate"]}
            estimated = ref["base"] + (ref["ttSend"] - ref["base"]) * (1 - PREFERENCE) if ref else None
            applied = actual or estimated
            events.append({**base, "event_type": "EXCHANGE", "direction": "BUY_USD",
                "krw_amount": amount * applied if applied else None, "applied_rate": applied,
                "rate_status": "actual" if actual else "estimated", "preference_rate": PREFERENCE,
                "reference_base_rate": ref["base"] if ref else None, "reference_customer_rate": ref["ttSend"] if ref else None,
                "spread_cost_krw": amount * (applied - ref["base"]) if applied and ref else None,
                "spread_savings_krw": amount * (ref["ttSend"] - applied) if applied and ref else None,
                "reference_source": observed_ref["source"] if observed_ref else HANA_URL,
                "realized_fx_gl_krw": None, "counterparty": None, "match_status": "not_applicable",
                "confidence": "observed" if actual else "medium",
                "method": "hana_actual_applied_rate" if actual else "hana_first_published_tt_send_90pct_v1",
                "note": (f"Actual rate from Hana XLS; compared with published round {observed_ref['publishedRound']} at {observed_ref['publishedTime']}." if actual and observed_ref else "Actual rate from Hana XLS.") if actual else "Estimated from Hana first published daily TT-send spread with 90% preference; preference is high-confidence but transaction time is unavailable."})
            continue
        if row["kind"] == "외화지폐":
            ref = rates.get(row["date"])
            applied = row.get("applied_rate") or (ref.get("cashBuy") if ref else None)
            events.append({**base, "event_type": "EXCHANGE", "direction": "BUY_USD", "krw_amount": amount * applied if applied else None,
                "applied_rate": applied, "rate_status": "actual" if row.get("applied_rate") else "estimated",
                "preference_rate": None, "reference_base_rate": ref.get("base") if ref else None,
                "reference_customer_rate": ref.get("cashBuy") if ref else None, "spread_cost_krw": None,
                "spread_savings_krw": None, "reference_source": HANA_URL, "realized_fx_gl_krw": None, "counterparty": None,
                "match_status": "not_applicable", "confidence": "medium", "method": "hana_cash_buy_reference_v1",
                "note": "Cash-wallet exchange; the 90% FX Market preference is not assumed."})
            continue
        if row["kind"] == "외화대체":
            memo = f"{row.get('memo') or ''} {row.get('branch') or ''}".strip()
            counterparty = "Toss Securities" if "토스증권" in memo else "Mirae Asset Securities" if "MIRAE" in memo.upper() else None
            status = "counterparty_observed" if counterparty else "unmatched"
            confidence, note = ("observed", memo) if counterparty else ("low", memo or "Counterparty is not printed in the annual PDF.")
            override = overrides.get(("Hana Bank", row["date"], direction, round(amount, 2)))
            if override:
                counterparty, status, confidence, note = override["counterparty"], override["matchStatus"], override["confidence"], override["provenance"]
            events.append({**base, "event_type": "TRANSFER", "direction": direction, "krw_amount": None,
                "applied_rate": row.get("applied_rate"), "rate_status": "account_reference_only" if row.get("applied_rate") else "not_applicable",
                "preference_rate": None, "reference_base_rate": None, "reference_customer_rate": None,
                "spread_cost_krw": None, "spread_savings_krw": None, "realized_fx_gl_krw": None,
                "reference_source": None,
                "counterparty": counterparty, "match_status": status, "confidence": confidence,
                "method": "bank_transfer_movement", "note": note})
    return events


def toss_events():
    if not KR_TSV.exists():
        return [], [{"filename": KR_TSV.name, "path": str(KR_TSV), "sha256": None, "rows": 0}], ["Toss transaction TSV is missing"]
    with KR_TSV.open(encoding="utf-8-sig", newline="") as handle:
        rows = [r for r in csv.DictReader(handle, delimiter="\t") if r.get("Raw Type", "").startswith("환전")]
    credits = {}
    for row in rows:
        if row["Raw Type"] not in ("환전외화입금", "환전외화입금취소"):
            continue
        key = (row["Date"], round(number(row["FX Rate"]), 6), round(number(row["Native Amount"]), 2), row["Raw Type"])
        credits.setdefault(key, []).append(row)
    events, findings = [], []
    for row in rows:
        raw = row["Raw Type"]
        if raw not in ("환전원화출금", "환전원화입금"):
            continue
        rate, krw = number(row["FX Rate"]), number(row["Native Amount"])
        counterpart = "환전외화입금" if raw == "환전원화출금" else "환전외화입금취소"
        key = (row["Date"], round(rate, 6), round(krw, 2), counterpart)
        matched = credits.get(key, [])
        other = matched.pop(0) if matched else None
        if not other:
            findings.append(f"Toss {row['Date']} {raw} KRW {krw}: matching USD ledger leg missing")
        usd = krw / rate if rate else None
        events.append({"institution": "Toss Securities", "account": row["Account"], "date": row["Date"], "time": None,
            "event_type": "EXCHANGE_CANCEL" if raw == "환전원화입금" else "EXCHANGE", "direction": "CANCEL_BUY_USD" if raw == "환전원화입금" else "BUY_USD",
            "usd_amount": usd, "krw_amount": krw, "applied_rate": rate, "rate_status": "actual",
            "preference_rate": None, "reference_base_rate": None, "reference_customer_rate": None,
            "spread_cost_krw": None, "spread_savings_krw": None, "reference_source": "Toss Securities transaction statement", "realized_fx_gl_krw": None,
            "counterparty": None, "match_status": "paired" if other else "leg_missing", "confidence": "observed",
            "method": "toss_statement_leg_pair_v1", "balance_usd": None, "source": row["Source"],
            "source_path": str(KR_TSV), "page": int(number(row["Page"])) or None,
            "note": "Paired exact date/rate/KRW legs from the KRW and USD statement sections."})
    source = {"filename": KR_TSV.name, "path": str(KR_TSV), "sha256": sha256(KR_TSV), "rows": len(rows)}
    return events, [source], findings


def main():
    pdf_rows, pdf_sources = parse_hana_pdfs()
    xls_rows, xls_sources, findings = parse_hana_xls()
    hana_rows = merge_hana_rows(pdf_rows, xls_rows)
    exchange_days = [r["date"] for r in hana_rows if (r["kind"] == "원화대가" and "FX마켓" in (r.get("memo") or "")) or r["kind"] == "외화지폐"]
    rates, rate_findings = reference_rates(exchange_days)
    toss, toss_sources, toss_findings = toss_events()
    events = hana_events(hana_rows, rates) + toss
    events.sort(key=lambda row: (row["date"], row.get("time") or "", row["institution"], row["event_type"]))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    balances = [{"institution": "Hana Bank", "account": "USD ...10938", "as_of_date": source["snapshotDate"],
                 "balance_usd": source["snapshotBalanceUsd"], "source": source["filename"]}
                for source in xls_sources if source.get("snapshotDate") and source.get("snapshotBalanceUsd") is not None]
    document = {"generatedAt": datetime.now(timezone.utc).isoformat(), "policy": {
        "hanaPreferenceRate": PREFERENCE, "hanaEstimateMethod": "first published daily TT-send spread",
        "transferRealizesFxGain": False, "mirae9346Coverage": "missing"
    }, "events": events, "balances": balances, "sources": pdf_sources + xls_sources + toss_sources,
        "findings": findings + rate_findings + toss_findings}
    OUT_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(events)} events; {len(document['findings'])} findings)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
