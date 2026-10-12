# American Express Checking Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the monthly American Express (Amex) Rewards Checking statement PDFs as a bank source, so the account's balances reach `cash_balances` and its credits reach `bank_inflows`, and (phase B) so transfers between Amex and the other USD accounts on file stop needing one hand-written rule per counterparty.

**Architecture:** One new family in the existing bank pipeline. The filer (`scripts/file-downloads.py`) recognises the statement by its printed layout, names it `amex-checking-<last4>-<from>-<to>.pdf` from the dates the statement declares, and files it under `bank-statements/`. The extractor (`scripts/extract-bank-statements.py`) parses the text table, refuses a statement whose rows disagree with its own summary box, and emits balances (printed after every row) plus every credit as an inflow. Phase B adds an evidence-gated pass that marks equal and opposite USD rows between two accounts on file as `ownTransfer`.

**Tech Stack:** Python 3 (pdfplumber, already a dependency), Node 24 test runner (`tsx --test`), TypeScript for the two small `lib/` lists.

**Spec:** none beyond the task brief of the session that produced this file. Facts about the statement layout were read from three real statements on the maintainer's machine; nothing from them is reproduced here. Every name, number, date and amount in this plan and in its fixtures is invented.

## Global Constraints

- The repository is PUBLIC. No real name, account number, last four digits, amount, date or counterparty from the maintainer's statements may appear in code, fixtures, docs, commits, PR text or this plan. Fixtures use `Example Holder`, last4 `0042`, `EXAMPLE CO PAYROLL`, `EXAMPLE BANK`, dates in 2025 and round invented amounts.
- Repo text (docs, comments, commit messages, PR bodies) is English only; no quoting of the maintainer's own words.
- PR and commit text describes effects, never amounts or dates from the maintainer's data.
- Never run a command on the ops host (`ssh ops-host`, and `push-sources`, which writes to it) without the user confirming that exact command first, diagnostics included. Nothing under "Rollout" runs without that.
- No edits in the ops host's checkout: tracked files change by PR.
- Tests need Node 24: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`. In a `.claude/worktrees` checkout `pnpm lint` and the dev server do not work (see the project memory `worktree-lint-and-env`); use `pnpm test` and `pnpm typecheck`.
- In this Bash tool use `command grep -a ...` (the shell `grep` skips files with a NUL byte and gitignored paths silently).
- Source files use ASCII slugs, or the extractors skip them silently.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not add a `Portfolio-Impact:` trailer unless the live portfolio page section was read and already says what the commit says.
- Work happens in the worktree `peaceful-perlman-b7c2c7` (branch `claude/peaceful-perlman-b7c2c7`). When the work is merged, invoke `superpowers:finishing-a-development-branch` before ending the turn.

## What the statements look like (facts established, values withheld)

- Text PDFs, two pages, **encrypted with an empty user password** (RC4). `pdfplumber.open(path)` opens them with no password, and both `file-downloads.py::_open_pdf` and `extract-kr-statements.py::open_pdf` try that first, so `STOCK_PDF_PASSWORD` is not needed. (The docstring of `_pdf_lines` in the extractor says "The statements are not encrypted"; Task 1 corrects it.)
- Title `American Express® Rewards Checking Statement`; a line `Statement Date: MM/DD/YYYY Account Ending: *NNNN Account Name: Rewards Checking`.
- Summary box: `Beginning Balance as of MM/DD/YYYY $X`, `Total Credits This Period $X`, `Total Debits This Period -$X` (negative when non-zero, `$0.00` when none), `Ending Balance as of MM/DD/YYYY $X`, `Interest Earned This Period $X`. A first statement can cover only a couple of days and hold no transactions; the period is whatever the "as of" dates say, not a calendar month.
- Table header `Date Description Credits Debits Balance`. Every row prints its amount and then the balance after it; **debits carry a leading minus, credits do not**, so the sign is explicit and no column geometry is needed. The first row is `Beginning Balance $X` and the last is `Ending Balance $X` (one money token, no amount).
- A description wraps onto further lines; the last wrapped line of a transaction is `ID <digits>` (a bank reference). Page 1 of a long statement ends with `Continued on next page` followed by a footer block starting `Account Details Contact Us`; page 2 repeats a name line, `p. 2/2`, a `Statement Date:` line and the table header. The text before `Important Notice` on the last page is the table's tail.
- Descriptions seen: `Online Transfer / Payment: Debit|Credit` with the originator or beneficiary on following lines, a card-payment ACH line, `Robinhood Money Payment`, a peer payment line, an incentive payment, and `Interest Deposit`. Credit descriptions may contain the holder's own name and masked account fragments; they stay in the private database like every other bank description.
- Classification consequences with no code change: `Interest Deposit` matches `BANK_INTEREST_RE` (`INTEREST`, case-insensitive) so it is `interest`. An employer credit and an incentive credit stay `unclassified` until `bankInflowRules` entries are added to the laptop's untracked `data/manual-mappings.json` (rollout step 4). The card-payment and peer-payment rows are debits and never reach `bank_inflows`.

## Decisions

1. **Filer.** New detector `detect_amex_checking`. Recognised by `American Express` + `Statement Summary` + the table header on page 1. Name `amex-checking-<last4>-<from>-<to>.pdf`, with `<last4>` from `Account Ending: *NNNN` and `<from>`/`<to>` from the summary's `Beginning Balance as of` / `Ending Balance as of` dates, written as the explicit window (the BoA shape), never as an as-of: a statement states exactly the coverage it has, and the as-of form lets a later file supersede it. The account resolves through the account map by `institution: "amex"` and `last4`: an entry whose `kind` is not `checking` refuses the file; **an absent entry does not refuse** (unlike 토스뱅크, the statement prints only four digits, and a single missing alias only means the account is named `amex <last4>`), and the evidence line says to add an entry. An `Account Name` that is not a checking account (a savings product, say) is refused with the printed name, because no such statement has been seen and guessing its layout would write wrong balances.
2. **Parser.** `parse_amex_lines(lines)` reads the summary and the rows; `parse_amex(path, findings, notes)` validates and returns rows or `None`. Rows keep the printed balance, so the account is not `derived` and the existing `continuity_breaks` covers rows within and across statements (a Beginning Balance row is a zero-amount row, so it must equal the previous statement's closing balance). A statement is **refused whole, with a finding** when any of these disagree: opening + credits + debits vs closing; the table's first/last balance vs the summary; the sum of credit rows and of debit rows vs the totals; the sum of `Interest Deposit` rows vs `Interest Earned This Period`; the printed `Account Ending` vs the file name's last4. Beginning/Ending Balance rows are kept as zero-amount rows so a statement with no transactions still produces balances and never trips "parsed to zero rows".
3. **Family.** `("amex-checking-", "amex", "checking", "USD", parse_amex, r"^amex-checking-(\d{4})-")`: keyed by last4 like 토스뱅크, named by the map entry's `alias` or `amex <last4>`. `kind` stays inside the ingest's allowed set (`checking`). Two places keep the same naming rule in step and both need `amex`: `LAST4_INSTITUTIONS` in `lib/bank-accounts.ts`, and `US_CASH_INSTITUTIONS` in `lib/fbar.ts`.
4. **FBAR.** The brief says the FBAR maximum-balance table misses the account. It should: FBAR/8938 lists *foreign* accounts, and `lib/fbar.ts` decides that with a hard-coded list of US cash institutions. An `amex` institution that is **not** on that list would be reported as a foreign account, which is wrong. `amex` is added to `US_CASH_INSTITUTIONS`, so the account counts in total assets (`cash_balances`) and stays out of FBAR. This is a correction to the brief's expectation, flagged for the user in the hand-off.
5. **USD pairing: yes, narrowly, as a second PR after the source lands.** `pair_transfers` only pairs KRW. Add `pair_usd_transfers` that marks a credit and a debit `ownTransfer` when all hold: both USD; different accounts; equal and opposite to the cent; dates within **3 days in either direction** (a receiving account can post the credit a day before the sending account's debit date); and **at least one of the two descriptions names the other row's institution** (a small word table). Amount-and-date alone is refused as evidence: a peer payment of the same size as an unrelated credit inside three days is common, and marking it would hide real income. One-to-one, nearest date first. Existing hand-written `transfer` rules are **kept**: the pairing only fires when the other leg's statement is on file, and the Amex statement arrives monthly, so a rule keeps a fresh Robinhood credit classified in the weeks before it does. A rule becomes redundant only in the sense that the pairing wins first (`ownTransfer` short-circuits the matcher; the row's `rule` is null). Retiring a rule is a separate, deliberate edit, not part of this plan. Phase B ships behind a before/after diff on real data (Task 7).
6. **Not doing:** no new inflow `counterparty` parsing (the description holds it and `descriptionIncludes` already matches it); no handling of non-checking Amex products; no change to the KRW pairing; no automatic removal of rules; no unpaired-outflow report.

## Review Focus

Failure modes the brief implies but no single task's happy path exercises, most likely first. Each has a test in the task named.

1. A statement with **no transactions** (a quiet or first month): it must still write balances for its days, not a "parsed to zero rows" finding and not a missing account. (Task 2)
2. A description that **wraps across the page break**: it must stay one row with its continuation, and the repeated header and the name/`p. 2/2` lines must not leak into it. (Task 1)
3. The **same statement downloaded twice** (a re-download under a numbered name): inflows and balances must count once. (Task 2)
4. A **domestic account must not appear in FBAR**, while still counting in total assets and being named by its alias. (Task 4)
5. A statement whose **rows disagree with its own summary**, or whose file name carries a different last4 than the one printed: skipped with a finding that names the file, never read partially. (Task 1, Task 2)

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `scripts/extract-bank-statements.py` | modify | `parse_amex_lines`, `amex_problems`, `parse_amex`, FAMILIES entry; phase B `pair_usd_transfers` and its call in `main` |
| `scripts/file-downloads.py` | modify | `detect_amex_checking` and its `DETECTORS` row |
| `lib/fbar.ts` | modify | `amex` in `US_CASH_INSTITUTIONS` |
| `lib/bank-accounts.ts` | modify | `amex` in `LAST4_INSTITUTIONS` |
| `tests/amex-fixtures.ts` | create | invented statements, the pdfplumber stub, `runExtract` |
| `tests/amex-checking.test.ts` | create | parser, extractor end-to-end, filer |
| `tests/fbar.test.ts` | modify | domestic list and naming rule |
| `tests/bank-inflows-ingest.test.ts` | modify | an Amex-shaped interest credit classifies as `interest` |
| `tests/usd-transfer-pairing.test.ts` | create (phase B) | the pairing function and one end-to-end case |
| `docs/data-sources.md` | modify | naming table, deposit description, inflow gaps, pairing |
| `data/accounts.local.example.json` | modify | an `amex` `bankAccounts` example |

---

# Phase A — the Amex source

### Task 1: Parse the statement text

**Files:**
- Modify: `scripts/extract-bank-statements.py` (insert a block immediately before `FAMILIES = [`; correct the `_pdf_lines` docstring at `scripts/extract-bank-statements.py:346`)
- Create: `tests/amex-fixtures.ts`
- Create: `tests/amex-checking.test.ts`

**Interfaces:**
- Produces: `parse_amex_lines(lines: list[str]) -> (summary: dict, rows: list[dict])` where `summary` has keys `last4, begin_date, begin, end_date, end, credits, debits, interest` (`None` when not found) and each row is `{"date": "YYYY-MM-DD", "seq": int, "description": str, "amount": float, "balance": float, "marker": bool}`; `amex_problems(summary, rows) -> list[str]`; `parse_amex(path, findings, notes=None) -> list[dict] | None` (rows without the `marker` key, `None` after appending one finding).
- Produces (tests): `tests/amex-fixtures.ts` exports `HOLDER`, `MAP`, `amexPages(options)`, `STATEMENT_FEB`, `STATEMENT_MAR`, `STATEMENT_APR`, `runExtract(files, map?)`.

- [ ] **Step 1: Write the fixtures module**

Create `tests/amex-fixtures.ts`:

```ts
// Invented American Express checking statements for the extractor and filer tests.
// Every name, number, date and amount is made up; the repository is public.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const PY = process.env.STOCK_PYTHON_BIN || 'python3'
export const HOLDER = 'Example Holder'

export const MAP = {
  bankAccounts: [{ institution: 'amex', kind: 'checking', currency: 'USD', last4: '0042', alias: 'Example Amex checking' }],
}

export type AmexOptions = {
  last4?: string
  name?: string
  begin: [string, string]
  end: [string, string]
  credits: string
  debits: string
  interest: string
  rows: string[]
  /** How many of `rows` stay on page 1; the rest follow the repeated header on page 2. */
  split?: number
}

/** The text pdfplumber reads off each page of a statement shaped like the real one. */
export function amexPages(o: AmexOptions): string[] {
  const split = o.split ?? o.rows.length
  const continued = split < o.rows.length
  const stamp = `Statement Date: ${o.end[0]} Account Ending: *${o.last4 ?? '0042'} Account Name: ${o.name ?? 'Rewards Checking'}`
  const head = [
    'American Express® Rewards Checking Statement', 'p. 1/2', HOLDER, stamp,
    'Statement Summary Interest Summary',
    `Beginning Balance as of ${o.begin[0]} ${o.begin[1]} Earned Period ${o.begin[0]} - ${o.end[0]}`,
    `Total Credits This Period ${o.credits} Days in Statement Period 30`,
    `Total Debits This Period ${o.debits} Interest Rate 1.00%`,
    `Ending Balance as of ${o.end[0]} ${o.end[1]} Annual Percentage Yield Earned 1.00%`,
    `Interest Earned This Period ${o.interest}`, 'Interest Paid This Year $0.00',
    'Account Activity', 'Date Description Credits Debits Balance',
  ]
  const footer = ['Account Details Contact Us', HOLDER, '1 EXAMPLE STREET', 'EXAMPLE CITY ST 00000', 'Accounts offered by Example National Bank. Member FDIC.']
  const notice = ['Important Notice', 'In Case of Errors or Questions About Your Electronic Transfers:', 'Accounts offered by Example National Bank. Member FDIC.']
  const page1 = [...head, ...o.rows.slice(0, split), ...(continued ? ['Continued on next page'] : []), ...footer]
  const page2 = [HOLDER, 'p. 2/2', stamp, ...(continued ? ['Date Description Credits Debits Balance', ...o.rows.slice(split)] : []), ...notice]
  return [page1.join('\n'), page2.join('\n')]
}

// February: no transactions, a balance carried through (a quiet month).
export const STATEMENT_FEB: AmexOptions = {
  begin: ['02/01/2025', '$1,000.00'], end: ['02/28/2025', '$1,000.00'],
  credits: '$0.00', debits: '$0.00', interest: '$0.00',
  rows: ['02/01/2025 Beginning Balance $1,000.00', '02/28/2025 Ending Balance $1,000.00'],
}

// March: an employer credit with a wrapped description, a debit whose description
// wraps four lines, a peer payment, and interest. 1,000 + 1,501.12 - 325 = 2,176.12.
export const STATEMENT_MAR: AmexOptions = {
  begin: ['03/01/2025', '$1,000.00'], end: ['03/31/2025', '$2,176.12'],
  credits: '$1,501.12', debits: '-$325.00', interest: '$1.12',
  rows: [
    '03/01/2025 Beginning Balance $1,000.00',
    '03/05/2025 Online Transfer / Payment: Credit $1,500.00 $2,500.00',
    'EXAMPLE CO PAYROLL',
    '*****0001 XXXX0002 Example Holder',
    'External - EXAMPLE BANK, N.A.',
    'ID 000000000000001',
    '03/12/2025 Online Transfer / Payment: Debit -$250.00 $2,250.00',
    'Robinhood Money Payment *****0003',
    'EXAMPLE HOLDER External - EXAMPLE',
    'CREDIT UNION',
    'ID 000000000000002',
    '03/20/2025 Zelle Payment To -$75.00 $2,175.00',
    'EXAMPLE FRIEND',
    'ID 000000000000003',
    '03/31/2025 Interest Deposit $1.12 $2,176.12',
    'ID 000000000000004',
    '03/31/2025 Ending Balance $2,176.12',
  ],
}

// April: an incentive credit and interest; no debits. 2,176.12 + 301.40 = 2,477.52.
export const STATEMENT_APR: AmexOptions = {
  begin: ['04/01/2025', '$2,176.12'], end: ['04/30/2025', '$2,477.52'],
  credits: '$301.40', debits: '$0.00', interest: '$1.40',
  rows: [
    '04/01/2025 Beginning Balance $2,176.12',
    '04/15/2025 Customer Incentive Payment $300.00 $2,476.12',
    'ID 000000000000005',
    '04/30/2025 Interest Deposit $1.40 $2,477.52',
    'ID 000000000000006',
    '04/30/2025 Ending Balance $2,477.52',
  ],
}

// pdfplumber replaced by a stub that reads page text from a JSON fixture, as in
// tossbank-pdf.test.ts and bank-inflows-extract.test.ts.
const PDFPLUMBER_STUB = `
import builtins, json

class _Page:
    def __init__(self, data):
        self._data = data
    def extract_text(self):
        return self._data.get("text", "")
    def extract_tables(self):
        return []

class _Pdf:
    def __init__(self, data):
        self.pages = [_Page(p) for p in data["pages"]]
        self.metadata = {}
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def close(self):
        pass

def open(path, password=None):
    with builtins.open(path, encoding="utf-8") as fh:
        return _Pdf(json.load(fh))
`

/**
 * Run scripts/extract-bank-statements.py over files written into bank-statements/.
 * A `string[]` value is a PDF (its page texts, read through the stub); a `string`
 * value is a text file (a CSV) written as is.
 */
export function runExtract(files: Record<string, string | string[]>, map: object = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'amex-extract-'))
  const stub = path.join(dir, 'stub')
  mkdirSync(stub)
  writeFileSync(path.join(stub, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  mkdirSync(path.join(dir, 'bank-statements'))
  for (const [name, body] of Object.entries(files)) {
    const text = typeof body === 'string' ? body : JSON.stringify({ pages: body.map((t) => ({ text: t })) })
    writeFileSync(path.join(dir, 'bank-statements', name), text, 'utf8')
  }
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dir, 'bank-balances.json')
  const result = spawnSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stub, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_ALLOW_NO_ACCOUNT_MAP: '', STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `bank extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}
```

- [ ] **Step 2: Write the failing parser tests**

Create `tests/amex-checking.test.ts`:

```ts
// American Express Rewards Checking statements: the extractor and the filer.
// Every name, number and amount is invented; the repository is public.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { amexPages, PY, ROOT, STATEMENT_APR, STATEMENT_FEB, STATEMENT_MAR } from './amex-fixtures'

const LOAD = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
lines = [line for page in pages for line in page.split("\\n")]
`
const py = (pages: string[], body: string) =>
  JSON.parse(execFileSync(PY, ['-I', '-c', LOAD + body, JSON.stringify(pages)], { cwd: ROOT, encoding: 'utf8' }))

test('a statement is read into a summary and one row per printed line of the table, markers included', () => {
  const r = py(amexPages(STATEMENT_MAR), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"summary": summary, "rows": rows, "problems": m.amex_problems(summary, rows)}))`)
  assert.deepEqual(r.summary, {
    last4: '0042', begin_date: '2025-03-01', begin: 1000, end_date: '2025-03-31', end: 2176.12,
    credits: 1501.12, debits: -325, interest: 1.12,
  })
  assert.deepEqual(r.rows.map((t: any) => [t.date, t.amount, t.balance, t.marker]), [
    ['2025-03-01', 0, 1000, true],
    ['2025-03-05', 1500, 2500, false],
    ['2025-03-12', -250, 2250, false],
    ['2025-03-20', -75, 2175, false],
    ['2025-03-31', 1.12, 2176.12, false],
    ['2025-03-31', 0, 2176.12, true],
  ])
  assert.deepEqual(r.problems, [])
})

test('a wrapped description is one string, the bank reference line is dropped, and no page furniture leaks in', () => {
  const r = py(amexPages(STATEMENT_MAR), `
rows = m.parse_amex_lines(lines)[1]
print(json.dumps([t["description"] for t in rows]))`)
  assert.deepEqual(r, [
    'Beginning Balance',
    'Online Transfer / Payment: Credit EXAMPLE CO PAYROLL *****0001 XXXX0002 Example Holder External - EXAMPLE BANK, N.A.',
    'Online Transfer / Payment: Debit Robinhood Money Payment *****0003 EXAMPLE HOLDER External - EXAMPLE CREDIT UNION',
    'Zelle Payment To EXAMPLE FRIEND',
    'Interest Deposit',
    'Ending Balance',
  ])
})

test('a description that wraps across the page break is still one row', () => {
  // Page 1 ends after "EXAMPLE HOLDER External - EXAMPLE"; page 2 repeats its header and continues with "CREDIT UNION".
  const r = py(amexPages({ ...STATEMENT_MAR, split: 9 }), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"descriptions": [t["description"] for t in rows], "problems": m.amex_problems(summary, rows)}))`)
  assert.equal(r.descriptions[2], 'Online Transfer / Payment: Debit Robinhood Money Payment *****0003 EXAMPLE HOLDER External - EXAMPLE CREDIT UNION')
  assert.equal(r.descriptions.length, 6)
  assert.deepEqual(r.problems, [])
})

test('a statement with no transactions reads as its two balance markers and agrees with its summary', () => {
  const r = py(amexPages(STATEMENT_FEB), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"rows": [[t["date"], t["amount"], t["balance"], t["marker"]] for t in rows], "problems": m.amex_problems(summary, rows)}))`)
  assert.deepEqual(r.rows, [['2025-02-01', 0, 1000, true], ['2025-02-28', 0, 1000, true]])
  assert.deepEqual(r.problems, [])
})

test('every way the rows can disagree with the summary is named', () => {
  const bad = (rows: string[]) => py(amexPages({ ...STATEMENT_MAR, rows }), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps(m.amex_problems(summary, rows)))`)
  // A debit amount changed: the balance chain, the debit total and the closing balance no longer agree.
  const changed = STATEMENT_MAR.rows.map((r) => r.replace('-$250.00 $2,250.00', '-$251.00 $2,250.00'))
  assert.match(bad(changed).join(' | '), /credit and debit totals/)
  // A row dropped: the totals and the interest no longer add up.
  const dropped = STATEMENT_MAR.rows.filter((r) => !r.startsWith('03/31/2025 Interest Deposit') && r !== 'ID 000000000000004')
  assert.match(bad(dropped).join(' | '), /interest/)
  // No Ending Balance row: the table is cut short.
  const cut = STATEMENT_MAR.rows.slice(0, -1)
  assert.match(bad(cut).join(' | '), /Beginning\/Ending Balance rows/)
})

test('the debit sign is the printed one: a credit is never negated and "$0.00" debits read as zero', () => {
  const r = py(amexPages(STATEMENT_APR), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"debits": summary["debits"], "amounts": [t["amount"] for t in rows if not t["marker"]]}))`)
  assert.equal(r.debits, 0)
  assert.deepEqual(r.amounts, [300, 1.4])
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/amex-checking.test.ts`
Expected: FAIL with `AttributeError: module 'bank' has no attribute 'parse_amex_lines'`.

- [ ] **Step 4: Implement the parser**

In `scripts/extract-bank-statements.py`, change the `_pdf_lines` docstring (line 347) to:

```python
    """Every page's text lines. A PDF that opens with no password (an American Express checking
    statement is encrypted with an empty one) needs none; STOCK_PDF_PASSWORD is the fallback."""
```

Insert immediately before `FAMILIES = [` (currently line 898):

```python
# --- American Express checking (Rewards Checking) PDF statements ----------------
#
# One statement per period, a text PDF. The summary box prints the opening and
# closing balance, the credit and debit totals and the interest earned; the table
# prints the balance after every row, a "Beginning Balance" row and an "Ending
# Balance" row. A debit's amount carries a leading minus and a credit's does not,
# so the sign is read, never inferred from a column. A description wraps onto
# further lines; the last line of a transaction is `ID <digits>`, a bank
# reference that is dropped. A long statement continues on a second page that
# repeats the table header after a footer block.

AMEX_MONEY = r"-?\$[\d,]+\.\d{2}"
AMEX_TABLE_HEADER = "Date Description Credits Debits Balance"
AMEX_TABLE_END = ("Continued on next page", "Account Details", "Important Notice")
AMEX_ROW_RE = re.compile(rf"^(\d{{2}}/\d{{2}}/\d{{4}}) (.*?)\s*({AMEX_MONEY})(?:\s+({AMEX_MONEY}))?$")
AMEX_REFERENCE_RE = re.compile(r"^ID \d+$")
AMEX_INTEREST_RE = re.compile(r"^Interest Deposit\b")


def parse_amex_lines(lines):
    """(summary, rows) from the text lines of every page of one statement.

    Rows are the table's lines in order. A dated line with two money tokens is a
    transaction (amount, then balance); with one it is a Beginning/Ending Balance
    marker (amount 0). Lines between a row and the next dated line are its
    description; lines before the first dated row of a page continue the last row
    of the page before. The table is only what lies between its header and the
    next footer marker, so the name, `p. 2/2` and `Statement Date:` lines of a
    second page are never read as description.
    """
    text = "\n".join(lines)

    def money(label):
        found = re.search(rf"{label}\s+({AMEX_MONEY})", text)
        return _num(found.group(1)) if found else None

    begin = re.search(rf"Beginning Balance as of (\d{{2}}/\d{{2}}/\d{{4}}) ({AMEX_MONEY})", text)
    end = re.search(rf"Ending Balance as of (\d{{2}}/\d{{2}}/\d{{4}}) ({AMEX_MONEY})", text)
    last4 = re.search(r"Account Ending:\s*\*?(\d{4})\b", text)
    summary = {
        "last4": last4.group(1) if last4 else None,
        "begin_date": _mdy(begin.group(1)) if begin else None, "begin": _num(begin.group(2)) if begin else None,
        "end_date": _mdy(end.group(1)) if end else None, "end": _num(end.group(2)) if end else None,
        "credits": money("Total Credits This Period"), "debits": money("Total Debits This Period"),
        "interest": money("Interest Earned This Period"),
    }
    rows, parts, inside = [], [], False
    for raw in lines:
        line = raw.strip()
        if line == AMEX_TABLE_HEADER:
            inside = True
            continue
        if any(line.startswith(marker) for marker in AMEX_TABLE_END):
            inside = False
            continue
        if not inside or not line:
            continue
        found = AMEX_ROW_RE.match(line)
        if found:
            day, head, first, second = found.groups()
            marker = second is None
            rows.append({"date": _mdy(day), "seq": len(rows), "description": head.strip(),
                         "amount": 0.0 if marker else _num(first), "balance": _num(first if marker else second),
                         "marker": marker})
            parts.append([])
        elif rows and not AMEX_REFERENCE_RE.match(line):
            parts[-1].append(line)
    for row, extra in zip(rows, parts):
        row["description"] = " ".join([row["description"], *extra]).strip()
    return summary, rows


def amex_problems(summary, rows):
    """What the statement's own summary says is wrong with the rows read from it; [] when they agree."""
    missing = [key for key in ("begin", "end", "credits", "debits", "interest") if summary[key] is None]
    if missing:
        return [f"the summary box has no {', '.join(missing)}"]
    if not rows or not (rows[0]["marker"] and rows[-1]["marker"]):
        return ["the activity table lacks its Beginning/Ending Balance rows"]
    problems = []
    if round(summary["begin"] + summary["credits"] + summary["debits"], 2) != summary["end"]:
        problems.append("the summary's opening balance plus its credits and debits is not its closing balance")
    if rows[0]["balance"] != summary["begin"] or rows[-1]["balance"] != summary["end"]:
        problems.append("the table's Beginning/Ending Balance rows disagree with the summary")
    credits = round(sum(t["amount"] for t in rows if t["amount"] > 0), 2)
    debits = round(sum(t["amount"] for t in rows if t["amount"] < 0), 2)
    if credits != summary["credits"] or debits != summary["debits"]:
        problems.append("the rows read do not add up to the summary's credit and debit totals")
    interest = round(sum(t["amount"] for t in rows if AMEX_INTEREST_RE.match(t["description"])), 2)
    if interest != summary["interest"]:
        problems.append("the Interest Deposit rows do not add up to the summary's interest earned")
    return problems


def parse_amex(path, findings, notes=None):
    """The rows of one Amex checking statement, or None (with one finding) when it cannot be trusted."""
    summary, rows = parse_amex_lines(_pdf_lines(path))
    problems = amex_problems(summary, rows)
    named = re.match(r"^amex-checking-(\d{4})-", path.name)
    if named and summary["last4"] and named.group(1) != summary["last4"]:
        problems.append(f"the file name says last four digits {named.group(1)} but the statement prints {summary['last4']}")
    if problems:
        findings.append(f"{path.name}: {'; '.join(problems)}; skipped")
        return None
    return [{k: v for k, v in t.items() if k != "marker"} for t in rows]


```

Add to `FAMILIES` after the `mirae-cma-` entry:

```python
    # American Express Rewards Checking statements (PDF, one account per last4 in the file name).
    ("amex-checking-", "amex", "checking", "USD", lambda p, f, n: parse_amex(p, f, n), r"^amex-checking-(\d{4})-"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/amex-checking.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-bank-statements.py tests/amex-fixtures.ts tests/amex-checking.test.ts
git commit -m "feat(bank): parse American Express checking statements

Reads the summary box and the activity table, keeps the printed balance
after every row, and refuses a statement whose rows disagree with its own
summary or whose file name disagrees with the last four digits it prints.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Extractor end to end

**Files:**
- Test: `tests/amex-checking.test.ts` (append)

**Interfaces:**
- Consumes: `runExtract(files, map?)`, `STATEMENT_FEB/MAR/APR`, `amexPages`, `MAP` from `tests/amex-fixtures.ts`; the FAMILIES entry from Task 1.
- Produces: nothing new in code; this task pins behaviour of the pipeline (alias, kind, balances, inflows, dedupe, refusal).

- [ ] **Step 1: Write the tests**

Append to `tests/amex-checking.test.ts` (add `runExtract, MAP` to the fixtures import):

```ts
const FILES = {
  'amex-checking-0042-20250201-20250228.pdf': amexPages(STATEMENT_FEB),
  'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
  'amex-checking-0042-20250401-20250430.pdf': amexPages(STATEMENT_APR),
}

test('three consecutive statements are one USD checking account named by its map entry, with continuous balances', () => {
  const doc = runExtract(FILES)
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
  const a = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.currency, a.derived, a.owner], ['amex', 'Example Amex checking', 'checking', 'USD', false, 'self'])
  assert.deepEqual(a.continuityBreaks, [])
  assert.equal(a.sources.length, 3)
  assert.deepEqual(a.balances, [
    { date: '2025-02-01', balance: 1000 },
    { date: '2025-02-28', balance: 1000 },
    { date: '2025-03-01', balance: 1000 },
    { date: '2025-03-05', balance: 2500 },
    { date: '2025-03-12', balance: 2250 },
    { date: '2025-03-20', balance: 2175 },
    { date: '2025-03-31', balance: 2176.12 },
    { date: '2025-04-01', balance: 2176.12 },
    { date: '2025-04-15', balance: 2476.12 },
    { date: '2025-04-30', balance: 2477.52 },
  ])
})

test('a statement with no transactions still writes its balances and raises no finding', () => {
  const doc = runExtract({ 'amex-checking-0042-20250201-20250228.pdf': amexPages(STATEMENT_FEB) })
  assert.deepEqual(doc.findings, [])
  assert.deepEqual(doc.accounts[0].balances, [{ date: '2025-02-01', balance: 1000 }, { date: '2025-02-28', balance: 1000 }])
  assert.deepEqual(doc.inflows, [])
})

test('only credits become inflows; balance markers and debits never do, and the reference line is not in a description', () => {
  const doc = runExtract(FILES)
  assert.deepEqual(doc.inflows.map((f: any) => [f.date, f.amount, f.ownTransfer, f.institution, f.account, f.currency]), [
    ['2025-03-05', 1500, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-03-31', 1.12, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-04-15', 300, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-04-30', 1.4, false, 'amex', 'Example Amex checking', 'USD'],
  ])
  assert.ok(doc.inflows.every((f: any) => !/ID \d{6,}/.test(f.description)))
  assert.equal(doc.inflows[1].description, 'Interest Deposit')
})

test('the same statement downloaded twice counts once', () => {
  const doc = runExtract({
    'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
    'amex-checking-0042-20250301-20250331-1.pdf': amexPages(STATEMENT_MAR),
  })
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.inflows.length, 2)
  assert.deepEqual(doc.accounts[0].continuityBreaks, [])
  assert.equal(doc.accounts[0].balances.length, 5)
})

test('with no map entry the account is named amex <last4>', () => {
  const doc = runExtract({ 'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR) }, { bankAccounts: [] })
  assert.equal(doc.accounts[0].account, 'amex 0042')
  assert.equal(doc.accounts[0].kind, 'checking')
})

test('a statement that disagrees with its own summary is skipped whole, with a finding that names the file', () => {
  const tampered = { ...STATEMENT_MAR, rows: STATEMENT_MAR.rows.map((r) => r.replace('-$250.00 $2,250.00', '-$251.00 $2,250.00')) }
  const doc = runExtract({ 'amex-checking-0042-20250301-20250331.pdf': amexPages(tampered) })
  assert.deepEqual(doc.accounts, [])
  assert.deepEqual(doc.inflows, [])
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /amex-checking-0042-20250301-20250331\.pdf/)
  assert.match(doc.findings[0], /skipped/)
})

test('a file named for one last4 that prints another is skipped with a finding', () => {
  const doc = runExtract({ 'amex-checking-0099-20250301-20250331.pdf': amexPages(STATEMENT_MAR) })
  assert.deepEqual(doc.accounts, [])
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /0099/)
  assert.match(doc.findings[0], /0042/)
})

test('a statement that does not follow its predecessor is reported as a continuity break, not hidden', () => {
  const gap = { ...STATEMENT_APR, begin: ['04/01/2025', '$9,999.00'] as [string, string], rows: STATEMENT_APR.rows.map((r) => r.replace('04/01/2025 Beginning Balance $2,176.12', '04/01/2025 Beginning Balance $9,999.00')) }
  // The summary still adds up only if its own opening balance is edited too, so the file is
  // internally consistent and the break is between two statements.
  const doc = runExtract({
    'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
    'amex-checking-0042-20250401-20250430.pdf': amexPages({ ...gap, end: ['04/30/2025', '$10,300.40'], rows: gap.rows.map((r) => r.replace('$2,476.12', '$10,299.00').replace('$2,477.52', '$10,300.40')) }),
  })
  assert.equal(doc.accounts[0].continuityBreaks.length > 0, true)
})
```

Self-check on the last fixture before running: 9,999.00 + 301.40 = 10,300.40 ✓; the incentive row balance becomes 9,999.00 + 300.00 = 10,299.00 ✓; the interest row 10,299.00 + 1.40 = 10,300.40 ✓.

- [ ] **Step 2: Run the tests**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/amex-checking.test.ts`
Expected: PASS. (Task 1 already carries the behaviour; these tests are expected to pass on the first run. If one fails, the failure is a real defect in Task 1, not in the test: fix the code, never the expectation.)

- [ ] **Step 3: Add the ingest classification test**

Append to `tests/bank-inflows-ingest.test.ts`:

```ts
test('an Amex-shaped interest credit is interest by default and an incentive credit waits for a rule', () => {
  const db = ingestBank(
    {
      accounts: [], estimatedAccounts: [], findings: [], notes: [],
      inflows: [
        inflow('amex', 'Example Amex checking', 'USD', '2025-03-31', 1.12, 'Interest Deposit'),
        inflow('amex', 'Example Amex checking', 'USD', '2025-04-15', 300, 'Customer Incentive Payment'),
      ],
    },
    { ...MAPPINGS, bankInflowRules: [] },
  )
  const rows = db.prepare('select description, category from bank_inflows order by date').all() as any[]
  assert.deepEqual(rows.map((r) => [r.description, r.category]), [
    ['Interest Deposit', 'interest'],
    ['Customer Incentive Payment', 'unclassified'],
  ])
})
```

- [ ] **Step 4: Run it**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/bank-inflows-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/amex-checking.test.ts tests/bank-inflows-ingest.test.ts
git commit -m "test(bank): Amex checking through the extractor and the inflow classifier

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The filer

**Files:**
- Modify: `scripts/file-downloads.py` (add the detector after `detect_tossbank_pdf`, ~line 1826; add one row to `DETECTORS`, ~line 2102)
- Test: `tests/amex-checking.test.ts` (append)

**Interfaces:**
- Consumes: `Document.page_text(index)`, `account_map_list("bankAccounts")`, `parse_mdy`, `compact`, `iso`, `Plan`, `Refusal`, `DIR_BANK`.
- Produces: `detect_amex_checking(doc) -> Plan | Refusal | None`; plan name `amex-checking-<last4>-<YYYYMMDD>-<YYYYMMDD>.pdf` in `bank-statements`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/amex-checking.test.ts` (add `mkdtempSync, writeFileSync` from `node:fs`, `tmpdir` from `node:os`, `path`, and `HOLDER, MAP` from the fixtures):

```ts
function detect(detector: string, pages: string[], map: object = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'amex-filer-'))
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const program = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('filer', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
class Doc:
    path = Path('statement.pdf')
    suffix = '.pdf'
    def page_text(self, i):
        return pages[i] if i < len(pages) else ''
out = getattr(m, sys.argv[2])(Doc())
if out is None:
    print(json.dumps(None))
elif isinstance(out, m.Plan):
    print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence}))
else:
    print(json.dumps({'reason': out.reason, 'remedy': out.remedy}))
`
  return JSON.parse(execFileSync(PY, ['-c', program, JSON.stringify(pages), detector], { cwd: ROOT, env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: mapPath }, encoding: 'utf8' }))
}

test('the filer names a statement by its last four digits and the window its summary declares', () => {
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR))
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250301-20250331.pdf')
  assert.ok(out.evidence.some((e: string) => /2025-03-01/.test(e) && /2025-03-31/.test(e)))
  assert.doesNotMatch(JSON.stringify(out), new RegExp(HOLDER))
})

test('a quiet statement is named by its declared window too, not as a year-to-date', () => {
  const out = detect('detect_amex_checking', amexPages({ ...STATEMENT_FEB, begin: ['01/01/2025', '$1,000.00'], end: ['02/28/2025', '$1,000.00'] }))
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250101-20250228.pdf')
})

test('an unmapped last4 is still filed, and the evidence says which entry to add', () => {
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR), { bankAccounts: [] })
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250301-20250331.pdf')
  assert.ok(out.evidence.some((e: string) => /bankAccounts/.test(e)))
})

test('a mapped entry that is not a checking account refuses the file', () => {
  const map = { bankAccounts: [{ institution: 'amex', kind: 'savings', currency: 'USD', last4: '0042', alias: 'Example Amex savings' }] }
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR), map)
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /savings/)
})

test('an Amex statement for a product that is not checking is refused, naming the printed product', () => {
  const out = detect('detect_amex_checking', amexPages({ ...STATEMENT_MAR, name: 'High Yield Savings' }))
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /High Yield Savings/)
})

test('a statement with no declared window or no last four digits is refused, not guessed', () => {
  const noWindow = amexPages(STATEMENT_MAR).map((t) => t.replace(/Beginning Balance as of \S+ \$[\d,.]+/, 'Beginning Balance'))
  assert.match(detect('detect_amex_checking', noWindow).reason, /period/)
  const noLast4 = amexPages(STATEMENT_MAR).map((t) => t.replace('Account Ending: *0042', 'Account Ending:'))
  assert.match(detect('detect_amex_checking', noLast4).reason, /last four/)
})

test('documents that are not an Amex checking statement are not claimed, and the 토스뱅크 and 빗썸 detectors leave it alone', () => {
  assert.equal(detect('detect_amex_checking', ['Some other bank statement\nDate Description Amount Balance']), null)
  const pages = amexPages(STATEMENT_MAR)
  assert.equal(detect('detect_tossbank_pdf', pages), null)
  assert.equal(detect('detect_bithumb_statement', pages), null)
  assert.equal(detect('detect_toss_transactions', pages), null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/amex-checking.test.ts`
Expected: the new filer tests FAIL with `AttributeError: module 'filer' has no attribute 'detect_amex_checking'`.

- [ ] **Step 3: Implement the detector**

Insert after `detect_tossbank_pdf` in `scripts/file-downloads.py`:

```python
AMEX_TABLE_HEADER = "Date Description Credits Debits Balance"
AMEX_BEGIN_RE = re.compile(r"Beginning Balance as of (\d{2}/\d{2}/\d{4})")
AMEX_END_RE = re.compile(r"Ending Balance as of (\d{2}/\d{2}/\d{4})")
AMEX_LAST4_RE = re.compile(r"Account Ending:\s*\*?(\d{4})\b")
AMEX_ACCOUNT_NAME_RE = re.compile(r"Account Name:\s*(.+?)\s*$", re.M)


def detect_amex_checking(doc):
    """American Express checking statement (PDF) → bank-statements/amex-checking-<last4>-<from>-<to>.pdf

    Told apart by the issuer name, the `Statement Summary` box and the activity
    table's header on page 1. The period is the window the summary declares
    (`Beginning Balance as of` … `Ending Balance as of`), written as an explicit
    window and never as an as-of: a statement covers exactly that, and the as-of
    form lets a later file replace it. The statement prints only the last four
    digits of the account (`Account Ending: *NNNN`), so that is the identity; the
    account map's `bankAccounts` entry for `institution: "amex"` and that `last4`
    only supplies the alias and must be a checking account. An absent entry is
    not a refusal (the account is then named `amex <last4>`), but a product
    other than checking is: no such statement has been seen, so its layout is
    not guessed.
    """
    if doc.suffix != ".pdf":
        return None
    text = doc.page_text(0)
    if "American Express" not in text or "Statement Summary" not in text or AMEX_TABLE_HEADER not in text:
        return None
    what = "American Express checking statement"
    named = AMEX_ACCOUNT_NAME_RE.search(text)
    product = named.group(1) if named else ""
    if "checking" not in product.lower():
        return Refusal(what, f"its Account Name is {product or 'not printed'!r}, and only a checking account is filed from this document")
    last4 = AMEX_LAST4_RE.search(text)
    if not last4:
        return Refusal(what, "it prints no `Account Ending` last four digits, so which account it is cannot be told")
    begin, end = AMEX_BEGIN_RE.search(text), AMEX_END_RE.search(text)
    if not (begin and end):
        return Refusal(what, "its summary has no Beginning/Ending Balance dates to take a period from")
    start, stop = parse_mdy(begin.group(1)), parse_mdy(end.group(1))
    if not (start and stop) or start > stop:
        return Refusal(what, "its Beginning/Ending Balance dates are not a usable period")
    number = last4.group(1)
    entries, problem = account_map_list("bankAccounts")
    if problem:
        return Refusal(what, problem, "fix the JSON, or move the file aside")
    entry = next((e for e in entries if e.get("institution") == "amex" and str(e.get("last4") or "") == number), None)
    evidence = [f"declared period {iso(start)} … {iso(stop)}", f"Account Ending …{number}"]
    if entry is None:
        evidence.append(f"no amex bankAccounts entry with last4 {number}; add one to name the account "
                        f"(otherwise it is `amex {number}`)")
    elif entry.get("kind") != "checking":
        return Refusal(what, f"the account map lists …{number} as a {entry.get('kind')} account, and only a checking "
                             "account is filed from this document", "correct the entry's kind, or file it by hand")
    else:
        evidence.append(f"…{number} is {entry.get('alias') or 'an Amex checking account'} in the account map")
    return Plan(DIR_BANK, f"amex-checking-{number}-{compact(start)}-{compact(stop)}.pdf", evidence)
```

Add to `DETECTORS`, after the tossbank PDF row:

```python
    ("American Express checking statement (PDF)", detect_amex_checking),
```

- [ ] **Step 4: Run to verify they pass**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/amex-checking.test.ts tests/bank-filing.test.ts tests/tossbank-pdf.test.ts`
Expected: PASS (the other two files confirm no other detector started to claim or lose a file).

- [ ] **Step 5: Commit**

```bash
git add scripts/file-downloads.py tests/amex-checking.test.ts
git commit -m "feat(bank): file American Express checking statements from the inbox

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Domestic list and naming rule

**Files:**
- Modify: `lib/fbar.ts:88`
- Modify: `lib/bank-accounts.ts` (the `LAST4_INSTITUTIONS` constant)
- Test: `tests/fbar.test.ts` (extend the test around line 95; append one test)

**Interfaces:**
- Consumes: `isUsCashInstitution(name: string): boolean`, `bankAccountName(entry): string`.
- Produces: `US_CASH_INSTITUTIONS` includes `'amex'`; `LAST4_INSTITUTIONS` includes `'amex'`.

- [ ] **Step 1: Write the failing test**

In `tests/fbar.test.ts` change line 95 to include `'amex'`:

```ts
  for (const name of ['chase', 'boa', 'robinhood-bank', 'fidelity', 'amex', 'Chase']) assert.equal(isUsCashInstitution(name), true, name)
```

Append at the end of the file:

```ts
test('an Amex checking account is named by its alias, or by amex <last4> without one, and is domestic', () => {
  assert.equal(bankAccountName({ institution: 'amex', kind: 'checking', last4: '0042', alias: 'Example Amex checking' }), 'Example Amex checking')
  assert.equal(bankAccountName({ institution: 'amex', kind: 'checking', last4: '0042' }), 'amex 0042')
  assert.equal(isUsCashInstitution('amex'), true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/fbar.test.ts`
Expected: FAIL — `isUsCashInstitution('amex')` is `false` and the second name is `amex checking`.

- [ ] **Step 3: Implement**

`lib/fbar.ts`:

```ts
export const US_CASH_INSTITUTIONS: readonly string[] = ['chase', 'boa', 'robinhood-bank', 'fidelity', 'amex']
```

`lib/bank-accounts.ts`:

```ts
const LAST4_INSTITUTIONS = new Set(['tossbank', 'amex'])
```

- [ ] **Step 4: Run to verify it passes**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/fbar.test.ts && PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/fbar.ts lib/bank-accounts.ts tests/fbar.test.ts
git commit -m "fix(fbar): treat American Express checking as a domestic cash account

An institution missing from the domestic list is reported as a foreign
account in the FBAR table.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and the map example

**Files:**
- Modify: `docs/data-sources.md` (the naming table at ~line 39; the "Bank inflows" gaps list at ~line 274)
- Modify: `data/accounts.local.example.json`

- [ ] **Step 1: Add the naming-table row**

In `docs/data-sources.md`, after the `Bank of America checking` row of the "Bank deposits" table, add:

```markdown
| American Express checking | `amex-checking-<last4>-<from>-<to>.pdf`: the monthly Rewards Checking statement (a text PDF with an empty password). The last four digits come from `Account Ending: *NNNN` and the window from the summary's `Beginning Balance as of` / `Ending Balance as of` dates. The map's `bankAccounts` entry `{ "institution": "amex", "last4": "<last4>", "kind": "checking", "alias": "..." }` supplies the alias (without it the account is `amex <last4>`); an entry of another `kind` refuses the file, as does an `Account Name` that is not a checking account. The extractor skips, with a finding, a statement whose rows disagree with its own summary (opening + credits + debits, the credit and debit totals, the interest earned) or whose file name carries other last four digits than it prints. The account is domestic, so it counts in total assets and is not in the FBAR table |
```

- [ ] **Step 2: Update the example map**

In `data/accounts.local.example.json`, add to `bankAccounts` after the Robinhood entries:

```json
    { "institution": "amex", "last4": "0000", "kind": "checking", "currency": "USD", "alias": "Amex checking" },
```

- [ ] **Step 3: Run the whole suite**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`
Expected: PASS, no new failures (the account-map and example-file tests read the example JSON).

- [ ] **Step 4: Check the public-repo rule**

Run: `git diff main --stat`, then build a pattern in the shell (never in a file) from the real strings the maintainer's statements hold: the holder's name, the employer string, the street, the last four digits, the bank reference prefix. Run `git diff main -U0 | command grep -a -n -i -E "^\+.*(<those strings joined with |>)"`.
Expected: the stat only; the grep prints nothing. The pattern is typed for this one run and written nowhere.

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/data-sources.md data/accounts.local.example.json
git commit -m "docs(bank): American Express checking statements

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

PR title: `feat(bank): read American Express checking statements`. Body: what is read, what is refused, the FBAR list correction, what the maintainer must add locally (alias entry, two inflow rules). No amounts, dates, names or last four digits.

---

# Phase B — USD own-account pairing (a second PR, after phase A is merged)

### Task 6: Pair USD transfers between accounts on file

**Files:**
- Modify: `scripts/extract-bank-statements.py` (new block after `pair_transfers`; one call in `main()` after `estimate_closed_accounts`)
- Create: `tests/usd-transfer-pairing.test.ts`

**Interfaces:**
- Consumes: `inflow_sources: list[(institution, alias, currency, txns)]` as built in `main()`; `_days(a, b)`.
- Produces: `pair_usd_transfers(sources) -> int` (the number of pairs marked; sets `ownTransfer = True` on both legs in place); constants `USD_PAIR_DAYS = 3`, `USD_INSTITUTION_WORDS`.

- [ ] **Step 1: Write the failing tests**

Create `tests/usd-transfer-pairing.test.ts`:

```ts
// USD transfers between two accounts on file are paired when the rows name each
// other's institution. Every name and amount is invented.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { amexPages, PY, ROOT, runExtract, STATEMENT_MAR } from './amex-fixtures'

const HARNESS = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def src(inst, alias, cur, rows):
    return (inst, alias, cur, [{"date": d, "seq": i, "description": desc, "amount": a, "balance": None} for i, (d, desc, a) in enumerate(rows)])
`
const run = (body: string) => JSON.parse(execFileSync(PY, ['-I', '-c', HARNESS + body], { cwd: ROOT, encoding: 'utf8' }))

test('a debit and a credit of the same size in two accounts pair when one names the other institution, in either date order', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-12", "Online Transfer / Payment: Debit Robinhood Money Payment", -250.0)]),
  src("robinhood-bank", "RH", "USD", [("2025-03-11", "ACH Deposit from American Express", 250.0)]),
]
n = m.pair_usd_transfers(sources)
print(json.dumps({"n": n, "flags": [[t.get("ownTransfer", False) for t in s[3]] for s in sources]}))`)
  assert.equal(r.n, 1)
  assert.deepEqual(r.flags, [[true], [true]])
})

test('equal and opposite rows that name no institution are a coincidence and stay unmarked', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-20", "Zelle Payment To EXAMPLE FRIEND", -75.0)]),
  src("chase", "Chase", "USD", [("2025-03-21", "Zelle payment from EXAMPLE OTHER", 75.0)]),
]
print(json.dumps({"n": m.pair_usd_transfers(sources), "flags": [[t.get("ownTransfer", False) for t in s[3]] for s in sources]}))`)
  assert.equal(r.n, 0)
  assert.deepEqual(r.flags, [[false], [false]])
})

test('three days apart pairs and four does not; a different amount by a cent does not', () => {
  const r = run(`
def case(gap_day, amount):
    sources = [
      src("amex", "Amex", "USD", [("2025-03-10", "Payment to Chase", -100.0)]),
      src("chase", "Chase", "USD", [(gap_day, "Deposit from American Express", amount)]),
    ]
    return m.pair_usd_transfers(sources)
print(json.dumps({"three": case("2025-03-13", 100.0), "four": case("2025-03-14", 100.0), "cent": case("2025-03-11", 100.01)}))`)
  assert.deepEqual(r, { three: 1, four: 0, cent: 0 })
})

test('with two equal credits and one debit only the nearest pairs', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-10", "Payment to Robinhood", -500.0)]),
  src("robinhood-bank", "RH", "USD", [("2025-03-13", "ACH Deposit from American Express", 500.0), ("2025-03-11", "ACH Deposit from American Express", 500.0)]),
]
n = m.pair_usd_transfers(sources)
print(json.dumps({"n": n, "rh": [[t["date"], t.get("ownTransfer", False)] for t in sources[1][3]]}))`)
  assert.equal(r.n, 1)
  assert.deepEqual(r.rh, [['2025-03-13', false], ['2025-03-11', true]])
})

test('rows of one account never pair with each other, and KRW rows are left to the KRW pairing', () => {
  const r = run(`
usd = [src("chase", "Chase", "USD", [("2025-03-10", "Refund from Chase", 40.0), ("2025-03-10", "Chase card payment", -40.0)])]
krw = [
  src("tossbank", "T", "KRW", [("2025-03-10", "Chase", -100000.0)]),
  src("mg", "M", "KRW", [("2025-03-10", "Chase", 100000.0)]),
]
print(json.dumps({"usd": m.pair_usd_transfers(usd), "krw": m.pair_usd_transfers(krw)}))`)
  assert.deepEqual(r, { usd: 0, krw: 0 })
})

test('end to end: the Robinhood credit that follows an Amex debit is an own transfer, the employer credit is not', () => {
  const doc = runExtract(
    {
      'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
      'robinhood-bank-checking-20250311-20250321.csv': [
        'Date,Description,Amount',
        '2025-03-21,ACH Deposit from EXAMPLE FRIEND,75.00',
        '2025-03-11,ACH Deposit from American Express,250.00',
      ].join('\n'),
    },
    {
      bankAccounts: [
        { institution: 'amex', kind: 'checking', currency: 'USD', last4: '0042', alias: 'Example Amex checking' },
        { institution: 'robinhood-bank', kind: 'checking', currency: 'USD', alias: 'Example RH checking' },
      ],
      anchors: [{ alias: 'Example RH checking', date: '2025-03-21', balance: 400 }],
    },
  )
  const byDescription = Object.fromEntries(doc.inflows.map((f: any) => [f.description, f.ownTransfer]))
  assert.equal(byDescription['ACH Deposit from American Express'], true)
  assert.equal(byDescription['ACH Deposit from EXAMPLE FRIEND'], false)
  assert.equal(byDescription['Online Transfer / Payment: Credit EXAMPLE CO PAYROLL *****0001 XXXX0002 Example Holder External - EXAMPLE BANK, N.A.'], false)
  assert.ok(doc.notes.some((n: string) => /1 USD transfer/.test(n)), JSON.stringify(doc.notes))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/usd-transfer-pairing.test.ts`
Expected: FAIL with `AttributeError: module 'bank' has no attribute 'pair_usd_transfers'`.

- [ ] **Step 3: Implement**

In `scripts/extract-bank-statements.py`, after `pair_transfers` (before `held_outside`):

```python
# --- USD transfers between two accounts on file ---------------------------------
#
# `pair_transfers` is KRW-only. For USD, two equal and opposite rows in two
# accounts are an own-account transfer only when something besides the amount
# says so: a payment between two of one's accounts names the other institution
# in at least one of its rows ("ACH Deposit from American Express"). Amount and
# date alone also match a peer payment and an unrelated credit of the same size,
# and marking that would hide real income. The date window is symmetric because
# a receiving account can post the credit a day before the sending account's
# debit date.

USD_PAIR_DAYS = 3
USD_INSTITUTION_WORDS = {
    "amex": ("american express", "amex"),
    "chase": ("chase",),
    "boa": ("bank of america", "bkofamerica"),
    "robinhood-bank": ("robinhood",),
    "fidelity": ("fidelity", "fid bkg"),
}


def _names_institution(description, institution):
    text = (description or "").lower()
    return any(word in text for word in USD_INSTITUTION_WORDS.get(institution, ()))


def pair_usd_transfers(sources):
    """Mark equal and opposite USD rows between two accounts on file as own transfers; returns the pair count.

    `sources` are (institution, account, currency, txns) as `main` builds them; the
    txn dicts are marked in place, so the `inflows` written afterwards carry it.
    One-to-one, nearest date first; a row already marked is left alone.
    """
    legs = [(institution, alias, txn) for institution, alias, currency, txns in sources if currency == "USD"
            for txn in txns if txn["amount"] != 0 and not txn.get("ownTransfer")]
    by_size = {}
    for index, (_, _, txn) in enumerate(legs):
        by_size.setdefault(round(abs(txn["amount"]), 2), []).append(index)
    candidates = []
    for group in by_size.values():
        credits = [i for i in group if legs[i][2]["amount"] > 0]
        debits = [i for i in group if legs[i][2]["amount"] < 0]
        for c in credits:
            for d in debits:
                (c_inst, c_account, credit), (d_inst, d_account, debit) = legs[c], legs[d]
                if (c_inst, c_account) == (d_inst, d_account):
                    continue
                gap = _days(credit["date"], debit["date"])
                if gap > USD_PAIR_DAYS:
                    continue
                if not (_names_institution(credit.get("description"), d_inst) or _names_institution(debit.get("description"), c_inst)):
                    continue
                candidates.append((gap, credit["date"], c, d))
    taken, pairs = set(), 0
    for _gap, _date, c, d in sorted(candidates):
        if c in taken or d in taken:
            continue
        taken.update((c, d))
        legs[c][2]["ownTransfer"] = legs[d][2]["ownTransfer"] = True
        pairs += 1
    return pairs
```

In `main()`, immediately after `estimated, external_inflows = estimate_closed_accounts(...)` and before the `inflows = [...]` list:

```python
    usd_pairs = pair_usd_transfers(inflow_sources)
    if usd_pairs:
        notes.append(f"{usd_pairs} USD transfer(s) between accounts on file paired as own transfers")
```

- [ ] **Step 4: Run to verify they pass**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm exec tsx --test tests/usd-transfer-pairing.test.ts tests/amex-checking.test.ts tests/bank-inflows-extract.test.ts tests/bank-statements.test.ts`
Expected: PASS. The two older files confirm the KRW estimate and its pairing are untouched.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-bank-statements.py tests/usd-transfer-pairing.test.ts
git commit -m "feat(bank): pair USD transfers between accounts on file

A credit and a debit of the same size in two accounts, within three days,
are an own transfer when one of the two descriptions names the other's
institution. Amount and date alone are not evidence.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Pairing docs and the real-data diff gate

**Files:**
- Modify: `docs/data-sources.md` (Bank inflows section, ~lines 208–279)

- [ ] **Step 1: Edit the docs**

In the paragraph that lists what sets `ownTransfer`, add: "a USD credit that pairs with an equal and opposite debit in another account on file (within three days, either order, and only when one of the two descriptions names the other's institution, so a peer payment of the same size is not caught)". Replace the known-gap bullet "USD own-account transfers are not paired, so they show as unclassified until a `transfer` rule covers them." with: "A USD own-account transfer is paired only when the other account's statement is on file and a description names the institution; otherwise a `transfer` rule is still what classifies it. The rules are kept: pairing wins first (the row's `rule` is then empty), and the other statement may simply not have arrived yet."

- [ ] **Step 2: Run the suite**

Run: `PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`
Expected: PASS.

- [ ] **Step 3: Real-data diff gate (laptop only, before merging phase B)**

Run the extractor twice against the laptop's own data directory, once on `main` and once on this branch, writing to scratch paths, then compare only counts per `(institution, account)` of inflows with `ownTransfer` true:

```bash
STOCK_BANK_BALANCES_PATH=<scratch>/before.json pnpm extract:bank-statements   # on main
STOCK_BANK_BALANCES_PATH=<scratch>/after.json  pnpm extract:bank-statements   # on this branch
```

Expected: every newly marked row is a credit whose description names a held institution; no row from an employer, a peer payment or a card cashback changes. Report to the maintainer counts only (how many rows newly marked, per institution); never paste rows, amounts or dates into a PR or comment. A surprise means tightening `USD_INSTITUTION_WORDS`, not merging.

- [ ] **Step 4: Commit**

```bash
git add docs/data-sources.md
git commit -m "docs(bank): USD own-account pairing

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

# Rollout (the maintainer's machines; nothing here is code)

Order matters: the files must be filed under the new names before anything reads them, and nothing may be renamed on one machine only (the project memory `renaming-a-source-file`). The three PDFs are new, so there is no old name to remove on either side; confirm that first with `ls bank-statements | command grep -a -i amex` on the laptop (expect no output).

1. **After phase A is merged, on the laptop:** `make file-downloads-dry`. Expect three lines of the form `AMEX Checking - <Month> 2026.pdf → bank-statements/amex-checking-<last4>-<from>-<to>.pdf` with the declared windows as evidence and a note that no `bankAccounts` entry exists yet. This is also the real-file check that no other detector claims them (`identify` raises if two do). Moves nothing.
2. **Laptop, `data/accounts.local.json`:** add `{ "institution": "amex", "last4": "<the printed last four>", "kind": "checking", "currency": "USD", "alias": "<name>" }` to `bankAccounts`.
3. **Laptop:** `make file-downloads` (moves the three PDFs; the inbox is never pushed).
4. **Laptop, `data/manual-mappings.json`** (untracked; carried by `push-sources`): after step 5's local extract, `bank_inflows_classified` will count two unclassified credits (an employer credit and an incentive credit). Add one `salary` rule (`institution: "amex"`, `descriptionIncludes` the employer string as it prints) and one `other` rule for the incentive. Keep the existing `transfer-rh-from-amex` rule.
5. **Laptop, verify before touching the ops host:** `pnpm extract:bank-statements` then read `data/bank-balances.json`'s `findings` (expect none for the Amex files) and `accounts[].continuityBreaks` for the Amex account (expect none: each statement's opening balance equals the previous statement's closing balance).
6. **Ops host (every command below needs the user's explicit yes at the moment of running, exact text confirmed):**
   - `./scripts/push-sources.sh --dry-run` from the laptop checkout. Expect the three new files under `bank-statements/` and the two config files, no deletions (the script has no `--delete`).
   - `./scripts/push-sources.sh` to copy them.
   - A refresh on the host: the scheduler will do it on its own cycle; to force one, the exact command (checkout path on the host, and the `PATH` export from the project memory `prod-pnpm-path`) is proposed to the user at that time. The host's checkout path is **not** established in this plan and must be read from `~/workspace/common/workspace-governance/docs/ops-host-identity.md` or asked, never guessed.
7. **Verify on the dashboard:** the Amex account appears in total assets under its alias; it is absent from the FBAR table; `bank_inflows_classified` and `cash_statements_parsed` are clean; the Robinhood credit from Amex shows as a transfer (by pairing after phase B, by rule before it).

## Self-review

- **Spec coverage:** (1) filer — Task 3 (detector, slug, declared period, map resolution); (2) parser — Task 1 (multi-line, signed, summary checks, interest row); (3) FAMILIES, kind, alias — Tasks 1, 2, 4; (4) USD pairing decision — Decisions 5, Tasks 6–7, hand-written rules kept with the reason; (5) tests with invented fixtures — every task; (6) docs and rollout — Task 5, Task 7, Rollout. The brief's "FBAR table misses it" is addressed as a correction in Decision 4 and Task 4.
- **Placeholders:** none in code steps. The one open fact is the ops host's checkout path, called out as unknown in Rollout step 6; every other command is spelled out.
- **Type consistency:** `parse_amex_lines → (summary, rows)`, `amex_problems(summary, rows)`, `parse_amex(path, findings, notes)`, `detect_amex_checking(doc)`, `pair_usd_transfers(sources) → int`, `runExtract(files, map)`, `amexPages(options)` are used with the same names and shapes in every task and test.
- **Review Focus:** quiet statement (Task 1 and Task 2), page-break wrap (Task 1), same statement twice (Task 2), domestic/FBAR (Task 4), summary and last4 disagreement (Task 1, Task 2).
