'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseUsTargetPct, saveRebalancePolicy } from '@/lib/rebalance-policy'
import { portfolioToday } from '@/lib/adapters/portfolio-db'
import { proposeEngineOnly } from '@/lib/rebalance/propose'

export async function saveRebalanceTargets(formData: FormData) {
  const usTargetPct = parseUsTargetPct(formData.get('usTargetPct'))
  if (usTargetPct == null) redirect('/rebalance?target=invalid')
  saveRebalancePolicy(usTargetPct)
  revalidatePath('/rebalance')
  redirect('/rebalance?target=saved')
}

/**
 * Builds a manual proposal from the current targets (no target change), then opens it. Only a fixed
 * reason code travels back in the URL; the detail goes to the server log.
 */
export async function createManualProposal() {
  let result: ReturnType<typeof proposeEngineOnly>
  try {
    result = proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: portfolioToday(), now: new Date() })
  } catch (error) {
    console.error('[rebalance] createManualProposal:', error)
    redirect('/rebalance?error=propose_failed')
  }
  if (!result.ok) {
    console.error('[rebalance] createManualProposal:', result.reason, result.detail)
    redirect(`/rebalance?error=${result.reason}`)
  }
  revalidatePath('/rebalance')
  redirect(`/rebalance/proposals/${encodeURIComponent(result.proposal.id)}?done=created`)
}
