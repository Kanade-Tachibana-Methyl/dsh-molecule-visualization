/**
 * Shared types for the molecule viewer tool plugin.
 *
 * The viewer payload travels inside the `tool/result` event's
 * `presentationMeta` projection (a first-class harness event type that every
 * build persists and replays), so no custom session event type is declared:
 * out-of-repo event types are refused on load by builds that do not know
 * them, which would break session history for downstream users.
 * @module dsh-molecule-visualization/types
 */
/**
 * Supported molecular file formats.
 *
 * `mol` and `gjf` are *input* formats with no 3Dmol.js parser of their own:
 * MOL blocks are parsed by the `sdf` parser, and Gaussian input is converted
 * to XYZ on the host. {@link RenderFormat} is what actually reaches 3Dmol.js.
 */
export type MoleculeFormat = 'pdb' | 'sdf' | 'mol2' | 'mol' | 'xyz' | 'gjf';
/** Formats the vendored 3Dmol.js 2.4.2 build registers a parser for. */
export type RenderFormat = 'pdb' | 'sdf' | 'mol2' | 'xyz';
/**
 * Display styles.
 *
 * `ballstick` is ball-and-stick: 3Dmol.js has no such representation, it is
 * the clinical *overlay* of a thin stick and a small sphere
 * (`{ stick: { radius }, sphere: { scale } }`) on the same selection.
 */
export type MoleculeStyle = 'stick' | 'ballstick' | 'line' | 'sphere' | 'cartoon';
/** Tool-facing arguments after schema validation. */
export interface ViewMoleculeArgs {
    /**
     * Path to a molecular file, read server-side (preferred source). Windows and
     * POSIX spellings both resolve; `~` expands against the host HOME.
     */
    path?: string;
    /** Raw molecular file content as a UTF-8 string — only when no file exists. */
    data?: string;
    /**
     * File format. Required with `data`; inferred from `path`'s extension when
     * omitted.
     */
    format?: MoleculeFormat;
    /** Optional human-readable display name. */
    name?: string;
    /** Initial rendering style; the user may change it live in the client. */
    style?: MoleculeStyle;
}
/** Canonical tool result returned to the model. */
export interface ViewMoleculeResult {
    /** Echoed input format. */
    format: MoleculeFormat;
    /** Number of atoms detected during the host-side parse pass. */
    atomCount: number;
    /** Optional display name. */
    name?: string;
    /** Whether the data passed validation. */
    ok: boolean;
    /** Diagnostic message when `ok` is false. */
    error?: string;
    /** Actionable next step when `ok` is false. */
    errorHint?: string;
    /** Non-fatal findings worth surfacing to the user (rendered on the card). */
    warnings?: string[];
}
/** Marker distinguishing this tool's meta from every other tool's payload. */
export declare const MOLECULE_META_KIND = "molecule-view";
/**
 * UI payload persisted with the `tool/result` event via
 * `output.presentationMeta` and delivered to the client's keyed
 * `tool.call.toolview` renderer as `block.meta`. Snapshot semantics: the
 * payload is projected once at result time and replayed verbatim on reload.
 * Declared as a type alias so it stays assignable to the `JsonValue` index
 * signature `presentationMeta` returns.
 */
export type MoleculeViewMeta = {
    /** Discriminant; always {@link MOLECULE_META_KIND}. */
    readonly kind: typeof MOLECULE_META_KIND;
    /** Whether the molecular data passed host-side validation. */
    readonly ok: boolean;
    /** Input format as declared by the caller. */
    readonly format: MoleculeFormat;
    /**
     * Format the client must hand to `viewer.addModel`. Absent on payloads
     * written by plugin versions before the format-mapping fix; the client then
     * derives it from {@link format} (this is what makes `mol` render).
     */
    readonly renderFormat?: RenderFormat;
    /** Atoms counted by the host-side parse (0 when `ok` is false). */
    readonly atomCount: number;
    /** Atoms the client should expect 3Dmol.js to load (defaults to atomCount). */
    readonly renderAtomCount?: number;
    /** Initial rendering style. */
    readonly style: MoleculeStyle;
    /** Optional display name. */
    readonly name?: string;
    /** Diagnostic message when `ok` is false. */
    readonly error?: string;
    /** Actionable next step when `ok` is false. */
    readonly errorHint?: string;
    /** Non-fatal findings shown on the card. */
    readonly warnings?: string[];
    /**
     * Render-ready molecular content (already normalised to `renderFormat`).
     * Omitted when the parse failed, when the source could not be re-read, or
     * when the content exceeds the inline cap (then `truncated` is set).
     */
    readonly data?: string;
    /** Set when `data` was withheld because the content exceeds the inline cap. */
    readonly truncated?: true;
};
