import type { Command } from '@/lib/cli/common'
import { fbarTableCommand } from '@/lib/cli/fbar-table'
import { sourcesStatusCommand } from '@/lib/cli/sources-status'
import { taxCalendarCommand } from '@/lib/cli/tax-calendar'
import { taxRealizedCommand } from '@/lib/cli/tax-realized'
import { taxScenarioCommand } from '@/lib/cli/tax-scenario'

/** The read-only CLIs, by the pnpm script name that runs each (scripts/observatory-cli.mjs). */
export const commands: Record<string, Command> = {
  'tax:scenario': taxScenarioCommand,
  'tax:calendar': taxCalendarCommand,
  'tax:realized': taxRealizedCommand,
  'sources:status': sourcesStatusCommand,
  'fbar:table': fbarTableCommand,
}
