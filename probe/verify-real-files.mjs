/**
 * End-to-end verification over real molecular files.
 *
 * Pipeline under test, exactly as the plugin runs it in production:
 *   file → `parseMolecule(format, data)` (host validation + render payload)
 *        → 3Dmol.js `addMolData(payload, payload.format)` (what the browser does).
 *
 * A file passes only when the host accepts it AND 3Dmol.js loads the atom count
 * the host reported — the second half is what the fork adds, because a host
 * parser can accept content that 3Dmol.js then renders as nothing.
 *
 * Usage: node probe/verify-real-files.mjs [rootDir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { parseMolecule } from '../src/parser.ts'

const here = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Browser stubs for the vendored 3Dmol.js UMD bundle (parsing needs no WebGL).
// ---------------------------------------------------------------------------
const noop = () => {}
const canvas = () => ({ style: {}, width: 0, height: 0, getContext: () => null, addEventListener: noop, removeEventListener: noop })
globalThis.window = globalThis
globalThis.self = globalThis
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-probe' }, configurable: true, writable: true })
globalThis.document = {
  createElement: () => canvas(),
  createElementNS: () => canvas(),
  documentElement: { style: {} },
  body: { style: {}, appendChild: noop },
  addEventListener: noop,
  removeEventListener: noop,
}
globalThis.devicePixelRatio = 1
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const threeDmol = createRequire(import.meta.url)(join(here, '..', 'vendor', '3Dmol-min.cjs'))

/** Parse a render payload exactly like `viewer.addModel(data, format, opts)`. */
function render(payload) {
  const model = new threeDmol.GLModel()
  const logs = []
  const originalLog = console.log
  console.log = (...args) => { logs.push(args.join(' ')) }
  try {
    model.addMolData(payload.data, payload.format, {
      multimodel: false,
      ...(payload.format === 'pdb' ? { keepH: true } : {}),
    })
  } catch (error) {
    logs.push(`THREW ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    console.log = originalLog
  }
  const atoms = model.selectedAtoms({})
  let bonds = 0
  for (let index = 0; index < atoms.length; index++) {
    for (const neighbour of atoms[index].bonds ?? []) if (typeof neighbour === 'number' && neighbour > index) bonds++
  }
  return { atoms: atoms.length, bonds, logs }
}

const EXTENSION_FORMAT = {
  '.pdb': 'pdb', '.ent': 'pdb', '.sdf': 'sdf', '.sd': 'sdf', '.mol': 'mol',
  '.mol2': 'mol2', '.xyz': 'xyz', '.gjf': 'gjf', '.com': 'gjf',
}

const root = resolve(process.argv[2] ?? process.cwd())
const files = []
;(function walk(directory, depth) {
  if (depth > 6 || files.length > 500) return
  let entries
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (EXTENSION_FORMAT[extname(entry.name).toLowerCase()] !== undefined) files.push(full)
  }
})(root, 0)

const rows = []
let failed = 0
let emptyRender = 0
let countMismatch = 0

for (const file of files) {
  const format = EXTENSION_FORMAT[extname(file).toLowerCase()]
  const data = readFileSync(file, 'utf8')
  const host = parseMolecule(format, data)
  if (!host.ok) {
    failed++
    rows.push({ file, format, verdict: 'REJECTED', detail: host.error ?? '', atoms: '-', rendered: '-' })
    continue
  }
  const outcome = render(host.render ?? { format, data })
  const expected = host.renderAtomCount
  if (outcome.atoms === 0) emptyRender++
  const mismatch = outcome.atoms !== expected
  if (mismatch) countMismatch++
  const warnings = host.warnings.map((warning) => warning.code)
  rows.push({
    file,
    format,
    verdict: mismatch ? 'RENDER-MISMATCH' : 'ok',
    detail: [
      `host=${expected}`,
      `3dmol=${outcome.atoms}/${outcome.bonds}b`,
      warnings.length > 0 ? `warn=${warnings.join(',')}` : '',
      outcome.logs.length > 0 ? `log=${outcome.logs.join(';')}` : '',
    ].filter(Boolean).join('  '),
    atoms: expected,
    rendered: outcome.atoms,
  })
}

const terminalWidth = 120
console.log('='.repeat(terminalWidth))
console.log('host validation → 3Dmol.js render (vendored 2.4.2)')
console.log('='.repeat(terminalWidth))
for (const row of rows) {
  const name = row.file.length > 52 ? `…${row.file.slice(-51)}` : row.file
  console.log(`${name.padEnd(53)} ${row.format.padEnd(4)} ${row.verdict.padEnd(16)} ${row.detail}`)
}
console.log('-'.repeat(terminalWidth))
console.log(`files=${rows.length}  rejected-by-host=${failed}  rendered-0-atoms=${emptyRender}  count-mismatch=${countMismatch}`)
if (failed > 0 || emptyRender > 0 || countMismatch > 0) {
  console.log('verdict: FAIL — every accepted file must render the atom count the host reported')
  process.exitCode = 1
} else {
  console.log('verdict: PASS')
}
