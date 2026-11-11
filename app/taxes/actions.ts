'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { config } from '@/config'
import { readTaxHistory, taxHistoryPath } from '@/lib/adapters/tax-history-store'
import { applyTaxHistoryEdit, type TaxHistoryEdit } from '@/lib/application/tax-history-edit'

export async function reviewTaxHistory(form: FormData) {
  const value = (key: string) => String(form.get(key) ?? '')
  const recordId = value('recordId'),
    store = readTaxHistory()
  if (!store.obligations.some((row) => !row.deleted && row.id === recordId)) throw new Error('Unknown tax record')
  const destination = `/taxes/records/${encodeURIComponent(recordId)}`
  try {
    const revision = value('expectedRevision')
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision)))
      throw new Error('Invalid state revision')
    const common = { id: value('id'), expectedRevision: Number(revision), reason: value('reason') }
    let edit: TaxHistoryEdit
    if (value('kind') === 'review-event')
      edit = { ...common, kind: 'review-event', review: value('review') as 'unreviewed' | 'evidenced' }
    else if (value('kind') === 'relink-evidence')
      edit = { ...common, kind: 'relink-evidence', relativePath: value('relativePath') }
    else if (value('kind') === 'select-basis') {
      const separator = value('basis').indexOf(':'),
        basisKind = value('basis').slice(0, separator),
        basisId = value('basis').slice(separator + 1)
      if (!['return', 'assessment'].includes(basisKind)) throw new Error('Invalid liability basis')
      edit = { ...common, kind: 'select-basis', basisKind: basisKind as 'return' | 'assessment', basisId }
    } else throw new Error('Invalid review action')
    applyTaxHistoryEdit(taxHistoryPath(), edit, {
      stateWritable: config.finance.stateWritable,
      roots: { records: config.finance.recordsDir, tax: config.finance.taxDir },
    })
  } catch (error) {
    redirect(`${destination}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Review failed')}`)
  }
  revalidatePath('/taxes')
  revalidatePath('/taxes/history')
  revalidatePath(destination)
  redirect(destination)
}
