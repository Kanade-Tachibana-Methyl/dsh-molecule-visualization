/**
 * Smoke test for the *built* artifacts (`lib/`), not the TypeScript sources.
 *
 * The host bundle is imported as an ES module; the client bundle is evaluated
 * through a stub of the harness's lazy-CJS module table (`window.__ModuleLoader__`)
 * so a broken banner/footer, a missing external, or a bad export is caught before
 * the bundle is served to a browser.
 *
 * Usage: node probe/built-artifacts-probe.mjs
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// ---------------------------------------------------------------------------
// Host half
// ---------------------------------------------------------------------------
const host = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
assert.equal(typeof host.apply, 'function', 'host half must export apply()')
assert.ok(Array.isArray(host.inject) && host.inject.includes('tools'), 'host half must inject tools')
assert.equal(typeof host.Config, 'function', 'host half must export the Config schema')
assert.equal(typeof host.renderFormatFor, 'function', 'host half must re-export renderFormatFor()')

const config = new host.Config({})
assert.equal(config.defaultStyle, 'stick', 'default style must stay stick')
assert.equal(config.repairShiftedPdbAltLoc, true, 'PDB column repair must default to on')
assert.equal(host.renderFormatFor('mol'), 'sdf')
assert.equal(host.renderFormatFor('gjf'), 'xyz')

const parser = await import(pathToFileURL(join(root, 'lib', 'parser.js')).href)
const mol = [
  'probe', '  init', '',
  '  2  1  0  0  0  0  0  0  0  0999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.3400    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0', 'M  END', '',
].join('\n')
const parsed = parser.parseMolecule('mol', mol)
assert.equal(parsed.ok, true, 'built parser must accept a molfile')
assert.equal(parsed.atomCount, 2)
assert.equal(parsed.render.format, 'sdf')

// ---------------------------------------------------------------------------
// Client half
// ---------------------------------------------------------------------------
// The vendored 3Dmol.js UMD bundle touches `document` while its modules are
// evaluated, exactly as it does in a browser; stub the minimum for Node.
const noop = () => {}
const canvasStub = () => ({ style: {}, width: 0, height: 0, getContext: () => null, addEventListener: noop, removeEventListener: noop })
globalThis.document = {
  createElement: () => canvasStub(),
  createElementNS: () => canvasStub(),
  documentElement: { style: {} },
  body: { style: {}, appendChild: noop },
  addEventListener: noop,
  removeEventListener: noop,
}
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-probe' }, configurable: true, writable: true })
globalThis.devicePixelRatio = 1
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const bundles = new Map()
const reactStub = {
  createElement: (...args) => ({ $$typeof: Symbol.for('react.element'), args }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const requireShim = (specifier) => {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return reactStub
  throw new Error(`client bundle requires unexpected external: ${specifier}`)
}
globalThis.window = globalThis
globalThis.window.__ModuleLoader__ = {
  load: ({ id, factory }) => { bundles.set(id, factory(requireShim)) },
}

const requireBuilt = createRequire(import.meta.url)
requireBuilt(join(root, 'lib', 'client.js'))

const exported = bundles.get('dsh-molecule-visualization')
assert.ok(exported !== undefined, 'client bundle must register itself under its package id')
assert.equal(typeof exported.apply, 'function', 'client half must export apply()')
assert.ok(Array.isArray(exported.inject) && exported.inject.includes('slots'), 'client half must inject slots')

// `apply` must register exactly one keyed renderer for view_molecule.
const registrations = []
exported.apply({
  slots: {
    inject: (name, contribute) => { registrations.push({ kind: 'inject', name }); contribute() },
    register: (spec, component) => { registrations.push({ kind: 'register', spec, component }) },
  },
})
assert.equal(registrations.length, 2, 'apply() must inject once and register once')
assert.equal(registrations[0].name, 'tool.call.toolview')
assert.equal(registrations[1].spec.key, 'view_molecule')
assert.equal(typeof registrations[1].component, 'function', 'the renderer must be a component')

console.log('✓ host bundle: apply/inject/Config/renderFormatFor + parseMolecule')
console.log('✓ client bundle: module-table registration + apply() wiring')
console.log(`  client bundle size: ${(await import('node:fs')).statSync(join(root, 'lib', 'client.js')).size} bytes`)
