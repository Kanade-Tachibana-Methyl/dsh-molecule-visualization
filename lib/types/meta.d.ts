/**
 * UI payload projection for the `view_molecule` tool.
 *
 * Split out of the tool registration so the projection can be unit-tested
 * without a Cordis context: it is pure apart from the injected source reader.
 * @module dsh-molecule-visualization/meta
 */
import { type ParseOptions } from './parser.ts';
import { type MoleculeStyle, type MoleculeViewMeta, type ViewMoleculeArgs, type ViewMoleculeResult } from './types.ts';
/**
 * Cap on molecular content inlined into the persisted UI payload. The payload
 * rides the session log, so an unbounded inline would balloon every future
 * write of the log; above the cap the client renders a summary card instead
 * of the interactive viewer.
 */
export declare const MAX_META_INLINE_BYTES: number;
/** Everything the projection needs from the surrounding plugin. */
export interface MetaProjectionDeps {
    /** Style to use when the caller omitted `style`. */
    readonly defaultStyle: MoleculeStyle;
    /** Strictness knobs; must match the ones the tool body validated with. */
    readonly parseOptions: ParseOptions;
    /**
     * Re-read a `path` source at projection time (throw to signal failure).
     * Injected so the projection stays testable without touching the filesystem.
     */
    readonly readSource: (path: string) => string;
}
/** Byte length of a string in UTF-8, independent of Node's Buffer typings. */
export declare function utf8Length(text: string): number;
/**
 * Project the UI payload for the `tool/result` event.
 *
 * The payload is projected once, at result time, and replayed verbatim on
 * every later reload — so the molecular content is snapshotted here rather
 * than referenced by path. Never throws: a projection failure degrades to a
 * payload without `data` (the card then shows a summary), because the tool
 * call itself has already landed.
 *
 * @param args - the validated call arguments.
 * @param result - the canonical tool result.
 * @param deps - default style, parse knobs, and the source reader.
 * @returns the payload persisted with the event.
 */
export declare function buildMoleculeMeta(args: ViewMoleculeArgs, result: ViewMoleculeResult, deps: MetaProjectionDeps): MoleculeViewMeta;
