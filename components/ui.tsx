// The primitives live in four modules; this file re-exports them so every
// page keeps importing from '@/components/ui'.
//   card.tsx      Card, MetricHeroCard, EmptyState, HeroAside, Panel, Callout
//   metric.tsx    MetricField, Signed, Label, MetaRow, MetaItem, Note, SectionHeading
//   table.tsx     Table, Thead, Th, Tbody, Tr, Td
//   controls.tsx  Button, SegmentedControl, TextLink, Badge
export { Callout, Card, EmptyState, HeroAside, MetricHeroCard, Panel } from './card'
export { Badge, Button, SegmentedControl, TextLink } from './controls'
export { HelpPopover } from '@/components/HelpPopover'
export { Label, MetaItem, MetaRow, MetricField, Note, SectionHeading, Signed } from './metric'
export { Table, Tbody, Td, Th, Thead, Tr } from './table'

// Tone is owned by lib/tone.ts. Re-exported here because the pages and
// components that import it from this module keep compiling unchanged.
export type { Tone } from '@/lib/tone'

// marketTone now lives in lib/tone.ts with the rest of the meaning→tone rules.
// Re-exported here because eleven files import it from this module.
export { marketTone } from '@/lib/tone'
