/**
 * Mount tests — issue 1 (which parser name reaches 3Dmol.js), issue 2 (a
 * failed load must throw a specific reason, never leave a blank canvas) and
 * issue 4 (a model without bonds still shows something).
 *
 * The fake namespace records exactly what the real `viewer.addModel` /
 * `setStyle` calls receive.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MoleculeRenderError, countBonds, mountMolecule, type AtomLike } from '../src/client/render.ts'
import type { ColorMode } from '../src/client/style.ts'

const element: ColorMode = { kind: 'element' }

/** Atoms 0..n-1 with bonds to the next atom (a simple chain). */
function chain(count: number): AtomLike[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    ...(index < count - 1 ? { bonds: [index + 1] } : { bonds: [] }),
  }))
}

/** Atoms with no bonds at all. */
function isolated(count: number): AtomLike[] {
  return Array.from({ length: count }, (_, index) => ({ index, bonds: [] }))
}

interface HarnessConfig {
  readonly atoms?: readonly AtomLike[]
  /** Bonds the model gains when `assignBonds()` runs (0 = perception fails). */
  readonly assignBondsAdds?: number
  readonly createViewerError?: string
  readonly addModelError?: string
  readonly modelUndefined?: boolean
}

/** Build a recording 3Dmol.js namespace + viewer. */
function harness(config: HarnessConfig = {}) {
  let atoms: readonly AtomLike[] = config.atoms ?? chain(2)
  const calls = {
    createViewer: 0,
    addModel: [] as { data: string, format: string, options?: Record<string, unknown> }[],
    setStyle: [] as { selection: unknown, spec: Record<string, unknown> }[],
    zoomTo: 0,
    render: 0,
    zoom: [] as [number, number][],
    clear: 0,
    setBackgroundColor: [] as string[],
    resize: 0,
    assignBonds: 0,
  }

  const model = {
    selectedAtoms: (): readonly AtomLike[] => atoms,
    assignBonds: (): void => {
      calls.assignBonds++
      const added = config.assignBondsAdds ?? 0
      if (added > 0) atoms = chain(atoms.length)
    },
  }

  const viewer = {
    addModel: (data: string, format: string, options?: Record<string, unknown>) => {
      calls.addModel.push({ data, format, ...(options !== undefined ? { options } : {}) })
      if (config.addModelError !== undefined) throw new Error(config.addModelError)
      return config.modelUndefined === true ? undefined : model
    },
    setStyle: (selection: unknown, spec: Record<string, unknown>): void => {
      calls.setStyle.push({ selection, spec })
    },
    zoomTo: (): void => { calls.zoomTo++ },
    render: (): void => { calls.render++ },
    zoom: (factor: number, duration: number): void => { calls.zoom.push([factor, duration]) },
    clear: (): void => { calls.clear++ },
    setBackgroundColor: (color: string): void => { calls.setBackgroundColor.push(color) },
    resize: (): void => { calls.resize++ },
  }

  const threeDmol = {
    createViewer: (): typeof viewer => {
      calls.createViewer++
      if (config.createViewerError !== undefined) throw new Error(config.createViewerError)
      return viewer
    },
  }

  return { threeDmol, viewer, calls }
}

/** Containers are never inspected by mountMolecule; a plain object suffices. */
const container = {} as unknown as HTMLElement

describe('mountMolecule: parser format', () => {
  it('hands mol content to the sdf parser (issue 1)', () => {
    const { threeDmol, calls } = harness()
    const result = mountMolecule({
      threeDmol, container, data: 'molfile', format: 'mol', style: 'stick',
      colorMode: element, backgroundColor: '#000000',
    })
    assert.equal(calls.addModel[0]?.format, 'sdf')
    assert.equal(result.parserFormat, 'sdf')
  })

  it('honours the payload renderFormat', () => {
    const { threeDmol, calls } = harness()
    mountMolecule({
      threeDmol, container, data: 'molfile', format: 'mol', renderFormat: 'sdf', style: 'stick',
      colorMode: element, backgroundColor: '#000000',
    })
    assert.equal(calls.addModel[0]?.format, 'sdf')
  })

  it('asks the PDB parser to keep hydrogens so the atom count matches the host', () => {
    const { threeDmol, calls } = harness({ atoms: chain(3) })
    mountMolecule({
      threeDmol, container, data: 'pdb', format: 'pdb', style: 'stick',
      colorMode: element, backgroundColor: '#000000', expectedAtoms: 3,
    })
    assert.equal(calls.addModel[0]?.options?.['keepH'], true)
  })
})

describe('mountMolecule: failures are specific (issue 2)', () => {
  it('throws an empty-model error naming 3Dmol.js and the host count', () => {
    const { threeDmol } = harness({ atoms: [] })
    assert.throws(
      () => mountMolecule({
        threeDmol, container, data: 'molfile', format: 'mol', style: 'stick',
        colorMode: element, backgroundColor: '#000000', expectedAtoms: 121,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MoleculeRenderError)
        assert.equal(error.code, 'empty-model')
        assert.match(error.message, /0 个原子/)
        assert.match(error.message, /121/)
        assert.ok(error.hint.length > 0)
        return true
      },
    )
  })

  it('throws a viewer-init error when WebGL is unavailable', () => {
    const { threeDmol } = harness({ createViewerError: 'WebGL context creation failed' })
    assert.throws(
      () => mountMolecule({
        threeDmol, container, data: 'x', format: 'pdb', style: 'stick',
        colorMode: element, backgroundColor: '#000000',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MoleculeRenderError)
        assert.equal(error.code, 'viewer-init')
        assert.match(error.detail ?? '', /WebGL context creation failed/)
        assert.ok(error.hint.includes('WebGL'))
        return true
      },
    )
  })

  it('throws a parse error when the library throws', () => {
    const { threeDmol } = harness({ addModelError: 'bad sdf' })
    assert.throws(
      () => mountMolecule({
        threeDmol, container, data: 'x', format: 'sdf', style: 'stick',
        colorMode: element, backgroundColor: '#000000',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MoleculeRenderError)
        assert.equal(error.code, 'parse')
        assert.match(error.detail ?? '', /bad sdf/)
        return true
      },
    )
  })

  it('throws a parse error when addModel returns no model', () => {
    const { threeDmol } = harness({ modelUndefined: true })
    assert.throws(
      () => mountMolecule({
        threeDmol, container, data: 'x', format: 'sdf', style: 'stick',
        colorMode: element, backgroundColor: '#000000',
      }),
      (error: unknown) => error instanceof MoleculeRenderError && error.code === 'parse',
    )
  })
})

describe('mountMolecule: missing bonds (issue 4)', () => {
  it('perceives bonds by distance and says so', () => {
    const { threeDmol, calls } = harness({ atoms: isolated(2), assignBondsAdds: 1 })
    const result = mountMolecule({
      threeDmol, container, data: 'xyz', format: 'xyz', style: 'stick',
      colorMode: element, backgroundColor: '#000000',
    })
    assert.equal(calls.assignBonds, 1)
    assert.equal(result.bondsPerceived, true)
    assert.ok(result.bondCount > 0)
    assert.ok(result.notices.some(notice => notice.includes('推断')))
    assert.deepEqual(Object.keys(calls.setStyle.at(-1)?.spec ?? {}), ['stick'])
  })

  it('falls back to spheres when no bonds can be perceived', () => {
    const { threeDmol, calls } = harness({ atoms: isolated(2), assignBondsAdds: 0 })
    const result = mountMolecule({
      threeDmol, container, data: 'xyz', format: 'xyz', style: 'ballstick',
      colorMode: element, backgroundColor: '#000000',
    })
    assert.equal(result.bondsPerceived, false)
    assert.ok(result.notices.some(notice => notice.includes('球状')))
    assert.deepEqual(Object.keys(calls.setStyle.at(-1)?.spec ?? {}), ['sphere'])
  })

  it('does not try to perceive bonds in a single-atom model', () => {
    const { threeDmol, calls } = harness({ atoms: isolated(1) })
    const result = mountMolecule({
      threeDmol, container, data: 'xyz', format: 'xyz', style: 'stick',
      colorMode: element, backgroundColor: '#000000',
    })
    assert.equal(calls.assignBonds, 0)
    assert.equal(result.notices.length, 0)
  })
})

describe('mountMolecule: diagnostics and painting', () => {
  it('reports an atom shortfall (the altLoc-drop signature)', () => {
    const { threeDmol } = harness({ atoms: chain(45) })
    const result = mountMolecule({
      threeDmol, container, data: 'pdb', format: 'pdb', style: 'stick',
      colorMode: element, backgroundColor: '#000000', expectedAtoms: 92,
    })
    assert.ok(result.notices.some(notice => notice.includes('45/92')))
  })

  it('does not warn when the counts agree', () => {
    const { threeDmol } = harness({ atoms: chain(92) })
    const result = mountMolecule({
      threeDmol, container, data: 'pdb', format: 'pdb', style: 'stick',
      colorMode: element, backgroundColor: '#000000', expectedAtoms: 92,
    })
    assert.equal(result.notices.length, 0)
  })

  it('zooms and renders after styling', () => {
    const { threeDmol, calls } = harness({ atoms: chain(4) })
    mountMolecule({
      threeDmol, container, data: 'sdf', format: 'sdf', style: 'ballstick',
      colorMode: element, backgroundColor: '#101010',
    })
    assert.equal(calls.zoomTo, 1)
    assert.equal(calls.render, 1)
    assert.deepEqual(calls.zoom, [[1.2, 800]])
    assert.equal(calls.setStyle.length, 1)
  })
})

describe('countBonds', () => {
  it('counts each undirected bond once', () => {
    assert.equal(countBonds(chain(3)), 2)
    assert.equal(countBonds(isolated(3)), 0)
    assert.equal(countBonds([
      { index: 0, bonds: [1, 2] },
      { index: 1, bonds: [0] },
      { index: 2, bonds: [0] },
    ]), 2)
  })

  it('ignores non-numeric bond entries', () => {
    assert.equal(countBonds([{ index: 0, bonds: [1] }, { index: 1, bonds: [undefined as unknown as number, 0] }]), 1)
  })
})
