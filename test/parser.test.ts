/**
 * Host-side validation tests.
 *
 * These encode the verification checklist: every case that used to render a
 * blank (or nearly blank) canvas without any error must now either validate or
 * fail with an actionable message.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseMolecule, renderFormatFor } from '../src/parser.ts'
import type { ParseResult } from '../src/parser.ts'
import { gjfDocument, mol2Document, molDocument, molV3000Document, pdbDocument, pdbLine, xyzDocument } from './fixtures.ts'

/** Assert a result is a failure and return its message. */
function expectFailure(result: ParseResult): string {
  assert.equal(result.ok, false, `expected a failure, got atomCount=${String(result.atomCount)}`)
  assert.equal(result.atomCount, 0)
  assert.equal(typeof result.error, 'string')
  assert.ok((result.error ?? '').length > 0, 'failure must carry a message')
  return result.error ?? ''
}

// ---------------------------------------------------------------------------
// Format mapping — issue 1
// ---------------------------------------------------------------------------

describe('renderFormatFor (format mapping)', () => {
  it('maps mol to the sdf parser, because 3Dmol.js registers no mol parser', () => {
    assert.equal(renderFormatFor('mol'), 'sdf')
  })

  it('maps gjf to xyz', () => {
    assert.equal(renderFormatFor('gjf'), 'xyz')
  })

  it('passes native formats through unchanged', () => {
    for (const format of ['pdb', 'sdf', 'mol2', 'xyz'] as const) {
      assert.equal(renderFormatFor(format), format)
    }
  })
})

// ---------------------------------------------------------------------------
// PDB
// ---------------------------------------------------------------------------

describe('PDB validation', () => {
  it('accepts a well-formed record and counts atoms', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1, name: 'C1', x: 0, y: 0, z: 0, element: 'C' }),
      pdbLine({ serial: 2, name: 'O1', x: 1.23, y: 0, z: 0, element: 'O' }),
    ])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.equal(result.render?.format, 'pdb')
    assert.equal(result.render?.data, data, 'a valid PDB must reach 3Dmol.js unchanged')
  })

  it('warns — but does not fail — when CONECT records are missing', () => {
    const data = pdbDocument([pdbLine({ serial: 1 }), pdbLine({ serial: 2, x: 1.2, element: 'O' })])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some(warning => warning.code === 'pdb-no-conect'))
  })

  it('does not warn about CONECT when records are present', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1 }),
      pdbLine({ serial: 2, x: 1.2, element: 'O' }),
      'CONECT    1    2',
      'CONECT    2    1',
    ])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.equal(result.warnings.some(warning => warning.code === 'pdb-no-conect'), false)
  })

  it('rejects a record whose x coordinate sits in column 30 instead of 31', () => {
    // A full-width coordinate is needed for column 30 to be occupied: with
    // "   1.234" the shift is invisible, which is why the check keys on the
    // column rather than on the parsed value.
    const data = pdbDocument([pdbLine({ serial: 1, x: -1234.567, xColumn: 30 }), pdbLine({ serial: 2, x: 2.5 })])
    const message = expectFailure(parseMolecule('pdb', data))
    assert.match(message, /column 30/)
    assert.match(message, /line 1/)
  })

  it('rejects a non-numeric coordinate column with the column range in the message', () => {
    const line = pdbLine({ serial: 1 })
    const broken = `${line.slice(0, 30)}   abcde${line.slice(38)}`
    const message = expectFailure(parseMolecule('pdb', pdbDocument([broken])))
    assert.match(message, /x coordinate \(columns 31-38\) is not a number/)
  })

  it('rejects a record truncated before the z coordinate', () => {
    const message = expectFailure(parseMolecule('pdb', pdbDocument([pdbLine({ serial: 1 }).slice(0, 40)])))
    assert.match(message, /needs content through column 54/)
  })

  it('rejects content with no atom records at all', () => {
    const message = expectFailure(parseMolecule('pdb', 'REMARK nothing here\nEND\n'))
    assert.match(message, /no ATOM or HETATM records/)
  })

  it('rejects an ATOM record that lacks the two spaces after the record name', () => {
    const wellFormed = pdbLine({ serial: 1 })
    // "ATOM1 ..." instead of "ATOM      1 ...": every field after it shifts.
    const malformed = `ATOM1      ${wellFormed.slice(11)}`
    const message = expectFailure(parseMolecule('pdb', pdbDocument([malformed])))
    assert.match(message, /record name must occupy columns 1-6/)
  })

  it('repairs a uniformly misaligned altLoc column and reports it (issue 6)', () => {
    // The shape found in real Chem3D exports: atom name at column 13 and
    // resName at 17-19, so 3Dmol.js reads resName[0] as an altLoc and drops the
    // atom.
    const data = pdbDocument([
      pdbLine({ serial: 1, name: 'C1', resName: 'LIG', x: 0, y: 0, z: 0, nameAndResidueShifted: true }),
      pdbLine({ serial: 2, name: 'C2', resName: 'LIG', x: 1.4, y: 0, z: 0, nameAndResidueShifted: true }),
      pdbLine({ serial: 3, name: 'I1', resName: 'LIG', x: 2.8, y: 0, z: 0, nameAndResidueShifted: true }),
    ])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 3)
    assert.ok(result.warnings.some(warning => warning.code === 'pdb-altloc-column-repaired'))
    const repaired = (result.render?.data ?? '').split('\n')
    for (const line of repaired) {
      if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
        assert.equal(line[16], ' ', 'column 17 must be blanked so 3Dmol.js keeps the atom')
      }
    }
    // The coordinates must survive the repair untouched: only column 17 changes.
    assert.equal(result.render?.data, data.replace(/^(.{16})./gm, '$1 '))
  })

  it('fails instead of repairing when the repair is disabled', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1, name: 'C1', resName: 'LIG', nameAndResidueShifted: true }),
      pdbLine({ serial: 2, name: 'C2', resName: 'LIG', nameAndResidueShifted: true }),
    ])
    const result = parseMolecule('pdb', data, { repairShiftedPdbAltLoc: false })
    const message = expectFailure(result)
    assert.match(message, /alternate-location letter/)
    assert.match(result.errorHint ?? '', /keeps only 0 of 2 atoms/)
  })

  it('warns (without repairing) when only some records carry altLoc letters', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1, altLoc: 'A' }),
      pdbLine({ serial: 2, x: 1.2, altLoc: 'B', element: 'O' }),
      pdbLine({ serial: 3, x: 2.4, altLoc: ' ', element: 'N' }),
      pdbLine({ serial: 4, x: 3.6, altLoc: ' ', element: 'C' }),
    ])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some(warning => warning.code === 'pdb-altloc'))
    assert.equal(result.warnings.some(warning => warning.code === 'pdb-altloc-column-repaired'), false)
    assert.equal(result.render?.data, data)
  })

  it('keeps a genuine altLoc conformer file untouched', () => {
    const data = pdbDocument([
      pdbLine({ serial: 1, altLoc: 'A', resName: 'ALA' }),
      pdbLine({ serial: 2, altLoc: 'B', resName: 'ALA', x: 1.2 }),
      pdbLine({ serial: 3, altLoc: ' ', resName: 'ALA', x: 2.4 }),
    ])
    const result = parseMolecule('pdb', data)
    assert.equal(result.ok, true)
    assert.equal(result.render?.data, data)
    assert.ok(result.warnings.some(warning => warning.code === 'pdb-altloc'))
  })
})

// ---------------------------------------------------------------------------
// MOL / SDF
// ---------------------------------------------------------------------------

describe('MOL/SDF validation', () => {
  const twoAtoms = [
    { x: 0, y: 0, z: 0, element: 'C' },
    { x: 1.34, y: 0, z: 0, element: 'C' },
  ] as const

  it('accepts a V2000 molfile and reports the sdf render format', () => {
    const result = parseMolecule('mol', molDocument(twoAtoms, [{ from: 1, to: 2 }]))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.equal(result.render?.format, 'sdf')
  })

  it('reads a 121-atom Cu/I molfile whose counts run together (checklist item 1)', () => {
    // 121 atoms and 130 bonds are both three-digit, so the counts line is
    // "121130  0 …" with no separator between the two fields — the shape real
    // Chem3D exports use, and the reason the counts must be read by column.
    const atoms = Array.from({ length: 119 }, (_, index) => ({ x: index * 0.1, y: 0, z: 0, element: 'C' }))
    atoms.push({ x: 12.0, y: 0, z: 0, element: 'Cu' })
    atoms.push({ x: 14.6, y: 0, z: 0, element: 'I' })
    const bonds = Array.from({ length: 130 }, (_, index) => ({ from: (index % 120) + 1, to: ((index + 1) % 120) + 1 }))
    const data = molDocument(atoms, bonds)
    assert.match(data.split('\n')[3] ?? '', /^121130/)

    const result = parseMolecule('mol', data)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 121)
    assert.equal(result.render?.format, 'sdf')
    assert.ok((result.render?.data ?? '').includes('Cu'))
    assert.ok((result.render?.data ?? '').includes('I  '))
  })

  it('accepts a molfile whose title line is blank (Chem3D exports)', () => {
    const data = molDocument(twoAtoms, [{ from: 1, to: 2 }])
      .replace(/^fixture\n  dsh-molecule-visualization\n/, () => '\n  Chem3D Core 23.1.1\n')
    const result = parseMolecule('mol', data)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.equal(result.warnings.some(warning => warning.code === 'mol-two-header-lines'), false)
  })

  it('recovers a molfile with only two header lines, with a warning', () => {
    const lines = molDocument(twoAtoms, [{ from: 1, to: 2 }]).split('\n')
    // Drop the (blank) comment header line, moving the counts line to line 3.
    const withoutComment = [lines[0], lines[1], ...lines.slice(3)].join('\n')
    const result = parseMolecule('mol', withoutComment)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.ok(result.warnings.some(warning => warning.code === 'mol-two-header-lines'))
  })

  it('accepts the same content declared as sdf', () => {
    const data = molDocument(twoAtoms, [{ from: 1, to: 2 }])
    const asMol = parseMolecule('mol', data)
    const asSdf = parseMolecule('sdf', data)
    assert.equal(asMol.ok, true)
    assert.equal(asSdf.ok, true)
    assert.equal(asMol.atomCount, asSdf.atomCount)
    assert.equal(asMol.render?.data, asSdf.render?.data)
  })

  it('rejects a truncated atom block', () => {
    const complete = molDocument(twoAtoms, [])
    const lines = complete.split('\n')
    // Keep the header, the counts line and the first atom; drop the rest.
    const message = expectFailure(parseMolecule('mol', lines.slice(0, 5).join('\n')))
    assert.match(message, /declares 2 atoms but the atom block has only 1 lines/)
  })

  it('rejects a bond that points outside the atom range', () => {
    const message = expectFailure(parseMolecule('mol', molDocument(twoAtoms, [{ from: 1, to: 9 }])))
    assert.match(message, /outside the declared range 1-2/)
  })

  it('rejects a counts line with no atom count', () => {
    const data = molDocument(twoAtoms).replace(/^\s*2\s+0/m, 'nonsense')
    const message = expectFailure(parseMolecule('mol', data))
    assert.match(message, /counts line does not start with atom and bond counts/)
  })

  it('warns when the bond block is empty, because 3Dmol.js draws bonds only from it', () => {
    const result = parseMolecule('mol', molDocument(twoAtoms, []))
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some(warning => warning.code === 'mol-no-bonds'))
  })

  it('accepts V3000 content and counts the atom block', () => {
    const result = parseMolecule('sdf', molV3000Document(twoAtoms, [{ from: 1, to: 2 }]))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
  })

  it('renders only the first record of a multi-molecule SDF and says so', () => {
    // The replacement is a function: `$$` in a replace() *string* collapses to
    // one literal `$`, which would silently drop the SDF delimiter.
    const one = molDocument(twoAtoms, [{ from: 1, to: 2 }]).replace('M  END\n', () => 'M  END\n$$$$\n')
    const data = `${one}${molDocument([{ x: 0, y: 0, z: 0, element: 'N' }, { x: 1, y: 0, z: 0, element: 'O' }, { x: 2, y: 0, z: 0, element: 'F' }])}`
    const result = parseMolecule('sdf', data)
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 5)
    assert.equal(result.renderAtomCount, 2)
    assert.ok(result.warnings.some(warning => warning.code === 'sdf-multi-molecule'))
    assert.equal((result.render?.data ?? '').includes('F   '), false, 'the payload holds only the first record')
  })
})

// ---------------------------------------------------------------------------
// MOL2
// ---------------------------------------------------------------------------

describe('MOL2 validation', () => {
  const atoms = [
    { name: 'C1', x: 0, y: 0, z: 0, type: 'C.3' },
    { name: 'O1', x: 1.23, y: 0, z: 0, type: 'O.2' },
  ] as const

  it('accepts a well-formed mol2 file', () => {
    const result = parseMolecule('mol2', mol2Document(atoms, [{ from: 1, to: 2 }]))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.equal(result.render?.format, 'mol2')
  })

  it('rejects content without the TRIPOS header', () => {
    const message = expectFailure(parseMolecule('mol2', 'nothing to see\n'))
    assert.match(message, /@<TRIPOS>MOLECULE/)
  })

  it('rejects a non-numeric coordinate', () => {
    const broken = mol2Document(atoms, []).replace('   1.2300', '   x.2300')
    const message = expectFailure(parseMolecule('mol2', broken))
    assert.match(message, /x coordinate is not a number/)
  })

  it('warns when the file has no bond section', () => {
    const result = parseMolecule('mol2', mol2Document(atoms, []))
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some(warning => warning.code === 'mol2-no-bonds'))
  })
})

// ---------------------------------------------------------------------------
// XYZ
// ---------------------------------------------------------------------------

describe('XYZ validation', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'Cu' },
    { x: 2.5, y: 0, z: 0, element: 'I' },
  ] as const

  it('accepts a well-formed xyz file', () => {
    const result = parseMolecule('xyz', xyzDocument(atoms))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
    assert.equal(result.render?.format, 'xyz')
  })

  it('rejects a first line that is not an atom count', () => {
    const message = expectFailure(parseMolecule('xyz', 'Cu 0 0 0\nI 2.5 0 0\n'))
    assert.match(message, /first line of an XYZ file must be the atom count/)
  })

  it('rejects a truncated atom block', () => {
    const message = expectFailure(parseMolecule('xyz', '3\nfixture\nCu 0 0 0\n'))
    assert.match(message, /declares 3 atoms but has only 1 atom lines/)
  })

  it('warns that xyz carries no bonds', () => {
    const result = parseMolecule('xyz', xyzDocument(atoms))
    assert.ok(result.warnings.some(warning => warning.code === 'xyz-no-bonds'))
  })
})

// ---------------------------------------------------------------------------
// Gaussian input — optional scope item
// ---------------------------------------------------------------------------

describe('Gaussian input (gjf) validation and conversion', () => {
  const geometry = [
    ' C     -5.83910000    -1.71460000     0.52080000',
    ' C     -5.83910000    -3.05160000     0.52080000',
    ' Cu    -4.68120000    -3.72010000     0.52080000',
    ' I     -3.52330000    -3.05160000     0.52080000',
  ] as const

  it('converts the geometry block to xyz and counts atoms', () => {
    const result = parseMolecule('gjf', gjfDocument(geometry))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 4)
    assert.equal(result.render?.format, 'xyz')
    const lines = (result.render?.data ?? '').split('\n')
    assert.equal(lines[0], '4')
    assert.equal(lines[2], 'C -5.83910000 -1.71460000 0.52080000')
    assert.equal(lines[5], 'I -3.52330000 -3.05160000 0.52080000')
    assert.ok(result.warnings.some(warning => warning.code === 'gjf-converted-to-xyz'))
  })

  it('tolerates fragment labels on the element column', () => {
    const withFragments = [
      ' C(Fragment=1)  -5.83910000  -1.71460000   0.52080000',
      ' C(Fragment=2)  -5.83910000  -3.05160000   0.52080000',
    ] as const
    const result = parseMolecule('gjf', gjfDocument(withFragments))
    assert.equal(result.ok, true)
    assert.equal(result.atomCount, 2)
  })

  it('rejects a file without a route section', () => {
    const message = expectFailure(parseMolecule('gjf', '%chk=x\n\nno route\n'))
    assert.match(message, /route section/)
  })

  it('rejects a file without a charge/multiplicity line', () => {
    const message = expectFailure(parseMolecule('gjf', '#p opt\n\nfixture\n\n C 0 0 0\n'))
    assert.match(message, /charge multiplicity/)
  })

  it('rejects a charge line with no geometry after it', () => {
    const message = expectFailure(parseMolecule('gjf', gjfDocument([])))
    assert.match(message, /no geometry atoms/)
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

describe('dispatch', () => {
  it('rejects empty content for every format', () => {
    for (const format of ['pdb', 'sdf', 'mol2', 'mol', 'xyz', 'gjf'] as const) {
      const message = expectFailure(parseMolecule(format, '   \n\n'))
      assert.match(message, /empty molecular data/)
    }
  })

  it('rejects content that is valid for another format', () => {
    const mol = molDocument([{ x: 0, y: 0, z: 0, element: 'C' }], [])
    expectFailure(parseMolecule('pdb', mol))
    expectFailure(parseMolecule('xyz', mol))
  })
})
