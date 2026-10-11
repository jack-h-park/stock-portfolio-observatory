'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseUsTargetPct, saveRebalancePolicy } from '@/lib/rebalance-policy'

export async function saveRebalanceTargets(formData: FormData) {
  const usTargetPct = parseUsTargetPct(formData.get('usTargetPct'))
  if (usTargetPct == null) redirect('/rebalance?target=invalid')
  saveRebalancePolicy(usTargetPct)
  revalidatePath('/rebalance')
  redirect('/rebalance?target=saved')
}
