import type { Metadata } from 'next'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { SubmitButton } from '@/components/SubmitButton'
import { Badge, Card, EmptyState, TextLink } from '@/components/ui'
import { Checkbox, Field, Input, Select } from '@/components/form'
import { CardRow } from '@/components/layout'
import { dbAvailable, portfolioToday } from '@/lib/adapters/portfolio-db'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { getLanguage } from '@/lib/i18n-server'
import { SLEEVES, accountKey, defaultAccountRule, getAllocationPolicy, type AccountRule, type Sleeve } from '@/lib/rebalance/allocation-policy'
import { classify, getInstrumentClasses, instrumentKey, type InstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { ERROR_CODES, emptyAllocationPolicy, type SettingsErrorCode } from '@/lib/rebalance/settings-form'
import { fmtNumber } from '@/lib/format'
import { getPageCopy } from '@/lib/ui-copy'
import { routeSection } from '@/lib/page-names'
import {
  saveAccountRules,
  saveBoundsAndTargets,
  saveBuyLists,
  saveInstrumentClassesAction,
  saveLimits,
} from './actions'

export const dynamic = 'force-dynamic'

// A nested route: it is not in the sidebar, so it names its own tab (as /tax-planning/plans/[id] does).
export async function generateMetadata(): Promise<Metadata> {
  return { title: getPageCopy('rebalanceSettings', await getLanguage()).metaTitle }
}

const SCALAR_FIELDS = [
  ['positionCapPct', 'pct'],
  ['maxTargetShiftPctPerCycle', 'pct'],
  ['maxTurnoverPctPerProposal', 'pct'],
  ['minTradeKrw', 'krw'],
  ['staleDataDays', 'days'],
  ['harvestThresholdKrw', 'krw'],
] as const

type Params = { saved?: string; error?: string; code?: string | string[]; line?: string }

function loadClassesSafely(): InstrumentClasses {
  try {
    return getInstrumentClasses()
  } catch {
    return {}
  }
}

export default async function RebalanceSettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('rebalanceSettings', language)
  const state = getAllocationPolicy()
  const policy = state.policy ?? emptyAllocationPolicy()
  const classes = loadClassesSafely()
  const codes = (params.code === undefined ? [] : Array.isArray(params.code) ? params.code : [params.code]).filter(
    (code): code is SettingsErrorCode => (ERROR_CODES as readonly string[]).includes(code)
  )
  const lineNumber = Number(params.line)
  const messages = codes.map((code) => {
    const entry = copy.errors[code]
    return typeof entry === 'function' ? entry(Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : 0) : entry
  })

  let input: ReturnType<typeof getRebalanceInput> | null = null
  if (dbAvailable()) {
    try {
      input = getRebalanceInput(portfolioToday())
    } catch {
      input = null
    }
  }

  // Accounts: every taxable account in the data, plus any already configured.
  const accountRows = new Map<string, { key: string; label: string; rule: AccountRule }>()
  const addAccount = (brokerage: string | null, account: string, market: string) => {
    const key = accountKey(brokerage, account)
    if (accountRows.has(key)) return
    accountRows.set(key, { key, label: brokerage ? `${brokerage} · ${account}` : account, rule: policy.accounts[key] ?? defaultAccountRule(market) })
  }
  for (const position of input?.positions ?? []) addAccount(position.brokerage, position.account, position.market)
  for (const cash of input?.cash ?? []) addAccount(cash.brokerage, cash.account, 'KR')
  for (const [key, rule] of Object.entries(policy.accounts)) {
    if (accountRows.has(key)) continue
    const [brokerage, ...rest] = key.split('::')
    accountRows.set(key, { key, label: brokerage ? `${brokerage} · ${rest.join('::')}` : rest.join('::'), rule })
  }
  const accounts = Array.from(accountRows.values())

  // Securities: one row each, however many accounts hold it.
  const securities = new Map<string, { key: string; market: string; ticker: string; name: string; auto: Sleeve | null }>()
  for (const position of input?.positions ?? []) {
    const key = instrumentKey(position.market, position.ticker)
    if (securities.has(key)) continue
    securities.set(key, { key, market: position.market, ticker: position.ticker, name: position.name, auto: classify(position, {}) })
  }
  const securityRows = Array.from(securities.values())
  const unclassified = securityRows.filter((row) => !row.auto && !classes[row.key]).length

  const targetSum = SLEEVES.reduce((sum, sleeve) => sum + policy.targets[sleeve].target, 0)
  const sleeveRows: { sleeve: Sleeve }[] = SLEEVES.map((sleeve) => ({ sleeve }))

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/rebalance', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={
          <div className="flex items-center gap-2">
            {params.saved && <Badge tone="success">{copy.saved}</Badge>}
            <TextLink href="/rebalance">{copy.back}</TextLink>
          </div>
        }
      />

      {params.error && (
        <Card title={copy.errorsTitle} accent>
          <ul className="list-disc space-y-1 pl-5 text-caption text-warning">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <p className="mt-2 text-label text-ink-3">{copy.errorsNote}</p>
        </Card>
      )}
      {state.error && <p className="mb-4 text-caption text-warning">{copy.policyInvalid}</p>}
      {!state.policy && !state.error && <p className="mb-4 text-caption text-ink-3">{copy.policyMissing}</p>}
      {!input && <p className="mb-4 text-caption text-ink-3">{copy.noDatabase}</p>}

      <Card title={copy.bounds.title} info={copy.bounds.info} accent>
        <form action={saveBoundsAndTargets} className="space-y-4">
          <DataTable
            minWidth="32rem"
            rows={sleeveRows}
            columns={[
              { key: 'sleeve', label: copy.bounds.sleeve, render: (r: { sleeve: Sleeve }) => <span className="font-medium text-ink">{copy.sleeves[r.sleeve]}</span> },
              { key: 'min', label: copy.bounds.min, align: 'right', render: (r: { sleeve: Sleeve }) => <Input size="sm" type="number" step="any" name={`min_${r.sleeve}`} defaultValue={policy.bounds.sleeves[r.sleeve].min} aria-label={`${copy.sleeves[r.sleeve]} ${copy.bounds.min}`} className="w-20 text-right" /> },
              { key: 'max', label: copy.bounds.max, align: 'right', render: (r: { sleeve: Sleeve }) => <Input size="sm" type="number" step="any" name={`max_${r.sleeve}`} defaultValue={policy.bounds.sleeves[r.sleeve].max} aria-label={`${copy.sleeves[r.sleeve]} ${copy.bounds.max}`} className="w-20 text-right" /> },
              { key: 'target', label: copy.bounds.target, align: 'right', render: (r: { sleeve: Sleeve }) => <Input size="sm" type="number" step="any" name={`target_${r.sleeve}`} defaultValue={policy.targets[r.sleeve].target} aria-label={`${copy.sleeves[r.sleeve]} ${copy.bounds.target}`} className="w-20 text-right" /> },
              { key: 'band', label: copy.bounds.band, align: 'right', render: (r: { sleeve: Sleeve }) => <Input size="sm" type="number" step="any" name={`band_${r.sleeve}`} defaultValue={policy.targets[r.sleeve].band} aria-label={`${copy.sleeves[r.sleeve]} ${copy.bounds.band}`} className="w-20 text-right" /> },
            ]}
          />
          <div className="flex items-center gap-3">
            <SubmitButton>{copy.bounds.save}</SubmitButton>
            <Badge tone={Math.abs(targetSum - 100) < 0.05 ? 'success' : 'warning'}>{copy.bounds.sum(fmtNumber(targetSum, 2))}</Badge>
          </div>
        </form>
      </Card>

      <CardRow>
        <Card title={copy.limits.title} info={copy.limits.info}>
          <form action={saveLimits} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {SCALAR_FIELDS.map(([name, unit]) => (
                <Field key={name} label={copy.limits[name]} name={name} defaultValue={policy.bounds[name]} suffix={copy.limits[unit]} />
              ))}
            </div>
            <label className="flex items-start gap-2 text-caption text-ink-2">
              <Checkbox name="investor_usTaxPerson" defaultChecked={policy.investor?.usTaxPerson ?? false} />
              <span>
                <span className="font-medium text-ink">{copy.limits.usTaxPerson}</span>
                <span className="block text-label text-ink-3">{copy.limits.usTaxPersonHelp}</span>
              </span>
            </label>
            <SubmitButton>{copy.limits.save}</SubmitButton>
          </form>
        </Card>

        <Card title={copy.buyLists.title} info={copy.buyLists.info}>
          <form action={saveBuyLists} className="space-y-4">
            <p className="text-label text-ink-3">{copy.buyLists.format}</p>
            {SLEEVES.map((sleeve) => (
              <label key={sleeve} className="block">
                <span className="mb-1 block text-label font-medium text-ink-2">{copy.sleeves[sleeve]}</span>
                <textarea
                  name={`buy_${sleeve}`}
                  rows={3}
                  defaultValue={(policy.preferredInstruments[sleeve] ?? [])
                    .map((p) => `${p.market}:${p.ticker}@${p.brokerage ?? ''}::${p.account}`)
                    .join('\n')}
                  className="w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-label text-ink focus:outline-none focus-visible:border-info focus-visible:ring-2 focus-visible:ring-info/30"
                />
              </label>
            ))}
            <SubmitButton>{copy.buyLists.save}</SubmitButton>
          </form>
        </Card>
      </CardRow>

      <Card title={copy.accounts.title} info={copy.accounts.info}>
        {accounts.length === 0 ? (
          <EmptyState>{copy.accounts.empty}</EmptyState>
        ) : (
          <form action={saveAccountRules} className="space-y-4">
            <DataTable
              minWidth="40rem"
              rows={accounts.map((row, index) => ({ ...row, index }))}
              columns={[
                {
                  key: 'label',
                  label: copy.accounts.account,
                  render: (r) => (
                    <>
                      <input type="hidden" name={`acct_key_${r.index}`} value={r.key} />
                      <span className="font-medium text-ink">{r.label}</span>
                    </>
                  ),
                },
                {
                  key: 'lotMethod',
                  label: copy.accounts.lotMethod,
                  render: (r) => (
                    <div>
                      <Select size="sm" name={`acct_lot_${r.index}`} defaultValue={r.rule.lotMethod} aria-label={copy.accounts.lotMethod}>
                        <option value="fifo">{copy.accounts.lotMethods.fifo}</option>
                        <option value="specific">{copy.accounts.lotMethods.specific}</option>
                        <option value="average">{copy.accounts.lotMethods.average}</option>
                      </Select>
                      <div className="mt-1 max-w-[16rem] text-label text-ink-3">{copy.accounts.lotHelp}</div>
                    </div>
                  ),
                },
                {
                  key: 'fractional',
                  label: copy.accounts.fractional,
                  align: 'center',
                  render: (r) => <Checkbox name={`acct_fractional_${r.index}`} defaultChecked={r.rule.fractional} aria-label={copy.accounts.fractional} />,
                },
                {
                  key: 'managedBy',
                  label: copy.accounts.managedBy,
                  render: (r) => <Input size="sm" type="text" name={`acct_managedBy_${r.index}`} defaultValue={r.rule.managedBy ?? ''} placeholder={copy.accounts.managedByPlaceholder} aria-label={copy.accounts.managedBy} />,
                },
                {
                  key: 'excludedCash',
                  label: copy.accounts.excludedCash,
                  align: 'center',
                  render: (r) => <Checkbox name={`acct_excluded_${r.index}`} defaultChecked={r.rule.excludedCash} aria-label={copy.accounts.excludedCash} />,
                },
              ]}
            />
            <SubmitButton>{copy.accounts.save}</SubmitButton>
          </form>
        )}
      </Card>

      <Card
        title={copy.classes.title}
        info={copy.classes.info}
        action={unclassified > 0 ? <Badge tone="warning">{copy.classes.unclassifiedCount(unclassified)}</Badge> : undefined}
      >
        {securityRows.length === 0 ? (
          <EmptyState>{copy.classes.empty}</EmptyState>
        ) : (
          <form action={saveInstrumentClassesAction} className="space-y-4">
            <DataTable
              minWidth="32rem"
              rows={securityRows}
              columns={[
                {
                  key: 'ticker',
                  label: copy.classes.security,
                  render: (r) => (
                    <div className="min-w-[12rem]">
                      <span className="font-mono text-caption font-medium text-ink">{r.market}:{r.ticker}</span>
                      <div className="max-w-[20rem] truncate text-label text-ink-3">{r.name}</div>
                    </div>
                  ),
                },
                {
                  key: 'sleeve',
                  label: copy.classes.sleeve,
                  render: (r: { auto: Sleeve | null; key: string; market: string; ticker: string }) =>
                    r.auto ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">{copy.sleeves[r.auto]}</Badge>
                        <span className="text-label text-ink-3">{copy.classes.auto}</span>
                      </div>
                    ) : (
                      <Select size="sm" name={`class_${r.key}`} defaultValue={classes[r.key] ?? ''} aria-label={`${r.market}:${r.ticker}`}>
                        <option value="">{copy.classes.unclassified}</option>
                        {SLEEVES.map((sleeve) => (
                          <option key={sleeve} value={sleeve}>
                            {copy.sleeves[sleeve]}
                          </option>
                        ))}
                      </Select>
                    ),
                },
              ]}
            />
            <SubmitButton>{copy.classes.save}</SubmitButton>
          </form>
        )}
      </Card>
    </>
  )
}
