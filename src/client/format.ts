/**
 * Input-format → 3Dmol.js-parser mapping.
 *
 * The bundled 3Dmol.js 2.4.2 build registers parsers for exactly
 * `pdb`, `sdf`, `mol2`, `xyz` (plus a few it guesses at). `mol` is **not**
 * among them: `viewer.addModel(data, 'mol')` makes the library log
 * "Unknown format: mol", fall back to a text heuristic, and — for most real
 * molfiles — hand the content to the `xyz` parser, which reads zero atoms. The
 * canvas then stays blank with no error surfaced anywhere.
 *
 * Keeping the mapping here (rather than trusting the host payload) also makes
 * payloads written by older plugin versions render correctly.
 * @module format
 */

import type { MoleculeFormat, RenderFormat } from './contract/types.ts'

/** Formats 3Dmol.js can parse when asked by name. */
export const RENDER_FORMATS: readonly RenderFormat[] = ['pdb', 'sdf', 'mol2', 'xyz']

/**
 * Map a declared input format to the parser 3Dmol.js must use.
 * @param format - the format declared by the tool call.
 * @returns the parser name to hand to `addModel`.
 */
export function renderFormatFor(format: MoleculeFormat): RenderFormat {
  switch (format) {
    // A MOL block is an SDF record without the `$$$$` delimiter; the `sdf`
    // parser reads both.
    case 'mol': return 'sdf'
    // The host already rewrote Gaussian geometry to XYZ.
    case 'gjf': return 'xyz'
    case 'pdb':
    case 'sdf':
    case 'mol2':
    case 'xyz':
      return format
    default: {
      const exhaustive: never = format
      throw new Error(`unhandled molecular format: ${String(exhaustive)}`)
    }
  }
}

/**
 * Resolve the parser name for a payload, preferring the host-projected
 * `renderFormat` when it is present and coherent.
 * @param payload - the tool payload (older versions omit `renderFormat`).
 * @returns the parser name plus whether it came from the payload.
 */
export function resolveRenderFormat(payload: {
  readonly format: MoleculeFormat
  readonly renderFormat?: RenderFormat | undefined
}): { readonly format: RenderFormat; readonly source: 'payload' | 'mapping' } {
  if (payload.renderFormat !== undefined && RENDER_FORMATS.includes(payload.renderFormat)) {
    return { format: payload.renderFormat, source: 'payload' }
  }
  return { format: renderFormatFor(payload.format), source: 'mapping' }
}
