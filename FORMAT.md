# Kartmakare Readable JSON — format specification

**Format version:** 1
**Status:** stable
**File extension:** `.json` (exported as `Kartmakare-readable.json`)

This document specifies the Readable JSON format used by
[Kartmakare](https://thekmf.github.io/Kartmakare/) to export and import Wardley
maps. It is the recommended interchange format for third-party tools: anything
that writes a file matching this spec can be dropped straight into Kartmakare,
and anything Kartmakare exports as "Readable JSON" follows it.

> Kartmakare also has a *Compact JSON* file format (a positional array, not
> covered here — for file interchange use Readable JSON) and a binary share-link
> format for QR codes, specified in section 7. If you want your tool to emit a
> link that opens directly in Kartmakare, implement section 7; otherwise emit a
> Readable JSON file.

---

## 1. Overview

A map file is a single JSON object:

```json
{
  "type": "kartmakare",
  "version": 1,
  "exported": "2026-07-07T12:00:00.000Z",
  "anchor": "Customer needs hot tea",
  "anchorLinks": ["id-kettle"],
  "items": [ ... ],
  "links": [ ... ],
  "areas": [ ... ],
  "labels": [ ... ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | **yes** | Must be exactly `"kartmakare"`. This is the file discriminator — without it the import is rejected. |
| `version` | number | recommended | Format version. Currently `1`. |
| `exported` | string | no | ISO 8601 timestamp. Informational only; ignored on import. |
| `anchor` | string | no | The user need at the top of the map. Empty string if unset. |
| `anchorLinks` | string[] | no | IDs of items linked directly to the anchor. |
| `items` | Item[] | **yes** | The map's components. May be empty. |
| `links` | Link[] | **yes** | Dependencies between components. May be empty. |
| `areas` | Area[] | **yes** | Freeform grouping blobs. May be empty. |
| `labels` | Label[] | no | Freestanding text labels. |

`items`, `links` and `areas` must be present (as arrays, even if empty) for the
file to be recognised as Kartmakare data.

---

## 2. Coordinate system

All positions are **fractions from 0 to 1** on both axes.

- **X axis — evolution.** `0` = far left (Genesis), `1` = far right (Commodity).
- **Y axis — visibility.** `1` = **top** of the map (visible, close to the
  user), `0` = **bottom** (invisible, deep infrastructure). Note that this is
  the *opposite* of screen coordinates; Kartmakare renders an item at CSS
  `top: (1 - posY) * 100%`.

### Evolution stages

The X axis is divided into four equal columns:

| Stage value | Column (posX range) | Column centre | UI label |
|---|---|---|---|
| `"genesis"` | 0.00 – 0.25 | 0.125 | Genesis |
| `"custom"` | 0.25 – 0.50 | 0.375 | Custom Built |
| `"product"` | 0.50 – 0.75 | 0.625 | Product |
| `"commodity"` | 0.75 – 1.00 | 0.875 | Commodity |
| `""` (empty) | — | — | unstaged |

`stage` and `posX` are stored independently, but Kartmakare keeps them
consistent whenever the user drags an item (stage is re-derived from the X
position). **Writers should do the same:** set `stage` to the column that
`posX` falls in, or place the item at the column centre for its stage. An
unstaged item (`stage: ""`) conventionally sits at `posX: 0, posY: 0` and shows
up in Kartmakare's list/staging flow rather than on the map.

---

## 3. Entities

### 3.1 Item (component)

```json
{
  "id": "3f2b8c4e-...",
  "text": "Kettle",
  "stage": "product",
  "posX": 0.625,
  "posY": 0.62,
  "evolvedFrom": "id-of-source-item"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | string | **yes** | Non-empty, unique within the file. Kartmakare uses UUIDs but any unique string works. |
| `text` | string | **yes** | Display name. Kartmakare's UI caps input at 200 chars. |
| `stage` | string | no | One of `""`, `"genesis"`, `"custom"`, `"product"`, `"commodity"`. `null`/missing is treated as `""`. Any other value drops the item. |
| `posX` | number | **yes** | Finite number, 0–1. |
| `posY` | number | **yes** | Finite number, 0–1. |
| `evolvedFrom` | string | no | ID of the item this one evolved out of. Renders the item with a dashed outline and implies an evolution relationship. Cleared on import if the referenced ID doesn't exist. |

### 3.2 Link (dependency)

```json
{
  "id": "a1b2c3-...",
  "fromId": "id-cup-of-tea",
  "toId": "id-kettle",
  "style": "solid"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | string | **yes** | Non-empty, unique. |
| `fromId` | string | **yes** | Must reference an existing item ID, otherwise the link is dropped. |
| `toId` | string | **yes** | Same. |
| `style` | string | **yes** | One of `"solid"`, `"dashed"`, `"evolution"`. Anything else drops the link. |

Semantics: a link means *`fromId` depends on `toId`*. `"solid"` is a normal
dependency, `"dashed"` a weak/inherited one, and `"evolution"` is the arrowed
link from an item to its evolved successor (pair it with the successor's
`evolvedFrom` field).

### 3.3 Area (grouping blob)

An area is a smooth Bezier blob drawn around a set of items.

```json
{
  "id": "e5f6a7-...",
  "itemIds": ["id-kettle", "id-water", "id-power"],
  "vertexAdjustments": [],
  "midpointOffsets": []
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | string | **yes** | Non-empty. |
| `itemIds` | string[] | **yes** | Items enclosed by the blob. Unknown IDs are filtered out; an area left with zero valid items is dropped. |
| `vertexAdjustments` | object[] | no | Manual shape fine-tuning (below). Safe to write as `[]`. |
| `midpointOffsets` | object[] | no | Manual edge fine-tuning (below). Safe to write as `[]`. |

The blob's shape is *derived* — convex hull of the member items plus padding —
so third-party writers only need `itemIds`. The two adjustment arrays exist so
hand-tuned shapes survive a round-trip; **preserve them if you read-modify-write
a file, emit `[]` if you generate maps from scratch.**

For completeness:

- `vertexAdjustments[]`: `{ "itemId": string, "radiusOffset": number,
  "handleLenA": number, "handleLenB": number, "handleAngleA": number,
  "handleAngleB": number }` — per-hull-vertex padding offset (map-canvas units,
  where the canvas is a 0–100 viewBox) and Bezier handle length/angle (radians)
  tweaks.
- `midpointOffsets[]`: `{ "fromId": string, "toId": string, "dx": number,
  "dy": number }` — displacement of the curve midpoint between two adjacent
  hull vertices, in the same canvas units.

### 3.4 Label (freestanding text)

```json
{
  "id": "b9c0d1-...",
  "text": "Team Platform owns this",
  "posX": 0.4,
  "posY": 0.15,
  "width": 160
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | string | **yes** | Non-empty. |
| `text` | string | **yes** | Label text. |
| `posX`, `posY` | number | **yes** | Finite, 0–1, same coordinate system as items. |
| `width` | number | no | Box width in pixels, 40–600. Defaults to 100. |

### 3.5 Anchor

The anchor is the user need that sits at the top of a Wardley map. It is a
plain string (`anchor`) plus a list of item IDs it connects to
(`anchorLinks`). Unknown IDs in `anchorLinks` are filtered out on import.

---

## 4. Import behaviour (what Kartmakare does with your file)

Understanding the importer helps you write robust files:

1. **Discrimination.** The JSON must parse, and must either be an object with
   `type: "kartmakare"` and array-valued `items`/`links`/`areas`, or a Compact
   JSON array. Otherwise the file is rejected outright.
2. **Field-level sanitising.** Each entry is validated against the rules in
   section 3. Malformed entries are *dropped, not repaired* (except: missing
   `stage` becomes `""`, dangling `evolvedFrom` is deleted, dangling
   `itemIds`/`anchorLinks` entries are filtered). The user is told how many
   entries were dropped.
3. **Cross-reference grounding.** Everything that points at an item ID is
   checked against the surviving items — links, areas, anchor links and
   `evolvedFrom` never dangle after import.
4. **Replacement, not merge.** A successful import *replaces* the whole map.
5. Unknown extra fields on entities are currently carried along untouched, but
   don't rely on that — treat the fields in this spec as the contract.

---

## 5. Minimal valid example

The smallest useful file another app can emit:

```json
{
  "type": "kartmakare",
  "version": 1,
  "anchor": "Customer needs hot tea",
  "anchorLinks": ["cup"],
  "items": [
    { "id": "cup",    "text": "Cup of tea", "stage": "custom",    "posX": 0.375, "posY": 0.85 },
    { "id": "kettle", "text": "Kettle",     "stage": "product",   "posX": 0.625, "posY": 0.55 },
    { "id": "power",  "text": "Power",      "stage": "commodity", "posX": 0.875, "posY": 0.20 }
  ],
  "links": [
    { "id": "l1", "fromId": "cup",    "toId": "kettle", "style": "solid" },
    { "id": "l2", "fromId": "kettle", "toId": "power",  "style": "solid" }
  ],
  "areas": [],
  "labels": []
}
```

Drop this onto Kartmakare's import view (or anywhere in the window) and it
renders as a three-component map with the anchor at the top.

## 6. Writer's checklist

- [ ] `type` is `"kartmakare"`, `version` is `1`
- [ ] `items`, `links`, `areas` present as arrays
- [ ] Every `id` is a non-empty, unique string
- [ ] All `posX`/`posY` are finite numbers in 0–1 (remember: `posY: 1` is the top)
- [ ] `stage` matches the column `posX` falls in
- [ ] `link.style` is `solid`, `dashed` or `evolution`
- [ ] Every `fromId`/`toId`/`itemIds`/`anchorLinks`/`evolvedFrom` references an existing item
- [ ] Adjustment arrays preserved on round-trip, `[]` when generating fresh

---

## 7. Share-link binary format (QR / `#k=` URLs)

Kartmakare share links carry the whole map in the URL fragment:

```
https://thekmf.github.io/Kartmakare/#k=<payload>
```

There is no server; the receiving page decodes the fragment locally. A tool
that implements this section can emit links (or QR codes of them) that open
directly in Kartmakare.

### 7.1 Pipeline

```
map state → KM3 binary (7.3) → raw DEFLATE → base64url → "#k=" + payload
```

- **Raw DEFLATE** (RFC 1951, *no* zlib/gzip wrapper). In a browser this is
  `CompressionStream('deflate-raw')`; in zlib it's `deflateRaw`.
- **base64url**: standard base64 with `+`→`-`, `/`→`_`, padding stripped.
  The payload must match `[A-Za-z0-9_-]+`.
- Decoding reverses the steps, then the result is validated with the same
  rules as a file import (section 4).

**Legacy links:** payloads whose decoded bytes start with the gzip magic
`1f 8b` are the older format (gzip-wrapped Compact JSON). A valid raw-DEFLATE
stream can never start with those bytes, so the two are unambiguous. New
writers should only emit the current format.

### 7.2 Primitives

All integers are **unsigned LEB128 varints**: 7 bits per byte, little-endian
groups, high bit = continuation. Signed values use **zigzag** coding first
(`n → n<0 ? -2n-1 : 2n`), then varint.

Strings are UTF-8. String *lists* are written as all lengths (varints) first,
then all UTF-8 bytes concatenated — lengths block, then text blob.

**Positions** (`posX`/`posY`, and label positions) are encoded from
`q = round(pos * 1000)` (clamped 0–1000):

- if `q` is a multiple of 25: varint of `(q/25) << 1 | 1`  (1 byte)
- otherwise: varint of `q << 1`

Decode: if bit 0 is set, `pos = ((v>>1) * 25) / 1000`, else `pos = (v>>1) / 1000`.

**Stage numbering** where used: `0` = unstaged, `1` = genesis, `2` = custom,
`3` = product, `4` = commodity.
**Link style numbering:** `0` = solid, `1` = dashed, `2` = evolution.

### 7.3 Layout

In order, with `n` = item count:

| # | Field | Encoding |
|---|---|---|
| 1 | format version | 1 byte, must be `3` |
| 2 | item count `n` | varint |
| 3 | item texts | string list (7.2) |
| 4 | item `posX` × n | position encoding |
| 5 | item `posY` × n | position encoding |
| 6 | stage exceptions | varint count, then per entry: varint item index + 1 byte stage (0–4) |
| 7 | evolvedFrom pairs | varint count, then per entry: varint item index + varint source item index |
| 8 | link count `m` | varint |
| 9 | link endpoints | per link: varint from-index + varint to-index |
| 10 | link styles | `ceil(m/4)` bytes, 2 bits per link, LSB-first within each byte |
| 11 | area count | varint |
| 12 | areas | per area, see below |
| 13 | label count | varint |
| 14 | label texts | string list |
| 15 | label geometry | per label: posX + posY (position encoding) + varint width (`0` means default 100) |
| 16 | anchor | varint byte-length + UTF-8 |
| 17 | anchor links | varint count + varint item indices |

**Stage exceptions (6):** an item's stage defaults to the column derived from
its position: `floor(round(posX*1000) / 250)`, clamped to 3 (giving
genesis/custom/product/commodity). Only items whose actual stage differs —
chiefly unstaged items — get an exception entry.

**Per area (12):**

| Field | Encoding |
|---|---|
| member items | varint count + varint item indices |
| vertex adjustments | varint count, then per entry: varint item index + 5 zigzag varints: `radiusOffset*100`, `handleLenA*100`, `handleLenB*100`, `handleAngleA*1000`, `handleAngleB*1000` |
| midpoint offsets | varint count, then per entry: varint from-index + varint to-index + 2 zigzag varints: `dx*10`, `dy*10` |

A generator can write `0` for both adjustment counts (shapes are derived from
the member items).

### 7.4 Writer's notes

- Item order is preserved and is what all indices refer to.
- `evolvedFrom` survives share links (it does *not* survive Compact JSON files).
- Round all scaled values before varint/zigzag encoding.
- Keep the final URL modest: QR version 40 at ECC L caps the whole URL at
  2953 bytes, and phone cameras prefer far smaller codes. As a rule of thumb,
  maps up to ~180 components fit; beyond that emit a Readable JSON file
  instead.
- The decoder validates everything (unknown indices are dropped, counts are
  bounded by payload size), but emit clean data — the sanitiser repairs by
  *dropping*, not fixing.
