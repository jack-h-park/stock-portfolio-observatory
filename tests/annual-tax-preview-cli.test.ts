import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import example from '../examples/annual-tax-estimate.synthetic.json'
import qdcg from '../examples/annual-tax-qdcg.synthetic.json'
import { calculateAnnualComponents } from '../lib/domain/taxes/annual/calculate'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root, 'scripts/annual-tax-preview.ts')
const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs')
function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'annual-preview-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const input = path.join(dir, 'scenario.json')
  return {
    dir, input,
    write(value: unknown) { writeFileSync(input, JSON.stringify(value)); return input },
    run(args: string[], preload?: string) {
      return spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), '--import', loader, entry, ...args], {
        cwd: dir, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.json'), FINANCE_MODE: 'private', FINANCE_STATE_WRITABLE: '1', FINANCE_TAX_DIR: path.join(dir, 'not-evidence'), STOCK_DATA_DIR: path.join(dir, 'not-data') },
      })
    },
  }
}

test('CLI emits unchanged component contracts and deterministic JSON for supported US methods', t => {
  const f = fixture(t)
  const both = structuredClone(example) as any
  both.requestedComponents.push('us.niit')
  both.amounts.niitMagi = { ...both.amounts.taxableIncome, minor: '30000000' }
  both.amounts.netInvestmentIncome = { ...both.amounts.taxableIncome, minor: '2000000' }
  for (const input of [both, qdcg]) {
    f.write(input)
    const result = f.run(['--input', f.input])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const parsed = JSON.parse(result.stdout)
    assert.deepEqual(parsed, calculateAnnualComponents(input))
    assert.equal(parsed.annualTotal, null)
    assert.equal(parsed.comparisonEligible, false)
    assert.equal(result.stdout, f.run(['--input', f.input]).stdout)
    assert.ok(result.stdout.endsWith('\n'))
    if (input === both) assert.deepEqual(parsed.components.map((c: any) => c.amountMinor), ['1622800', '76000'])
  }
})

test('valid missing-base and Korean previews stay blocked with null money rather than inferred zero', t => {
  const f = fixture(t)
  const missing = structuredClone(example) as any
  missing.amounts = {}
  const kr = structuredClone(example) as any
  kr.authority = 'KR:national'; kr.currency = 'KRW'; kr.filingStatus = 'individual'
  kr.taxUnit = { id: 'synthetic-kr', kind: 'individual', ownerIds: ['example-a'] }
  kr.regularTaxMethod.state = 'general-reviewed'
  kr.requestedComponents = ['kr.global.calculated']
  kr.amounts = { taxableBase: { ...example.amounts.taxableIncome, currency: 'KRW', minor: '30000000' } }
  const local = structuredClone(kr)
  local.authority = 'KR:local'; local.requestedComponents = ['kr.local.calculated']
  for (const input of [missing, kr, local]) {
    f.write(input)
    const result = f.run(['--input', f.input])
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.status, 'blocked')
    assert.equal(parsed.components[0].amountMinor, null)
    assert.ok(parsed.components[0].reason)
    assert.equal(parsed.annualTotal, null)
    assert.equal(parsed.comparisonEligible, false)
  }
})

test('CLI rejects ambiguous/write arguments and emits no result for invalid invocation', t => {
  const f = fixture(t); f.write(example)
  for (const args of [[], ['--input'], ['--input', f.input, '--input', f.input], ['--input', f.input, '--apply'], ['--input', f.input, '--output', f.input], ['--help', '--input', f.input], ['--input', f.input, '--rule-pack', 'latest'], [f.input]]) {
    const result = f.run(args)
    assert.equal(result.status, 2, JSON.stringify(args))
    assert.equal(result.stdout, '')
    assert.ok(result.stderr.length > 0)
    assert.ok(!result.stderr.includes(f.dir))
  }
  const help = f.run(['--help'])
  assert.equal(help.status, 0)
  assert.equal(help.stderr, '')
  assert.match(help.stdout, /component/i)
  assert.match(help.stdout, /blocked/i)
})

test('invalid JSON/contracts, unreadable paths and non-regular/oversized inputs fail without leaking values', t => {
  const f = fixture(t)
  for (const text of ['{"secret-sensitive-marker":', JSON.stringify({ ...example, secretSensitiveMarker: 'private-value' }), JSON.stringify({ ...example, taxYear: 2026 }), ' '.repeat(1024 * 1024 + 1)]) {
    writeFileSync(f.input, text)
    const result = f.run(['--input', f.input])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.ok(!/secret|private-value|2026|annual-preview-/.test(result.stderr))
    assert.equal(readFileSync(f.input, 'utf8'), text)
  }
  for (const name of [f.dir, path.join(f.dir, 'missing.json')]) {
    const result = f.run(['--input', name])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.ok(!result.stderr.includes(name))
  }
})

test('CLI reads only its explicit scenario and preserves inputs/configuration with no created files', t => {
  const f = fixture(t)
  const input = structuredClone(example)
  input.sources[0].locator = path.join(f.dir, 'missing-evidence.pdf')
  f.write(input)
  writeFileSync(path.join(f.dir, '.env.local'), 'INVALID_ENV_SENTINEL\nFINANCE_STATE_WRITABLE=1\n')
  writeFileSync(path.join(f.dir, 'tax-history.json'), '{"sentinel":"unchanged"}')
  const snapshot = () => readdirSync(f.dir).sort().map(name => {
    const file = path.join(f.dir, name)
    return [name, readFileSync(file, 'utf8'), statSync(file).mtimeMs]
  })
  const guard = path.join(f.dir, 'guard.mjs')
  const guardedPaths = [path.join(f.dir, '.env.local'), path.join(f.dir, 'tax-history.json'), input.sources[0].locator]
  writeFileSync(guard, `
    import fs from 'node:fs';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { syncBuiltinESMExports } from 'node:module';
    const paths = new Set(${JSON.stringify(guardedPaths)});
    function inspect(value) {
      if (value instanceof URL) value = fileURLToPath(value);
      if (Buffer.isBuffer(value)) value = value.toString();
      if (typeof value === 'string' && paths.has(path.resolve(value))) process.stderr.write('UNEXPECTED_SENTINEL_ACCESS:' + [...paths].indexOf(path.resolve(value)) + '\\n');
    }
    for (const target of [fs, fs.promises]) {
      for (const name of ['readFileSync','readFile','openSync','open','statSync','stat','lstatSync','lstat','accessSync','access','existsSync','createReadStream']) {
        if (typeof target[name] !== 'function') continue;
        const original = target[name];
        target[name] = function(first, ...rest) { inspect(first); return Reflect.apply(original, this, [first, ...rest]); };
      }
    }
    syncBuiltinESMExports();
  `)
  // Prove the observer detects reads and ignored ENOENT, not just unchanged bytes.
  const probe = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '--eval', `
    import fs from 'node:fs';
    fs.readFileSync(${JSON.stringify(guardedPaths[0])});
    await fs.promises.readFile(${JSON.stringify(guardedPaths[1])});
    try { fs.readFileSync(${JSON.stringify(guardedPaths[2])}); } catch {}
  `], { cwd: f.dir, encoding: 'utf8', timeout: 15000 })
  assert.equal(probe.status, 0, probe.stderr)
  for (const index of [0, 1, 2]) assert.ok(probe.stderr.includes(`UNEXPECTED_SENTINEL_ACCESS:${index}`))
  const before = snapshot()
  const result = f.run(['--input', 'scenario.json'], guard)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).components[0].amountMinor, '1622800')
  assert.equal(result.stderr, '')
  assert.deepEqual(snapshot(), before)
})

test('CLI accepts a full-size valid UTF-8 JSON file and rejects malformed UTF-8 bytes', t => {
  const f = fixture(t)
  const json = JSON.stringify(example)
  writeFileSync(f.input, json + ' '.repeat(1024 * 1024 - Buffer.byteLength(json)))
  assert.equal(f.run(['--input', f.input]).status, 0)
  // Place invalid bytes inside a JSON string so replacement decoding would silently accept it.
  const bytes = Buffer.from(json)
  const start = bytes.indexOf('Synthetic reviewed fact')
  bytes[start] = 0xff
  writeFileSync(f.input, bytes)
  const result = f.run(['--input', f.input])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.deepEqual(readFileSync(f.input), bytes)
})

test('canonical silent package command emits only JSON and redacts failed input paths', t => {
  const f = fixture(t); f.write(example)
  const run = (args: string[]) => spawnSync('pnpm', ['--silent', 'tax:annual:preview', ...args], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 15000,
  })
  const valid = run(['--input', f.input])
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(JSON.parse(valid.stdout).components[0].amountMinor, '1622800')
  const invalid = run(['--input', path.join(f.dir, 'private-missing-scenario.json')])
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, '')
  assert.ok(!invalid.stderr.includes(f.dir))
  assert.match(run(['--help']).stdout, /pnpm --silent tax:annual:preview/)
})
