/**
 * 3Dmol.js representation specs.
 *
 * Split out of the React component so the style contract — above all the
 * two-representation ball-and-stick overlay — is unit-testable against a
 * recording viewer stub.
 * @module style
 */

import type { MoleculeStyle } from './contract/types.ts'

/** Molecule coloring modes. */
export type ColorMode =
  | { readonly kind: 'element' }
  | { readonly kind: 'spectrum' }
  | { readonly kind: 'custom'; readonly color: string }

/** The subset of a 3Dmol.js viewer this module drives. */
export interface StyleTarget {
  setStyle(selection: unknown, spec: Record<string, unknown>): void
}

/** One entry of the style switch in the toolbar. */
export interface StyleOption {
  readonly value: MoleculeStyle
  readonly label: string
  readonly title: string
}

/** The styles offered in the toolbar, in display order. */
export const STYLE_OPTIONS: readonly StyleOption[] = [
  { value: 'ballstick', label: 'Ball & stick', title: '球棍模型：细棒 + 小球' },
  { value: 'stick', label: 'Stick', title: '棒状模型：只有化学键' },
  { value: 'line', label: 'Line', title: '线框模型' },
  { value: 'sphere', label: 'Sphere', title: '空间填充模型（范德华半径）' },
  { value: 'cartoon', label: 'Cartoon', title: '蛋白二级结构飘带（配体自动用棒状）' },
]

/** Styles whose geometry comes entirely from bonds. */
export function isBondStyle(style: MoleculeStyle): boolean {
  return style === 'stick' || style === 'ballstick'
}

/**
 * Color portion of a 3Dmol style spec.
 *
 * `spectrum` rides the `color` key (the library checks `spec.color ===
 * 'spectrum'` for its residue gradient); element mode passes no color so the
 * built-in element colors apply.
 */
export function colorSpec(mode: ColorMode): Record<string, unknown> {
  if (mode.kind === 'spectrum') return { color: 'spectrum' }
  if (mode.kind === 'custom') return { color: mode.color }
  return {}
}

/**
 * One representation spec for `style` merged with the color mode.
 *
 * Ball-and-stick has no 3Dmol.js representation of its own: it is the overlay
 * of a thin stick and a small sphere on the same selection. Sending only
 * `{ stick }` (what this plugin did before) renders bare sticks, and sending
 * `{sphere: {scale: 1}}` renders space-filling; `scale` 0.25 is the
 * conventional ball radius.
 */
export function reprSpec(style: MoleculeStyle, mode: ColorMode): Record<string, unknown> {
  const color = colorSpec(mode)
  switch (style) {
    case 'stick': return { stick: color }
    case 'ballstick': return { stick: { ...color, radius: 0.15 }, sphere: { ...color, scale: 0.25 } }
    case 'line': return { line: color }
    case 'sphere': return { sphere: { ...color, scale: 0.3 } }
    case 'cartoon': return { cartoon: color }
    default: return { stick: color }
  }
}

/** Is this atom from a HETATM record / a standalone small molecule? Such atoms
 * have no secondary structure, so a cartoon-only style renders nothing. */
export function isHetero(atom: { readonly hetflag?: boolean }): boolean {
  return atom.hetflag === true
}

/** Options that change the effective representation. */
export interface ApplyStyleOptions {
  /**
   * Whether the loaded model has any bonds. A bond-drawn style over a model
   * with no bonds (an XYZ file, a MOL block with an empty bond block, a PDB of
   * isolated atoms) draws nothing at all, so such a model falls back to a
   * sphere representation — visible, and obviously "atoms only".
   */
  readonly bondsAvailable?: boolean
}

/**
 * Apply `style` + `mode` to every atom of the loaded model.
 * @param viewer - the 3Dmol.js viewer.
 * @param style - requested representation.
 * @param mode - coloring mode.
 * @param options - representation fallbacks.
 */
export function applyStyle(
  viewer: StyleTarget,
  style: MoleculeStyle,
  mode: ColorMode,
  options: ApplyStyleOptions = {},
): void {
  if (options.bondsAvailable === false && isBondStyle(style)) {
    // Nothing to draw bonds along: show the atoms themselves.
    viewer.setStyle({}, { sphere: { ...colorSpec(mode), scale: 0.3 } })
    return
  }
  if (style === 'cartoon') {
    // Protein (non-het) atoms: cartoon. Het atoms (ligands, or every atom of a
    // pure small-molecule file): stick — so a co-crystallized ligand stays
    // visible next to the protein ribbon.
    viewer.setStyle({}, { cartoon: colorSpec(mode) })
    viewer.setStyle({ predicate: isHetero }, { stick: colorSpec(mode) })
    return
  }
  viewer.setStyle({}, reprSpec(style, mode))
}
