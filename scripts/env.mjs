import fs from 'node:fs'
import path from 'node:path'

export function loadLocalEnv(cwd = process.cwd()) {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(cwd, filename)
    if (!fs.existsSync(filePath)) continue
    const body = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] != null) continue
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
    }
  }
}
