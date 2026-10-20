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
/** Convert an input format to the format 3Dmol.js must be asked to parse. */
export function renderFormatFor(format) {
    switch (format) {
        case 'pdb': return 'pdb';
        case 'sdf': return 'sdf';
        // 3Dmol.js registers no `mol` parser; a MOL block is an SDF record without
        // the `$$$$` delimiter, and the `sdf` parser reads it. Passing 'mol' makes
        // the library log "Unknown format" and *guess* — which fails outright for
        // most real molfiles (the guessed `xyz` parser then reads 0 atoms).
        case 'mol': return 'sdf';
        case 'mol2': return 'mol2';
        case 'xyz': return 'xyz';
        // Gaussian input has no 3Dmol.js parser either; the host rewrites the
        // geometry block to XYZ before it reaches the browser.
        case 'gjf': return 'xyz';
        default: {
            const exhaustive = format;
            throw new Error(`unhandled molecular format: ${String(exhaustive)}`);
        }
    }
}
/** Build a failed result. */
function fail(error, errorHint, warnings = []) {
    return {
        ok: false, atomCount: 0, renderAtomCount: 0, warnings,
        error, ...(errorHint !== undefined ? { errorHint } : {}),
    };
}
/** Build a successful result. */
function pass(atomCount, render, warnings, renderAtomCount = atomCount) {
    return { ok: true, atomCount, renderAtomCount, render, warnings };
}
/** Whether a fixed-column text field parses as a finite number. */
function isNumericField(field) {
    const trimmed = field.trim();
    if (trimmed === '' || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(trimmed))
        return false;
    return Number.isFinite(Number(trimmed.replace(/[dD]/, 'e')));
}
/** Split content into lines, tolerating CRLF and a trailing newline. */
function linesOf(data) {
    return data.replace(/\r\n?/g, '\n').split('\n');
}
/** Drop leading and trailing blank lines (for formats with no leading header). */
function trimBlankEdges(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && (lines[start] ?? '').trim() === '')
        start++;
    while (end > start && (lines[end - 1] ?? '').trim() === '')
        end--;
    return lines.slice(start, end);
}
/** Drop trailing blank lines (leading ones are significant in a molfile). */
function trimTrailingBlank(lines) {
    let end = lines.length;
    while (end > 0 && (lines[end - 1] ?? '').trim() === '')
        end--;
    return lines.slice(0, end);
}
/** PDB atom-record columns, 1-based and inclusive, as the spec defines them. */
const PDB_COLUMNS = {
    serial: [7, 11],
    altLoc: [17, 17],
    resName: [18, 20],
    x: [31, 38],
    y: [39, 46],
    z: [47, 54],
};
/** Slice a 1-based inclusive column range out of a PDB line. */
function column(line, range) {
    return line.slice(range[0] - 1, range[1]);
}
/**
 * Validate PDB content and, when needed, repair the one misalignment that
 * 3Dmol.js turns into silently missing atoms.
 */
function validatePdb(data, options) {
    const lines = linesOf(data);
    const records = [];
    let conectCount = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? '';
        if (line.startsWith('CONECT'))
            conectCount++;
        if (!line.startsWith('ATOM') && !line.startsWith('HETATM'))
            continue;
        const number = index + 1;
        if (!line.startsWith('ATOM  ') && !line.startsWith('HETATM')) {
            return fail(`PDB line ${number}: the record name must occupy columns 1-6 as "ATOM  " or "HETATM" — found ${JSON.stringify(line.slice(0, 8))}`, 'Every field in a PDB atom record is fixed-column, so a short record name shifts everything after it.');
        }
        if (line.length < PDB_COLUMNS.z[1]) {
            return fail(`PDB line ${number}: ${line.length} characters long, but a coordinate record needs content through column ${PDB_COLUMNS.z[1]}`, 'The z coordinate is cut off — re-export the structure with standard PDB columns.');
        }
        // Column 30 is always blank in a valid record: x occupies columns 31-38,
        // right-justified. A value in column 30 means the coordinate block slid one
        // column left, which still parses — as a wrong but plausible number. That
        // is exactly the silent mis-read this check exists for.
        const column30 = line[29];
        if (column30 !== undefined && column30 !== ' ') {
            return fail(`PDB line ${number}: column 30 holds ${JSON.stringify(column30)}, but the x coordinate must start in column 31`, 'The atom record is shifted one column to the left (resName lands in 17-19 instead of 18-20). Re-export with standard PDB columns.');
        }
        for (const axis of ['x', 'y', 'z']) {
            const field = column(line, PDB_COLUMNS[axis]);
            if (!isNumericField(field)) {
                return fail(`PDB line ${number}: the ${axis} coordinate (columns ${PDB_COLUMNS[axis][0]}-${PDB_COLUMNS[axis][1]}) is not a number — found ${JSON.stringify(field)}`, 'Coordinates are fixed-column: x is 31-38, y is 39-46, z is 47-54. A shifted record parses as garbage without any error from 3Dmol.js.');
            }
        }
        records.push({
            line,
            number,
            altLoc: column(line, PDB_COLUMNS.altLoc),
            resName: column(line, PDB_COLUMNS.resName).trim(),
        });
    }
    if (records.length === 0) {
        return fail('no ATOM or HETATM records found in PDB data', 'Check that the file really is PDB format — a CIF, XYZ or Gaussian output file needs its own format.');
    }
    const warnings = [];
    const firstRecord = records[0];
    if (!/^[A-Za-z0-9]{0,3}$/.test(firstRecord.resName)) {
        return fail(`PDB line ${firstRecord.number}: the residue name (columns 18-20) reads ${JSON.stringify(firstRecord.resName)}, which is not a 1-3 character residue name`, 'A residue name that long means the record is misaligned, so PDB readers drop or mislabel these atoms.');
    }
    const serial = column(firstRecord.line, PDB_COLUMNS.serial).trim();
    if (serial !== '' && !/^\d+$/.test(serial)) {
        warnings.push({
            code: 'pdb-serial-non-numeric',
            message: `atom serial numbers are not plain integers (first is ${JSON.stringify(serial)}) — fine for 3Dmol.js, unusual for PDB`,
        });
    }
    // Alternate-location analysis. 3Dmol.js keeps only atoms whose altLoc is
    // blank or "A" (unless told otherwise), so a file where *every* atom carries
    // the same letter renders a handful of atoms at most.
    const altLocCounts = new Map();
    for (const record of records) {
        if (record.altLoc === '' || record.altLoc === ' ')
            continue;
        altLocCounts.set(record.altLoc, (altLocCounts.get(record.altLoc) ?? 0) + 1);
    }
    const distinctAltLocs = [...altLocCounts.entries()].sort((left, right) => right[1] - left[1]);
    const dominant = distinctAltLocs[0];
    const dominantLetter = dominant?.[0] ?? '';
    const dominantCount = dominant?.[1] ?? 0;
    const uniformAltLoc = dominantCount >= Math.max(2, Math.ceil(records.length * 0.9));
    let renderData = data;
    if (uniformAltLoc && dominantLetter !== '') {
        if (options.repairShiftedPdbAltLoc === false) {
            return fail(`all ${dominantCount} atom records carry the same alternate-location letter ${JSON.stringify(dominantLetter)} in column 17, where PDB defines altLoc`, `Residue names are one column to the left (17-19 instead of 18-20), so 3Dmol.js reads the residue name's first letter as an alternate conformation and keeps only ${Math.max(records.length - dominantCount, 0)} of ${records.length} atoms. Re-export with standard PDB columns, or leave repairShiftedPdbAltLoc enabled.`);
        }
        const repaired = lines.map((line) => {
            if (!line.startsWith('ATOM') && !line.startsWith('HETATM'))
                return line;
            return line.slice(0, 16) + ' ' + line.slice(17);
        });
        renderData = repaired.join('\n');
        warnings.push({
            code: 'pdb-altloc-column-repaired',
            message: `cleared a spurious alternate-location flag ${JSON.stringify(dominantLetter)} in column 17 of ${dominantCount} atom records (residue names sat in columns 17-19); without the repair 3Dmol.js would have kept ${Math.max(records.length - dominantCount, 0)} of ${records.length} atoms`,
        });
    }
    else if (distinctAltLocs.length > 0) {
        warnings.push({
            code: 'pdb-altloc',
            message: `${dominantCount} of ${records.length} atom records carry alternate-location letters (${distinctAltLocs.map(([letter]) => letter).join(', ')}); 3Dmol.js keeps the blank and "A" conformers only`,
        });
    }
    if (conectCount === 0 && records.length > 1) {
        warnings.push({
            code: 'pdb-no-conect',
            message: 'no CONECT records — bonds are perceived by distance, which is right for most structures but can merge atoms that sit close in space',
        });
    }
    return pass(records.length, { format: 'pdb', data: renderData }, warnings);
}
/** Validate one V2000 atom line. */
function validateV2000Atom(line, atomIndex, blockIndex) {
    const where = `MOL block ${blockIndex + 1}, atom ${atomIndex + 1}`;
    if (line.length < 34) {
        return `${where}: line is ${line.length} characters, but an atom line carries coordinates in columns 1-30 and the element symbol in 32-34`;
    }
    for (const [axis, offset] of [['x', 0], ['y', 10], ['z', 20]]) {
        const field = line.slice(offset, offset + 10);
        if (!isNumericField(field)) {
            return `${where}: the ${axis} coordinate is not a number — found ${JSON.stringify(field)}`;
        }
    }
    const symbol = line.slice(31, 34).trim();
    if (symbol === '') {
        return `${where}: no element symbol in columns 32-34`;
    }
    if (!/^(?:[A-Za-z]{1,3}|\*|R#?|A|Q|L)$/.test(symbol)) {
        return `${where}: element symbol ${JSON.stringify(symbol)} is not a valid element or query atom`;
    }
    return undefined;
}
/**
 * Parse a V2000 counts line.
 *
 * The atom and bond counts are fixed-width (3 columns each), so a file with a
 * three-digit count and a three-digit bond count writes them together with no
 * separator — Chem3D emits `210216  0  0 … V2000` for 210 atoms and 216 bonds.
 * Reading the fields with a `\d+\s+\d+` regex turns that into 210216 atoms.
 */
function parseV2000Counts(line) {
    const atomField = line.slice(0, 3).trim();
    const bondField = line.slice(3, 6).trim();
    if (/^\d+$/.test(atomField) && /^\d+$/.test(bondField)) {
        return { atoms: Number(atomField), bonds: Number(bondField) };
    }
    const spaced = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (spaced === null)
        return undefined;
    return { atoms: Number(spaced[1]), bonds: Number(spaced[2]) };
}
/** Does this line look like a V2000/V3000 counts line? */
function looksLikeCountsLine(line) {
    if (/V3000/.test(line))
        return true;
    // V2000: at least the atom and bond counts followed by more integers; atom
    // lines have floating-point coordinates, so six integers in a row rule them
    // out.
    return /^\s*\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+/.test(line);
}
/** Validate one V3000 body (`M  V30` sections). */
function validateV3000Block(lines, countsIndex, blockIndex) {
    let atoms = 0;
    let bonds = 0;
    let section = 'none';
    // V3000 keeps the real counts in the `M  V30 COUNTS` line; the header counts
    // line is all zeros.
    const countsLine = lines.find((line) => /M\s+V30\s+COUNTS/.test(line)) ?? lines[countsIndex] ?? '';
    const counters = /\b(\d+)\s+(\d+)\b/.exec(countsLine);
    if (counters !== null) {
        atoms = Number.parseInt(counters[1] ?? '0', 10);
        bonds = Number.parseInt(counters[2] ?? '0', 10);
    }
    let atomIndex = 0;
    let bondIndex = 0;
    for (const line of lines) {
        if (/BEGIN ATOM/.test(line)) {
            section = 'atom';
            continue;
        }
        if (/END ATOM/.test(line)) {
            section = 'none';
            continue;
        }
        if (/BEGIN BOND/.test(line)) {
            section = 'bond';
            continue;
        }
        if (/END BOND/.test(line)) {
            section = 'none';
            continue;
        }
        const v30 = /^\s*M\s+V30\s+(.*)$/.exec(line);
        if (v30 === null)
            continue;
        const body = v30[1] ?? '';
        if (section === 'atom') {
            atomIndex++;
            const fields = body.trim().split(/\s+/);
            if (fields.length < 5) {
                return {
                    error: `MOL block ${blockIndex + 1}, V3000 atom ${atomIndex}: expected "index element x y z", found ${JSON.stringify(body.trim())}`,
                };
            }
            for (const [offset, axis] of [[2, 'x'], [3, 'y'], [4, 'z']]) {
                if (!isNumericField(fields[offset] ?? '')) {
                    return {
                        error: `MOL block ${blockIndex + 1}, V3000 atom ${atomIndex}: the ${axis} coordinate is not a number — found ${JSON.stringify(fields[offset] ?? '')}`,
                    };
                }
            }
        }
        else if (section === 'bond') {
            bondIndex++;
        }
    }
    if (atomIndex > 0)
        atoms = atomIndex;
    if (bondIndex > 0)
        bonds = bondIndex;
    if (atoms <= 0) {
        return {
            error: `MOL block ${blockIndex + 1}: V3000 content has no atoms (no "BEGIN ATOM" section)`,
            hint: 'A V3000 molfile wraps its atom block in "M  V30 BEGIN ATOM" / "M  V30 END ATOM".',
        };
    }
    return { stats: { atoms, bonds } };
}
/** Validate one MOL/SDF record. */
function validateMolBlock(rawBlock, blockIndex, warnings) {
    const lines = trimTrailingBlank(rawBlock);
    if (lines.length < 4) {
        return {
            error: `MOL block ${blockIndex + 1}: only ${lines.length} non-empty lines — a molfile needs 3 header lines plus a counts line`,
            hint: 'A V2000 molfile is 3 header lines, the counts line, then the atom and bond blocks.',
        };
    }
    // The counts line is line 4. The header lines may legitimately be blank (the
    // title line is empty in every Chem3D export), so leading blank lines must
    // NOT be trimmed away — doing so moves the counts line and turns the first
    // atom line into it. A few writers emit only two header lines; that shape is
    // recognised explicitly instead of being misread.
    let countsIndex = 3;
    let countsLine = lines[3] ?? '';
    if (!looksLikeCountsLine(countsLine) && looksLikeCountsLine(lines[2] ?? '')) {
        countsIndex = 2;
        countsLine = lines[2] ?? '';
        warnings.push({
            code: 'mol-two-header-lines',
            message: `MOL block ${blockIndex + 1} has only two header lines (the counts line sits on line 3); the file is still read, but a standard molfile has three`,
        });
    }
    if (/V3000/.test(countsLine))
        return validateV3000Block(lines, countsIndex, blockIndex);
    const counts = parseV2000Counts(countsLine);
    if (counts === undefined) {
        return {
            error: `MOL block ${blockIndex + 1}: the counts line does not start with atom and bond counts — checked line 4 (${JSON.stringify((lines[3] ?? '').slice(0, 40))}) and line 3 (${JSON.stringify((lines[2] ?? '').slice(0, 40))})`,
            hint: 'The counts line reads e.g. " 21 20  0  0  0  0  0  0  0  0999 V2000" and follows the three header lines (title, program, comment), which may be blank.',
        };
    }
    const atomCount = counts.atoms;
    const bondCount = counts.bonds;
    if (atomCount <= 0) {
        return {
            error: `MOL block ${blockIndex + 1}: the counts line declares ${atomCount} atoms`,
            hint: 'An empty molfile has nothing to render; export the structure again with its atoms.',
        };
    }
    const firstAtomLine = countsIndex + 1;
    for (let atomIndex = 0; atomIndex < atomCount; atomIndex++) {
        const line = lines[firstAtomLine + atomIndex];
        if (line === undefined) {
            return {
                error: `MOL block ${blockIndex + 1}: the counts line declares ${atomCount} atoms but the atom block has only ${atomIndex} lines`,
                hint: 'The file is truncated — the atom block must contain exactly as many lines as the counts line declares.',
            };
        }
        const problem = validateV2000Atom(line, atomIndex, blockIndex);
        if (problem !== undefined)
            return { error: problem, hint: 'Every V2000 atom line is fixed-column: x 1-10, y 11-20, z 21-30, element 32-34.' };
    }
    for (let bondIndex = 0; bondIndex < bondCount; bondIndex++) {
        const line = lines[firstAtomLine + atomCount + bondIndex];
        const where = `MOL block ${blockIndex + 1}, bond ${bondIndex + 1}`;
        if (line === undefined) {
            return {
                error: `${where}: the counts line declares ${bondCount} bonds but the bond block has only ${bondIndex} lines`,
                hint: 'The file is truncated — the bond block must contain exactly as many lines as the counts line declares.',
            };
        }
        const from = Number.parseInt(line.slice(0, 3), 10);
        const to = Number.parseInt(line.slice(3, 6), 10);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > atomCount || to > atomCount) {
            return {
                error: `${where}: references atom indices ${JSON.stringify(line.slice(0, 6))}, outside the declared range 1-${atomCount}`,
                hint: 'Bond lines list two 1-based atom indices in columns 1-3 and 4-6.',
            };
        }
    }
    if (bondCount === 0) {
        warnings.push({
            code: 'mol-no-bonds',
            message: `MOL block ${blockIndex + 1} declares no bonds — 3Dmol.js draws bonds only from the bond block, so the viewer falls back to perceiving them by distance`,
        });
    }
    return { stats: { atoms: atomCount, bonds: bondCount } };
}
/** Validate MOL/SDF content (one or more `$$$$`-separated records). */
function validateMolFormat(data) {
    const blocks = data.split('$$$$');
    const warnings = [];
    const stats = [];
    const texts = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const raw = linesOf(blocks[blockIndex] ?? '');
        // Each record after the first starts with the newline that followed the
        // `$$$$` delimiter; that one line is an artefact of splitting, whereas the
        // leading lines of a record are its (possibly blank) header lines.
        const block = blockIndex > 0 && (raw[0] ?? '').trim() === '' ? raw.slice(1) : raw;
        if (trimTrailingBlank(block).length === 0)
            continue;
        const outcome = validateMolBlock(block, stats.length, warnings);
        if (outcome.error !== undefined)
            return fail(outcome.error, outcome.hint, warnings);
        if (outcome.stats !== undefined) {
            stats.push(outcome.stats);
            texts.push(`${trimTrailingBlank(block).join('\n')}\nM  END\n`);
        }
    }
    if (stats.length === 0) {
        return fail('no molecule block found', 'An SDF/MOL file needs at least one record terminated by "M  END".');
    }
    // 3Dmol.js loads one model per addModel call, so only the first record is
    // rendered. Keep the payload to that record so the viewer and the atom count
    // agree, and say so. A single-record file is passed through byte-for-byte.
    const first = stats[0];
    const atomCount = stats.reduce((total, block) => total + block.atoms, 0);
    if (stats.length > 1) {
        warnings.push({
            code: 'sdf-multi-molecule',
            message: `the file contains ${stats.length} molecules (${atomCount} atoms in total); the viewer renders the first one (${first.atoms} atoms)`,
        });
    }
    const renderData = stats.length === 1 ? data : (texts[0] ?? data);
    return pass(atomCount, { format: 'sdf', data: renderData }, warnings, first.atoms);
}
// ---------------------------------------------------------------------------
// MOL2
// ---------------------------------------------------------------------------
/** Validate TRIPOS MOL2 content. */
function validateMol2(data) {
    const lines = linesOf(data);
    const headerIndex = lines.findIndex((line) => line.trim() === '@<TRIPOS>MOLECULE');
    if (headerIndex < 0) {
        return fail('no @<TRIPOS>MOLECULE header found in MOL2 data', 'A mol2 file starts with "@<TRIPOS>MOLECULE" followed by the molecule name and the counts line.');
    }
    const countsLine = lines[headerIndex + 2] ?? '';
    const counts = /^\s*(\d+)\s+(\d+)/.exec(countsLine);
    const declaredAtoms = counts === null ? undefined : Number.parseInt(counts[1] ?? '0', 10);
    const declaredBonds = counts === null ? undefined : Number.parseInt(counts[2] ?? '0', 10);
    let section = '';
    let atoms = 0;
    let bonds = 0;
    const warnings = [];
    for (let index = headerIndex; index < lines.length; index++) {
        const trimmed = (lines[index] ?? '').trim();
        if (trimmed.startsWith('@<TRIPOS>')) {
            section = trimmed.slice('@<TRIPOS>'.length).toUpperCase();
            continue;
        }
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        if (section === 'ATOM') {
            atoms++;
            const fields = trimmed.split(/\s+/);
            if (fields.length < 6) {
                return fail(`MOL2 atom ${atoms}: expected "id name x y z type", found ${JSON.stringify(trimmed)}`, 'The @<TRIPOS>ATOM section is whitespace-separated: id, atom name, x, y, z, atom type.');
            }
            for (const [offset, axis] of [[2, 'x'], [3, 'y'], [4, 'z']]) {
                if (!isNumericField(fields[offset] ?? '')) {
                    return fail(`MOL2 atom ${atoms}: the ${axis} coordinate is not a number — found ${JSON.stringify(fields[offset] ?? '')}`);
                }
            }
        }
        else if (section === 'BOND') {
            bonds++;
        }
    }
    if (atoms === 0) {
        return fail('no @<TRIPOS>ATOM section found in MOL2 data', 'MOL2 geometry lives in a section introduced by "@<TRIPOS>ATOM".');
    }
    if (declaredAtoms !== undefined && declaredAtoms !== atoms) {
        warnings.push({
            code: 'mol2-count-mismatch',
            message: `the MOL2 counts line declares ${declaredAtoms} atoms but the atom section has ${atoms}`,
        });
    }
    if (bonds === 0) {
        warnings.push({
            code: 'mol2-no-bonds',
            message: 'no @<TRIPOS>BOND section — 3Dmol.js draws mol2 bonds from it, so the viewer falls back to perceiving bonds by distance',
        });
    }
    else if (declaredBonds !== undefined && declaredBonds !== bonds) {
        warnings.push({
            code: 'mol2-bond-count-mismatch',
            message: `the MOL2 counts line declares ${declaredBonds} bonds but the bond section has ${bonds}`,
        });
    }
    return pass(atoms, { format: 'mol2', data }, warnings);
}
// ---------------------------------------------------------------------------
// XYZ
// ---------------------------------------------------------------------------
/** Validate XYZ content (atom count line, comment, `element x y z` rows). */
function validateXyz(data) {
    const lines = trimBlankEdges(linesOf(data));
    const header = (lines[0] ?? '').trim();
    const declared = Number.parseInt(header, 10);
    if (!Number.isInteger(declared) || declared <= 0 || header !== String(declared)) {
        return fail(`the first line of an XYZ file must be the atom count — found ${JSON.stringify((lines[0] ?? '').slice(0, 40))}`, 'An XYZ file is: atom count, comment line, then one "element x y z" line per atom.');
    }
    if (lines.length < declared + 2) {
        return fail(`the file declares ${declared} atoms but has only ${Math.max(lines.length - 2, 0)} atom lines after the count and comment lines`, 'An XYZ file is: atom count, comment line, then one "element x y z" line per atom. The atom block is truncated.');
    }
    for (let index = 0; index < declared; index++) {
        // Line 0 is the atom count and line 1 the comment; atoms start at line 2.
        const line = lines[index + 2] ?? '';
        const fields = line.trim().split(/\s+/);
        const number = index + 1;
        if (fields.length < 4) {
            return fail(`XYZ atom ${number}: expected "element x y z", found ${JSON.stringify(line.trim())}`, 'Coordinates and the element symbol are whitespace-separated in XYZ files.');
        }
        if (!/^[A-Za-z]{1,3}$/.test(fields[0] ?? '')) {
            return fail(`XYZ atom ${number}: ${JSON.stringify(fields[0])} is not an element symbol`);
        }
        for (const [offset, axis] of [[1, 'x'], [2, 'y'], [3, 'z']]) {
            if (!isNumericField(fields[offset] ?? '')) {
                return fail(`XYZ atom ${number}: the ${axis} coordinate is not a number — found ${JSON.stringify(fields[offset] ?? '')}`);
            }
        }
    }
    const warnings = [{
            code: 'xyz-no-bonds',
            message: 'XYZ carries no bonds — the viewer perceives them by distance',
        }];
    if ((lines[declared + 2] ?? '').trim() !== '') {
        warnings.push({
            code: 'xyz-extra-frames',
            message: `the file holds more than one frame; the viewer renders the first ${declared} atoms`,
        });
    }
    return pass(declared, { format: 'xyz', data }, warnings);
}
/** Normalise an element token to canonical case (`CL` → `Cl`). */
function normaliseElement(raw) {
    const lower = raw.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}
/**
 * Validate Gaussian input content and rewrite its geometry block as XYZ.
 *
 * Only the geometry is read: link-0 commands, the route section and any later
 * `--Link1--` sections are irrelevant to rendering. 3Dmol.js has no Gaussian
 * parser at all, so without this conversion `addModel(data, 'gjf')` logs
 * "Unknown format" and returns a model with zero atoms.
 */
function validateGjf(data) {
    const lines = linesOf(data);
    const routeIndex = lines.findIndex((line) => line.trim().startsWith('#'));
    if (routeIndex < 0) {
        return fail('no route section found — a Gaussian input file starts its "#" line before the geometry', 'Pass a Gaussian *input* file (.gjf/.com), or convert the structure to XYZ.');
    }
    let chargeIndex = -1;
    for (let index = routeIndex + 1; index < lines.length; index++) {
        if (/^\s*[-+]?\d+\s+[-+]?\d+\s*$/.test(lines[index] ?? '')) {
            chargeIndex = index;
            break;
        }
    }
    if (chargeIndex < 0) {
        return fail('no "charge multiplicity" line found after the route section', 'A Gaussian input file carries the charge and spin multiplicity (e.g. "0 1") on its own line just before the geometry.');
    }
    const atomPattern = /^\s*([A-Za-z]{1,3})(?:\([^)]*\))?\s+([-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?)\s*$/;
    const atoms = [];
    for (let index = chargeIndex + 1; index < lines.length; index++) {
        const line = lines[index] ?? '';
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('--Link1--'))
            break;
        const match = atomPattern.exec(line);
        if (match === null)
            break;
        atoms.push({
            element: normaliseElement(match[1] ?? ''),
            x: match[2] ?? '0',
            y: match[3] ?? '0',
            z: match[4] ?? '0',
        });
    }
    if (atoms.length === 0) {
        return fail('no geometry atoms found after the charge/multiplicity line', 'Geometry lines read "Element x y z", e.g. " C   -5.83910000   -1.71460000    0.52080000".');
    }
    const xyz = [
        String(atoms.length),
        'converted from Gaussian input by dsh-molecule-visualization',
        ...atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`),
        '',
    ].join('\n');
    const warnings = [{
            code: 'gjf-converted-to-xyz',
            message: `Gaussian input converted to XYZ (${atoms.length} atoms); bonds are perceived by distance`,
        }];
    const extraSections = lines.filter((line) => line.trim().startsWith('--Link1--')).length;
    if (extraSections > 0) {
        warnings.push({
            code: 'gjf-multi-section',
            message: `the file has ${extraSections} --Link1-- section(s); the first geometry is rendered`,
        });
    }
    return pass(atoms.length, { format: 'xyz', data: xyz }, warnings);
}
// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
/**
 * Validate `data` as `format` and produce a render-ready payload.
 * @param format - the declared input format.
 * @param data - raw file content.
 * @param options - strictness knobs.
 * @returns atom counts, render payload, warnings, or an actionable error.
 */
export function parseMolecule(format, data, options = {}) {
    if (data.trim() === '') {
        return fail('empty molecular data', 'The file or inline content contained no text.');
    }
    switch (format) {
        case 'pdb': return validatePdb(data, options);
        case 'sdf': return validateMolFormat(data);
        case 'mol': return validateMolFormat(data);
        case 'mol2': return validateMol2(data);
        case 'xyz': return validateXyz(data);
        case 'gjf': return validateGjf(data);
        default: {
            const exhaustive = format;
            return fail(`unsupported format: ${String(exhaustive)}`);
        }
    }
}
//# sourceMappingURL=parser.js.map