import { HelpPopover } from '@/components/HelpPopover'
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary'

export function GlossaryTerm({ term, compact = false }: { term: GlossaryKey; compact?: boolean }) {
  const entry = GLOSSARY[term]
  return (
    <span className="inline-flex items-center">
      <span>{entry.label}</span>
      {!compact && <span className="ml-1 text-ink-3">({entry.alias})</span>}
      <HelpPopover label={`${entry.label} 설명`} align="left">
        <span className="font-medium text-ink">{entry.label}</span>
        <span className="ml-1 text-ink-3">{entry.alias}</span>
        <span className="mt-1 block">{entry.description}</span>
      </HelpPopover>
    </span>
  )
}
