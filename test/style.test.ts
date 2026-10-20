/**
 * Representation-spec tests — issue 3 (missing ball-and-stick) and the
 * cartoon/ligand overlay.
 *
 * 3Dmol.js has no ball-and-stick representation: it is the overlay of a thin
 * stick and a small sphere on the same selection. Sending only `{stick}`
 * renders bare sticks; sending only `{sphere}` renders space-filling.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { STYLE_OPTIONS, applyStyle, colorSpec, isBondStyle, reprSpec, type ColorMode } from '../src/client/style.ts'

const element: ColorMode = { kind: 'element' }

/** Recording viewer stub. */
function recordingViewer() {
  const calls: { selection: unknown, spec: Record<string, unknown> }[] = []
  return {
    calls,
    setStyle(selection: unknown, spec: Record<string, unknown>): void {
      calls.push({ selection, spec })
    },
  }
}

describe('reprSpec', () => {
  it('renders ball-and-stick as a stick + sphere overlay', () => {
    const spec = reprSpec('ballstick', element)
    assert.deepEqual(Object.keys(spec).sort(), ['sphere', 'stick'])
    assert.equal((spec['stick'] as { radius?: number }).radius, 0.15)
    assert.equal((spec['sphere'] as { scale?: number }).scale, 0.25)
  })

  it('keeps stick as a single representation', () => {
    const spec = reprSpec('stick', element)
    assert.deepEqual(Object.keys(spec), ['stick'])
  })

  it('renders sphere as space-filling', () => {
    const spec = reprSpec('sphere', element)
    assert.equal((spec['sphere'] as { scale?: number }).scale, 0.3)
  })

  it('renders line and cartoon', () => {
    assert.deepEqual(Object.keys(reprSpec('line', element)), ['line'])
    assert.deepEqual(Object.keys(reprSpec('cartoon', element)), ['cartoon'])
  })

  it('applies the color mode to every representation of a ball-and-stick spec', () => {
    const spectrum: ColorMode = { kind: 'spectrum' }
    const spec = reprSpec('ballstick', spectrum)
    assert.equal((spec['stick'] as { color?: string }).color, 'spectrum')
    assert.equal((spec['sphere'] as { color?: string }).color, 'spectrum')
    const custom: ColorMode = { kind: 'custom', color: '#ff0000' }
    const customSpec = reprSpec('ballstick', custom)
    assert.equal((customSpec['sphere'] as { color?: string }).color, '#ff0000')
  })
})

describe('colorSpec', () => {
  it('passes no color for element mode, so 3Dmol.js uses element colors', () => {
    assert.deepEqual(colorSpec(element), {})
  })

  it('uses the library spectrum keyword', () => {
    assert.deepEqual(colorSpec({ kind: 'spectrum' }), { color: 'spectrum' })
  })

  it('uses the chosen color', () => {
    assert.deepEqual(colorSpec({ kind: 'custom', color: '#4D6BFE' }), { color: '#4D6BFE' })
  })
})

describe('applyStyle', () => {
  it('applies the ball-and-stick overlay in one call', () => {
    const viewer = recordingViewer()
    applyStyle(viewer, 'ballstick', element)
    assert.equal(viewer.calls.length, 1)
    assert.deepEqual(Object.keys(viewer.calls[0]?.spec ?? {}).sort(), ['sphere', 'stick'])
  })

  it('draws a cartoon plus sticks for hetero atoms in cartoon mode', () => {
    const viewer = recordingViewer()
    applyStyle(viewer, 'cartoon', element)
    assert.equal(viewer.calls.length, 2)
    assert.deepEqual(Object.keys(viewer.calls[0]?.spec ?? {}), ['cartoon'])
    assert.deepEqual(Object.keys(viewer.calls[1]?.spec ?? {}), ['stick'])
  })

  it('falls back to spheres when the model has no bonds to draw', () => {
    const viewer = recordingViewer()
    applyStyle(viewer, 'stick', element, { bondsAvailable: false })
    assert.equal(viewer.calls.length, 1)
    assert.deepEqual(Object.keys(viewer.calls[0]?.spec ?? {}), ['sphere'])

    const ballStick = recordingViewer()
    applyStyle(ballStick, 'ballstick', element, { bondsAvailable: false })
    assert.deepEqual(Object.keys(ballStick.calls[0]?.spec ?? {}), ['sphere'])
  })

  it('leaves non-bond styles alone when bonds are missing', () => {
    const viewer = recordingViewer()
    applyStyle(viewer, 'sphere', element, { bondsAvailable: false })
    assert.deepEqual(Object.keys(viewer.calls[0]?.spec ?? {}), ['sphere'])
  })
})

describe('style options', () => {
  it('offers ball-and-stick in the toolbar', () => {
    assert.ok(STYLE_OPTIONS.some(option => option.value === 'ballstick'))
    assert.equal(STYLE_OPTIONS.length, 5)
  })

  it('classifies which styles need bonds', () => {
    assert.equal(isBondStyle('stick'), true)
    assert.equal(isBondStyle('ballstick'), true)
    assert.equal(isBondStyle('sphere'), false)
    assert.equal(isBondStyle('line'), false)
    assert.equal(isBondStyle('cartoon'), false)
  })
})
