/**
 * Format-mapping tests — the client half of issue 1.
 *
 * `viewer.addModel(data, 'mol')` is what shipped upstream: 3Dmol.js 2.4.2 has
 * no `mol` parser, logs "Unknown format: mol", guesses, and for most real
 * molfiles guesses `xyz` and loads zero atoms. The mapping (and the payload's
 * `renderFormat`) must make that impossible.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RENDER_FORMATS, renderFormatFor, resolveRenderFormat } from '../src/client/format.ts'

describe('client format mapping', () => {
  it('maps mol to the sdf parser', () => {
    assert.equal(renderFormatFor('mol'), 'sdf')
  })

  it('maps gjf to xyz', () => {
    assert.equal(renderFormatFor('gjf'), 'xyz')
  })

  it('never hands 3Dmol.js a parser name it does not register', () => {
    for (const format of ['pdb', 'sdf', 'mol2', 'mol', 'xyz', 'gjf'] as const) {
      assert.ok(RENDER_FORMATS.includes(renderFormatFor(format)), `${format} must map into RENDER_FORMATS`)
    }
  })

  it('prefers a coherent renderFormat from the payload', () => {
    const resolved = resolveRenderFormat({ format: 'mol', renderFormat: 'sdf' })
    assert.deepEqual(resolved, { format: 'sdf', source: 'payload' })
  })

  it('falls back to the mapping for payloads written by older plugin versions', () => {
    const resolved = resolveRenderFormat({ format: 'mol' })
    assert.deepEqual(resolved, { format: 'sdf', source: 'mapping' })
  })

  it('ignores a payload renderFormat that is not a real parser', () => {
    const resolved = resolveRenderFormat({ format: 'mol', renderFormat: 'mol' as never })
    assert.deepEqual(resolved, { format: 'sdf', source: 'mapping' })
  })
})
