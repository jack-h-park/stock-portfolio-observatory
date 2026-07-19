'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { policyFromFormData, saveTaxPolicy } from '@/lib/tax-policy'

export async function saveTaxSettings(formData: FormData) {
  const policy = policyFromFormData(formData)
  saveTaxPolicy(policy)
  revalidatePath('/tax-settings')
  revalidatePath('/tax-planning')
  redirect('/tax-settings?saved=1')
}
