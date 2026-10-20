/**
 * Empirical probe of the vendored 3Dmol.js 2.4.2 bundle.
 *
 * Loads `vendor/3Dmol-min.cjs` under Node with minimal DOM stubs and exercises
 * only the parsing/geometry layer (GLModel) — no WebGL, no canvas. This is how
 * the fork validates what `viewer.addModel(data, format)` actually does for
 * each declared format, instead of assuming.
 *
 * Usage: node probe/3dmol-probe.cjs
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

// ---------------------------------------------------------------------------
// Minimal browser stubs. The UMD build touches `window.navigator.userAgent` at
// load time and lazily probes canvas support; parsing itself needs no WebGL.
// ---------------------------------------------------------------------------
function stubDom() {
  const noop = () => {}
  const listeners = { addEventListener: noop, removeEventListener: noop }
  const canvas = () => ({
    style: {},
    width: 0,
    height: 0,
    getContext: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    appendChild: noop,
  })
  const documentElement = { style: {}, appendChild: noop, removeChild: noop }
  global.document = {
    createElement: (tag) => (tag === 'canvas' ? canvas() : { style: {}, appendChild: noop, getContext: () => null }),
    createElementNS: () => canvas(),
    documentElement,
    body: { style: {}, appendChild: noop, removeChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementsByTagName: () => [],
  }
  global.window = global
  global.self = global
  // Node 24 defines `navigator` as a getter-only global; override the descriptor.
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node-probe' },
    configurable: true,
    writable: true,
  })
  global.devicePixelRatio = 1
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  global.cancelAnimationFrame = (id) => clearTimeout(id)
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.assign(global, listeners)
}

stubDom()

const ns = require(path.join(__dirname, '..', 'vendor', '3Dmol-min.cjs'))

/** Summarize what a parse produced: atoms, bonds, elements. */
function summarize(atoms) {
  let bonds = 0
  const elements = new Set()
  for (const atom of atoms) {
    elements.add(atom.elem)
    for (const b of atom.bonds ?? []) {
      if (typeof b === 'number' && b > atom.index) bonds++
    }
  }
  return { atoms: atoms.length, bonds, elements: [...elements].sort().join('') }
}

/** Parse `data` as `format` through the same public path the viewer uses. */
function parseAs(format, data, options) {
  const model = new ns.GLModel()
  const logs = []
  const originalLog = console.log
  console.log = (...args) => { logs.push(args.join(' ')) }
  try {
    model.addMolData(data, format, options ?? { multimodel: false })
  } catch (error) {
    logs.push(`THREW: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    console.log = originalLog
  }
  const atoms = model.selectedAtoms({})
  return { ...summarize(atoms), model, logs }
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
const TWO_ATOM_MOL = [
  'ethylene-ish',
  '  probe',
  '',
  '  2  1  0  0  0  0  0  0  0  0999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.3400    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0',
  'M  END',
  '',
].join('\n')

const XY2_XYZ = ['2', 'two atoms', 'Cu 0.0 0.0 0.0', 'I  2.5 0.0 0.0', ''].join('\n')

const PDB_NO_CONECT = [
  'HEADER    PROBE',
  'ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  O   MOL A   1       1.230   0.000   0.000  1.00  0.00           O',
  'ATOM      3  I   MOL A   1       2.700   0.000   0.000  1.00  0.00           I',
  'END',
  '',
].join('\n')

const PDB_WITH_CONECT = [
  'HEADER    PROBE',
  'ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  O   MOL A   1       1.230   0.000   0.000  1.00  0.00           O',
  'CONECT    1    2',
  'CONECT    2    1',
  'END',
  '',
].join('\n')

// The reported failure mode: a 121-atom MOL with Cu and I, saved as .mol.
const BIG_MOL = (() => {
  const atoms = []
  // 119 carbons on a sphere shell + 1 Cu + 1 I = 121 atoms, 120 bonds (chain).
  for (let i = 0; i < 119; i++) {
    const t = (i / 119) * Math.PI * 2
    const y = Math.cos(t) * 8
    const r = Math.sin(t) * 8
    atoms.push([r.toFixed(4), y.toFixed(4), (i * 0.05).toFixed(4), 'C'])
  }
  atoms.push(['0.0000', '9.5000', '0.0000', 'Cu'])
  atoms.push(['0.0000', '-9.5000', '0.0000', 'I'])
  const atomLines = atoms.map(
    ([x, y, z, e]) => `  ${x.padStart(9)}${y.padStart(10)}${z.padStart(10)} ${e.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
  )
  const bondLines = []
  for (let i = 0; i < 120; i++) bondLines.push(`${String(i + 1).padStart(3)}${String(i + 2).padStart(3)}  1  0`)
  return [
    'big-complex', '  probe Cu/I', '',
    `${String(atoms.length).padStart(3)}${String(bondLines.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atomLines,
    ...bondLines,
    'M  END', '',
  ].join('\n')
})()

const results = []
const record = (label, r) => {
  results.push({ label, atoms: r.atoms, bonds: r.bonds, elements: r.elements, logs: r.logs })
}

// What the current plugin does: passes the declared format straight through.
record('mol  (as-is, what ships today)', parseAs('mol', TWO_ATOM_MOL))
record('mol  big 121-atom Cu/I', parseAs('mol', BIG_MOL))
record('sdf  same content', parseAs('sdf', TWO_ATOM_MOL))
record('sdf  big 121-atom Cu/I', parseAs('sdf', BIG_MOL))
record('xyz  (as-is)', parseAs('xyz', XY2_XYZ))
record('xyz  + assignBonds:true', parseAs('xyz', XY2_XYZ, { multimodel: false, assignBonds: true }))
record('pdb  no CONECT', parseAs('pdb', PDB_NO_CONECT))
record('pdb  no CONECT + assignBonds:true', parseAs('pdb', PDB_NO_CONECT, { multimodel: false, assignBonds: true }))
record('pdb  with CONECT', parseAs('pdb', PDB_WITH_CONECT))
record('gjf  (as-is)', parseAs('gjf', 'nope'))
record('mol2 (as-is, truncated)', parseAs('mol2', '@<TRIPOS>MOLECULE\nx\n'))
record('bogus format string', parseAs('nonsense', TWO_ATOM_MOL))

// Bond re-perception on the model object itself.
const pdbModel = parseAs('pdb', PDB_NO_CONECT)
let afterAssign = null
try {
  pdbModel.model.assignBonds()
  afterAssign = summarize(pdbModel.model.selectedAtoms({}))
} catch (error) {
  afterAssign = { error: String(error) }
}

console.log('='.repeat(78))
console.log('3Dmol 2.4.2 parse probe (version:', ns.version ?? 'n/a', ')')
console.log('='.repeat(78))
for (const r of results) {
  console.log(
    `${r.label.padEnd(34)} atoms=${String(r.atoms).padStart(3)}  bonds=${String(r.bonds).padStart(3)}  elems=${(r.elements || '-').padEnd(8)}  console=${r.logs.length ? JSON.stringify(r.logs) : '-'}`,
  )
}
console.log('-'.repeat(78))
console.log('GLModel.assignBonds() on no-CONECT PDB ->', JSON.stringify(afterAssign))
console.log('parser registry keys ->', Object.keys(ns.parsers ?? {}).join(',') || '(not exported as ns.parsers)')
