/**
 * Fixture builders for the parser tests.
 *
 * PDB is fixed-column, so fixtures are built with an explicit `putField`
 * helper: a test that says "put x in column 30" documents the exact
 * misalignment being reproduced, instead of hiding it in a padded literal.
 */

/** A blank PDB record line, 80 columns wide. */
export function blankPdbLine(): string[] {
  return new Array<string>(80).fill(' ')
}

/**
 * Write `text` into 1-based, inclusive columns of an in-place column array.
 * Text longer than the span is truncated; shorter text is left-justified.
 */
export function putField(columns: string[], startColumn: number, endColumn: number, text: string): string[] {
  const width = endColumn - startColumn + 1
  const padded = text.length > width ? text.slice(0, width) : text.padEnd(width)
  for (let offset = 0; offset < width; offset++) columns[startColumn - 1 + offset] = padded[offset] ?? ' '
  return columns
}

/** Options for {@link pdbLine}. */
export interface PdbAtomOptions {
  readonly record?: string
  readonly serial?: number
  readonly name?: string
  readonly altLoc?: string
  readonly resName?: string
  readonly chain?: string
  readonly resSeq?: number
  readonly x?: number
  readonly y?: number
  readonly z?: number
  readonly element?: string
  /** Move the x field to start at this column instead of 31 (the classic shift). */
  readonly xColumn?: number
  /** Put the residue name at columns 17-19 and the atom name at column 13. */
  readonly nameAndResidueShifted?: boolean
}

/** Build one PDB atom record. */
export function pdbLine(options: PdbAtomOptions = {}): string {
  const columns = blankPdbLine()
  const record = options.record ?? 'ATOM'
  putField(columns, 1, 6, record.padEnd(6))
  putField(columns, 7, 11, String(options.serial ?? 1).padStart(5))
  const resName = options.resName ?? 'MOL'
  const name = options.name ?? 'C1'
  if (options.nameAndResidueShifted === true) {
    // The real-world shape: atom name left-justified in 13-16 and the residue
    // name occupying 17-19, so column 17 (altLoc) reads the resName's first
    // letter. Coordinates stay standard.
    putField(columns, 13, 16, name)
    putField(columns, 17, 19, resName)
  } else {
    putField(columns, 13, 16, ` ${name}`.slice(0, 4).padStart(4))
    putField(columns, 17, 17, options.altLoc ?? ' ')
    putField(columns, 18, 20, resName)
  }
  putField(columns, 22, 22, options.chain ?? 'A')
  putField(columns, 23, 26, String(options.resSeq ?? 1).padStart(4))
  const xColumn = options.xColumn ?? 31
  putField(columns, xColumn, xColumn + 7, (options.x ?? 0).toFixed(3).padStart(8))
  putField(columns, 39, 46, (options.y ?? 0).toFixed(3).padStart(8))
  putField(columns, 47, 54, (options.z ?? 0).toFixed(3).padStart(8))
  putField(columns, 55, 60, '1.00')
  putField(columns, 61, 66, '0.00')
  putField(columns, 77, 78, (options.element ?? (name.startsWith('C') ? 'C' : name.slice(0, 1))).padStart(2))
  return columns.join('')
}

/** Assemble a PDB document from records. */
export function pdbDocument(records: readonly string[], trailers: readonly string[] = ['END']): string {
  return [...records, ...trailers, ''].join('\n')
}

/** One V2000 atom: coordinates plus element symbol. */
export interface MolAtom {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly element: string
}

/** One V2000 bond: 1-based atom indices plus bond order. */
export interface MolBond {
  readonly from: number
  readonly to: number
  readonly order?: number
}

/** Build a V2000 molfile with correct fixed columns. */
export function molDocument(atoms: readonly MolAtom[], bonds: readonly MolBond[] = []): string {
  const atomLines = atoms.map((atom) => (
    `${atom.x.toFixed(4).padStart(10)}${atom.y.toFixed(4).padStart(10)}${atom.z.toFixed(4).padStart(10)}`
    + ` ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`
  ))
  const bondLines = bonds.map((bond) => (
    `${String(bond.from).padStart(3)}${String(bond.to).padStart(3)}${String(bond.order ?? 1).padStart(3)}  0`
  ))
  return [
    'fixture',
    '  dsh-molecule-visualization',
    '',
    `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atomLines,
    ...bondLines,
    'M  END',
    '',
  ].join('\n')
}

/** Build a V3000 molfile body. */
export function molV3000Document(atoms: readonly MolAtom[], bonds: readonly MolBond[] = []): string {
  return [
    'fixture',
    '  dsh-molecule-visualization',
    '',
    '  0  0  0     0  0            999 V3000',
    'M  V30 BEGIN CTAB',
    `M  V30 COUNTS ${String(atoms.length)} ${String(bonds.length)} 0 0 0`,
    'M  V30 BEGIN ATOM',
    ...atoms.map((atom, index) => `M  V30 ${String(index + 1)} ${atom.element} ${String(atom.x)} ${String(atom.y)} ${String(atom.z)} 0`),
    'M  V30 END ATOM',
    'M  V30 BEGIN BOND',
    ...bonds.map((bond, index) => `M  V30 ${String(index + 1)} ${String(bond.order ?? 1)} ${String(bond.from)} ${String(bond.to)}`),
    'M  V30 END BOND',
    'M  V30 END CTAB',
    'M  END',
    '',
  ].join('\n')
}

/** Build a MOL2 document. */
export function mol2Document(
  atoms: readonly { name: string, x: number, y: number, z: number, type: string }[],
  bonds: readonly { from: number, to: number }[] = [],
): string {
  return [
    '@<TRIPOS>MOLECULE',
    'fixture',
    `  ${String(atoms.length)} ${String(bonds.length)} 0 0 0`,
    'SMALL',
    'NO_CHARGES',
    '',
    '@<TRIPOS>ATOM',
    ...atoms.map((atom, index) => (
      `      ${String(index + 1)} ${atom.name.padEnd(6)} ${atom.x.toFixed(4).padStart(9)} ${atom.y.toFixed(4).padStart(9)} ${atom.z.toFixed(4).padStart(9)} ${atom.type}  1 LIG  0.0000`
    )),
    '@<TRIPOS>BOND',
    ...bonds.map((bond, index) => `     ${String(index + 1)} ${String(bond.from)} ${String(bond.to)} 1`),
    '',
  ].join('\n')
}

/** Build an XYZ document. */
export function xyzDocument(atoms: readonly MolAtom[], comment = 'fixture'): string {
  return [
    String(atoms.length),
    comment,
    ...atoms.map(atom => `${atom.element} ${String(atom.x)} ${String(atom.y)} ${String(atom.z)}`),
    '',
  ].join('\n')
}

/** Build a Gaussian input document with the given geometry lines. */
export function gjfDocument(geometry: readonly string[], options: { readonly charge?: string, readonly title?: string } = {}): string {
  return [
    '%chk=fixture.chk',
    '%mem=8GB',
    '#p opt freq b3lyp/def2svp',
    '',
    options.title ?? 'fixture geometry',
    '',
    options.charge ?? '0 1',
    ...geometry,
    '',
  ].join('\n')
}
