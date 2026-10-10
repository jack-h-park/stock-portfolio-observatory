"""Which 미래에셋 account a document belongs to: its FULL 계좌번호, in the account map.

One rule, shared by the filer (scripts/file-downloads.py) and the extractors
(scripts/extract-kr-statements.py, scripts/extract-bank-statements.py):

- An account is identified only by its full account number matching an entry in
  the gitignored account map. The numbers are private and this repository is
  public, so the map is the only place they live.
- Never by the last four digits. Several 미래에셋 accounts share them: the
  종합_CMA and the 종합 brokerage account do, and a CMA certificate sat filed
  under the 종합 account for months because of it.
- Never by the printed 계좌유형 alone. A second 종합 account prints the same
  계좌유형 as the first, and labelling by type merges the two. 계좌유형 is only
  checked against the map's kind, and a contradiction is refused.

The map entries a document can match:

- `brokerageAccounts`: `{"institution": "mirae", "accountNumber", "kind": "isa" | "general" | "gold"}`
- `bankAccounts`: `{"institution": "mirae", "kind": "cma", "accountNumber", "alias"}`
- `pensionAccounts`: `{"token": "irp", "accountNumber", "wrapper": "irp", "institution": "미래에셋증권", ...}`

Any of them may carry a `label`, which wins. Without one the label is the kind's
default below (a CMA's is its `alias`, the IRP's its pensionAccounts `account`),
which is what the data has always been keyed by. Two accounts of one kind therefore need distinct labels, and a pair
that resolves to one label is a collision: it is refused, never merged.

Messages show a number as `***-**-****1234`: the last four only.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

DEFAULT_LABELS = {
    "general": "미래에셋증권(종합)",
    "isa": "미래에셋증권(ISA)",
    "gold": "미래에셋증권(금현물)",
    "irp": "미래에셋증권(IRP)",
    "cma": "미래에셋 CMA",
}
BROKERAGE_KINDS = ("isa", "general", "gold")
# What each kind prints as 계좌유형, for messages.
PRINTED_TYPES = {"general": "종합", "isa": "ISA", "gold": "금현물", "irp": "퇴직연금_개인IRP", "cma": "종합_CMA"}
MIRAE_INSTITUTIONS = ("mirae", "미래에셋증권")


def _spaced(label):
    """A regex for `label` that tolerates the letter-spacing 미래에셋 prints."""
    return r"\s*".join(re.escape(ch) for ch in label)


# `상대계좌번호` is the counterparty's account, a column of the transaction table.
# A number that runs into a mask (`123-45-****`) is not a full number at all.
_NUMBER = r"(\d[\d-]*\d)(?![-\d*])"
NUMBER_RE = re.compile(r"(?<!상대)(?<!상대\s)" + _spaced("계좌번호") + r"\s*:?\s*" + _NUMBER)
# A 잔고증명서 cover prints the labels on one line and the values under them.
BALANCE_COVER_RE = re.compile(_spaced("계좌번호계좌명부기명실명확인번호") + r"\s*" + _NUMBER)


def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def mask(number):
    """`***-**-****1234`: the only form a number is ever shown in."""
    return f"***-**-****{digits(number)[-4:]}"


def account_numbers(texts):
    """Every full 계좌번호 printed in `texts`, digits only, one item per occurrence."""
    found = []
    for text in texts:
        text = unicodedata.normalize("NFC", text or "")
        found.extend(digits(m.group(1)) for m in NUMBER_RE.finditer(text))
    return found


def balance_cover_numbers(text):
    """The 계좌번호 under a 잔고증명서 cover's `계좌번호 계좌명 부기명 실명확인번호` line."""
    text = unicodedata.normalize("NFC", text or "")
    return [digits(m.group(1)) for m in BALANCE_COVER_RE.finditer(text)]


def type_kind(account_type):
    """The kind a printed 계좌유형 names, or None. Only ever a consistency check."""
    account_type = re.sub(r"\s+", "", unicodedata.normalize("NFC", account_type or ""))
    if re.search(r"IRP|퇴직연금", account_type, re.I):
        return "irp"
    if "금현물" in account_type:
        return "gold"
    if "ISA" in account_type.upper():
        return "isa"
    # `종합_CMA` before `종합`: the CMA prints both.
    if "CMA" in account_type.upper():
        return "cma"
    if "종합" in account_type:
        return "general"
    return None


def load_map(path):
    """(map, problem). No file is (None, None): CI and sample mode have none."""
    path = Path(path)
    if not path.exists():
        return None, None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return None, f"the account map {path.name} could not be read ({type(error).__name__})"
    if not isinstance(raw, dict):
        return None, f"the account map {path.name} is not a JSON object"
    return raw, None


def _list(account_map, key):
    entries = (account_map or {}).get(key) or []
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def entries(account_map):
    """Every 미래에셋 account the map declares with a full number: dicts of number, kind, label, section."""
    out = []
    for entry in _list(account_map, "brokerageAccounts"):
        if entry.get("institution") == "mirae" and entry.get("kind") in BROKERAGE_KINDS and digits(entry.get("accountNumber")):
            out.append({"number": digits(entry["accountNumber"]), "kind": entry["kind"],
                        "label": entry.get("label") or DEFAULT_LABELS[entry["kind"]], "section": "brokerageAccounts"})
    for entry in _list(account_map, "bankAccounts"):
        if entry.get("institution") == "mirae" and entry.get("kind") == "cma" and digits(entry.get("accountNumber")):
            out.append({"number": digits(entry["accountNumber"]), "kind": "cma",
                        "label": entry.get("label") or entry.get("alias") or DEFAULT_LABELS["cma"], "section": "bankAccounts"})
    for entry in _list(account_map, "pensionAccounts"):
        if (entry.get("wrapper") == "irp" and entry.get("institution") in MIRAE_INSTITUTIONS
                and digits(entry.get("accountNumber"))):
            out.append({"number": digits(entry["accountNumber"]), "kind": "irp",
                        "label": entry.get("label") or entry.get("account") or DEFAULT_LABELS["irp"],
                        "section": "pensionAccounts"})
    return out


def find(account_map, number):
    """(entry, problem): the one map entry for this full number, or None if there is none."""
    number = digits(number)
    found = [e for e in entries(account_map) if e["number"] == number]
    if len({(e["kind"], e["label"]) for e in found}) > 1:
        where = ", ".join(sorted(f"{e['section']} ({e['kind']})" for e in found))
        return None, f"the account map lists {mask(number)} more than once, as different accounts: {where}"
    return (found[0] if found else None), None


def label_collisions(account_map):
    """(messages, numbers): accounts that would merge under one label, and their numbers."""
    by_label = {}
    for entry in entries(account_map):
        by_label.setdefault(entry["label"], {})[entry["number"]] = entry
    messages, numbers = [], set()
    for label, accounts in sorted(by_label.items()):
        if len(accounts) < 2:
            continue
        numbers.update(accounts)
        shown = ", ".join(f"{mask(n)} ({e['kind']})" for n, e in sorted(accounts.items()))
        messages.append(
            f"{shown} would all be labelled {label}; give each a distinct `label` "
            "in the account map rather than merging them"
        )
    return messages, numbers


def remedy(kind, number):
    """The map entry to add for an unknown number, naming only its last four digits."""
    placeholder = f"<the full 계좌번호 ending {digits(number)[-4:]}>" if digits(number) else "<계좌번호>"
    where = "in the account map (data/accounts.local.json)"
    if kind == "cma":
        return (f'add {{"institution": "mirae", "kind": "cma", "accountNumber": "{placeholder}", '
                f'"currency": "KRW", "alias": "<name>"}} to bankAccounts {where}')
    if kind == "irp":
        return f'add "accountNumber": "{placeholder}" to the IRP entry in pensionAccounts {where}'
    if kind in BROKERAGE_KINDS:
        return (f'add {{"institution": "mirae", "accountNumber": "{placeholder}", "kind": "{kind}"}} '
                f"to brokerageAccounts {where}")
    return (f'add {{"institution": "mirae", "accountNumber": "{placeholder}", "kind": "isa", "general" or "gold"}} '
            f'to brokerageAccounts, or {{"institution": "mirae", "kind": "cma", "accountNumber": ...}} '
            f"to bankAccounts, {where}")
