import type { LanguageModel } from "ai";

export type TypedNote = {
  type: "typed";
  text: string;
};

export type HandwrittenNote = {
  type: "handwritten";
  image: Uint8Array;
  width: number;
  height: number;
};

export type NoteRecord = TypedNote | HandwrittenNote;

export type HighlightRecord = {
  chapter: string | null;
  page: number;
  text: string;
  date: Date;
  note?: NoteRecord;
};

export type BookMetadata = {
  title: string;
  author: string;
  asin: string;
};

export type ParsedNotebook = {
  book: BookMetadata;
  highlights: HighlightRecord[];
};

export type NoteToTranscribe = {
  id: string;
  image: Uint8Array;
};

export type TranscriptionModel = "claude-haiku-4-5-20251001" | "claude-sonnet-5";

export type TranscriptionResult = {
  id: string;
  transcription: string;
  confidence: number;
  isDiagram: boolean;
  model: TranscriptionModel;
};

export type TranscribeOptions = {
  /** Anthropic API key. Required unless `model` is provided. Never read from process.env. */
  apiKey?: string;
  /**
   * A pre-constructed Vercel AI SDK language model, used in place of the real
   * Anthropic models for both the primary and any escalation call — e.g. a mock
   * model from `ai/test` in tests. Required unless `apiKey` is provided.
   */
  model?: LanguageModel;
  /** Confidence below which a note is re-transcribed with the escalation model. */
  confidenceThreshold?: number;
};
