'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { applyTargets, getAllocationPolicy, saveAllocationPolicy } from '@/lib/rebalance/allocation-policy'
import { getInstrumentClasses, saveInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { classesFromSettingsForm, emptyAllocationPolicy, policyFromSettingsForm } from '@/lib/rebalance/settings-form'

const PATH = '/rebalance/settings'

function fail(section: string, errors: string[]): never {
  const query = new URLSearchParams({ error: section })
  for (const message of errors.slice(0, 10)) query.append('e', message.slice(0, 200))
  redirect(`${PATH}?${query.toString()}`)
}

function done(section: string): never {
  revalidatePath(PATH)
  revalidatePath('/rebalance')
  redirect(`${PATH}?saved=${section}`)
}

function savePolicySection(section: string, formData: FormData, recordTargets: boolean): never {
  const before = getAllocationPolicy().policy
  const { policy, errors } = policyFromSettingsForm(formData, before)
  if (errors.length) fail(section, errors)
  // The parser leaves history alone; a target change made here is the maintainer's own.
  const baseline = before ?? emptyAllocationPolicy()
  const next = recordTargets
    ? applyTargets({ ...policy, targets: baseline.targets }, policy.targets, 'maintainer', new Date().toISOString())
    : policy
  try {
    saveAllocationPolicy(next)
  } catch (error) {
    fail(section, [(error as Error).message])
  }
  done(section)
}

export async function saveBoundsAndTargets(formData: FormData) {
  savePolicySection('bounds', formData, true)
}

export async function saveLimits(formData: FormData) {
  savePolicySection('limits', formData, false)
}

export async function saveAccountRules(formData: FormData) {
  savePolicySection('accounts', formData, false)
}

export async function saveBuyLists(formData: FormData) {
  savePolicySection('buyLists', formData, false)
}

export async function saveInstrumentClassesAction(formData: FormData) {
  let current
  try {
    current = getInstrumentClasses()
  } catch (error) {
    fail('classes', [(error as Error).message])
  }
  const { classes, errors } = classesFromSettingsForm(formData, current)
  if (errors.length) fail('classes', errors)
  saveInstrumentClasses(classes)
  done('classes')
}
