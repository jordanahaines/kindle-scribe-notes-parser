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
  NoteToTranscribe,
  TranscriptionResult,
  TranscriptionModel,
  TranscribeOptions,
} from "./types.js";

export { transcribeNotes, TranscriptionValidationError } from "./transcribe.js";

export function parseNotebook(pdfBytes: Uint8Array): ParsedNotebook {
  const document = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const book = parseHeader(document);
  const highlights = parseEntries(document);
  return { book, highlights };
}
