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

export type TranscriptionModel = "gemini-3.7-flash" | "claude-sonnet-5";

export type TranscriptionResult = {
  id: string;
  transcription: string;
  confidence: number;
  isDiagram: boolean;
  model: TranscriptionModel;
};

export type TranscribeOptions = {
  /**
   * Google Generative AI API key, used to construct the primary Gemini model.
   * Required unless `model` is provided. Never read from process.env.
   */
  googleApiKey?: string;
  /**
   * Anthropic API key, used to construct the Claude Sonnet escalation model.
   * Required unless `model` is provided, and only if a note actually escalates.
   * Never read from process.env.
   */
  anthropicApiKey?: string;
  /**
   * A pre-constructed Vercel AI SDK language model, used in place of the real
   * Gemini/Sonnet models for both the primary and any escalation call — e.g. a
   * mock model from `ai/test` in tests. Required unless `googleApiKey` (and,
   * for escalation, `anthropicApiKey`) is provided.
   */
  model?: LanguageModel;
  /** Confidence below which a note is re-transcribed with the escalation model. */
  confidenceThreshold?: number;
};
