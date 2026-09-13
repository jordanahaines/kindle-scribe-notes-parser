import * as mupdf from "mupdf";
import { parseHeader } from "./parse-header.js";
import { parseEntries } from "./parse-entries.js";
import type { ParsedNotebook } from "./types.js";

export type {
  ParsedNotebook,
  HighlightRecord,
  NoteRecord,
  TypedNote,
  HandwrittenNote,
  BookMetadata,
} from "./types.js";

export function parseNotebook(pdfBytes: Uint8Array): ParsedNotebook {
  const document = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const book = parseHeader(document);
  const highlights = parseEntries(document);
  return { book, highlights };
}
