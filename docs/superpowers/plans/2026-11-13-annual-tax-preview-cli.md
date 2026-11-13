# Annual component preview CLI plan

The owner put Hometax verification on hold and authorized the next step. Implement the first preview surface described in the [accepted MVP design](../specs/2026-11-12-annual-tax-estimation-mvp-design.md#8-application-and-data-boundaries), narrowed to explicit input and stdout only. Korean reporting gates stay unresolved; #299 is merged without deployment. No source research is required for this wrapper.

## Design and implementation choices

Add `pnpm --silent tax:annual:preview --input scenario.json`, backed by a separate TypeScript entry point. Reuse `calculateAnnualComponents` without changing calculators, rule packs, schemas or existing CLIs. The CLI does not load dotenv, config, evidence, history, portfolio DB or runtime adapters. It reads only the explicitly named regular file; a maximum of 1 MiB bounds input. With the canonical silent invocation, output is the existing component contract as JSON plus a newline. Plain pnpm may print its own banner and argument paths; it is not the machine/private-output interface. Exit 0 means a valid preview was produced, including a valid blocked result; it never means complete tax coverage. `--help` alone prints usage with the component/blocked boundary. Reject missing/duplicate/unknown arguments (including write/output/merge flags). Invalid input or invocation returns exit 2 with no result on stdout and a fixed diagnostic on stderr, without echoing private values or paths.

Alternatives considered: annual composition/comparison requires additional reviewed boundaries; a web surface adds application/UI scope; the existing independent component library allows a smaller useful preview first. Stdout only avoids a new persistence/output-path contract. Evidence receipts remain input metadata claims, not verified bytes. These are implementer choices within the existing preview design, not new owner profile decisions.

## Tasks

- [x] Add subprocess tests; observe failure before the CLI exists. Cover US ordinary/NIIT and explicit QDCG v2, missing inputs, KR blocked results, malformed/invalid JSON, unsupported arguments, file limit/type, deterministic output and read-only isolation.
- [x] Implement the standalone entry point and package command. Expect the CLI tests to pass with unchanged library results; retain all rule/schema bytes and existing command behavior.
- [x] Update current status and usage docs: #299 merged/undeployed, Hometax investigation explicitly on hold, CLI available only in this PR, annual totals/comparison and deployment still unavailable.
- [x] Run CLI and annual tests, full suite, typecheck/lint and UI guardrails. Run the public package command on a synthetic input. Obtain a fresh whole-branch review, fix material findings with RED/GREEN, verify protected runtime/originals read-only. Validation: 1,274 tests passed, typecheck/lint/UI guardrails and sample build passed; both review findings were addressed.

Delivery: push and open the PR; its live status is tracked on GitHub. Do not merge or deploy.

Review focus: a blocked preview must not imply zero or success of calculation; argument handling must not open implicit files; validators must not echo input values; errors must leave stdout empty; input/source paths must remain unchanged and unopened except for the explicit scenario file. Test temporary directories are deleted by test cleanup.
