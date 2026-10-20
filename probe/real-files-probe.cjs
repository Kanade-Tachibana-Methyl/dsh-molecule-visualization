/**
 * Scan real molecular files under a directory and compare what 3Dmol 2.4.2
 * produces when the declared format is passed straight through (the current
 * plugin's behaviour) versus the explicit format mapping the fork will use.
 *
 * Usage: node probe/real-files-probe.cjs [rootDir]
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function stubDom() {
  const noop = () => {}
  const canvas = () => ({ style: {}, width: 0, height: 0, getContext: () => null, addEventListener: noop, removeEventListener: noop })
  global.document = {
    createElement: () => canvas(), createElementNS: () => canvas(),
    documentElement: { style: {} }, body: { style: {}, appendChild: noop },
    addEventListener: noop, removeEventListener: noop,
  }
  global.window = global
  global.self = global
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-probe' }, configurable: true, writable: true })
  global.devicePixelRatio = 1
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0)
  global.cancelAnimationFrame = (id) => clearTimeout(id)
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
}
stubDom()

const ns = require(path.join(__dirname, '..', 'vendor', '3Dmol-min.cjs'))

function parse(format, data) {
  const model = new ns.GLModel()
  const logs = []
  const orig = console.log
  console.log = (...a) => { logs.push(a.join(' ')) }
  let threw = null
  try {
    model.addMolData(data, format, { multimodel: false })
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  } finally {
    console.log = orig
  }
  const atoms = model.selectedAtoms({})
  let bonds = 0
  const elems = new Map()
  for (const a of atoms) {
    elems.set(a.elem, (elems.get(a.elem) ?? 0) + 1)
    for (const b of a.bonds ?? []) if (typeof b === 'number' && b > a.index) bonds++
  }
  return { atoms: atoms.length, bonds, elems, logs, threw }
}

const root = process.argv[2] ?? process.cwd()
const exts = new Set(['.mol', '.sdf', '.sd', '.pdb', '.ent', '.mol2', '.xyz', '.gjf', '.log'])
const files = []
;(function walk(dir, depth) {
  if (depth > 6 || files.length > 400) return
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (exts.has(path.extname(entry.name).toLowerCase())) files.push(full)
  }
})(root, 0)

const EXT_FORMAT = { '.pdb': 'pdb', '.ent': 'pdb', '.sdf': 'sdf', '.sd': 'sdf', '.mol2': 'mol2', '.mol': 'mol', '.xyz': 'xyz', '.gjf': 'gjf', '.log': 'log' }

let checked = 0
let mismatches = 0
console.log('file'.padEnd(46), 'declared'.padEnd(9), 'atoms/bonds (as-is)'.padEnd(22), 'mapped', 'notes')
console.log('-'.repeat(120))
for (const file of files) {
  const ext = path.extname(file).toLowerCase()
  const declared = EXT_FORMAT[ext]
  if (declared === undefined) continue
  const data = fs.readFileSync(file, 'utf8')
  const asIs = parse(declared, data)
  let mapped = null
  if (declared === 'mol') mapped = parse('sdf', data)
  if (declared === 'gjf') mapped = parse('xyz', data)
  checked++
  const rel = file.length > 44 ? '…' + file.slice(-43) : file
  const note = []
  if (asIs.threw) note.push(`THREW ${asIs.threw}`)
  if (asIs.logs.length > 0) note.push(asIs.logs.join('; '))
  const bad = asIs.atoms === 0 || (asIs.bonds === 0 && asIs.atoms > 1)
  if (mapped !== null && mapped.atoms !== asIs.atoms) {
    mismatches++
    note.push(`MAPPED AS ${declared === 'mol' ? 'sdf' : 'xyz'} => ${mapped.atoms} atoms / ${mapped.bonds} bonds`)
  }
  console.log(
    rel.padEnd(46),
    declared.padEnd(9),
    `${asIs.atoms}/${asIs.bonds}`.padEnd(22),
    mapped === null ? '-' : `${mapped.atoms}/${mapped.bonds}`,
    (bad ? 'EMPTY! ' : '') + note.join(' | '),
  )
}
console.log('-'.repeat(120))
console.log(`checked=${checked} atom-count mismatches=${mismatches}`)
