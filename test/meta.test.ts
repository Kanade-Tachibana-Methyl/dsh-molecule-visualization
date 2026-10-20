/**
 * Payload-projection tests.
 *
 * The projection is what the session log stores and what the card replays on
 * every reload, so it must already be render-ready: `mol` content must be
 * tagged `sdf`, Gaussian input must arrive as XYZ, and a source that cannot be
 * re-read must degrade to a summary payload instead of throwing.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_META_INLINE_BYTES, buildMoleculeMeta } from '../src/meta.ts'
import type { MoleculeViewMeta, ViewMoleculeArgs, ViewMoleculeResult } from '../src/types.ts'
import { gjfDocument, molDocument, pdbDocument, pdbLine } from './fixtures.ts'

const MOL_DATA = molDocument([
  { x: 0, y: 0, z: 0, element: 'C' },
  { x: 1.34, y: 0, z: 0, element: 'C' },
], [{ from: 1, to: 2 }])

/** Projection deps with a fixed source-reader. */
function deps(source: string | (() => string)) {
  return {
    defaultStyle: 'ballstick' as const,
    parseOptions: { repairShiftedPdbAltLoc: true },
    readSource: (): string => (typeof source === 'string' ? source : source()),
  }
}

/** A successful tool result for `format`. */
function okResult(format: ViewMoleculeResult['format'], atomCount: number, warnings?: string[]): ViewMoleculeResult {
  return { ok: true, format, atomCount, ...(warnings !== undefined ? { warnings } : {}) }
}

describe('buildMoleculeMeta: successful payloads', () => {
  it('tags mol content with the sdf render format (issue 1)', () => {
    const args: ViewMoleculeArgs = { data: MOL_DATA, format: 'mol' }
    const meta = buildMoleculeMeta(args, okResult('mol', 2), deps(''))
    assert.equal(meta.format, 'mol')
    assert.equal(meta.renderFormat, 'sdf')
    assert.equal(meta.data, MOL_DATA)
    assert.equal(meta.renderAtomCount, 2)
  })

  it('converts Gaussian input to XYZ in the payload', () => {
    const gjf = gjfDocument([' C 0.0 0.0 0.0', ' O 1.2 0.0 0.0'])
    const meta = buildMoleculeMeta({ data: gjf, format: 'gjf' }, okResult('gjf', 2), deps(''))
    assert.equal(meta.format, 'gjf')
    assert.equal(meta.renderFormat, 'xyz')
    assert.equal((meta.data ?? '').split('\n')[0], '2')
    assert.match(meta.data ?? '', /^O 1\.2 0\.0 0\.0$/m)
  })

  it('applies the configured default style when the call omits one', () => {
    const meta = buildMoleculeMeta({ data: MOL_DATA, format: 'mol' }, okResult('mol', 2), deps(''))
    assert.equal(meta.style, 'ballstick')
  })

  it('honours the requested style', () => {
    const meta = buildMoleculeMeta({ data: MOL_DATA, format: 'mol', style: 'cartoon' }, okResult('mol', 2), deps(''))
    assert.equal(meta.style, 'cartoon')
  })

  it('carries warnings from the tool result', () => {
    const meta = buildMoleculeMeta(
      { data: MOL_DATA, format: 'mol' },
      okResult('mol', 2, ['no bonds declared']),
      deps(''),
    )
    assert.deepEqual(meta.warnings, ['no bonds declared'])
  })

  it('re-reads path sources at projection time', () => {
    const meta = buildMoleculeMeta({ path: 'x.mol' }, okResult('mol', 2), deps(MOL_DATA))
    assert.equal(meta.data, MOL_DATA)
  })

  it('keeps the repaired PDB columns in the stored payload (issue 6)', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1, name: 'C1', resName: 'LIG', nameAndResidueShifted: true }),
      pdbLine({ serial: 2, name: 'C2', resName: 'LIG', x: 1.4, nameAndResidueShifted: true }),
    ])
    const meta = buildMoleculeMeta({ data, format: 'pdb' }, okResult('pdb', 2), deps(''))
    const records = (meta.data ?? '').split('\n').filter(line => line.startsWith('ATOM'))
    assert.equal(records.length, 2)
    for (const line of records) assert.equal(line[16], ' ')
  })
})

describe('buildMoleculeMeta: failed payloads', () => {
  const failure: ViewMoleculeResult = {
    ok: false,
    format: 'pdb',
    atomCount: 0,
    error: 'column 30 holds "-"',
    errorHint: 'Re-export with standard PDB columns.',
    warnings: ['no CONECT records'],
  }

  it('carries the reason and the hint, and no data', () => {
    const meta = buildMoleculeMeta({ path: 'x.pdb' }, failure, deps('irrelevant'))
    assert.equal(meta.ok, false)
    assert.equal(meta.error, 'column 30 holds "-"')
    assert.equal(meta.errorHint, 'Re-export with standard PDB columns.')
    assert.equal(meta.data, undefined)
    assert.deepEqual(meta.warnings, ['no CONECT records'])
  })

  it('still exposes the render format so the card can label the failure', () => {
    const meta = buildMoleculeMeta({ path: 'x.pdb' }, failure, deps(''))
    assert.equal(meta.renderFormat, 'pdb')
  })
})

describe('buildMoleculeMeta: degraded payloads', () => {
  it('omits data when the source cannot be re-read', () => {
    const meta = buildMoleculeMeta({ path: 'gone.mol' }, okResult('mol', 5), deps(() => { throw new Error('ENOENT') }))
    assert.equal(meta.ok, true)
    assert.equal(meta.data, undefined)
    assert.equal(meta.truncated, undefined)
    assert.equal(meta.atomCount, 5)
  })

  it('withholds content above the inline cap and flags it (issue: log bloat)', () => {
    const huge = 'x'.repeat(MAX_META_INLINE_BYTES + 32)
    const meta = buildMoleculeMeta({ data: huge, format: 'sdf' }, okResult('sdf', 1), deps(''))
    assert.equal(meta.truncated, true)
    assert.equal(meta.data, undefined)
  })

  it('never throws for an unparseable source', () => {
    const meta: MoleculeViewMeta = buildMoleculeMeta({ data: 'nonsense', format: 'pdb' }, okResult('pdb', 3), deps(''))
    assert.equal(meta.ok, true)
  })
})
