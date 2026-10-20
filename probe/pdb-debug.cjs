/** Focused debug of one PDB file through 3Dmol's parser. */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const noop = () => {}
const canvas = () => ({ style: {}, width: 0, height: 0, getContext: () => null, addEventListener: noop, removeEventListener: noop })
global.document = { createElement: () => canvas(), createElementNS: () => canvas(), documentElement: { style: {} }, body: { style: {}, appendChild: noop }, addEventListener: noop, removeEventListener: noop }
global.window = global
global.self = global
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-probe' }, configurable: true, writable: true })
global.devicePixelRatio = 1
global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)
global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }

const ns = require(path.join(__dirname, '..', 'vendor', '3Dmol-min.cjs'))
const file = process.argv[2]
const data = fs.readFileSync(file, 'utf8')

const model = new ns.GLModel()
model.addMolData(data, 'pdb', { multimodel: false })
const atoms = model.selectedAtoms({})
console.log('atoms:', atoms.length)
console.log('first 3 atoms:', JSON.stringify(atoms.slice(0, 3), null, 1).slice(0, 1200))

// Column sanity for the first record, using the PDB spec.
const line = data.split(/\r?\n/)[0]
const col = (a, b) => line.slice(a - 1, b)
console.log('record 1-6   :', JSON.stringify(col(1, 6)))
console.log('serial 7-11  :', JSON.stringify(col(7, 11)))
console.log('name 13-16   :', JSON.stringify(col(13, 16)))
console.log('resName 18-20:', JSON.stringify(col(18, 20)))
console.log('chain 22     :', JSON.stringify(col(22, 22)))
console.log('resSeq 23-26 :', JSON.stringify(col(23, 26)))
console.log('x 31-38      :', JSON.stringify(col(31, 38)), '->', parseFloat(col(31, 38)))
console.log('y 39-46      :', JSON.stringify(col(39, 46)), '->', parseFloat(col(39, 46)))
console.log('z 47-54      :', JSON.stringify(col(47, 54)), '->', parseFloat(col(47, 54)))
console.log('altLoc 17    :', JSON.stringify(col(17, 17)))
console.log('line length  :', line.length)
