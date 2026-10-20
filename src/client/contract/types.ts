/**
 * Client-side wire contract for the molecule viewer.
 *
 * The client must NOT import the host package (cross-package plugin imports
 * are forbidden), so this module mirrors the host-half `MoleculeViewMeta`
 * shape plus a runtime guard. The payload arrives as `block.meta` on the
 * settled tool call block.
 * @module contract/types
 */

/** Supported input formats (mirror of the host-half type). */
export type MoleculeFormat = 'pdb' | 'sdf' | 'mol2' | 'mol' | 'xyz' | 'gjf'

/** Formats the bundled 3Dmol.js build registers a parser for. */
export type RenderFormat = 'pdb' | 'sdf' | 'mol2' | 'xyz'

/** Display styles (mirror of the host-half type). */
export type MoleculeStyle = 'stick' | 'ballstick' | 'line' | 'sphere' | 'cartoon'

/**
 * UI payload persisted with the `view_molecule` tool/result event via the
 * host's `presentationMeta` projection (mirror of the host-half type).
 *
 * `renderFormat`, `renderAtomCount`, `errorHint` and `warnings` are additions
 * of the fork; every one of them is optional so payloads replayed from older
 * plugin versions keep rendering.
 */
export interface MoleculeViewMeta {
  readonly kind: 'molecule-view'
  readonly ok: boolean
  readonly format: MoleculeFormat
  readonly renderFormat?: RenderFormat
  readonly atomCount: number
  readonly renderAtomCount?: number
  readonly style: MoleculeStyle
  readonly name?: string
  readonly error?: string
  readonly errorHint?: string
  readonly warnings?: readonly string[]
  readonly data?: string
  readonly truncated?: true
}

const FORMATS: readonly unknown[] = ['pdb', 'sdf', 'mol2', 'mol', 'xyz', 'gjf']
const RENDER_FORMATS: readonly unknown[] = ['pdb', 'sdf', 'mol2', 'xyz']
const STYLES: readonly unknown[] = ['stick', 'ballstick', 'line', 'sphere', 'cartoon']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Narrow an untrusted `block.meta` into {@link MoleculeViewMeta}. The payload
 * crosses the wire and may come from a different (older or newer) plugin
 * version, so every field the renderer reads is checked.
 */
export function isMoleculeViewMeta(value: unknown): value is MoleculeViewMeta {
  if (!isRecord(value)) return false
  return value['kind'] === 'molecule-view'
    && typeof value['ok'] === 'boolean'
    && FORMATS.includes(value['format'])
    && (value['renderFormat'] === undefined || RENDER_FORMATS.includes(value['renderFormat']))
    && typeof value['atomCount'] === 'number'
    && (value['renderAtomCount'] === undefined || typeof value['renderAtomCount'] === 'number')
    && STYLES.includes(value['style'])
    && (value['name'] === undefined || typeof value['name'] === 'string')
    && (value['error'] === undefined || typeof value['error'] === 'string')
    && (value['errorHint'] === undefined || typeof value['errorHint'] === 'string')
    && (value['data'] === undefined || typeof value['data'] === 'string')
    && (value['truncated'] === undefined || value['truncated'] === true)
    && (value['warnings'] === undefined
      || (Array.isArray(value['warnings']) && value['warnings'].every(item => typeof item === 'string')))
}
