import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// push-sources.sh has no --delete on purpose, so a file moved or retired on the
// laptop stays on the refresh host. After the push it now asks rsync what
// --delete WOULD remove and prints it. These tests run the real script with a
// fake rsync and ssh in front of PATH: the drift call is the one that carries
// -an, everything else is the push itself.

const script = path.join(import.meta.dirname, '..', 'scripts', 'push-sources.sh')

function run({ stale = '', rsyncDriftFails = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'push-sources-stale-'))
  try {
    const bin = path.join(dir, 'bin')
    const data = path.join(dir, 'data')
    mkdirSync(bin)
    mkdirSync(path.join(data, 'kr-statements'), { recursive: true })
    writeFileSync(
      path.join(bin, 'rsync'),
      '#!/bin/sh\n' +
        'if [ "$1" = "-an" ]; then\n' +
        '  [ -n "$FAKE_DRIFT_FAILS" ] && exit 23\n' +
        '  printf "%s" "$FAKE_STALE"\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n',
    )
    writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nexit 0\n')
    chmodSync(path.join(bin, 'rsync'), 0o755)
    chmodSync(path.join(bin, 'ssh'), 0o755)

    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: dir,
        STOCK_DATA_DIR: data,
        STOCK_PROD_HOST: 'fake-host',
        STOCK_PROD_DATA_DIR: 'remote/data',
        STOCK_PYTHON_BIN: '/nonexistent/python', // skip the inbox filing step
        FAKE_STALE: stale,
        FAKE_DRIFT_FAILS: rsyncDriftFails ? '1' : '',
      },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('files only the far side still has are listed, and directories are not counted', () => {
  const result = run({
    stale: [
      '*deleting kr-statements/mirae-gold-transactions-20230101-20261010.pdf',
      '*deleting kr-statements/old name with spaces.pdf',
      '*deleting bank-statements/_pending-parser/',
      '.d..t.... kr-statements/',
      '',
    ].join('\n'),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /far side still has 2 file\(s\) this machine no longer has/)
  assert.match(result.stdout, / {2}kr-statements\/mirae-gold-transactions-20230101-20261010\.pdf/)
  assert.match(result.stdout, / {2}kr-statements\/old name with spaces\.pdf/)
  assert.ok(!result.stdout.includes('_pending-parser'), 'a directory line is not a file')
})

test('nothing is printed when the far side has no leftovers', () => {
  const result = run({ stale: '.d..t.... kr-statements/\n' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes('far side still has'))
})

test('a long list is cut at 20 lines and says how many were left out', () => {
  const stale = Array.from({ length: 25 }, (_, i) => `*deleting kr-statements/stale-${String(i).padStart(2, '0')}.pdf`).join('\n') + '\n'
  const result = run({ stale })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /far side still has 25 file\(s\)/)
  assert.match(result.stdout, /stale-19\.pdf/)
  assert.ok(!result.stdout.includes('stale-20.pdf'))
  assert.match(result.stdout, /\.\.\. and 5 more/)
})

test('a failing drift check never fails the push', () => {
  const result = run({ stale: '*deleting kr-statements/x.pdf\n', rsyncDriftFails: true })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes('far side still has'))
  assert.match(result.stdout, /pushed\./)
})
