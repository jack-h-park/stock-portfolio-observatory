// XML forbids two hyphens inside a comment. macOS plutil and launchd accept the
// file anyway, which is why one template carried `--` in a comment for months; a
// strict parser (Python's plistlib, most XML tooling) rejects it. This keeps every
// launchd template under deploy/ parseable by the strict ones as well.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const deployDir = fileURLToPath(new URL('../deploy/', import.meta.url));
const plists = readdirSync(deployDir).filter((name) => name.endsWith('.plist'));

test('there are launchd templates to check', () => {
  assert.ok(plists.length > 0);
});

for (const name of plists) {
  test(`${name}: no double hyphen inside an XML comment`, () => {
    const text = readFileSync(new URL(name, new URL('../deploy/', import.meta.url)), 'utf8');
    const bad = [...text.matchAll(/<!--([\s\S]*?)-->/g)].filter((match) => match[1].includes('--'));
    assert.deepEqual(bad.map((match) => match[1].trim().slice(0, 80)), []);
  });
}
