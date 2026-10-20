/**
 * UI payload projection for the `view_molecule` tool.
 *
 * Split out of the tool registration so the projection can be unit-tested
 * without a Cordis context: it is pure apart from the injected source reader.
 * @module dsh-molecule-visualization/meta
 */
import { parseMolecule, renderFormatFor } from "./parser.js";
import { MOLECULE_META_KIND, } from "./types.js";
/**
 * Cap on molecular content inlined into the persisted UI payload. The payload
 * rides the session log, so an unbounded inline would balloon every future
 * write of the log; above the cap the client renders a summary card instead
 * of the interactive viewer.
 */
export const MAX_META_INLINE_BYTES = 2 * 1024 * 1024;
/** Byte length of a string in UTF-8, independent of Node's Buffer typings. */
export function utf8Length(text) {
    return new TextEncoder().encode(text).byteLength;
}
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
export function buildMoleculeMeta(args, result, deps) {
    const style = args.style ?? deps.defaultStyle;
    const base = {
        kind: MOLECULE_META_KIND,
        format: result.format,
        renderFormat: renderFormatFor(result.format),
        style,
        ...(result.name !== undefined ? { name: result.name } : {}),
        ...(result.warnings !== undefined && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
    if (!result.ok) {
        return {
            ...base,
            ok: false,
            atomCount: 0,
            error: result.error ?? 'validation failed',
            ...(result.errorHint !== undefined ? { errorHint: result.errorHint } : {}),
        };
    }
    let source;
    try {
        if (args.data !== undefined)
            source = args.data;
        else if (args.path !== undefined)
            source = deps.readSource(args.path);
    }
    catch {
        source = undefined;
    }
    if (source === undefined) {
        return { ...base, ok: true, atomCount: result.atomCount };
    }
    // Normalise again at projection time: the payload must be render-ready even
    // when the source is a format 3Dmol.js cannot parse by name.
    const parsed = parseMolecule(result.format, source, deps.parseOptions);
    const renderData = parsed.render?.data ?? source;
    const truncated = utf8Length(renderData) > MAX_META_INLINE_BYTES;
    return {
        ...base,
        ok: true,
        atomCount: result.atomCount,
        renderAtomCount: parsed.renderAtomCount > 0 ? parsed.renderAtomCount : result.atomCount,
        ...(truncated ? { truncated: true } : { data: renderData }),
        ...(parsed.render !== undefined ? { renderFormat: parsed.render.format } : {}),
    };
}
//# sourceMappingURL=meta.js.map