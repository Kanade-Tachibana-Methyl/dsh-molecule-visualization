/**
 * One-command verification: typecheck → unit tests → real-file probe.
 *
 * Usage:
 *   node scripts/verify.mjs             # probe the repository itself
 *   node scripts/verify.mjs path/to/molecules   # additionally validate real files
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extraArgs = process.argv.slice(2)

const steps = [
  { label: 'typecheck', command: process.execPath, args: ['scripts/typecheck.mjs'] },
  { label: 'unit tests', command: process.execPath, args: ['test/run-all.ts'] },
  { label: '3Dmol.js parse probe', command: process.execPath, args: ['probe/3dmol-probe.cjs'] },
  { label: 'built-artifact smoke test', command: process.execPath, args: ['probe/built-artifacts-probe.mjs'] },
  {
    label: 'real-file pipeline probe',
    command: process.execPath,
    // Without an explicit directory the probe scans the current working
    // directory, so a fresh clone never reaches outside itself by default.
    args: ['probe/verify-real-files.mjs', ...extraArgs],
  },
]

for (const step of steps) {
  process.stdout.write(`\n${'='.repeat(72)}\n▶ ${step.label}\n${'='.repeat(72)}\n`)
  const outcome = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' })
  if (outcome.error !== undefined) {
    console.error(`✖ ${step.label}: ${outcome.error.message}`)
    process.exit(1)
  }
  if (outcome.status !== 0) {
    console.error(`\n✖ ${step.label} failed (exit ${String(outcome.status)})`)
    process.exit(outcome.status ?? 1)
  }
}
process.stdout.write('\n✓ all verification steps passed\n')
