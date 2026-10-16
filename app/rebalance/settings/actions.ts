'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { applyTargets, getAllocationPolicy, saveAllocationPolicy } from '@/lib/rebalance/allocation-policy'
import { getInstrumentClasses, saveInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import {
  classesFromSettingsForm,
  emptyAllocationPolicy,
  policyFromSettingsForm,
  policyWriteGuard,
  summarizeErrors,
  type SettingsErrorCode,
} from '@/lib/rebalance/settings-form'

const PATH = '/rebalance/settings'

function fail(section: string, codes: SettingsErrorCode[], line: number | null = null, detail?: unknown): never {
  if (detail !== undefined) console.error(`[rebalance-settings] ${section}:`, detail)
  const query = new URLSearchParams({ error: section })
  for (const code of codes) query.append('code', code)
  if (line != null) query.set('line', String(line))
  redirect(`${PATH}?${query.toString()}`)
}

function failWith(section: string, errors: string[]): never {
  console.error(`[rebalance-settings] ${section}:`, errors)
  const { codes, line } = summarizeErrors(errors)
  fail(section, codes, line)
}

function done(section: string): never {
  revalidatePath(PATH)
  revalidatePath('/rebalance')
  redirect(`${PATH}?saved=${section}`)
}

function savePolicySection(section: string, formData: FormData, recordTargets: boolean): never {
  const state = getAllocationPolicy()
  const guard = policyWriteGuard(state)
  if (guard) fail(section, [guard], null, state.error)
  const before = state.policy
  const { policy, errors } = policyFromSettingsForm(formData, before)
  if (errors.length) failWith(section, errors)
  // The parser leaves history alone; a target change made here is the maintainer's own.
  const baseline = before ?? emptyAllocationPolicy()
  const next = recordTargets
    ? applyTargets({ ...policy, targets: baseline.targets }, policy.targets, 'maintainer', new Date().toISOString())
    : policy
  try {
    saveAllocationPolicy(next)
  } catch (error) {
    fail(section, ['write_failed'], null, error)
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
    fail('classes', ['classes_invalid'], null, error)
  }
  const { classes, errors } = classesFromSettingsForm(formData, current)
  if (errors.length) failWith('classes', errors)
  try {
    saveInstrumentClasses(classes)
  } catch (error) {
    fail('classes', ['write_failed'], null, error)
  }
  done('classes')
}
