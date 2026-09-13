import * as mupdf from "mupdf";
import type { HighlightRecord } from "./types.js";

const ENTRY_HEADER_PATTERN =
  /^Page (\d+) \| (Highlight \(Yellow\)|Highlight Continued|Bookmark \(Blue\)|Note)$/;
const NOTE_LABEL_PATTERN = /^Note:\s*(.*)$/;
const DATE_PATTERN = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

const CHAPTER_X = 50;
const ENTRY_X = 66;
const BODY_X = 82;
const HEADER_SIZE = 18;
const DATE_SIZE = 14;
const X_TOLERANCE = 3;

function nearX(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= X_TOLERANCE;
}

type LineToken = {
  kind: "line";
  x: number;
  size: number;
  bold: boolean;
  text: string;
};
type ImageToken = { kind: "image"; image: mupdf.Image };
type Token = LineToken | ImageToken;

type StructuredLine = {
  font: { weight: string; size: number };
  x: number;
  text: string;
};
type StructuredBlock =
  | { type: "text"; lines: StructuredLine[] }
  | { type: "image" };

/**
 * Combines the JSON structured-text walk (for line text/font/position) with
 * a parallel onImageBlock walk (for the actual embedded image data) — the
 * JSON serialization omits image bytes, but both walks visit blocks in the
 * same reading order, so images can be dequeued as their placeholder blocks
 * are encountered.
 */
function tokenizePage(page: mupdf.Page): Token[] {
  const structuredText = page.toStructuredText("preserve-images");
  const { blocks } = JSON.parse(structuredText.asJSON()) as { blocks: StructuredBlock[] };

  const images: mupdf.Image[] = [];
  structuredText.walk({
    onImageBlock(_bbox, _transform, image) {
      images.push(image);
    },
  });

  const tokens: Token[] = [];
  let imageIndex = 0;
  for (const block of blocks) {
    if (block.type === "image") {
      const image = images[imageIndex];
      imageIndex += 1;
      if (image) tokens.push({ kind: "image", image });
      continue;
    }
    for (const line of block.lines) {
      // Preserve original spacing (including a body line's trailing space,
      // which is the only word-boundary separator when it wraps mid-word
      // onto the next line or page) — trim only for emptiness checks and
      // pattern matching elsewhere.
      if (line.text.trim().length === 0) continue;
      tokens.push({
        kind: "line",
        x: line.x,
        size: line.font.size,
        bold: line.font.weight === "bold",
        text: line.text,
      });
    }
  }
  return tokens;
}

function imageToNote(image: mupdf.Image): { image: Uint8Array; width: number; height: number } {
  return {
    image: image.toPixmap().asPNG(),
    width: image.getWidth(),
    height: image.getHeight(),
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseEntries(document: mupdf.Document): HighlightRecord[] {
  const highlights: HighlightRecord[] = [];

  let currentChapter: string | null = null;
  let pending: { record: HighlightRecord; textParts: string[] } | null = null;
  let mode: "body" | "post-date" | "awaiting-note-image" | "idle" = "idle";

  const finalizePending = () => {
    if (!pending) return;
    pending.record.text = normalizeWhitespace(pending.textParts.join(""));
    highlights.push(pending.record);
    pending = null;
    mode = "idle";
  };

  const pageCount = document.countPages();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = document.loadPage(pageIndex);
    const tokens = tokenizePage(page);

    for (const token of tokens) {
      if (token.kind === "image") {
        if (mode === "awaiting-note-image" && pending) {
          pending.record.note = { type: "handwritten", ...imageToNote(token.image) };
          mode = "post-date";
        }
        continue;
      }

      const { x, size, bold, text } = token;
      const trimmed = text.trim();

      if (bold && size === HEADER_SIZE && nearX(x, CHAPTER_X)) {
        currentChapter = trimmed;
        continue;
      }

      const headerMatch = bold && size === HEADER_SIZE && nearX(x, ENTRY_X) ? ENTRY_HEADER_PATTERN.exec(trimmed) : null;
      if (headerMatch) {
        const [, pageNumber, kind] = headerMatch;
        if (kind === "Highlight Continued") {
          mode = "body";
          continue;
        }
        finalizePending();
        if (kind === "Highlight (Yellow)") {
          pending = {
            record: { chapter: currentChapter, page: Number(pageNumber), text: "", date: new Date(NaN) },
            textParts: [],
          };
          mode = "body";
        }
        // Bookmark and standalone Note headers produce no record — pending stays null.
        continue;
      }

      if (bold && size === HEADER_SIZE && nearX(x, ENTRY_X)) {
        const noteMatch = NOTE_LABEL_PATTERN.exec(trimmed);
        if (noteMatch && pending) {
          const noteText = noteMatch[1].trim();
          if (noteText.length > 0) {
            pending.record.note = { type: "typed", text: noteText };
            mode = "post-date";
          } else {
            mode = "awaiting-note-image";
          }
          continue;
        }
      }

      if (!bold && size === DATE_SIZE && nearX(x, ENTRY_X) && DATE_PATTERN.test(trimmed)) {
        if (mode === "body" && pending) {
          pending.record.date = new Date(trimmed);
          mode = "post-date";
        }
        continue;
      }

      if (!bold && size === HEADER_SIZE && nearX(x, BODY_X) && mode === "body" && pending) {
        pending.textParts.push(text);
        continue;
      }
    }
  }

  finalizePending();
  return highlights;
}
