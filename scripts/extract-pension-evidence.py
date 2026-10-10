#!/usr/bin/env python3
"""Year-end pension certificates in pension/evidence/ → data/pension-evidence.json.

Three documents, filed by scripts/file-downloads.py as
`pension/evidence/<token>-<balance-status|balance-certificate>-<YYYYMMDD>.pdf`:

  미래에셋 퇴직연금 잔고현황 (balance-status). Per-product holdings, the
  합 계 total, and the 기본사항 block: 납입원본 누계 (principal paid in),
  사용자부담금 (employer) and 가입자부담금 (own). This is the only document that
  carries the IRP's cumulative contributions; the IRP 거래내역증명서 stops at the
  first transfer in.

  미래에셋 IRP 잔고증명서 (balance-certificate). One aggregate 신탁 line and the
  account total, no per-product table, so `products` is empty. An independent
  year-end value next to the 잔고현황.

  삼성증권 연금저축 잔고증명서 (balance-certificate). The 총 잔고 / 합계 total,
  the cash, and page 2's per-fund table (종목명, 구분, 수량, 가격, 평가금액,
  매입금액). Its `products` stand in for a holdings snapshot of that account.

These feed validation (and the 삼성 snapshot fallback); they move no holdings.
A total that cannot be read is null and a finding, never 0: a zero total would
compare as a real, very wrong, year-end value.

Reads STOCK_PDF_PASSWORD for encrypted certificates.
"""

import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
EVIDENCE_DIR = DATA_DIR / "pension" / "evidence"
OUT_PATH = Path(os.environ.get("STOCK_PENSION_EVIDENCE_PATH", Path.cwd() / "data" / "pension-evidence.json"))
PDF_PASSWORD = os.environ.get("STOCK_PDF_PASSWORD", "")

FILE_NAME = re.compile(r"^(.+)-(balance-status|balance-certificate)-(\d{8})\.pdf$")
AMOUNT = r"([\d,]+(?:\.\d+)?)"


def nfc(value):
    return unicodedata.normalize("NFC", value or "")


def despace(value):
    return re.sub(r"\s+", "", nfc(value))


def amount(value):
    """A money or quantity cell as a number, or None when it holds none."""
    raw = despace(str(value or "")).replace(",", "").replace("￦", "").replace("₩", "").replace("원", "")
    if not raw or not re.fullmatch(r"-?\d+(\.\d+)?", raw):
        return None
    number = float(raw)
    return int(number) if number.is_integer() else number


def cell_name(value):
    """A product name whose cell wraps across lines, on one line."""
    return " ".join(nfc(value).split())


def open_pdf(path):
    for password in (None, PDF_PASSWORD):
        if password == "":
            continue
        try:
            return pdfplumber.open(path) if password is None else pdfplumber.open(path, password=password)
        except Exception:
            continue
    return None


class Doc:
    def __init__(self, pdf):
        self.texts = [nfc(page.extract_text() or "") for page in pdf.pages]
        self.tables = [[[[nfc(c) if c is not None else "" for c in row] for row in table]
                        for table in (page.extract_tables() or [])] for page in pdf.pages]

    def text(self, page=None):
        return "\n".join(self.texts) if page is None else (self.texts[page] if page < len(self.texts) else "")

    def rows(self, page=None):
        pages = range(len(self.tables)) if page is None else [page]
        for p in pages:
            if p >= len(self.tables):
                continue
            for table in self.tables[p]:
                for row in table:
                    yield row


def labelled_amount(doc, label):
    """The first amount after `label`, looked for row by row, then in the page text.

    By label and never by position: a footer can spill into a table row and shift
    every index after it, and the label is what the document actually promises.
    """
    pattern = re.compile(re.escape(despace(label)) + r"[^\d]*?" + AMOUNT)
    for row in doc.rows():
        match = pattern.search(despace(" ".join(row)))
        if match:
            return amount(match.group(1))
    match = pattern.search(despace(doc.text()))
    return amount(match.group(1)) if match else None


def header_index(row, *labels):
    cells = [despace(c) for c in row]
    found = []
    for label in labels:
        target = despace(label)
        found.append(next((i for i, c in enumerate(cells) if c == target), None))
    return found


def certificate(token, kind, as_of, source):
    return {
        "token": token, "kind": kind, "asOf": as_of,
        "totalKrw": None, "contributionsCumulativeKrw": None,
        "employerCumulativeKrw": None, "ownCumulativeKrw": None,
        "cashKrw": None, "products": [], "source": source,
    }


def iso(compact):
    return f"{compact[:4]}-{compact[4:6]}-{compact[6:]}"


def parse_balance_status(doc, cert, finding):
    """미래에셋 퇴직연금 잔고현황."""
    match = re.search(r"기준일자:?(\d{4}-\d{2}-\d{2})", despace(doc.text(0)))
    if match:
        cert["asOf"] = match.group(1)
    cert["contributionsCumulativeKrw"] = labelled_amount(doc, "납입원본 누계 (A)")
    cert["employerCumulativeKrw"] = labelled_amount(doc, "사용자부담금")
    cert["ownCumulativeKrw"] = labelled_amount(doc, "가입자부담금")
    balance = labelled_amount(doc, "적립금 잔액 (A+B-C)")

    columns = None
    total_value = None
    for row in doc.rows():
        if columns is None:
            cost, quantity, value = header_index(row, "매입원금", "잔고수량", "평가금액")
            if despace(row[0] if row else "") == "상품명" and None not in (cost, quantity, value):
                columns = (cost, quantity, value)
            continue
        name = despace(row[0] if row else "")
        if not name:
            continue
        cost, quantity, value = (amount(row[i]) if i < len(row) else None for i in columns)
        if name == "합계":
            total_value = value
            break
        if value is None:
            continue
        cert["products"].append({"name": cell_name(row[0]), "quantity": quantity, "costKrw": cost, "valueKrw": value})

    cert["totalKrw"] = total_value if total_value is not None else balance
    if cert["totalKrw"] is not None and cert["products"]:
        summed = sum(p["valueKrw"] for p in cert["products"])
        if abs(summed - cert["totalKrw"]) > 1:
            finding("evidence-products-total-mismatch",
                    f"the products sum to {len(cert['products'])} row(s) that disagree with the 합 계 row")
    if balance is not None and total_value is not None and abs(balance - total_value) > 1:
        finding("evidence-total-disagrees", "the 합 계 평가금액 disagrees with 적립금 잔액 (A+B-C) on page 1")


def parse_irp_certificate(doc, cert, finding):
    """미래에셋 IRP 잔고증명서: one 신탁 line and the account total; no products."""
    match = re.search(r"기준일자발급일시.*?(\d{4}-\d{2}-\d{2})", despace(doc.text(0)), re.S)
    if not match:
        for row in doc.rows(0):
            if any(re.fullmatch(r"\d{4}-\d{2}-\d{2}", despace(c)) for c in row[:1]):
                match = re.match(r"(\d{4}-\d{2}-\d{2})", despace(row[0]))
                break
    if match:
        cert["asOf"] = match.group(1)
    total = None
    text = despace(doc.text(0))
    at = text.find("잔고평가금액총액")
    if at >= 0:
        won = re.search(r"[￦₩]" + AMOUNT, text[at:])
        total = amount(won.group(1)) if won else None
    if total is None:
        # The 20241231 issue prints no 총액 line; the page-2 개인형IRP row's
        # 평가금액 is the same figure.
        value_col = None
        for row in doc.rows(1):
            index = header_index(row, "평가금액")[0]
            if index is not None:
                value_col = index
                continue
            if value_col is not None and despace(row[0] if row else "") == "개인형IRP":
                total = amount(row[value_col]) if value_col < len(row) else None
                break
    cert["totalKrw"] = total


def parse_samsung_certificate(doc, cert, finding):
    """삼성증권 연금저축 잔고증명서: 총 잔고 / 합계, cash, and the per-fund table."""
    match = re.search(r"기준일자(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})", despace(doc.text(0)))
    if match:
        year = int(match.group(1))
        cert["asOf"] = f"{year + 2000 if year < 100 else year}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"

    # The 계좌별내역 table's 합계 row, by label: cash under 현금, the total in
    # its last amount (총 계좌잔고).
    cash_col = None
    total = None
    for row in doc.rows(0):
        index = header_index(row, "현금")[0]
        if index is not None and despace(row[0] if row else "") == "계좌번호":
            cash_col = index
            continue
        if despace(row[0] if row else "") == "합계":
            amounts = [amount(c) for c in row[1:]]
            amounts = [a for a in amounts if a is not None]
            total = amounts[-1] if amounts else None
            if cash_col is not None and cash_col < len(row):
                cert["cashKrw"] = amount(row[cash_col])
            break
    if total is None:
        # The page-1 summary: the row after the 원화/외화 sub-header, last cell 총 잔고.
        rows = list(doc.rows(0))
        for i, row in enumerate(rows):
            if any("총잔고" in despace(c) for c in row) and i + 2 < len(rows):
                total = amount(rows[i + 2][-1])
                if cert["cashKrw"] is None:
                    cert["cashKrw"] = amount(rows[i + 2][0])
                break
    cert["totalKrw"] = total

    columns = None
    for row in doc.rows(1):
        if columns is None:
            found = header_index(row, "종목명", "수량", "평가금액", "매입금액")
            if None not in found:
                columns = found
            continue
        name_col, qty_col, value_col, cost_col = columns
        if name_col >= len(row) or not despace(row[name_col]) or despace(row[name_col]) == "합계":
            continue
        value = amount(row[value_col]) if value_col < len(row) else None
        if value is None:
            continue
        cert["products"].append({
            "name": cell_name(row[name_col]),
            "quantity": amount(row[qty_col]) if qty_col < len(row) else None,
            "costKrw": amount(row[cost_col]) if cost_col < len(row) else None,
            "valueKrw": value,
        })
    if total is not None and cert["products"]:
        summed = sum(p["valueKrw"] for p in cert["products"]) + (cert["cashKrw"] or 0)
        if abs(summed - total) > 1:
            finding("evidence-products-total-mismatch",
                    f"{len(cert['products'])} fund row(s) plus cash disagree with 총 잔고 / 합계")


def main():
    findings = []
    certificates = []
    paths = sorted(EVIDENCE_DIR.glob("*.pdf")) if EVIDENCE_DIR.is_dir() else []

    for path in paths:
        source = f"pension/evidence/{path.name}"

        def finding(kind, detail, source=source):
            findings.append({"kind": kind, "source": source, "detail": detail})

        named = FILE_NAME.match(nfc(path.name))
        if not named:
            finding("evidence-unrecognised-name", "not <token>-<balance-status|balance-certificate>-YYYYMMDD.pdf")
            continue
        token, kind, compact = named.groups()
        pdf = open_pdf(str(path))
        if pdf is None:
            finding("evidence-unreadable", "could not be opened (set STOCK_PDF_PASSWORD)")
            continue
        with pdf:
            doc = Doc(pdf)
        cert = certificate(token, kind, iso(compact), source)
        cover = despace(doc.text(0))
        if kind == "balance-status":
            parse_balance_status(doc, cert, finding)
        elif "삼성증권" in cover:
            parse_samsung_certificate(doc, cert, finding)
        elif "미래에셋증권" in cover:
            parse_irp_certificate(doc, cert, finding)
        else:
            finding("evidence-unrecognised-issuer", "a balance certificate from neither 미래에셋증권 nor 삼성증권")
            continue
        if cert["asOf"] != iso(compact):
            finding("evidence-as-of-mismatch", f"the document is as of {cert['asOf']}, the file name says {iso(compact)}")
        if cert["totalKrw"] is None:
            finding("evidence-total-unparsed", "no total could be read; the certificate is kept with totalKrw null")
        certificates.append(cert)

    certificates.sort(key=lambda c: (c["token"], c["asOf"], c["kind"]))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "certificates": certificates,
        "findings": findings,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for cert in certificates:
        print(f"[pension-evidence] {cert['source']}: {cert['kind']} as of {cert['asOf']}, "
              f"total {'parsed' if cert['totalKrw'] is not None else 'MISSING'}, {len(cert['products'])} product(s)")
    for f in findings:
        print(f"[pension-evidence] {f['kind']}: {f['source']}: {f['detail']}", file=sys.stderr)
    print(f"[pension-evidence] wrote {OUT_PATH}: {len(certificates)} certificate(s), {len(findings)} finding(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
