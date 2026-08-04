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

const AXIS = { fontSize: 10, fill: 'var(--text-tertiary)' }

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
  xAxisInterval,
  xAxisHeight,
  xTickAngle = 0,
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
  xAxisInterval?: number | 'preserveStart' | 'preserveEnd' | 'preserveStartEnd' | 'equidistantPreserveStart'
  xAxisHeight?: number
  xTickAngle?: number
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
          interval={xAxisInterval}
          height={xAxisHeight}
          angle={xTickAngle}
          textAnchor={xTickAngle === 0 ? 'middle' : 'end'}
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
  height = 240,
  valuePrefix = '',
  valueSuffix = '',
  axisLabel,
}: {
  data: { date: string; value: number | null }[]
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
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
          label={axisLabel ? { value: axisLabel, angle: -90, position: 'insideLeft', style: AXIS } : undefined}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: number) => [formatValue(value), 'Value']}
        />
        <Line
          type="linear"
          dataKey={dataKey}
          name="Value"
          connectNulls={false}
          stroke={color}
          strokeWidth={2}
          dot={data.length <= 80 ? { r: 2, strokeWidth: 1 } : false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function PortfolioMultiTrendChart({
  data,
  series,
  height = 240,
  valuePrefix = '₩',
  valueSuffix = 'M',
  axisLabel = 'KRW million',
}: {
  data: { date: string; [key: string]: number | string | null }[]
  series: { dataKey: string; name: string; color: string }[]
  height?: number
  valuePrefix?: string
  valueSuffix?: string
  axisLabel?: string
}) {
  const formatValue = (value: number) => `${valuePrefix}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${valueSuffix}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
          label={{ value: axisLabel, angle: -90, position: 'insideLeft', style: AXIS }}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [formatValue(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((item) => (
          <Line
            key={item.dataKey}
            type="linear"
            dataKey={item.dataKey}
            name={item.name}
            connectNulls={false}
            stroke={item.color}
            strokeWidth={2}
            dot={data.length <= 80 ? { r: 2, strokeWidth: 1 } : false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
