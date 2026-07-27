// summary.mjs — entry point for `pnpm summary`.
//
// Exists for one reason: `.env.local` must be in process.env BEFORE
// write-briefing-summary.ts is evaluated. That module imports @/config, and
// config.ts resolves every path once at module-initialisation time — so a config
// evaluated too early has already decided where the database and the published
// summary live, and the .env.local values never apply.
//
// This failed exactly that way: `pnpm summary` run by hand ignored .env.local and
// wrote into the repo instead of beside the database, while the scheduled path
// looked healthy the whole time because refresh.mjs loads the env itself and
// spawns its steps with it. A wrong path, no error, and only the consumers —
// which would have reported "unavailable" — to show for it.
//
// A statement here rather than an import-order convention inside the TypeScript
// module: `import` is hoisted, so putting loadLocalEnv() "first" in that file
// would not have worked, and a side-effect import declared first is exactly the
// kind of line an import sorter reorders without anyone noticing. A file boundary
// cannot be reordered.
//
// Nothing else belongs here. The work stays in write-briefing-summary.ts.

import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

await import('./write-briefing-summary.ts')
