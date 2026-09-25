// The Hermes cron installer: role-marker gate, required delivery target, paused create.
// The behaviour lives in tests/install-cron-test.sh, which drives the real installer
// against a throwaway HOME with a stub Hermes interpreter; this puts it under `pnpm test`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('install-cron.sh gates on the role marker, needs a target, and creates jobs paused', () => {
  const script = fileURLToPath(new URL('./install-cron-test.sh', import.meta.url));
  const result = spawnSync('bash', [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
