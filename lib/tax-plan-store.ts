import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '@/config'
import type { MasterPlanStrategyKey, MonthlySaleMasterPlan } from '@/lib/tax-planning'

export type SavedTaxPlanStatus = 'draft' | 'reviewed' | 'active' | 'completed' | 'archived'
export type SavedInstructionStatus = 'planned' | 'reviewed' | 'executed' | 'skipped'

export type SavedInstructionExecution = {
  status: SavedInstructionStatus
  updatedAt: string
  executedAt: string | null
  actualProceedsKrw: number | null
  actualGainKrw: number | null
  note: string
}

export type SavedTaxPlan = {
  schemaVersion: 1
  id: string
  name: string
  status: SavedTaxPlanStatus
  revision: number
  createdAt: string
  updatedAt: string
  asOfDate: string
  strategy: MasterPlanStrategyKey
  executionMonths: number
  horizonYears: number
  policyVersion: number
  policyUpdatedAt: string | null
  plan: MonthlySaleMasterPlan
  execution: Record<string, SavedInstructionExecution>
}

type TaxPlanStore = {
  version: 1
  plans: SavedTaxPlan[]
}

const EMPTY_STORE: TaxPlanStore = { version: 1, plans: [] }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStore(filePath: string): TaxPlanStore {
  if (!fs.existsSync(filePath)) return clone(EMPTY_STORE)
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<TaxPlanStore>
  return {
    version: 1,
    plans: Array.isArray(raw.plans) ? raw.plans : [],
  }
}

function writeStore(store: TaxPlanStore, filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

function cleanName(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 120)
  return normalized || fallback
}

export function listSavedTaxPlans(filePath = config.stockTaxPlansPath) {
  return readStore(filePath).plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getSavedTaxPlan(id: string, filePath = config.stockTaxPlansPath) {
  return listSavedTaxPlans(filePath).find((plan) => plan.id === id) ?? null
}

export function createSavedTaxPlan({
  name,
  plan,
  asOfDate,
  horizonYears,
  policyVersion,
  policyUpdatedAt,
  filePath = config.stockTaxPlansPath,
  now = new Date(),
}: {
  name: string
  plan: MonthlySaleMasterPlan
  asOfDate: string
  horizonYears: number
  policyVersion: number
  policyUpdatedAt: string | null
  filePath?: string
  now?: Date
}) {
  const store = readStore(filePath)
  const timestamp = now.toISOString()
  const saved: SavedTaxPlan = {
    schemaVersion: 1,
    id: randomUUID(),
    name: cleanName(name, `${plan.label} · ${asOfDate}`),
    status: 'draft',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    asOfDate,
    strategy: plan.strategy,
    executionMonths: plan.executionMonths,
    horizonYears,
    policyVersion,
    policyUpdatedAt,
    plan: clone(plan),
    execution: {},
  }
  store.plans.unshift(saved)
  writeStore(store, filePath)
  return saved
}

export function updateSavedTaxPlanStatus({
  id,
  status,
  filePath = config.stockTaxPlansPath,
  now = new Date(),
}: {
  id: string
  status: SavedTaxPlanStatus
  filePath?: string
  now?: Date
}) {
  const store = readStore(filePath)
  const plan = store.plans.find((item) => item.id === id)
  if (!plan) return null
  plan.status = status
  plan.revision += 1
  plan.updatedAt = now.toISOString()
  writeStore(store, filePath)
  return plan
}

export function updateSavedInstructionExecution({
  planId,
  instructionId,
  status,
  executedAt = null,
  actualProceedsKrw = null,
  actualGainKrw = null,
  note = '',
  filePath = config.stockTaxPlansPath,
  now = new Date(),
}: {
  planId: string
  instructionId: string
  status: SavedInstructionStatus
  executedAt?: string | null
  actualProceedsKrw?: number | null
  actualGainKrw?: number | null
  note?: string
  filePath?: string
  now?: Date
}) {
  const store = readStore(filePath)
  const plan = store.plans.find((item) => item.id === planId)
  if (!plan || !plan.plan.instructions.some((item) => item.id === instructionId)) return null
  const timestamp = now.toISOString()
  plan.execution[instructionId] = {
    status,
    updatedAt: timestamp,
    executedAt: status === 'executed' ? executedAt || timestamp.slice(0, 10) : null,
    actualProceedsKrw: status === 'executed' ? actualProceedsKrw : null,
    actualGainKrw: status === 'executed' ? actualGainKrw : null,
    note: note.trim().slice(0, 500),
  }
  plan.revision += 1
  plan.updatedAt = timestamp
  writeStore(store, filePath)
  return plan
}

export function savedTaxPlanProgress(plan: SavedTaxPlan) {
  const rows = plan.plan.instructions
  const executionRows = rows.map((row) => plan.execution[row.id])
  const count = (status: SavedInstructionStatus) =>
    executionRows.filter((execution) => (execution?.status ?? 'planned') === status).length
  const executedProceedsKrw = rows.reduce((sum, row) => {
    const execution = plan.execution[row.id]
    if (execution?.status !== 'executed') return sum
    return sum + Number(execution.actualProceedsKrw ?? row.proceedsKrw)
  }, 0)
  return {
    total: rows.length,
    planned: count('planned'),
    reviewed: count('reviewed'),
    executed: count('executed'),
    skipped: count('skipped'),
    executedProceedsKrw,
    completionPct: rows.length > 0 ? ((count('executed') + count('skipped')) / rows.length) * 100 : 0,
  }
}
