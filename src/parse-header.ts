import type * as mupdf from "mupdf";
import type { BookMetadata } from "./types.js";

type StructuredLine = {
  font: { weight: string; size: number };
  x: number;
  text: string;
};

type StructuredBlock =
  | { type: "text"; lines: StructuredLine[] }
  | { type: "image" };

const ASIN_PATTERN = /asin=([A-Za-z0-9]{10})/;

/**
 * The Kindle Scribe notebook header page renders the title as the only
 * bold, size-16 line and the author as the "by <author>" line directly
 * below it — the ASIN is embedded in the Kindle preview-share URL.
 */
export function parseHeader(document: mupdf.Document): BookMetadata {
  const page = document.loadPage(0);
  const structuredText = page.toStructuredText("preserve-images");
  const { blocks } = JSON.parse(structuredText.asJSON()) as { blocks: StructuredBlock[] };

  let title: string | null = null;
  let author: string | null = null;
  let asin: string | null = null;

  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const line of block.lines) {
      const text = line.text.trim();
      if (title === null && line.font.weight === "bold" && line.font.size === 16) {
        title = text;
        continue;
      }
      if (author === null && line.font.size === 16 && text.startsWith("by ")) {
        author = text.slice("by ".length).trim();
        continue;
      }
      if (asin === null) {
        const match = ASIN_PATTERN.exec(text);
        if (match) asin = match[1];
      }
    }
  }

  if (title === null || author === null || asin === null) {
    throw new Error(
      "Could not parse book metadata from notebook header page — expected a title, author, and ASIN.",
    );
  }

  return { title, author, asin };
}
