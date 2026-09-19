# kindle-scribe-notes-parser

Parses a Kindle Scribe "notebook export" PDF (Share → email PDF from the device)
into structured book metadata and highlight/note records.

```ts
import { parseNotebook } from "kindle-scribe-notes-parser";
import { readFile } from "node:fs/promises";

const pdfBytes = await readFile("my-book-notebook.pdf");
const { book, highlights } = parseNotebook(pdfBytes);

book; // { title, author, asin }
highlights; // HighlightRecord[]
```

## CLI

Installing the package also gives you a `kindle-scribe-parse` command:

```bash
npx kindle-scribe-parse my-book-notebook.pdf
```

By default this prints a human-readable summary of the book and its highlights,
and writes any handwritten note images as PNGs to
`./kindle-scribe-parse/output/<pdf-name>/`, relative to your current directory.

```
Usage: kindle-scribe-parse <pdf-path> [options]

Options:
  -o, --out <dir>   Directory to write handwritten note images to
                     (default: "./kindle-scribe-parse/output/<pdf-name>")
  --json            Print the full parsed result as JSON to stdout. Handwritten
                     note images are still written to disk; the JSON references
                     their path rather than embedding raw image bytes.
  -h, --help        Show this help message
```

Examples:

```bash
# Write note images to a specific directory
npx kindle-scribe-parse my-book-notebook.pdf -o ./notes

# Get structured JSON (e.g. to pipe into another tool)
npx kindle-scribe-parse my-book-notebook.pdf --json > notebook.json
```

During local development (without building/installing first), run it via:

```bash
npm run cli -- my-book-notebook.pdf
```

## What it does

- Extracts book `title`, `author`, and `asin` from the notebook's header page.
- Returns each highlight as a `HighlightRecord`: `chapter` (nullable), `page`,
  `text`, `date`, and an optional `note`.
- A `note` is either `{ type: 'typed', text }` or
  `{ type: 'handwritten', image, width, height }` (the image is PNG bytes).
- Merges `Highlight Continued` blocks into the preceding highlight as one record.
- Recognizes and discards `Bookmark (Blue)` entries and standalone `Note` entries
  (annotations not attached to a highlight) — neither produces an output record.

## What it doesn't do

- No OCR or handwriting transcription — handwritten notes are returned as raw
  image bytes only.
- No deduplication against previously-parsed notebooks.
- No support for PDF exports other than the Kindle Scribe notebook format.

## License and the `mupdf` dependency

This package is published under **AGPL-3.0-only**, inherited from its PDF engine:
[`mupdf`](https://www.npmjs.com/package/mupdf) (Artifex Software's WASM build of
MuPDF), which is licensed under the GNU Affero General Public License v3.0.

**If you embed this package in your own product**, the AGPL's copyleft terms
apply to your product as a whole — most notably, the AGPL's network-use clause
extends the usual GPL copyleft to software made available over a network (e.g.
a hosted web app), not just distributed binaries. Read the
[AGPL-3.0 license text](https://www.gnu.org/licenses/agpl-3.0.html) and get your
own legal advice before shipping this in a closed-source or commercial product.
Artifex also offers commercial licenses for `mupdf` if AGPL terms don't work for
your use case.

Note that if this license agreement is not what you want, consider [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Apache-2.0).

## Development

```bash
npm install
npm run build
npm test
```

Requires no Python runtime or subprocess — pure JS/TS plus the `mupdf` WASM
dependency.

## Releasing

Publishing is manual — there's no CI-triggered publish step. From a clean,
up-to-date `main`:

```bash
npm version patch   # or minor / major — runs typecheck+test, bumps the
                     # version, commits, tags, and pushes both (preversion/
                     # postversion hooks in package.json)
npm publish          # builds dist/ via prepublishOnly, then publishes
```

`npm login` once beforehand if you haven't authenticated with npm on this
machine.
