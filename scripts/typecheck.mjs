/**
 * Typecheck both halves with inherited stdio (see scripts/build.mjs for why).
 *
 * The host half is checked against the real `@deepseek-ai/*` packages, which
 * the installed harness distribution resolves from the profile tree (the fork
 * links them into `node_modules/@deepseek-ai`; see README).
 *
 * Usage: node scripts/typecheck.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

for (const project of ['tsconfig.json', 'tsconfig.client.json']) {
  process.stdout.write(`\n▶ typecheck ${project}\n`)
  const outcome = spawnSync(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' })
  if (outcome.error !== undefined) {
    console.error(`✖ typecheck ${project}: ${outcome.error.message}`)
    process.exit(1)
  }
  if (outcome.status !== 0) process.exit(outcome.status ?? 1)
}
process.stdout.write('\n✓ typecheck clean\n')
