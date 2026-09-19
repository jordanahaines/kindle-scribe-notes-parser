import { generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { NoteToTranscribe, TranscribeOptions, TranscriptionModel, TranscriptionResult } from "./types.js";

const HAIKU_MODEL_ID: TranscriptionModel = "claude-haiku-4-5-20251001";
const SONNET_MODEL_ID: TranscriptionModel = "claude-sonnet-5";
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

const SYSTEM_PROMPT = `You transcribe handwritten notes from a Kindle Scribe e-reader. Each image is a
single handwritten note. For every image, in order, produce one result carrying the exact "id" given
for it. Transcribe the handwriting as accurately as possible. If the note is a drawing or diagram
rather than legible text, set isDiagram to true and put a short description in transcription. Set
confidence to your honest estimate (0 to 1) of how accurate the transcription is.`;

const batchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      transcription: z.string(),
      confidence: z.number().min(0).max(1),
      isDiagram: z.boolean(),
    }),
  ),
});

export class TranscriptionValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TranscriptionValidationError";
  }
}

function resolveModel(options: TranscribeOptions, modelId: TranscriptionModel): LanguageModel {
  if (options.model) return options.model;
  if (options.apiKey) return createAnthropic({ apiKey: options.apiKey })(modelId);
  throw new TranscriptionValidationError(
    "transcribeNotes requires either options.apiKey or options.model to be set",
  );
}

function buildMessageContent(notes: NoteToTranscribe[]) {
  return notes.flatMap((note) => [
    { type: "text" as const, text: `Note id: ${note.id}` },
    { type: "file" as const, mediaType: "image/png", data: note.image },
  ]);
}

async function runBatch(
  notes: NoteToTranscribe[],
  model: LanguageModel,
  modelLabel: TranscriptionModel,
): Promise<Map<string, TranscriptionResult>> {
  let object: z.infer<typeof batchResultSchema>;
  try {
    ({ object } = await generateObject({
      model,
      schema: batchResultSchema,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildMessageContent(notes) }],
    }));
  } catch (err) {
    throw new TranscriptionValidationError(
      `Model response for ${modelLabel} did not match the expected transcription shape`,
      { cause: err },
    );
  }

  const requestedIds = new Set(notes.map((note) => note.id));
  const results = new Map<string, TranscriptionResult>();
  for (const result of object.results) {
    if (!requestedIds.has(result.id)) continue;
    results.set(result.id, { ...result, model: modelLabel });
  }

  const missingIds = notes.filter((note) => !results.has(note.id)).map((note) => note.id);
  if (missingIds.length > 0) {
    throw new TranscriptionValidationError(
      `Model response for ${modelLabel} is missing results for ids: ${missingIds.join(", ")}`,
    );
  }

  return results;
}

export async function transcribeNotes(
  notes: NoteToTranscribe[],
  alreadyTranscribedIds: ReadonlySet<string> | readonly string[],
  options: TranscribeOptions,
): Promise<TranscriptionResult[]> {
  const skipIds = alreadyTranscribedIds instanceof Set ? alreadyTranscribedIds : new Set(alreadyTranscribedIds);
  const pending = notes.filter((note) => !skipIds.has(note.id));
  if (pending.length === 0) return [];

  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const haikuModel = resolveModel(options, HAIKU_MODEL_ID);
  const haikuResults = await runBatch(pending, haikuModel, HAIKU_MODEL_ID);

  const escalationNotes = pending.filter((note) => (haikuResults.get(note.id)?.confidence ?? 1) < threshold);

  let finalResults = haikuResults;
  if (escalationNotes.length > 0) {
    const sonnetModel = resolveModel(options, SONNET_MODEL_ID);
    const sonnetResults = await runBatch(escalationNotes, sonnetModel, SONNET_MODEL_ID);
    finalResults = new Map(haikuResults);
    for (const [id, result] of sonnetResults) finalResults.set(id, result);
  }

  return pending.map((note) => {
    const result = finalResults.get(note.id);
    if (!result) throw new TranscriptionValidationError(`Missing transcription result for id: ${note.id}`);
    return result;
  });
}
