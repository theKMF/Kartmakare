# Text-to-List parser — integration note

Drop this file into the target project (e.g. as `docs/text-to-list-parser.md` or appended to `CLAUDE.md`) so future sessions know where the parser lives and what its contract is.

## Source of truth

```
/Users/kristofferyifredriksson/Documents/My Homecooked Apps/Text to List/parser.js
```

Pure ESM, zero dependencies, no DOM access. Copy the file as-is into the target project — do not fork or rewrite without updating the source above.

## API

```js
import { parseTextToList } from './parser.js';

parseTextToList(text);                    // -> string[]
parseTextToList(text, { dedupe: true });  // case-insensitive dedupe
```

- Input: any string (bullets, comma-separated, line-separated, semicolons, tabs, or a single item).
- Output: trimmed, cleaned `string[]`. Empty input → `[]`.

## Delimiter precedence (intentional)

Newlines → `;` → tabs → `,` → inline bullets → single item.

Ambiguous inputs follow this order. Example: `"a, b\nc"` splits on the newline (→ `["a, b", "c"]`), not on the comma.

## Cleanup applied to each item

- Strips leading bullet/numbering: `-`, `–`, `—`, `•`, `●`, `○`, `◦`, `▪`, `▫`, `*`, `▶`, `►`, `→`, `»`, plus `1.` / `1)` / `1]` / `1:` and single-letter `a)` etc.
- Strips surrounding quotes (incl. smart quotes).
- Strips trailing `,` or `;`.
- Drops empty results.

## Don'ts

- Don't add a UMD/CommonJS wrapper — target is modern PWAs, ESM only.
- Don't fold UI/share-target logic in. The host app owns ingestion; the parser only sees a string.
- Don't reorder delimiter precedence without a deliberate reason — it changes behavior for ambiguous inputs.
