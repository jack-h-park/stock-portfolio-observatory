import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, Table, Thead, Th, Tbody, Tr, Td, MetaRow, MetaItem, type Tone } from '@/components/ui'
import {
  getArchiveStatus,
  getBriefing,
  publicBriefingUrl,
  type BriefingDocument,
  type BriefingMarket,
  type BriefingPosition,
  type BriefingSessionMove,
} from '@/lib/adapters/briefing-archive'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Daily Briefing' }

// Amounts stay in each market's own currency. Converting them into one number
// would need an FX snapshot the briefing does not carry, and a wrong rate
// misstates both sides at once.
function amount(value: number, market: BriefingMarket, digits = 0) {
  const sign = value < 0 ? '-' : ''
  return `${sign}${market.symbol}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`
}

function priceOf(value: number, market: BriefingMarket) {
  return amount(value, market, market.priceDigits)
}

function pct(value: number) {
  return `${value >= 0 ? '+' : ''}${fmtNumber(value, 2)}%`
}

function Signed({ value, format }: { value: number; format: (v: number) => string }) {
  return <span className={value >= 0 ? 'text-success' : 'text-danger'}>{format(value)}</span>
}

/** Korean codes are opaque alone, so the sheet's company name rides along. */
function TickerLink({ ticker, name, market }: { ticker: string; name?: string | null; market: BriefingMarket }) {
  return (
    <>
      <Link href={positionHref(market.id, ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
        {ticker}
      </Link>
      {name && <div className="mt-0.5 text-[10px] leading-tight text-ink-3">{name}</div>}
    </>
  )
}

// Priority is the primary signal (how soon), kind the secondary one (what sort).
// The writer already orders actions by priority, so this page only displays.
const PRIORITY_TONE: Record<string, Tone> = { 'act-now': 'danger', 'this-week': 'warning', fyi: 'neutral' }
const PRIORITY_LABEL: Record<string, string> = { 'act-now': 'Act now', 'this-week': 'This week', fyi: 'FYI' }

/** Documents archived before priority existed default to the least urgent level. */
function priorityOf(action: { priority?: string }) {
  return action.priority && action.priority in PRIORITY_LABEL ? action.priority : 'fyi'
}

const SESSION_EXPLAIN: Record<string, string> = {
  'no-prior-snapshot': 'This was the first briefing with a retained holdings snapshot, so there was nothing yet to compare against.',
  'no-holdings': 'No holdings snapshot was retained for this briefing.',
  'no-price-coverage': 'The holdings sheet carried no usable prices on both sides of the comparison.',
}

type Notes = BriefingDocument['narrative']['moverNotes']

/** Standing versus cost — cumulative since purchase. */
function MoverList({ movers, notes, market }: { movers: BriefingPosition[]; notes: Notes; market: BriefingMarket }) {
  if (movers.length === 0) return <EmptyState>No movers in this briefing</EmptyState>
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {movers.map((m) => (
        <li key={m.ticker} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="w-24 shrink-0">
            <TickerLink ticker={m.ticker} name={m.name} market={market} />
            <div className="mt-0.5 text-[11px] font-medium tabular-nums">
              <Signed value={m.pct} format={pct} />
            </div>
          </div>
          <p className="min-w-0 text-[12px] leading-relaxed text-ink-2">{notes[m.ticker]?.why ?? 'No note in this briefing.'}</p>
        </li>
      ))}
    </ul>
  )
}

/** What the price actually did since the previous snapshot. */
function SessionMoverList({ movers, notes, direction, market }: { movers: BriefingSessionMove[]; notes: Notes; direction: 'up' | 'down'; market: BriefingMarket }) {
  if (movers.length === 0) return <EmptyState ok>No material moves {direction === 'up' ? 'up' : 'down'} this session</EmptyState>
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {movers.map((m) => (
        <li key={m.ticker} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="w-24 shrink-0">
            <TickerLink ticker={m.ticker} name={m.name} market={market} />
            <div className="mt-0.5 text-[11px] font-medium tabular-nums">
              <Signed value={m.pctChange} format={pct} />
            </div>
            <div className="text-[10px] tabular-nums text-ink-3">{amount(m.valueChange, market)}</div>
          </div>
          <div className="min-w-0">
            <p className="text-[12px] leading-relaxed text-ink-2">
              {notes[m.ticker]?.why ?? 'No researched note for this session move.'}
            </p>
            <div className="mt-0.5 text-[10px] tabular-nums text-ink-3">
              {priceOf(m.priceFrom, market)} → {priceOf(m.priceTo, market)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

const TRADE_TONE: Record<string, Tone> = { bought: 'success', opened: 'success', sold: 'danger', closed: 'danger' }
const TRADE_VERB: Record<string, string> = { bought: 'Bought', sold: 'Sold', opened: 'Opened', closed: 'Closed' }

/** Section heading that separates the session band from the cumulative band. */
function Band({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 mt-7 flex flex-wrap items-baseline gap-2.5 first:mt-0">
      <h2 className="text-[15px] font-medium tracking-tight text-ink">{title}</h2>
      <span className="text-[11px] text-ink-3">{subtitle}</span>
    </div>
  )
}

function DatePicker({ dates, selected }: { dates: string[]; selected: string }) {
  const i = dates.indexOf(selected)
  // dates are newest-first, so "newer" is the lower index.
  const newer = i > 0 ? dates[i - 1] : null
  const older = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null
  const link = 'rounded-sm border border-line bg-card px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink'
  const disabled = 'rounded-sm border border-line-subtle bg-surface px-2 py-1 text-[12px] text-ink-3/60'

  return (
    // A plain GET form: the page stays a server component and the picker works
    // without client-side JavaScript.
    <form method="get" className="mb-5 flex flex-wrap items-center gap-2">
      {older ? (
        <Link href={`/daily-briefing?date=${older}`} className={link} aria-label={`Older briefing, ${older}`}>
          ←
        </Link>
      ) : (
        <span className={disabled} aria-hidden>
          ←
        </span>
      )}
      <select
        name="date"
        defaultValue={selected}
        className="rounded-sm border border-line bg-card px-2 py-1 text-[12px] text-ink focus:border-info focus:outline-none"
        aria-label="Briefing date"
      >
        {dates.map((d, idx) => (
          <option key={d} value={d}>
            {d}
            {idx === 0 ? ' (latest)' : ''}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-sm border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:border-ink-3 hover:bg-surface"
      >
        View
      </button>
      {newer ? (
        <Link href={`/daily-briefing?date=${newer}`} className={link} aria-label={`Newer briefing, ${newer}`}>
          →
        </Link>
      ) : (
        <span className={disabled} aria-hidden>
          →
        </span>
      )}
      <span className="text-[11px] text-ink-3">
        {dates.length} briefing{dates.length === 1 ? '' : 's'} · {dates[dates.length - 1]} → {dates[0]}
      </span>
    </form>
  )
}

export default async function DailyBriefingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams
  const archive = getArchiveStatus()
  const latest = archive.dates[0]
  const selected = params.date && archive.dates.includes(params.date) ? params.date : latest
  const doc = selected ? getBriefing(selected) : null

  if (!doc) {
    return (
      <>
        <PageHeader
          eyebrow="Portfolio"
          title="Daily Briefing"
          emphasis="Briefing"
          subtitle="Archived daily briefings, published each trading morning."
        />
        <Card>
          <EmptyState
            hint={
              archive.present
                ? `Archive directory ${archive.dir} contains no readable briefing documents.`
                : `Set STOCK_BRIEFING_ARCHIVE_DIR to the briefing archive path (currently ${archive.dir}, which does not exist).`
            }
          >
            {archive.present && archive.dates.length > 0
              ? 'That briefing could not be read.'
              : 'No briefings archived yet.'}
          </EmptyState>
        </Card>
      </>
    )
  }

  const isLatest = doc.date === latest
  // US and Korean figures are never combined: different currencies, different
  // trading sessions, and no FX snapshot in the briefing to bridge them honestly.
  const markets = doc.markets.filter((m) => m.aggregates)

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Daily Briefing"
        emphasis="Briefing"
        subtitle={`${doc.dateLabel} · built ${doc.generatedAt.slice(0, 10)}`}
        action={
          <div className="flex items-center gap-2">
            {isLatest ? <Badge tone="success">Latest</Badge> : <Badge tone="neutral">Archived</Badge>}
            <a
              href={publicBriefingUrl(doc.date, isLatest)}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-info hover:underline"
            >
              Open published page ↗
            </a>
          </div>
        }
      />

      <DatePicker dates={archive.dates} selected={doc.date} />

      {markets.length === 0 && (
        <Card className="mb-5">
          <EmptyState hint="Holdings snapshots were only retained from the archive rollout onward; earlier days kept the narrative alone.">
            No portfolio numbers for {doc.date} — this briefing was archived narrative-only.
          </EmptyState>
        </Card>
      )}

      {markets.map((m) => {
        const totals = m.aggregates!.totals
        const session = m.session?.available ? m.session : null
        return (
          <section key={m.id} className="mb-2">
            <Band
              title={`${m.flag} ${m.label}`}
              subtitle={`${session ? `price moves since ${session.previousDate}` : 'day-over-day comparison'} · ${m.currency}`}
            />

            {session?.marketClosed && (
              <Card className="mb-3">
                <EmptyState hint="Session figures are therefore zero; the standing-versus-cost view below is unaffected.">
                  Every tracked {m.label} price matches {session.previousDate} — the market was closed, or the sheet has
                  not re-priced.
                </EmptyState>
              </Card>
            )}
            {!session && (
              <Card className="mb-3">
                <EmptyState hint={SESSION_EXPLAIN[m.session?.reason ?? ''] ?? 'No prior snapshot was available to compare against.'}>
                  No day-over-day comparison for {m.label} in this briefing.
                </EmptyState>
              </Card>
            )}

            <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
              <MetricHeroCard
                title={session ? 'Session P/L' : 'Portfolio Value'}
                info="Price movement on the shares already held, measured against the previous archived snapshot. Shares bought or sold since then are excluded, so this is the market move and not the effect of trading."
                eyebrow={session ? 'Daily move' : 'Standing snapshot'}
                value={session ? amount(session.totals!.pl, m) : amount(totals.marketValue, m)}
                hint={
                  session
                    ? `${session.totals!.coveredPositions} priced${session.totals!.uncoveredPositions ? `, ${session.totals!.uncoveredPositions} without prices` : ''}`
                    : `${totals.positions} positions`
                }
              >
                <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
                  <MetricField
                    label="Session Return"
                    value={session ? pct(session.totals!.plPct) : '—'}
                    hint={session ? `on ${amount(session.totals!.priorMarketValue, m)} prior value` : 'not available'}
                    tone={session ? (session.totals!.plPct >= 0 ? 'success' : 'danger') : 'neutral'}
                    valueClassName="text-[18px]"
                  />
                  <MetricField
                    label="Portfolio Value"
                    value={amount(totals.marketValue, m)}
                    hint={`${totals.positions} positions`}
                    valueClassName="text-[18px]"
                  />
                  <MetricField
                    label="Unrealized P/L"
                    value={amount(totals.gl, m)}
                    hint={`${pct(totals.pct)} vs ${amount(totals.cost, m)} cost`}
                    tone={totals.gl >= 0 ? 'success' : 'danger'}
                    valueClassName="text-[18px]"
                  />
                </div>
              </MetricHeroCard>

              <Card title="Briefing Read Order" info="Use the daily move first, then standing value and cumulative unrealized performance.">
                <div className="flex min-h-[16rem] flex-col justify-between gap-4">
                  <div className="space-y-4">
                    <MetricField
                      label="Market"
                      value={m.label}
                      hint={`${m.currency} reporting currency`}
                      valueClassName="text-[28px]"
                    />
                    <div className="h-px bg-line-subtle" />
                    <MetricField
                      label="Cost Basis"
                      value={amount(totals.cost, m)}
                      hint="Standing versus purchase cost"
                      valueClassName="text-[18px]"
                    />
                  </div>
                  <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                    Session figures answer today; portfolio value and unrealized P/L answer current standing.
                  </div>
                </div>
              </Card>
            </div>

            {session && !session.marketClosed && (
              <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Card title="Session gainers" info={`Ranked by price change since the previous snapshot, among positions worth at least ${amount(m.moverMinCost, m)}.`}>
                  <SessionMoverList movers={session.gainers} notes={doc.narrative.moverNotes} direction="up" market={m} />
                </Card>
                <Card title="Session decliners" info={`Ranked by price change since the previous snapshot, among positions worth at least ${amount(m.moverMinCost, m)}.`}>
                  <SessionMoverList movers={session.losers} notes={doc.narrative.moverNotes} direction="down" market={m} />
                </Card>
              </div>
            )}

            {session && session.activity.length > 0 && (
              <Card title={`Activity since ${session.previousDate}`} className="mb-5">
                <ul className="divide-y divide-[color:var(--border-subtle)]">
                  {session.activity.map((a) => (
                    <li key={`${a.ticker}-${a.kind}`} className="flex flex-wrap items-center gap-2 py-2 text-[12px] first:pt-0 last:pb-0">
                      <span className="w-20 shrink-0">
                        <TickerLink ticker={a.ticker} market={m} />
                      </span>
                      <Badge tone={TRADE_TONE[a.kind] ?? 'neutral'}>{a.kind}</Badge>
                      <span className="text-ink-2">
                        {TRADE_VERB[a.kind] ?? a.kind} {fmtQuantity(Math.abs(a.quantityChange), 4)} share
                        {Math.abs(a.quantityChange) === 1 ? '' : 's'}
                        {a.kind === 'closed' ? '' : ` · now holding ${fmtQuantity(a.quantity, 4)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  Detected from share-count changes between snapshots — no trade feed is involved. Excluded from Session
                  P/L, which measures price movement on the shares already held.
                </p>
              </Card>
            )}

            <Band title={`${m.flag} ${m.label} — standing vs cost`} subtitle="cumulative since purchase — moves slowly" />

            <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Card title="Best vs cost" info={`Ranked by unrealized gain versus cost basis, among positions of at least ${amount(m.moverMinCost, m)}. Cumulative since purchase — not a one-day move.`}>
                <MoverList movers={m.aggregates!.gainers} notes={doc.narrative.moverNotes} market={m} />
              </Card>
              <Card title="Worst vs cost" info={`Ranked by unrealized loss versus cost basis, among positions of at least ${amount(m.moverMinCost, m)}. Cumulative since purchase — not a one-day move.`}>
                <MoverList movers={m.aggregates!.losers} notes={doc.narrative.moverNotes} market={m} />
              </Card>
            </div>

            <Card title="Largest positions" className="mb-5" info="Ranked by market value, not cost — a position down 60% is no longer a large exposure whatever was paid for it.">
              <Table scroll>
                <Thead>
                  <Th>Ticker</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">Market Value</Th>
                  <Th align="right">Unrealized P/L</Th>
                  <Th align="right">Return</Th>
                  <Th align="right">Qty</Th>
                  <Th>Accounts</Th>
                </Thead>
                <Tbody>
                  {m.aggregates!.largest.map((p) => (
                    <Tr key={p.ticker}>
                      <Td>
                        <TickerLink ticker={p.ticker} name={p.name} market={m} />
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {amount(p.cost, m)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {amount(p.marketValue, m)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        <Signed value={p.gl} format={(v) => amount(v, m)} />
                      </Td>
                      <Td align="right" className="tabular-nums">
                        <Signed value={p.pct} format={pct} />
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {fmtQuantity(p.quantity, 2)}
                      </Td>
                      <Td className="text-[11px] text-ink-3">{p.accounts.join(', ')}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </section>
        )
      })}

      <Card title="Market context" className="mb-5">
        {/* Pipeline-generated HTML (<b> emphasis only), from our own cron — not user input. */}
        <div
          className="briefing-macro text-[13px] leading-relaxed text-ink-2"
          dangerouslySetInnerHTML={{ __html: doc.narrative.macro }}
        />
      </Card>

      {doc.narrative.actions.length > 0 && (
        <Card title="Suggested actions to consider" className="mb-5">
          <ul className="space-y-2.5">
            {doc.narrative.actions.map((a, i) => {
              const priority = priorityOf(a)
              return (
                <li key={i} className="rounded-sm border border-line bg-surface px-3 py-2.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
                    <span className="text-[12px] font-medium text-ink">{a.head}</span>
                    <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{a.kind}</span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-2">{a.body}</p>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Ordered by how soon each item deserves attention: <b>Act now</b> means a dated catalyst makes deciding today
            materially better than waiting (at most one per briefing), <b>This week</b> a decision due before a near-term
            event, <b>FYI</b> context with no action implied. Generated commentary, informational only — not investment
            advice.
          </p>
        </Card>
      )}

      <MetaRow>
        <MetaItem label="Briefing date">{doc.date}</MetaItem>
        <MetaItem label="Document built">{doc.generatedAt}</MetaItem>
        <MetaItem label="Markets">{markets.map((m) => m.id).join(', ') || 'none'}</MetaItem>
        <MetaItem label="Archive">{archive.dir}</MetaItem>
      </MetaRow>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Read-only view of the briefing archive written by the daily briefing cron. The same documents are published to
        briefing.jackpark.me, so both surfaces always show the same numbers for a date. Figures are the snapshot taken on
        the briefing date and do not update, and each market is reported in its own currency — they are never summed.
      </p>
    </>
  )
}
