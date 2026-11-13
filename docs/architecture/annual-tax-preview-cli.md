# Read-only annual component preview

Merged PR #300 adds the first executable preview surface for the annual component library. It is separate from the operating tax-history summary, investment-incremental planner and original evidence. No deployment or web activation was included in that increment. See the [current installation observation](../operations/installation-status.md) for later source presence; no private annual-tax workflow acceptance is implied.

From the repository checkout with dependencies installed:

```sh
pnpm --silent tax:annual:preview --input examples/annual-tax-estimate.synthetic.json
pnpm --silent tax:annual:preview --input examples/annual-tax-qdcg.synthetic.json
pnpm --silent tax:annual:preview --help
```

`pnpm --silent` is the canonical machine/private-output invocation: it suppresses pnpm's command banner so stdout contains only the CLI's JSON. Plain pnpm can print its own lifecycle banner and supplied paths; the stdout/redaction guarantees below apply to the silent invocation or direct CLI process, not unsilenced package-manager output. Input is one explicit regular UTF-8 JSON file, at most 1 MiB, matching the [annual input contract](annual-tax-foundation.md). Relative paths resolve from the caller's working directory. Normal package invocation uses the repository's TypeScript configuration. For execution from another cwd, configure the TypeScript runner to use that configuration explicitly. All example data is synthetic; source hashes/locators in an input are metadata claims, not evidence-byte verification.

The command reads the specified scenario, executes `calculateAnnualComponents` and prints its existing result contract plus a newline. It does not load `.env.local`, operating config, the portfolio DB, tax history or source evidence. A source locator is not opened. No automatic input discovery, source acquisition, network calls, import, persistence, stdout-to-file option or write opt-in is provided. Shell redirection remains the operator's responsibility.

| Outcome | Exit | Stdout |
| --- | --- | --- |
| Supported or partially supported scenario | 0 | Component result, with individual modes/reasons |
| Valid but blocked scenario | 0 | `status: blocked`, unavailable component amounts null |
| Invalid invocation, file, JSON or input contract | 2 | Empty; a fixed diagnostic goes to stderr |
| `--help` alone | 0 | Usage and scope explanation |

An exit code of zero means a valid preview was produced, not that all requested tax components were calculated. Inspect `status`, each component's `mode`, `amountMinor` and `reason`. Missing inputs remain unknown; they are never replaced by zero. Result scope remains `component`, `annualTotal` is null and `comparisonEligible` is false. No final return liability, refund, payment or historical comparison is inferred. The pinned pack is selected by the input; there is no latest-year or latest-pack override.

US ordinary/NIIT and eligible QDCG v2 reuse their existing rules and restrictions. Korean national/local reported amounts stay blocked. The separately available exact Korean reference API is not promoted to reported money or included as an additional CLI result. Hometax verification and resolution of the Korean reporting policy are explicitly on hold at the owner's request. California, annual composition/comparison and a web estimate view remain later increments.

The CLI accepts only `--input <file>` or `--help` alone. Duplicate options, positional paths and flags such as `--apply` or `--output` are rejected. Error diagnostics do not echo scenario values, filesystem paths or raw parser/validator errors. Successful JSON intentionally contains scenario identity, input hash and calculation traces, so a private scenario's stdout must be treated as private.

Synthetic subprocess tests exercise US calculations and deterministic library parity, valid blocked/missing cases, invalid argument/JSON/contract/file handling, input size/type limits and unchanged input/configuration fixtures with nonexistent source evidence. These establish the tested preview boundary, not a verified owner return or complete annual estimate. Approved-device web access, original archives, the single operating history writer and disabled private web writes remain unchanged.
