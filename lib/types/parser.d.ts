/**
 * Molecular file validator and render-normaliser.
 *
 * This is NOT a chemistry parser: rendering is delegated to 3Dmol.js in the
 * browser, which has its own parsers. What the host owns is the *contract*
 * with the model and the user:
 *
 * 1. Count atoms so the tool result carries useful metadata.
 * 2. Reject content that 3Dmol.js would silently mis-read — above all
 *    fixed-column PDB records that are shifted by a column, which 3Dmol.js
 *    interprets as alternate locations and then drops the atom for, leaving a
 *    blank or nearly-blank canvas with no error anywhere.
 * 3. Emit a render-ready payload for formats 3Dmol.js cannot parse by name
 *    (`mol` → `sdf`, `gjf` → `xyz`), instead of trusting 3Dmol.js's
 *    "Unknown format, best guess" fallback.
 *
 * Every failure carries an actionable hint, because the client half shows the
 * reason on the card.
 * @module dsh-molecule-visualization/parser
 */
import type { MoleculeFormat, RenderFormat } from './types.ts';
/** Non-fatal validation finding, surfaced on the viewer card. */
export interface ParseWarning {
    /** Stable machine-readable code. */
    readonly code: string;
    /** Human-readable message. */
    readonly message: string;
}
/** Result of a host-side validation pass. */
export interface ParseResult {
    /** Whether the content passed validation. */
    readonly ok: boolean;
    /** Atoms found in the content (summed across SDF records). */
    readonly atomCount: number;
    /** Atoms 3Dmol.js will actually load for the rendered payload. */
    readonly renderAtomCount: number;
    /** Render-ready content for {@link renderFormat}. */
    readonly render?: {
        readonly format: RenderFormat;
        readonly data: string;
    };
    /** Diagnostic message when `ok` is false. */
    readonly error?: string;
    /** Actionable next step when `ok` is false. */
    readonly errorHint?: string;
    /** Non-fatal findings. */
    readonly warnings: readonly ParseWarning[];
}
/** Knobs that trade strictness for convenience. */
export interface ParseOptions {
    /**
     * Blank a column-17 "alternate location" letter when *every* atom record in
     * a PDB carries the same one — the signature of a file whose residue-name
     * column is shifted one to the left. Without the repair 3Dmol.js drops every
     * such atom (its `altLoc` filter) and the viewer renders almost nothing.
     * Defaults to `true`; the repair is always reported as a warning.
     */
    readonly repairShiftedPdbAltLoc?: boolean;
}
/** Convert an input format to the format 3Dmol.js must be asked to parse. */
export declare function renderFormatFor(format: MoleculeFormat): RenderFormat;
/**
 * Validate `data` as `format` and produce a render-ready payload.
 * @param format - the declared input format.
 * @param data - raw file content.
 * @param options - strictness knobs.
 * @returns atom counts, render payload, warnings, or an actionable error.
 */
export declare function parseMolecule(format: MoleculeFormat, data: string, options?: ParseOptions): ParseResult;
