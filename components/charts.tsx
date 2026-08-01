'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const AXIS = { fontSize: 11, fill: 'var(--text-secondary)' }
const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.14)',
  fontSize: 12,
  lineHeight: 1.45,
  padding: '10px 12px',
}

type PortfolioTrendDatum = {
  date: string
  fx_rate?: number | null
  fx_as_of_date?: string | null
  fx_source?: string | null
  coverage?: number | null
  [key: string]: number | string | null | undefined
}

function PortfolioTooltip({
  active,
  label,
  payload,
  formatValue,
}: {
  active?: boolean
  label?: unknown
  payload?: { name?: unknown; value?: unknown; color?: string; payload?: unknown }[]
  formatValue: (value: number) => string
}) {
  if (!active || !payload?.length) return null
  const datum = payload[0]?.payload as PortfolioTrendDatum | undefined
  const values = payload.filter((item) => typeof item.value === 'number')
  return (
    <div style={TOOLTIP_STYLE}>
      <div className="mb-2 font-medium text-ink">{String(label ?? '')}</div>
      <div className="space-y-1">
        {values.map((item) => (
          <div key={String(item.name)} className="flex min-w-[190px] items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-ink-3">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {String(item.name || 'Value')}
            </span>
            <span className="font-medium tabular-nums text-ink">{formatValue(Number(item.value))}</span>
          </div>
        ))}
      </div>
      {datum?.fx_rate != null && (
        <div className="mt-2 border-t border-line-subtle pt-2 text-[11px] text-ink-3">
          <div className="flex items-center justify-between gap-5">
            <span>USD/KRW reference</span>
            <span className="font-medium tabular-nums text-ink">{datum.fx_rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="mt-0.5">As of {datum.fx_as_of_date || 'n/a'} · {datum.fx_source || 'Unknown source'}</div>
          {datum.coverage != null && datum.coverage < 1 && (
            <div className="mt-0.5">Priced cost coverage {(datum.coverage * 100).toFixed(1)}%</div>
          )}
        </div>
      )}
    </div>
  )
}

// Brand 4-color cycle for `multicolor` bars — one solid color per bar (no
// per-bar gradient). Used on time-series trends to carry the brand identity
// without sacrificing readability. Categorical charts keep a single `color`.
const BRAND_BARS = ['var(--brand-pink)', 'var(--brand-purple)', 'var(--brand-blue)', 'var(--brand-cyan)']

export function TrendBarChart({
  data,
  xKey,
  yKey,
  color = 'var(--brand-blue)',
  multicolor = false,
  height = 180,
  selectedKey,
  onBarSelect,
  xTickFormatter,
  yAxisPrefix = '',
  yAxisSuffix = '',
  yAxisLabel,
}: {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  color?: string
  // Cycle each bar through the brand palette (pink→purple→blue→cyan). Leave off
  // for categorical charts that encode meaning with a single deliberate color.
  multicolor?: boolean
  height?: number
  // Cross-filter affordance: when set, the bar whose xKey value === selectedKey is
  // drawn at full opacity and the rest are dimmed; clicking any bar calls onBarSelect
  // with that bar's xKey value. Omitting both keeps the chart a plain read-only trend.
  selectedKey?: string
  onBarSelect?: (key: string) => void
  xTickFormatter?: (value: string) => string
  yAxisPrefix?: string
  yAxisSuffix?: string
  yAxisLabel?: string
}) {
  const interactive = !!onBarSelect
  const hasSelection = selectedKey != null && selectedKey !== ''
  const formatAxisValue = (value: number) => `${yAxisPrefix}${value.toLocaleString()}${yAxisSuffix}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--border-default)' }}
          tickFormatter={xTickFormatter}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={formatAxisValue}
          label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', style: AXIS } : undefined}
        />
        <Tooltip
          cursor={{ fill: 'var(--bg-surface)' }}
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: number) => [`${yAxisPrefix}${value.toLocaleString()}${yAxisSuffix}`, undefined]}
        />
        <Bar
          dataKey={yKey}
          fill={color}
          radius={[3, 3, 0, 0]}
          maxBarSize={28}
          cursor={interactive ? 'pointer' : undefined}
          onClick={interactive ? (entry: Record<string, unknown>) => onBarSelect!(String(entry[xKey])) : undefined}
        >
          {data.map((d, i) => {
            const isSelected = hasSelection && String(d[xKey]) === selectedKey
            const dimmed = hasSelection && !isSelected
            // Selected bar: full opacity + a dark outline so it pops; others fade hard.
            return (
              <Cell
                key={i}
                fill={multicolor ? BRAND_BARS[i % BRAND_BARS.length] : color}
                fillOpacity={dimmed ? 0.25 : 1}
                stroke={isSelected ? 'var(--text-primary)' : undefined}
                strokeWidth={isSelected ? 1.5 : 0}
              />
            )
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

const PIE_COLORS = ['var(--accent-success)', 'var(--accent-info)', 'var(--brand-purple)', 'var(--brand-cyan)']

export function AllocationPieChart({
  data,
  height = 190,
}: {
  data: { name: string; value: number; label: string }[]
  height?: number
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="84%"
          paddingAngle={2}
          stroke="var(--bg-card)"
          strokeWidth={3}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: number, name: string, props: { payload?: { label?: string } }) => {
            const pct = total > 0 ? (value / total) * 100 : 0
            return [props.payload?.label ?? value.toLocaleString(), `${name} · ${pct.toFixed(1)}%`]
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function PortfolioTrendChart({
  data,
  dataKey,
  color = 'var(--brand-blue)',
  height = 290,
  valuePrefix = '',
  valueSuffix = '',
  axisLabel,
}: {
  data: PortfolioTrendDatum[]
  dataKey: string
  color?: string
  height?: number
  valuePrefix?: string
  valueSuffix?: string
  axisLabel?: string
}) {
  const formatValue = (value: number) => `${valuePrefix}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${valueSuffix}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} tickMargin={8} minTickGap={28} axisLine={{ stroke: 'var(--border-default)' }} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
          label={axisLabel ? { value: axisLabel, angle: -90, position: 'insideLeft', style: AXIS } : undefined}
        />
        <Tooltip
          content={(props) => <PortfolioTooltip {...props} formatValue={formatValue} />}
        />
        <Line
          type="linear"
          dataKey={dataKey}
          name="Value"
          connectNulls={false}
          stroke={color}
          strokeWidth={2.5}
          dot={data.length <= 80 ? { r: 2, strokeWidth: 1 } : false}
          activeDot={{ r: 5, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function PortfolioMultiTrendChart({
  data,
  series,
  height = 290,
  valuePrefix = '₩',
  valueSuffix = 'M',
  axisLabel = 'KRW million',
}: {
  data: PortfolioTrendDatum[]
  series: { dataKey: string; name: string; color: string }[]
  height?: number
  valuePrefix?: string
  valueSuffix?: string
  axisLabel?: string
}) {
  const formatValue = (value: number) => `${valuePrefix}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${valueSuffix}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} tickMargin={8} minTickGap={28} axisLine={{ stroke: 'var(--border-default)' }} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
          label={{ value: axisLabel, angle: -90, position: 'insideLeft', style: AXIS }}
        />
        <Tooltip
          content={(props) => <PortfolioTooltip {...props} formatValue={formatValue} />}
        />
        <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
        {series.map((item) => (
          <Line
            key={item.dataKey}
            type="linear"
            dataKey={item.dataKey}
            name={item.name}
            connectNulls={false}
            stroke={item.color}
            strokeWidth={2.5}
            dot={data.length <= 80 ? { r: 2, strokeWidth: 1 } : false}
            activeDot={{ r: 5, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
