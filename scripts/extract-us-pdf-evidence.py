"""Register the US brokerage PDFs as evidence, and read the 1099-B lots out of them.

The Gain/Loss reports describe positions that are still OPEN, so they can never
say what a past sale earned. The realized side comes from the consolidated 1099s
here: the broker has already applied wash sales, return-of-capital basis
adjustments and covered-basis rules, so its Gain/Loss is the number that files.

Only the 1099-B sections are read. The identical-looking 1099-DA section is
digital assets and belongs to the crypto side of the portfolio, so it is skipped
by the form marker on the page rather than by its layout, which is the same.

Every section prints its own `Totals:` line. Each one is checked against the sum
of the rows parsed beneath it, and a disagreement is reported rather than
returned — a silently mis-parsed 1099-B would put a wrong number on a tax page
and look exactly like a right one.
"""

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


SECTION_RE = re.compile(
    r"(SHORT|LONG|UNDETERMINED)\s*TERM TRANSACTIONS FOR\s*(COVERED|NONCOVERED) TAX LOTS", re.I
)
BOX_RE = re.compile(r"Report on Form 8949, Part\s+(\w+)\s+with Box\s+([A-Z])\s+checked", re.I)
# `ISHARES 0-3 MONTH TREASURY BON D ETF / CUSIP: 46436E718 / Symbol:` — the
# symbol is routinely blank on these forms, which is why the ticker is resolved
# downstream against the transactions rather than read from here.
SECURITY_RE = re.compile(
    r"^(?P<desc>.+?)\s*/\s*CUSIP:\s*(?P<cusip>[A-Z0-9]*)\s*/\s*Symbol:\s*(?P<symbol>[A-Z.]*)\s*"
    r"(?:/\s*Note:\s*(?P<note>.*?))?\s*$"
)
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{2}$")
NUM_RE = re.compile(r"^\(?-?[\d,]+\.?\d*\)?$")
TOTALS_RE = re.compile(r"^Totals:\s*(.+)$", re.I)


def _num(token):
    value = money(token)
    return value


def parse_1099b_row(line):
    """One lot row: date sold, quantity, proceeds, date acquired, cost, gain.

    Read left-to-right by position rather than by a single regex: the wash-sale
    column is sometimes a placeholder (`...`), sometimes an amount followed by a
    `D`/`W` flag, and the proceeds carry an optional `G`/`N` option-premium
    marker. A fixed-width pattern matched none of the real rows.
    """
    tokens = line.split()
    if len(tokens) < 6 or not DATE_RE.match(tokens[0]):
        return None
    i = 0
    sold = tokens[i]; i += 1
    quantity = _num(tokens[i]); i += 1
    if quantity is None:
        return None
    proceeds = _num(tokens[i]); i += 1
    if proceeds is None:
        return None
    if i < len(tokens) and tokens[i] in {"G", "N"}:
        i += 1
    acquired = tokens[i] if i < len(tokens) else ""; i += 1
    cost = _num(tokens[i]) if i < len(tokens) else None; i += 1
    if cost is None:
        return None
    wash = None
    if i < len(tokens):
        if tokens[i] == "...":
            i += 1
        elif NUM_RE.match(tokens[i]):
            wash = _num(tokens[i]); i += 1
            if i < len(tokens) and tokens[i] in {"D", "W"}:
                i += 1
    gain = None
    if i < len(tokens) and NUM_RE.match(tokens[i]):
        gain = _num(tokens[i]); i += 1
    if gain is None:
        return None
    return {
        "sold_date": date_iso(sold),
        "quantity": quantity,
        "proceeds": proceeds,
        "acquired_date": "Various" if acquired.lower() == "various" else date_iso(acquired),
        "cost_basis": cost,
        "wash_sale_disallowed": wash,
        "gain_loss": gain,
        "additional_info": " ".join(tokens[i:]).strip(),
    }


def parse_1099b(pdf, filename):
    """Every 1099-B lot row in the statement, with the section it was filed under."""
    rows = []
    mismatches = []
    section = None       # (term, covered, box)
    security = None
    running = []         # rows since the last `Totals:` line, for the totals check

    def close_section(totals_line):
        printed = [money(t) for t in totals_line.split() if NUM_RE.match(t)]
        printed = [p for p in printed if p is not None]
        if len(printed) < 2 or not running:
            return
        got_proceeds = round(sum(r["proceeds"] for r in running), 2)
        got_cost = round(sum(r["cost_basis"] for r in running), 2)
        if abs(got_proceeds - printed[0]) > 0.02 or abs(got_cost - printed[1]) > 0.02:
            mismatches.append(
                f"{filename}: parsed {len(running)} row(s) summing to "
                f"{got_proceeds:.2f}/{got_cost:.2f} but the form prints "
                f"{printed[0]:.2f}/{printed[1]:.2f}"
            )

    for page in pdf.pages:
        text = page.extract_text() or ""
        flat = re.sub(r"\s+", "", text)
        # The 1099-DA digital-asset section is laid out identically. Only the form
        # marker distinguishes them, so a page that names 1099-DA and not 1099-B
        # is skipped whole rather than filtered row by row.
        if "1099-DA" in flat and "1099-B" not in flat:
            section = None
            continue
        for raw in text.split("\n"):
            line = raw.strip()
            if not line:
                continue
            match = SECTION_RE.search(line)
            if match:
                section = [match.group(1).title(), match.group(2).title(), ""]
                security = None
                running = []
                continue
            box = BOX_RE.search(line)
            if box and section:
                section[2] = f"Box {box.group(2).upper()}"
                continue
            if section is None:
                continue
            totals = TOTALS_RE.match(line)
            if totals:
                close_section(totals.group(1))
                running = []
                security = None
                continue
            if "CUSIP:" in line and "Symbol:" in line:
                found = SECURITY_RE.match(line)
                if found:
                    security = {
                        "description": " ".join(found.group("desc").split()),
                        "cusip": found.group("cusip") or "",
                        "symbol": found.group("symbol") or "",
                        "note": (found.group("note") or "").strip(),
                    }
                continue
            parsed = parse_1099b_row(line)
            if parsed:
                parsed.update(
                    {
                        "term": section[0],
                        "covered_status": section[1],
                        "form_8949_box": section[2],
                        "description": (security or {}).get("description", ""),
                        "cusip": (security or {}).get("cusip", ""),
                        "symbol": (security or {}).get("symbol", ""),
                        "source": filename,
                    }
                )
                rows.append(parsed)
                running.append(parsed)
            elif rows and running and not line.startswith("*"):
                # The additional-information column wraps onto its own line
                # (`3- Proceeds from collectibles [X]` then `Sale`). Losing the
                # continuation loses the reason a lot is treated specially.
                extra = " ".join(line.split())
                if extra and len(extra) < 80 and not extra[0].isdigit():
                    prev = running[-1]
                    prev["additional_info"] = "; ".join(
                        p for p in [prev["additional_info"], extra] if p
                    )
    return rows, mismatches


def summarize_tax_doc(path):
    with pdfplumber.open(path) as pdf:
        first_text = pdf.pages[0].extract_text() or ""
        year_match = re.search(r"\b(20\d{2})\b", first_text)
        rows, mismatches = parse_1099b(pdf, path.name)
        proceeds = round(sum(r["proceeds"] for r in rows), 2)
        cost = round(sum(r["cost_basis"] for r in rows), 2)
        return {
            "name": f"tax_doc:{path.stem}",
            "category": "us_tax_document_pdf",
            "filename": path.name,
            "path": str(path),
            "account_hint": "",
            "pages": len(pdf.pages),
            # Used to be the page count, which read as a row count on the evidence
            # page and made five forms look like they held 54 rows of data.
            "row_count": len(rows),
            "metrics": {
                "tax_year_hint": year_match.group(1) if year_match else "",
                "form_1099b_rows": len(rows),
                "form_1099b_proceeds_usd": proceeds,
                "form_1099b_cost_basis_usd": cost,
                "form_1099b_gain_loss_usd": round(sum(r["gain_loss"] for r in rows), 2),
                # A form with no sales is a real answer, not a missing one: it is
                # what lets the tax page say a year was checked and had none.
                "form_1099b_status": "rows parsed" if rows else "no 1099-B sales",
                "form_1099b_totals_mismatches": mismatches,
            },
            "form_1099b": rows,
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
