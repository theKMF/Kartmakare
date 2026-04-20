// Minimal QR Code generator — byte mode, ECC level L, versions 1–40.
// Public-domain-equivalent implementation built from the ISO/IEC 18004 spec.
// Exposes window.KmQR with: encode(text) → { size, modules } | null-if-too-big
// and renderSVG(modules, { scale, margin, color, bg }) → SVG string.

(function (global) {
    'use strict';

    // ---- Capacity (data codewords) & EC block structure, ECC level L only ----
    // Per ISO/IEC 18004 table 9. Format: [ecCodewordsPerBlock, group1Blocks, group1DataCW, group2Blocks, group2DataCW]
    const EC_L = [
        [ 7,  1,  19, 0,   0], //  1
        [10,  1,  34, 0,   0], //  2
        [15,  1,  55, 0,   0], //  3
        [20,  1,  80, 0,   0], //  4
        [26,  1, 108, 0,   0], //  5
        [18,  2,  68, 0,   0], //  6
        [20,  2,  78, 0,   0], //  7
        [24,  2,  97, 0,   0], //  8
        [30,  2, 116, 0,   0], //  9
        [18,  2,  68, 2,  69], // 10
        [20,  4,  81, 0,   0], // 11
        [24,  2,  92, 2,  93], // 12
        [26,  4, 107, 0,   0], // 13
        [30,  3, 115, 1, 116], // 14
        [22,  5,  87, 1,  88], // 15
        [24,  5,  98, 1,  99], // 16
        [28,  1, 107, 5, 108], // 17
        [30,  5, 120, 1, 121], // 18
        [28,  3, 113, 4, 114], // 19
        [28,  3, 107, 5, 108], // 20
        [28,  4, 116, 4, 117], // 21
        [28,  2, 111, 7, 112], // 22
        [30,  4, 121, 5, 122], // 23
        [30,  6, 117, 4, 118], // 24
        [26,  8, 106, 4, 107], // 25
        [28, 10, 114, 2, 115], // 26
        [30,  8, 122, 4, 123], // 27
        [30,  3, 117, 10, 118],// 28
        [30,  7, 116, 7, 117], // 29
        [30,  5, 115, 10, 116],// 30
        [30, 13, 115, 3, 116], // 31
        [30, 17, 115, 0,   0], // 32
        [30, 17, 115, 1, 116], // 33
        [30, 13, 115, 6, 116], // 34
        [30, 12, 121, 7, 122], // 35
        [30,  6, 121, 14, 122],// 36
        [30, 17, 122, 4, 123], // 37
        [30,  4, 122, 18, 123],// 38
        [30, 20, 117, 4, 118], // 39
        [30, 19, 118, 6, 119], // 40
    ];

    function dataCapacityBytes(version) {
        const e = EC_L[version - 1];
        const totalDataCW = e[1] * e[2] + e[3] * e[4];
        // byte mode: mode indicator (4) + char count indicator + data*8 + terminator(up to 4)
        const ccBits = version < 10 ? 8 : 16;
        const availBits = totalDataCW * 8 - 4 - ccBits;
        return Math.floor(availBits / 8);
    }

    // ---- Alignment pattern centre positions per version (ISO/IEC 18004 Annex E) ----
    const ALIGN = [
        [], [6,18], [6,22], [6,26], [6,30], [6,34],
        [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62],
        [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78], [6,30,56,82], [6,30,58,86], [6,34,62,90],
        [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102], [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118],
        [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130], [6,30,56,82,108,134], [6,34,60,86,112,138],
        [6,30,58,86,114,142], [6,34,62,90,118,146], [6,30,54,78,102,126,150], [6,24,50,76,102,128,154],
        [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166], [6,30,58,86,114,142,170],
    ];

    // ---- GF(256) tables, primitive polynomial 0x11D ----
    const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
    (function () {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            GF_EXP[i] = x;
            GF_LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
        for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
    })();

    function gfMul(a, b) {
        if (a === 0 || b === 0) return 0;
        return GF_EXP[GF_LOG[a] + GF_LOG[b]];
    }

    function rsGeneratorPoly(degree) {
        let poly = [1];
        for (let i = 0; i < degree; i++) {
            const next = new Array(poly.length + 1).fill(0);
            for (let j = 0; j < poly.length; j++) {
                next[j] ^= poly[j];
                next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
            }
            poly = next;
        }
        return poly;
    }

    function rsEncode(data, ecLen) {
        const gen = rsGeneratorPoly(ecLen);
        const out = new Array(data.length + ecLen).fill(0);
        for (let i = 0; i < data.length; i++) out[i] = data[i];
        for (let i = 0; i < data.length; i++) {
            const coef = out[i];
            if (coef !== 0) {
                for (let j = 0; j < gen.length; j++) out[i + j] ^= gfMul(gen[j], coef);
            }
        }
        return out.slice(data.length);
    }

    // ---- Bit buffer ----
    class BitBuffer {
        constructor() { this.bytes = []; this.bitLen = 0; }
        put(val, len) {
            for (let i = len - 1; i >= 0; i--) {
                const bit = (val >>> i) & 1;
                const idx = this.bitLen >>> 3;
                if (idx >= this.bytes.length) this.bytes.push(0);
                if (bit) this.bytes[idx] |= (0x80 >>> (this.bitLen & 7));
                this.bitLen++;
            }
        }
    }

    function utf8Bytes(str) {
        if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
        const out = [];
        for (let i = 0; i < str.length; i++) {
            let c = str.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) { out.push(0xC0 | (c >> 6)); out.push(0x80 | (c & 0x3F)); }
            else if (c < 0xD800 || c >= 0xE000) { out.push(0xE0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3F)); out.push(0x80 | (c & 0x3F)); }
            else { // surrogate pair
                const c2 = str.charCodeAt(++i);
                const cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
                out.push(0xF0 | (cp >> 18)); out.push(0x80 | ((cp >> 12) & 0x3F));
                out.push(0x80 | ((cp >> 6) & 0x3F)); out.push(0x80 | (cp & 0x3F));
            }
        }
        return out;
    }

    function chooseVersion(byteLen) {
        for (let v = 1; v <= 40; v++) {
            if (byteLen <= dataCapacityBytes(v)) return v;
        }
        return -1;
    }

    function buildCodewords(bytes, version) {
        const e = EC_L[version - 1];
        const totalDataCW = e[1] * e[2] + e[3] * e[4];
        const ccBits = version < 10 ? 8 : 16;

        const bb = new BitBuffer();
        bb.put(0b0100, 4); // byte mode
        bb.put(bytes.length, ccBits);
        for (const b of bytes) bb.put(b, 8);

        // terminator
        const totalBits = totalDataCW * 8;
        const termLen = Math.min(4, totalBits - bb.bitLen);
        if (termLen > 0) bb.put(0, termLen);
        // pad to byte boundary
        while (bb.bitLen & 7) bb.put(0, 1);
        // pad bytes alternating 0xEC / 0x11
        const padBytes = [0xEC, 0x11];
        let pi = 0;
        while (bb.bytes.length < totalDataCW) bb.bytes.push(padBytes[pi++ & 1]);

        // Split into blocks, compute EC
        const ecLen = e[0];
        const blocks = [];
        const ecBlocks = [];
        let offset = 0;
        for (let g = 0; g < 2; g++) {
            const nBlocks = e[1 + g * 2];
            const nData = e[2 + g * 2];
            for (let b = 0; b < nBlocks; b++) {
                const blk = bb.bytes.slice(offset, offset + nData);
                blocks.push(blk);
                ecBlocks.push(rsEncode(blk, ecLen));
                offset += nData;
            }
        }

        // Interleave data codewords
        const out = [];
        const maxData = Math.max(...blocks.map(b => b.length));
        for (let i = 0; i < maxData; i++) {
            for (const b of blocks) if (i < b.length) out.push(b[i]);
        }
        // Interleave EC codewords
        for (let i = 0; i < ecLen; i++) {
            for (const b of ecBlocks) out.push(b[i]);
        }
        return out;
    }

    // ---- Matrix construction ----
    function newMatrix(size) {
        const m = new Array(size);
        const reserved = new Array(size);
        for (let i = 0; i < size; i++) { m[i] = new Uint8Array(size); reserved[i] = new Uint8Array(size); }
        return { m, reserved, size };
    }

    function setModule(mat, r, c, dark, reserve) {
        mat.m[r][c] = dark ? 1 : 0;
        if (reserve) mat.reserved[r][c] = 1;
    }

    function placeFinder(mat, r, c) {
        for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= mat.size || cc >= mat.size) continue;
            const inRing = (dr === 0 || dr === 6 || dc === 0 || dc === 6) && dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
            const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
            const inPattern = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
            const dark = inPattern && (inRing || inCenter);
            setModule(mat, rr, cc, dark, true);
        }
    }

    function placeAlignment(mat, version) {
        const centers = ALIGN[version - 1];
        for (const r of centers) for (const c of centers) {
            // skip those overlapping finders
            if ((r === 6 && c === 6) || (r === 6 && c === mat.size - 7) || (r === mat.size - 7 && c === 6)) continue;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                const ring = Math.max(Math.abs(dr), Math.abs(dc));
                const dark = ring !== 1;
                setModule(mat, r + dr, c + dc, dark, true);
            }
        }
    }

    function placeTiming(mat) {
        for (let i = 8; i < mat.size - 8; i++) {
            const dark = (i & 1) === 0;
            setModule(mat, 6, i, dark, true);
            setModule(mat, i, 6, dark, true);
        }
    }

    function reserveFormat(mat) {
        const n = mat.size;
        for (let i = 0; i < 9; i++) {
            if (i !== 6) { mat.reserved[8][i] = 1; mat.reserved[i][8] = 1; }
        }
        for (let i = 0; i < 8; i++) {
            mat.reserved[8][n - 1 - i] = 1;
            mat.reserved[n - 1 - i][8] = 1;
        }
        setModule(mat, n - 8, 8, true, true); // dark module
    }

    function reserveVersion(mat, version) {
        if (version < 7) return;
        const n = mat.size;
        for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
            mat.reserved[i][n - 11 + j] = 1;
            mat.reserved[n - 11 + j][i] = 1;
        }
    }

    function placeData(mat, codewords) {
        const n = mat.size;
        let bitIdx = 0;
        const totalBits = codewords.length * 8;
        let up = true;
        for (let rightCol = n - 1; rightCol > 0; rightCol -= 2) {
            if (rightCol === 6) rightCol--; // skip timing column
            for (let vert = 0; vert < n; vert++) {
                for (let j = 0; j < 2; j++) {
                    const c = rightCol - j;
                    const r = up ? n - 1 - vert : vert;
                    if (mat.reserved[r][c]) continue;
                    let dark = false;
                    if (bitIdx < totalBits) {
                        const byte = codewords[bitIdx >>> 3];
                        dark = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
                    }
                    mat.m[r][c] = dark ? 1 : 0;
                    bitIdx++;
                }
            }
            up = !up;
        }
    }

    const MASKS = [
        (r, c) => (r + c) % 2 === 0,
        (r) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
        (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
        (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ];

    function applyMask(mat, maskId) {
        const fn = MASKS[maskId];
        const n = mat.size;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (mat.reserved[r][c]) continue;
            if (fn(r, c)) mat.m[r][c] ^= 1;
        }
    }

    // Format info: 5 bits (EC level + mask), BCH(15,5), XOR 0x5412
    // EC level L = 01
    function formatInfoBits(maskId) {
        const data = (0b01 << 3) | maskId;
        let rem = data;
        for (let i = 0; i < 10; i++) {
            rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0b10100110111 : 0);
        }
        const bits = ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
        return bits;
    }

    function placeFormat(mat, maskId) {
        const bits = formatInfoBits(maskId);
        const n = mat.size;
        const get = (i) => (bits >> i) & 1;
        // Copy A — around top-left finder:
        // bits 0-5 down column 8 (rows 0-5), bit 6 at (7,8) skipping timing,
        // bit 7 at (8,8), bit 8 at (8,7) skipping timing, bits 9-14 along row 8 (cols 5..0)
        for (let i = 0; i <= 5; i++) setModule(mat, i, 8, get(i), true);
        setModule(mat, 7, 8, get(6), true);
        setModule(mat, 8, 8, get(7), true);
        setModule(mat, 8, 7, get(8), true);
        for (let i = 9; i < 15; i++) setModule(mat, 8, 14 - i, get(i), true);
        // Copy B (split):
        // bits 0-7 along row 8 from right (col n-1) to col n-8
        for (let i = 0; i < 8; i++) setModule(mat, 8, n - 1 - i, get(i), true);
        // bits 8-14 down column 8 from row n-7 to row n-1
        for (let i = 8; i < 15; i++) setModule(mat, n - 15 + i, 8, get(i), true);
        // dark module (always, overrides anything above)
        setModule(mat, n - 8, 8, true, true);
    }

    // Version info (v7+): 6 bits + 12-bit BCH remainder, Golay(18,6), poly 0b1111100100101
    function versionInfoBits(version) {
        let rem = version;
        for (let i = 0; i < 12; i++) {
            rem = (rem << 1) ^ (((rem >> 11) & 1) ? 0b1111100100101 : 0);
        }
        return (version << 12) | (rem & 0xFFF);
    }

    function placeVersion(mat, version) {
        if (version < 7) return;
        const bits = versionInfoBits(version);
        const n = mat.size;
        for (let i = 0; i < 18; i++) {
            const bit = (bits >> i) & 1;
            const a = Math.floor(i / 3), b = (i % 3) + n - 11;
            setModule(mat, a, b, bit, true);
            setModule(mat, b, a, bit, true);
        }
    }

    // Mask penalty scoring (ISO 18004 §7.8.3)
    function penalty(mat) {
        const n = mat.size;
        let score = 0;
        // Rule 1: runs of 5+ same color in rows/cols
        for (let r = 0; r < n; r++) {
            let run = 1;
            for (let c = 1; c < n; c++) {
                if (mat.m[r][c] === mat.m[r][c - 1]) { run++; } else { if (run >= 5) score += 3 + (run - 5); run = 1; }
            }
            if (run >= 5) score += 3 + (run - 5);
        }
        for (let c = 0; c < n; c++) {
            let run = 1;
            for (let r = 1; r < n; r++) {
                if (mat.m[r][c] === mat.m[r - 1][c]) { run++; } else { if (run >= 5) score += 3 + (run - 5); run = 1; }
            }
            if (run >= 5) score += 3 + (run - 5);
        }
        // Rule 2: 2x2 blocks
        for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
            const v = mat.m[r][c];
            if (v === mat.m[r][c + 1] && v === mat.m[r + 1][c] && v === mat.m[r + 1][c + 1]) score += 3;
        }
        // Rule 3: finder-like pattern 1:1:3:1:1 with 4 light on either side
        const pat = [1,0,1,1,1,0,1];
        const quiet = [0,0,0,0];
        for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) {
            let match1 = true, match2 = true;
            for (let k = 0; k < 7; k++) if (mat.m[r][c + k] !== pat[k]) { match1 = false; break; }
            if (match1) {
                // check 4 light modules on the right (or left)
                let ok = true;
                for (let k = 0; k < 4; k++) if (c + 7 + k >= n || mat.m[r][c + 7 + k] !== 0) { ok = false; break; }
                if (ok) score += 40;
                ok = true;
                for (let k = 0; k < 4; k++) if (c - 1 - k < 0 || mat.m[r][c - 1 - k] !== 0) { ok = false; break; }
                if (ok) score += 40;
            }
        }
        for (let c = 0; c < n; c++) for (let r = 0; r <= n - 11; r++) {
            let match = true;
            for (let k = 0; k < 7; k++) if (mat.m[r + k][c] !== pat[k]) { match = false; break; }
            if (match) {
                let ok = true;
                for (let k = 0; k < 4; k++) if (r + 7 + k >= n || mat.m[r + 7 + k][c] !== 0) { ok = false; break; }
                if (ok) score += 40;
                ok = true;
                for (let k = 0; k < 4; k++) if (r - 1 - k < 0 || mat.m[r - 1 - k][c] !== 0) { ok = false; break; }
                if (ok) score += 40;
            }
        }
        // Rule 4: proportion of dark modules
        let dark = 0;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mat.m[r][c]) dark++;
        const pct = (dark * 100) / (n * n);
        const dev = Math.floor(Math.abs(pct - 50) / 5);
        score += dev * 10;
        return score;
    }

    function cloneMatrix(mat) {
        const copy = newMatrix(mat.size);
        for (let r = 0; r < mat.size; r++) {
            copy.m[r].set(mat.m[r]);
            copy.reserved[r].set(mat.reserved[r]);
        }
        return copy;
    }

    function encode(text) {
        const bytes = utf8Bytes(text);
        const version = chooseVersion(bytes.length);
        if (version < 0) return null;
        const codewords = buildCodewords(bytes, version);
        const size = 17 + 4 * version;

        // build base matrix (without data / format / mask)
        const base = newMatrix(size);
        placeFinder(base, 0, 0);
        placeFinder(base, 0, size - 7);
        placeFinder(base, size - 7, 0);
        // separators already implicitly light; finder reserves 0..7 band
        placeAlignment(base, version);
        placeTiming(base);
        reserveFormat(base);
        reserveVersion(base, version);
        placeData(base, codewords);

        // Try each mask, pick lowest penalty
        let best = null, bestScore = Infinity;
        for (let m = 0; m < 8; m++) {
            const mat = cloneMatrix(base);
            applyMask(mat, m);
            placeFormat(mat, m);
            placeVersion(mat, version);
            const s = penalty(mat);
            if (s < bestScore) { bestScore = s; best = mat; }
        }
        // Convert to plain 2D boolean array
        const modules = [];
        for (let r = 0; r < size; r++) {
            const row = new Array(size);
            for (let c = 0; c < size; c++) row[c] = !!best.m[r][c];
            modules.push(row);
        }
        return { size, modules, version };
    }

    function renderSVG(modules, opts) {
        const scale = (opts && opts.scale) || 6;
        const margin = (opts && opts.margin != null) ? opts.margin : 4;
        const color = (opts && opts.color) || '#000';
        const bg = (opts && opts.bg) || '#fff';
        const n = modules.length;
        const size = (n + margin * 2) * scale;
        let path = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (modules[r][c]) {
                    const x = (c + margin) * scale;
                    const y = (r + margin) * scale;
                    path += 'M' + x + ',' + y + 'h' + scale + 'v' + scale + 'h-' + scale + 'z';
                }
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges">' +
            '<rect width="100%" height="100%" fill="' + bg + '"/>' +
            '<path d="' + path + '" fill="' + color + '"/></svg>';
    }

    global.KmQR = { encode, renderSVG, dataCapacityBytes };
})(window);
