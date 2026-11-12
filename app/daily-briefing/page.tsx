import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, Card, EmptyState, Label, MetaItem, MetaRow, MetricField, MetricHeroCard, Signed, Table, Tbody, Td, Th, Thead, Tr, type Tone } from '@/components/ui'
import {
  getArchiveStatus,
  getBriefing,
  publicBriefingUrl,
  type BriefingDocument,
  type BriefingMarket,
  type BriefingPosition,
  type BriefingSessionMove,
} from '@/lib/adapters/briefing-archive'
import { fmtPct, fmtQuantity } from '@/lib/format'
import { getGlossary } from '@/lib/glossary'
import { positionHref } from '@/lib/position-url'
import { signTone } from '@/lib/tone'
import { Select } from '@/components/form'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'
import { maskAccountLabel } from '@/lib/account-label'

type PageCopy = ReturnType<typeof getPageCopy<'dailyBriefing'>>

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/daily-briefing')


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

/** Korean codes are opaque alone, so the sheet's company name rides along. */
function TickerLink({ ticker, name, market }: { ticker: string; name?: string | null; market: BriefingMarket }) {
  return (
    <>
      <Link href={positionHref(market.id, ticker)} className="font-mono text-caption font-medium text-info hover:underline">
        {ticker}
      </Link>
      {name && <div className="mt-0.5 text-micro leading-tight text-ink-3">{name}</div>}
    </>
  )
}

// Priority is the primary signal (how soon), kind the secondary one (what sort).
// The writer already orders actions by priority, so this page only displays.
const PRIORITY_TONE: Record<string, Tone> = { 'act-now': 'danger', 'this-week': 'warning', fyi: 'neutral' }
// Built per request rather than at module scope, because the wording is now
// per-language and a module constant would freeze whichever language loaded first.
const priorityLabels = (copy: PageCopy): Record<string, string> => ({
  'act-now': copy.actNow,
  'this-week': copy.thisWeek,
  fyi: copy.fyi,
})

/** Documents archived before priority existed default to the least urgent level. */
function priorityOf(action: { priority?: string }) {
  return action.priority && ['act-now', 'this-week', 'fyi'].includes(action.priority) ? action.priority : 'fyi'
}

const sessionExplain = (copy: PageCopy): Record<string, string> => ({
  'no-prior-snapshot': copy.noPriorSnapshot,
  'no-holdings': copy.noSnapshot,
  'no-price-coverage': copy.noPrices,
})

type Notes = BriefingDocument['narrative']['moverNotes']

/** Standing versus cost — cumulative since purchase. */
function MoverList({ movers, notes, market, copy }: { movers: BriefingPosition[]; notes: Notes; market: BriefingMarket; copy: PageCopy }) {
  if (movers.length === 0) return <EmptyState>{copy.noMovers}</EmptyState>
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {movers.map((m) => (
        <li key={m.ticker} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="w-24 shrink-0">
            <TickerLink ticker={m.ticker} name={m.name} market={market} />
            <div className="mt-0.5 text-label font-medium tabular-nums">
              <Signed value={m.pct} format={(m) => fmtPct(m)} />
            </div>
          </div>
          <p className="min-w-0 text-caption leading-relaxed text-ink-2">{notes[m.ticker]?.why ?? copy.noNote}</p>
        </li>
      ))}
    </ul>
  )
}

/** What the price actually did since the previous snapshot. */
function SessionMoverList({ movers, notes, direction, market, copy }: { movers: BriefingSessionMove[]; notes: Notes; direction: 'up' | 'down'; market: BriefingMarket; copy: PageCopy }) {
  if (movers.length === 0) return <EmptyState ok>{direction === 'up' ? copy.noSessionMovesUp : copy.noSessionMovesDown}</EmptyState>
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {movers.map((m) => (
        <li key={m.ticker} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="w-24 shrink-0">
            <TickerLink ticker={m.ticker} name={m.name} market={market} />
            <div className="mt-0.5 text-label font-medium tabular-nums">
              <Signed value={m.pctChange} format={(m) => fmtPct(m)} />
            </div>
            <div className="text-micro tabular-nums text-ink-3">{amount(m.valueChange, market)}</div>
          </div>
          <div className="min-w-0">
            <p className="text-caption leading-relaxed text-ink-2">
              {copy.moverNote(m, notes)}
            </p>
            <div className="mt-0.5 text-micro tabular-nums text-ink-3">
              {priceOf(m.priceFrom, market)} → {priceOf(m.priceTo, market)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// `split` is deliberately absent: it is not a trade, so it gets neither a
// buy/sell tone nor a trade verb, and falls through to a neutral badge. The
// wording lives in lib/ui-copy/pages/dailyBriefing.ts, where it can be tested.
const TRADE_TONE: Record<string, Tone> = { bought: 'success', opened: 'success', sold: 'danger', closed: 'danger' }

/** Section heading that separates the session band from the cumulative band. */
function Band({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 mt-7 flex flex-wrap items-baseline gap-2.5 first:mt-0">
      <h2 className="text-body-lg font-medium tracking-tight text-ink">{title}</h2>
      <span className="text-label text-ink-3">{subtitle}</span>
    </div>
  )
}

function DatePicker({ dates, selected, copy }: { dates: string[]; selected: string; copy: PageCopy }) {
  const i = dates.indexOf(selected)
  // dates are newest-first, so "newer" is the lower index.
  const newer = i > 0 ? dates[i - 1] : null
  const older = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null
  const link = 'rounded-sm border border-line bg-card px-2 py-1 text-caption text-ink-2 transition-colors hover:border-ink-3 hover:text-ink'
  const disabled = 'rounded-sm border border-line-subtle bg-surface px-2 py-1 text-caption text-ink-3/60'

  return (
    // A plain GET form: the page stays a server component and the picker works
    // without client-side JavaScript.
    <form method="get" className="mb-5 flex flex-wrap items-center gap-2">
      {older ? (
        <Link href={`/daily-briefing?date=${older}`} className={link} aria-label={copy.olderBriefing(older)}>
          ←
        </Link>
      ) : (
        <span className={disabled} aria-hidden>
          ←
        </span>
      )}
      <Select
        name="date"
        defaultValue={selected}
        aria-label={copy.briefingDate}
        size="sm"
      >
        {dates.map((d, idx) => (
          <option key={d} value={d}>
            {d}
            {idx === 0 ? ` (${copy.latestSuffix})` : ''}
          </option>
        ))}
      </Select>
      <Button type="submit">
        {copy.view}
      </Button>
      {newer ? (
        <Link href={`/daily-briefing?date=${newer}`} className={link} aria-label={copy.newerBriefing(newer)}>
          →
        </Link>
      ) : (
        <span className={disabled} aria-hidden>
          →
        </span>
      )}
      <span className="text-label text-ink-3">
        {copy.briefingRange(dates.length, dates[dates.length - 1], dates[0])}
      </span>
    </form>
  )
}

export default async function DailyBriefingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const language = await getLanguage()
  const copy = getPageCopy('dailyBriefing', language)
  const glossary = getGlossary(language)
  const noValue = getUiCopy(language).common.noValue
  const params = await searchParams
  const archive = getArchiveStatus()
  const latest = archive.dates[0]
  const selected = params.date && archive.dates.includes(params.date) ? params.date : latest
  const doc = selected ? getBriefing(selected) : null

  if (!doc) {
    return (
      <>
        <PageHeader
          eyebrow={routeSection('/daily-briefing', language)}
          title={copy.title}
          emphasis={copy.emphasis}
          subtitle={copy.subtitle}
        />
        <Card>
          <EmptyState
            hint={
              archive.present
                ? copy.archiveUnreadableHint(archive.dir)
                : copy.archiveMissingHint(archive.dir)
            }
          >
            {archive.present && archive.dates.length > 0
              ? copy.unreadable
              : copy.noArchive}
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
        eyebrow={routeSection('/daily-briefing', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.docSubtitle(doc.dateLabel, doc.generatedAt.slice(0, 10))}
        action={
          <div className="flex items-center gap-2">
            {isLatest ? <Badge tone="success">{copy.latest}</Badge> : <Badge tone="neutral">{copy.archived}</Badge>}
            <a
              href={publicBriefingUrl(doc.date, isLatest)}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-info hover:underline"
            >
              {copy.openPublished}
            </a>
          </div>
        }
      />

      <DatePicker dates={archive.dates} selected={doc.date} copy={copy} />

      {markets.length === 0 && (
        <Card className="mb-5">
          <EmptyState hint={copy.narrativeOnlyHint}>
            {copy.narrativeOnly(doc.date)}
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
              subtitle={`${session ? copy.bandSince(session.previousDate) : copy.bandDayOverDay} · ${m.currency}`}
            />

            {session?.marketClosed && (
              <Card className="mb-3">
                <EmptyState hint={copy.sessionZero}>
                  {copy.marketClosed(m.label, session.previousDate)}
                </EmptyState>
              </Card>
            )}
            {!session && (
              <Card className="mb-3">
                <EmptyState hint={sessionExplain(copy)[m.session?.reason ?? ''] ?? copy.noPriorSnapshot}>
                  {copy.noComparison(m.label)}
                </EmptyState>
              </Card>
            )}

            <CardRow columns="hero">
              <MetricHeroCard
                title={session ? copy.sessionPl : copy.portfolioValue}
                info={copy.sessionPlInfo}
                eyebrow={session ? copy.dailyMove : copy.standingSnapshot}
                value={session ? amount(session.totals!.pl, m) : amount(totals.marketValue, m)}
                hint={
                  session
                    ? copy.pricedHint(String(session.totals!.coveredPositions), session.totals!.uncoveredPositions)
                    : copy.positionCount(totals.positions)
                }
              >
                <KpiBand>
                  <MetricField
                    label={copy.sessionReturn}
                    value={session ? fmtPct(session.totals!.plPct, { signed: true }) : '—'}
                    hint={session ? copy.priorValueHint(amount(session.totals!.priorMarketValue, m)) : noValue}
                    tone={session ? signTone(session.totals!.plPct) : 'neutral'}
                    valueClassName="text-title"
                  />
                  <MetricField
                    label={copy.portfolioValue}
                    value={amount(totals.marketValue, m)}
                    hint={copy.positionCount(totals.positions)}
                    valueClassName="text-title"
                  />
                  <MetricField
                    label={copy.unrealized}
                    value={amount(totals.gl, m)}
                    info={glossary.unrealizedGl.description}
                    hint={copy.unrealizedHint(fmtPct(totals.pct, { signed: true }), amount(totals.cost, m))}
                    tone={signTone(totals.gl)}
                    valueClassName="text-title"
                  />
                </KpiBand>
              </MetricHeroCard>

              <Card title={copy.readOrder} info={copy.readOrderInfo}>
                <div className="flex min-h-[16rem] flex-col justify-between gap-4">
                  <div className="space-y-4">
                    <MetricField
                      label={copy.market}
                      value={m.label}
                      hint={copy.reportingCurrency(m.currency)}
                      valueClassName="text-metric"
                    />
                    <div className="h-px bg-line-subtle" />
                    <MetricField
                      label={copy.costBasis}
                      value={amount(totals.cost, m)}
                      info={glossary.costBasis.description}
                      hint={copy.standingVsCost}
                      valueClassName="text-title"
                    />
                  </div>
                  <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
                    {copy.readOrderNote}
                  </div>
                </div>
              </Card>
            </CardRow>

            {session && !session.marketClosed && (
              <CardRow>
                <Card title={copy.gainers} info={copy.sessionMoversInfo(amount(m.moverMinCost, m))}>
                  <SessionMoverList movers={session.gainers} notes={doc.narrative.moverNotes} direction="up" market={m} copy={copy} />
                </Card>
                <Card title={copy.decliners} info={copy.sessionMoversInfo(amount(m.moverMinCost, m))}>
                  <SessionMoverList movers={session.losers} notes={doc.narrative.moverNotes} direction="down" market={m} copy={copy} />
                </Card>
              </CardRow>
            )}

            {session && session.activity.length > 0 && (
              <Card title={copy.activitySince(session.previousDate)} className="mb-5">
                <ul className="divide-y divide-[color:var(--border-subtle)]">
                  {session.activity.map((a) => (
                    <li key={`${a.ticker}-${a.kind}`} className="flex flex-wrap items-center gap-2 py-2 text-caption first:pt-0 last:pb-0">
                      <span className="w-20 shrink-0">
                        <TickerLink ticker={a.ticker} market={m} />
                      </span>
                      <Badge tone={TRADE_TONE[a.kind] ?? 'neutral'}>{copy.activityBadge(a)}</Badge>
                      <span className="text-ink-2">{copy.activityWording(a, fmtQuantity)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-label leading-relaxed text-ink-3">
                  {copy.activityNote}
                </p>
              </Card>
            )}

            <Band title={copy.standingBand(m.flag, m.label)} subtitle={copy.cumulativeNote} />

            <CardRow>
              <Card title={copy.bestVsCost} info={copy.bestVsCostInfo(amount(m.moverMinCost, m))}>
                <MoverList movers={m.aggregates!.gainers} notes={doc.narrative.moverNotes} market={m} copy={copy} />
              </Card>
              <Card title={copy.worstVsCost} info={copy.worstVsCostInfo(amount(m.moverMinCost, m))}>
                <MoverList movers={m.aggregates!.losers} notes={doc.narrative.moverNotes} market={m} copy={copy} />
              </Card>
            </CardRow>

            <Card title={copy.largestPositions} className="mb-5" info={copy.largestInfo}>
              <Table scroll>
                <Thead>
                  <Th>{copy.columns.ticker}</Th>
                  <Th align="right">{copy.costShort}</Th>
                  <Th align="right">{copy.columns.marketValue}</Th>
                  <Th align="right">{copy.unrealized}</Th>
                  <Th align="right">{copy.columns.returnPct}</Th>
                  <Th align="right">{copy.columns.quantity}</Th>
                  <Th>{copy.columns.accounts}</Th>
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
                        <Signed value={p.pct} format={(m) => fmtPct(m)} />
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {fmtQuantity(p.quantity, 2)}
                      </Td>
                      <Td className="text-label text-ink-3">{p.accounts.map(maskAccountLabel).join(', ')}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </section>
        )
      })}

      <Card title={copy.marketContext} className="mb-5">
        {/* Pipeline-generated HTML (<b> emphasis only), from our own cron — not user input. */}
        <div
          className="briefing-macro text-body leading-relaxed text-ink-2"
          dangerouslySetInnerHTML={{ __html: doc.narrative.macro }}
        />
      </Card>

      {doc.narrative.actions.length > 0 && (
        <Card title={copy.suggestedActions} className="mb-5">
          <ul className="space-y-2.5">
            {doc.narrative.actions.map((a, i) => {
              const priority = priorityOf(a)
              return (
                <li key={i} className="rounded-sm border border-line bg-surface px-3 py-2.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[priority]}>{priorityLabels(copy)[priority]}</Badge>
                    <span className="text-caption font-medium text-ink">{a.head}</span>
                    <Label as="span">{a.kind}</Label>
                  </div>
                  <p className="text-caption leading-relaxed text-ink-2">{a.body}</p>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-label leading-relaxed text-ink-3">
            {copy.actionsLead} <b>{copy.actNow}</b>{copy.actNowMeaning} <b>{copy.thisWeek}</b>{copy.thisWeekMeaning}{' '}
            <b>{copy.fyi}</b>{copy.fyiMeaning} {copy.disclaimer}
          </p>
        </Card>
      )}

      <MetaRow>
        <MetaItem label={copy.briefingDate}>{doc.date}</MetaItem>
        <MetaItem label={copy.documentBuilt}>{doc.generatedAt}</MetaItem>
        <MetaItem label={copy.markets}>{markets.map((m) => m.id).join(', ') || copy.noMarkets}</MetaItem>
        <MetaItem label={copy.archive}>{archive.dir}</MetaItem>
      </MetaRow>
      <p className="mt-2 text-label leading-relaxed text-ink-3">
        {copy.footer}
      </p>
    </>
  )
}
