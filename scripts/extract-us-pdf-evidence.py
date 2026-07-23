import json
import os
import re
from pathlib import Path

import pdfplumber


DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
OUT_PATH = Path(os.environ.get("STOCK_US_PDF_EVIDENCE_PATH", Path.cwd() / "data/us-pdf-evidence.json"))


def money(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    cleaned = raw.replace("$", "").replace(",", "")
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = f"-{cleaned[1:-1]}"
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_account(filename):
    match = re.match(r"(\d{4})\s+", filename)
    return match.group(1) if match else ""


def ticker_from_security(security):
    match = re.search(r"\(([A-Z.]+)\)", str(security or ""))
    return match.group(1) if match else ""


def clean_name(security):
    return re.sub(r"\s*\([A-Z.]+\)\s*$", "", str(security or "")).strip()


def date_iso(value):
    raw = str(value or "").strip()
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2})$", raw)
    if not match:
        return raw
    month, day, year = match.groups()
    return f"20{year}-{month.zfill(2)}-{day.zfill(2)}"


def is_lot_header(cells):
    return "Security" in cells and "Tax Cost" in cells


def summarize_gain_loss(path):
    rows = []
    lots = []
    account_hint = extract_account(path.name)
    account = f"Robinhood {account_hint}".strip()
    with pdfplumber.open(path) as pdf:
        # A Gain/Loss report's lot table runs across pages, and only the FIRST
        # page repeats the column header — every continuation page begins
        # straight at a data row. Requiring a header per table therefore dropped
        # every page after the first: 400 lot rows became 73, and the portfolio
        # silently showed a fraction of its cost basis.
        #
        # So the header carries forward. A continuation table is accepted only
        # when its column count matches the header it would be read with,
        # otherwise an unrelated table (a summary block, a footer) could be
        # zipped against the wrong field names and produce plausible nonsense.
        header = None
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if not table:
                    continue
                first_row = [str(c or "").replace("\n", " ").strip() for c in table[0]]
                if is_lot_header(first_row):
                    header = first_row
                    body = table[1:]
                elif header is not None and len(table[0]) == len(header):
                    body = table  # no header on this page: row 0 is already data
                else:
                    continue
                for values in body:
                    row = dict(zip(header, values))
                    security = str(row.get("Security") or "").strip()
                    if not security or security.lower().startswith("total"):
                        continue
                    rows.append(row)
                    ticker = ticker_from_security(security)
                    if ticker:
                        units = money(row.get("Units"))
                        tax_cost = money(row.get("Tax Cost"))
                        open_price = money(row.get("Open Orig Price"))
                        lots.append(
                            {
                                "account": account,
                                "account_hint": account_hint,
                                "ticker": ticker,
                                "name": clean_name(security),
                                "acquired_date": date_iso(row.get("Open Date")),
                                "hold_date": date_iso(row.get("Hold Date")),
                                "open_quantity": units,
                                "native_cost_basis": tax_cost,
                                "native_unit_cost": open_price,
                                "tax_term": str(row.get("GL Term") or "").strip().lower(),
                                "source": path.name,
                            }
                        )

        tax_cost = sum(v for v in (money(row.get("Tax Cost")) for row in rows) if v is not None)
        units = sum(v for v in (money(row.get("Units")) for row in rows) if v is not None)
        terms = {}
        tickers = set()
        for row in rows:
            term = str(row.get("GL Term") or "").strip().lower() or "unknown"
            terms[term] = terms.get(term, 0) + 1
            match = re.search(r"\(([A-Z.]+)\)", str(row.get("Security") or ""))
            if match:
                tickers.add(match.group(1))

        return {
            "name": f"gain_loss:{account_hint or path.stem}",
            "category": "us_gain_loss_pdf",
            "filename": path.name,
            "path": str(path),
            "account_hint": account_hint,
            "account": account,
            "pages": len(pdf.pages),
            "row_count": len(rows),
            "metrics": {
                "tax_cost_usd": round(tax_cost, 2),
                "units": round(units, 6),
                "ticker_count": len(tickers),
                "terms": terms,
            },
            "lots": lots,
        }


def summarize_tax_doc(path):
    with pdfplumber.open(path) as pdf:
        first_text = pdf.pages[0].extract_text() or ""
        year_match = re.search(r"\b(20\d{2})\b", first_text)
        return {
            "name": f"tax_doc:{path.stem}",
            "category": "us_tax_document_pdf",
            "filename": path.name,
            "path": str(path),
            "account_hint": "",
            "pages": len(pdf.pages),
            "row_count": len(pdf.pages),
            "metrics": {
                "tax_year_hint": year_match.group(1) if year_match else "",
            },
        }


gain_loss_paths = sorted(DATA_DIR.glob("**/*Gain_Loss Report.pdf"))
tax_doc_paths = sorted((p for p in DATA_DIR.glob("**/*.pdf") if "Tax Documents" in str(p)))

reports = [summarize_gain_loss(path) for path in gain_loss_paths]
reports.extend(summarize_tax_doc(path) for path in tax_doc_paths)

payload = {
    "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "source": "pdfplumber table/text extraction",
    "reports": reports,
}

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {OUT_PATH}: {len(reports)} PDF evidence report(s)")
