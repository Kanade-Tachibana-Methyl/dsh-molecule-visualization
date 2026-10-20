/**
 * 3Dmol.js model loading, diagnostics and first paint.
 *
 * Extracted from the React component so every failure mode the fork fixes is
 * testable against a recording viewer stub — above all that the format handed
 * to `addModel` is the *parser* name (`mol` → `sdf`) and that a model which
 * loads zero atoms becomes a visible error instead of a blank canvas.
 * @module render
 */

import { resolveRenderFormat } from './format.ts'
import { applyStyle, type ColorMode } from './style.ts'
import type { MoleculeFormat, MoleculeStyle, RenderFormat } from './contract/types.ts'

/** The subset of a 3Dmol.js atom this module inspects. */
export interface AtomLike {
  readonly index?: number
  readonly bonds?: readonly number[]
  readonly hetflag?: boolean
}

/** The subset of a 3Dmol.js model this module drives. */
export interface ModelLike {
  selectedAtoms(selection?: unknown): readonly AtomLike[]
  assignBonds?(): void
}

/** The subset of a 3Dmol.js viewer this module drives. */
export interface ViewerLike {
  addModel(data: string, format: string, options?: Record<string, unknown>): ModelLike | undefined
  setStyle(selection: unknown, spec: Record<string, unknown>): void
  zoomTo(): void
  render(): void
  zoom(factor: number, duration: number): void
  clear(): void
  setBackgroundColor(color: string): void
  resize(): void
}

/** The subset of the 3Dmol.js namespace this module needs. */
export interface ThreeDmolLike {
  createViewer(container: HTMLElement, options?: Record<string, unknown>): ViewerLike
}

/** Why a molecule could not be rendered. */
export type RenderFailureCode = 'viewer-init' | 'parse' | 'empty-model'

/** A rendering failure carrying a user-facing reason and next step. */
export class MoleculeRenderError extends Error {
  /** Machine-readable cause, used to pick the card layout. */
  readonly code: RenderFailureCode
  /** Actionable next step (Chinese, matching the viewer UI). */
  readonly hint: string
  /** Raw library message, shown in a details line. */
  readonly detail: string | undefined

  constructor(code: RenderFailureCode, message: string, options: { readonly hint?: string; readonly detail?: string } = {}) {
    super(message)
    this.name = 'MoleculeRenderError'
    this.code = code
    this.hint = options.hint ?? ''
    this.detail = options.detail
  }
}

/** Everything needed to put a molecule on screen. */
export interface MountOptions {
  /** Resolved 3Dmol.js namespace. */
  readonly threeDmol: ThreeDmolLike
  /** Host element the canvas is created in (must already be laid out). */
  readonly container: HTMLElement
  /** Render-ready molecular content. */
  readonly data: string
  /** Declared input format (drives labels and the parser mapping). */
  readonly format: MoleculeFormat
  /** Parser name from the payload, when the host provided one. */
  readonly renderFormat?: RenderFormat | undefined
  /** Requested representation. */
  readonly style: MoleculeStyle
  /** Coloring mode. */
  readonly colorMode: ColorMode
  /** Canvas background. */
  readonly backgroundColor: string
  /** Atoms the host counted; a shortfall means 3Dmol.js dropped some. */
  readonly expectedAtoms?: number | undefined
}

/** What a successful mount learned about the model. */
export interface MountResult {
  /** The live viewer (kept by the component for later style/resize). */
  readonly viewer: ViewerLike
  /** Parser name actually handed to 3Dmol.js. */
  readonly parserFormat: RenderFormat
  /** Atoms 3Dmol.js loaded. */
  readonly atomCount: number
  /** Bonds present after optional distance perception. */
  readonly bondCount: number
  /** Whether bonds had to be perceived by distance. */
  readonly bondsPerceived: boolean
  /** Non-fatal findings to show on the card. */
  readonly notices: readonly string[]
}

/** Count undirected bonds across the model. */
export function countBonds(atoms: readonly AtomLike[]): number {
  let bonds = 0
  for (let position = 0; position < atoms.length; position++) {
    const atom = atoms[position] as AtomLike
    for (const neighbour of atom.bonds ?? []) {
      if (typeof neighbour === 'number' && neighbour > position) bonds++
    }
  }
  return bonds
}

/** Atom count of a freshly-loaded model, tolerating a hostile library object. */
function countAtoms(model: ModelLike): readonly AtomLike[] {
  try {
    const atoms = model.selectedAtoms({})
    return Array.isArray(atoms) ? atoms : []
  } catch {
    return []
  }
}

/**
 * Load `data` into a new 3Dmol.js viewer, diagnose what arrived, and paint.
 *
 * Failure is always thrown as {@link MoleculeRenderError} with a specific
 * reason — never left as an empty canvas.
 * @param options - viewer inputs.
 * @returns the viewer plus diagnostics.
 * @throws {MoleculeRenderError} when the viewer, the parser, or the model fails.
 */
export function mountMolecule(options: MountOptions): MountResult {
  const { format } = resolveRenderFormat({ format: options.format, renderFormat: options.renderFormat })
  const notices: string[] = []

  let viewer: ViewerLike
  try {
    viewer = options.threeDmol.createViewer(options.container, {
      backgroundColor: options.backgroundColor,
      antialias: true,
    })
  } catch (error) {
    throw new MoleculeRenderError('viewer-init', '3Dmol.js 无法创建 WebGL 视图', {
      hint: '浏览器可能禁用了 WebGL 或显卡上下文创建失败。请检查 chrome://gpu，或在支持 WebGL 的浏览器中打开。',
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  let model: ModelLike | undefined
  try {
    // `keepH` matters for PDB: 3Dmol drops hydrogens by default, so the loaded
    // atom count would silently disagree with the host's count for every
    // structure that has explicit hydrogens.
    model = viewer.addModel(options.data, format, {
      multimodel: false,
      ...(format === 'pdb' ? { keepH: true } : {}),
    })
  } catch (error) {
    throw new MoleculeRenderError('parse', `3Dmol.js 解析 ${format} 数据时抛出异常`, {
      hint: `渲染用的格式是 ${format}（由 ${options.format} 映射而来）。3Dmol.js 2.4.2 支持 pdb / sdf / mol2 / xyz。`,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  if (model === undefined) {
    throw new MoleculeRenderError('parse', `3Dmol.js 没有为这份 ${format} 数据返回模型`, {
      hint: '载荷可能被截断或损坏。',
    })
  }

  const loaded = countAtoms(model)
  if (loaded.length === 0) {
    const expected = options.expectedAtoms
    throw new MoleculeRenderError(
      'empty-model',
      `3Dmol.js 从这份 ${format} 数据里解析出 0 个原子${expected !== undefined ? `（host 侧统计到 ${expected} 个）` : ''}`,
      {
        hint: `说明载荷本身是完整的，问题在浏览器端的解析路径。${options.format === 'mol' ? 'MOL 必须交给 sdf 解析器。' : ''}`
          + '请把该文件的内容发给我，我会按格式补一条解析器映射。',
      },
    )
  }

  // `assignBonds()` rewrites the model's bond table, so the atom list must be
  // re-read afterwards — the array from `selectedAtoms` is a snapshot.
  let atoms = loaded
  let bondCount = countBonds(atoms)
  let bondsPerceived = false
  if (bondCount === 0 && atoms.length > 1) {
    // Formats without a bond table (XYZ) and PDB files whose CONECT records are
    // missing or unusable: perceive bonds by distance, which is what turns an
    // otherwise empty stick view into a molecule.
    try {
      model.assignBonds?.()
      atoms = countAtoms(model)
      bondCount = countBonds(atoms)
      bondsPerceived = bondCount > 0
    } catch {
      bondCount = 0
    }
    if (bondCount > 0) {
      notices.push(`模型没有键表，已按距离推断出 ${bondCount} 根键`)
    } else {
      notices.push('模型没有键（也未推断出），已改用球状显示以免画面空白')
    }
  }

  const expected = options.expectedAtoms
  if (expected !== undefined && atoms.length < expected) {
    notices.push(
      `3Dmol.js 只载入了 ${atoms.length}/${expected} 个原子 —— 常见原因是固定列错位（被 altLoc 过滤）或文件里有多个模型`,
    )
  }

  applyStyle(viewer, options.style, options.colorMode, { bondsAvailable: bondCount > 0 })
  viewer.zoomTo()
  viewer.render()
  try {
    viewer.zoom(1.2, 800)
  } catch {
    // Animation is cosmetic; a failure here must not sink the render.
  }

  return { viewer, parserFormat: format, atomCount: atoms.length, bondCount, bondsPerceived, notices }
}
