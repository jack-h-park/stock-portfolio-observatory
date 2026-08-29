'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { usePageLanguage } from '@/components/LanguageProvider'
import { getUiCopy } from '@/lib/ui-copy'

/**
 * A submit button that says it is working.
 *
 * Every form in the dashboard posts to a server action, and none of them
 * reported anything between the click and the answer. Saving tax settings
 * rewrites a policy file and re-renders two routes; saving a plan builds a
 * plan set over five thousand lots. On a slow read that is a visibly dead
 * button, and the reasonable thing for a reader to do is click it again.
 *
 * useFormStatus reads the pending state of the nearest enclosing form, so this
 * has to be its own client component — a component that calls it must be
 * rendered *inside* the form rather than being the form.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  children: ReactNode
  /** Overrides the shared "Saving…" wording where a form does something else. */
  pendingLabel?: string
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
  className?: string
}) {
  const { pending } = useFormStatus()
  const copy = getUiCopy(usePageLanguage()).form

  return (
    <Button type="submit" variant={variant} size={size} loading={pending} className={className}>
      {pending ? (pendingLabel ?? copy.saving) : children}
    </Button>
  )
}
