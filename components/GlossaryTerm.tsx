import { HelpPopover } from '@/components/HelpPopover'
import { getGlossary, type GlossaryKey } from '@/lib/glossary'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

export function GlossaryTerm({ term, compact = false, language = 'en' }: { term: GlossaryKey; compact?: boolean; language?: Language }) {
  const entry = getGlossary(language)[term]
  const copy = getUiCopy(language).common
  return (
    <span className="inline-flex items-center">
      <span>{entry.label}</span>
      {!compact && <span className="ml-1 text-ink-3">({entry.alias})</span>}
      <HelpPopover label={copy.helpFor(entry.label)} align="left" language={language}>
        <span className="font-medium text-ink">{entry.label}</span>
        <span className="ml-1 text-ink-3">{entry.alias}</span>
        <span className="mt-1 block">{entry.description}</span>
      </HelpPopover>
    </span>
  )
}
