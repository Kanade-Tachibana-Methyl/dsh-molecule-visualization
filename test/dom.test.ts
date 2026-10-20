/**
 * Renders the *built* client bundle inside a jsdom document.
 *
 * This is the only check that exercises the real React tree a user sees: the
 * bundle is loaded through a stub of the harness's lazy-CJS module table, the
 * registered `view_molecule` renderer is mounted with a hand-made payload, and
 * the card's text is asserted.
 *
 * jsdom has no WebGL, so the successful path cannot run here; what it does
 * prove is that a failure produces the specific card (reason + hint + retry)
 * instead of a blank canvas — the fork's issue 2 — and that the style toolbar
 * offers ball-and-stick.
 *
 * Note on globals: `window` is aliased to `globalThis` (with jsdom's `document`
 * attached) because the vendored 3Dmol.js UMD bundle assigns `window.$3Dmol`
 * and then reads the bare global `$3Dmol`; that only resolves when the two are
 * the same object, exactly as in a browser.
 *
 * Skipped (with a message) when `lib/client.js` has not been built yet.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = join(root, 'lib', 'client.js')
const available = existsSync(bundlePath)

/** A minimal but valid PDB the viewer will try to render. */
const PDB = [
  'ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  O   MOL A   1       1.230   0.000   0.000  1.00  0.00           O',
  'END',
  '',
].join('\n')

/** Meta payload as the host would project it for that PDB. */
function metaPayload() {
  return {
    kind: 'molecule-view',
    ok: true,
    format: 'pdb',
    renderFormat: 'pdb',
    atomCount: 2,
    style: 'ballstick',
    warnings: ['no CONECT records — bonds are perceived by distance'],
    data: PDB,
  }
}

/** The browser-ish environment, built once (the bundle registers on load). */
let environment

/**
 * Boot jsdom, load the built bundle through the module-table shim, and return
 * the module table entry plus React handles.
 */
async function loadEnvironment() {
  if (environment !== undefined) return environment

  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })

  globalThis.window = globalThis
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.devicePixelRatio = 1
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  // `window` is aliased to globalThis here, so the EventTarget methods that
  // live on jsdom's Window prototype must be mirrored too — the dialog listens
  // for Escape on the global target.
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window)
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window)
  globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom has no layout engine: every box is 0×0, which would make the viewer
  // wait for its layout gate and then time out. Report a real box so the mount
  // proceeds into 3Dmol.js (which then fails on WebGL — the case asserted).
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // react-dom feature-detects a handful of DOM constructors (HTMLIFrameElement,
  // HTMLFrameElement, …) with `instanceof`; mirror the rest of jsdom's globals
  // without overwriting anything Node already provides.
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    try {
      Object.defineProperty(globalThis, key, {
        value: dom.window[key],
        configurable: true,
        writable: true,
      })
    } catch { /* non-configurable platform getter */ }
  }
  // Node 24 exposes `navigator` as a getter-only global.
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  })

  const nodeRequire = createRequire(import.meta.url)
  const bundles = new Map()
  globalThis.__ModuleLoader__ = {
    load: ({ id, factory }) => { bundles.set(id, factory((specifier) => nodeRequire(specifier))) },
  }
  nodeRequire(bundlePath)

  const exported = bundles.get('dsh-molecule-visualization')
  assert.ok(exported !== undefined, 'the bundle must register itself under its package id')

  environment = {
    exported,
    dom,
    React: nodeRequire('react'),
    createRoot: nodeRequire('react-dom/client').createRoot,
    // React 18.3 exposes `act` from the `react` entry; fall back for older 18.x.
    act: nodeRequire('react').act ?? nodeRequire('react-dom/test-utils').act,
  }
  return environment
}

/** Register the renderer through a fresh slots stub. */
function rendererFrom(exported) {
  let renderer
  exported.apply({
    slots: {
      inject: (_name, contribute) => { contribute() },
      register: (spec, component) => { if (spec.key === 'view_molecule') renderer = component },
    },
  })
  assert.equal(typeof renderer, 'function', 'apply() must register the view_molecule renderer')
  return renderer
}

/** Mount one payload into a fresh container and let the mount effects settle. */
async function mountBlock(meta) {
  const environment = await loadEnvironment()
  const renderer = rendererFrom(environment.exported)
  const container = globalThis.document.createElement('div')
  globalThis.document.body.append(container)
  const mounted = environment.createRoot(container)
  await environment.act(async () => {
    mounted.render(environment.React.createElement(renderer, { block: { kind: 'tool-call', meta } }))
    await new Promise(done => setTimeout(done, 200))
  })
  return { environment, container, mounted }
}

const skip = available ? false : 'lib/client.js has not been built (run node scripts/build.mjs)'

describe('built client bundle in jsdom', { skip }, () => {
  it('renders a failure card with a specific reason, hint and retry instead of a blank canvas', async () => {
    // A payload 3Dmol.js cannot find atoms in ("empty-model") — a deterministic
    // failure in jsdom, unlike WebGL availability which depends on the runner.
    const emptyMeta = { ...metaPayload(), data: 'REMARK nothing to render\nEND\n' }
    const { environment, container, mounted } = await mountBlock(emptyMeta)
    const text = container.textContent ?? ''
    assert.match(text, /3Dmol\.js 没有读出原子|WebGL 不可用|解析失败/, `expected a specific failure card, got: ${text.slice(0, 200)} | html: ${container.innerHTML.slice(0, 600)}`)
    assert.match(text, /重试/, 'the failure card must offer a retry button')
    assert.doesNotMatch(text, /正在加载 3D 视图…/, 'the card must not stay in the loading state forever')
    await environment.act(async () => { mounted.unmount() })
  })

  it('offers the ball-and-stick style and shows hosted warnings', async () => {
    const { environment, container, mounted } = await mountBlock(metaPayload())
    const labels = [...container.querySelectorAll('button')].map(button => button.textContent)
    assert.ok(labels.includes('Ball & stick'), `expected a ball-and-stick button, got: ${labels.join(' | ')}`)
    assert.ok(labels.includes('Cartoon'), 'the existing styles must still be offered')
    const text = container.textContent ?? ''
    assert.match(text, /no CONECT records/, 'host-side warnings must be shown on the card')
    assert.match(text, /PDB · 2 atoms/, 'the header must state format and atom count')
    await environment.act(async () => { mounted.unmount() })
  })

  it('reports a host-side rejection with the reason and the hint', async () => {
    const meta = {
      ...metaPayload(),
      ok: false,
      atomCount: 0,
      error: 'PDB line 3: column 30 holds "-", but the x coordinate must start in column 31',
      errorHint: 'The atom record is shifted one column to the left; re-export with standard PDB columns.',
      data: undefined,
    }
    const { environment, container, mounted } = await mountBlock(meta)
    const text = container.textContent ?? ''
    assert.match(text, /无法显示这份 PDB 结构/)
    assert.match(text, /column 30/)
    assert.match(text, /re-export with standard PDB columns/i)
    await environment.act(async () => { mounted.unmount() })
  })

  it('keeps the inline stage responsive instead of a fixed 400px box', async () => {
    const { environment, container, mounted } = await mountBlock(metaPayload())
    const markup = container.innerHTML
    assert.match(markup, /clamp\(240px/, 'the inline stage height must be responsive so the card fits the chat pane')
    assert.doesNotMatch(markup, /height:\s*400px/, 'the fixed 400px stage must be gone')
    await environment.act(async () => { mounted.unmount() })
  })

  it('expands the same viewer into a full-window dialog and closes on Escape', async () => {
    const { environment, container, mounted } = await mountBlock(metaPayload())

    // The card lives inline; the dialog is not mounted yet.
    assert.equal(globalThis.document.querySelector('[role="dialog"]'), null)

    const expand = [...container.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === '放大查看')
    assert.ok(expand !== undefined, 'the card must offer an expand control')

    await environment.act(async () => {
      expand.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true }))
      await new Promise(done => setTimeout(done, 200))
    })

    const dialog = globalThis.document.querySelector('[role="dialog"]')
    assert.ok(dialog !== null, 'clicking expand must mount a dialog at the document level')
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    // The dialog holds the viewer, and the conversation keeps a way back.
    assert.match(dialog.textContent ?? '', /Ball & stick/, 'the dialog must contain the full viewer controls')
    assert.match(container.textContent ?? '', /收起放大视图/, 'the inline card must leave a way back')
    assert.equal(container.querySelector('[role="dialog"]'), null, 'the dialog must not be nested in the chat flow')

    await environment.act(async () => {
      globalThis.dispatchEvent(new globalThis.window.KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise(done => setTimeout(done, 100))
    })
    assert.equal(globalThis.document.querySelector('[role="dialog"]'), null, 'Escape must close the dialog')
    assert.match(container.textContent ?? '', /Ball & stick/, 'the inline card must come back')
    await environment.act(async () => { mounted.unmount() })
  })
})
