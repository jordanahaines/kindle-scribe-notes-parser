import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { transcribeNotes, TranscriptionValidationError } from "../src/transcribe.js";
import type { NoteToTranscribe } from "../src/types.js";

function image(): Uint8Array {
  return new Uint8Array([1, 2, 3]);
}

function notes(ids: string[]): NoteToTranscribe[] {
  return ids.map((id) => ({ id, image: image() }));
}

type MockNote = { id: string; transcription: string; confidence: number; isDiagram: boolean };

function mockResult(results: MockNote[]): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ results }) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    },
    warnings: [],
  };
}

function malformedResult(): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text: "not json at all" }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    },
    warnings: [],
  };
}

function fileIdsInCall(call: LanguageModelV3CallOptions): string[] {
  const userMessages = call.prompt.filter((m) => m.role === "user");
  const ids: string[] = [];
  for (const message of userMessages) {
    for (const part of message.content) {
      if (part.type === "text" && part.text.startsWith("Note id: ")) {
        ids.push(part.text.replace("Note id: ", ""));
      }
    }
  }
  return ids;
}

describe("transcribeNotes", () => {
  it("sends exactly one Gemini call carrying all images when nothing is already transcribed", async () => {
    const input = notes(["a", "b", "c"]);
    const model = new MockLanguageModelV3({
      doGenerate: mockResult(
        input.map((n) => ({ id: n.id, transcription: `text-${n.id}`, confidence: 0.95, isDiagram: false })),
      ),
    });

    const results = await transcribeNotes(input, [], { model });

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(fileIdsInCall(model.doGenerateCalls[0])).toEqual(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.model).toBe("gemini-3.7-flash");
    }
  });

  it("excludes already-transcribed ids from both the request and the output", async () => {
    const input = notes(["a", "b", "c"]);
    const model = new MockLanguageModelV3({
      doGenerate: mockResult([
        { id: "b", transcription: "text-b", confidence: 0.95, isDiagram: false },
        { id: "c", transcription: "text-c", confidence: 0.95, isDiagram: false },
      ]),
    });

    const results = await transcribeNotes(input, new Set(["a"]), { model });

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(fileIdsInCall(model.doGenerateCalls[0])).toEqual(["b", "c"]);
    expect(results.map((r) => r.id).sort()).toEqual(["b", "c"]);
  });

  it("escalates only low-confidence notes to Sonnet in a single follow-up call", async () => {
    const input = notes(["a", "b", "c"]);
    const model = new MockLanguageModelV3({
      doGenerate: [
        mockResult([
          { id: "a", transcription: "gemini-a", confidence: 0.95, isDiagram: false },
          { id: "b", transcription: "gemini-b", confidence: 0.4, isDiagram: false },
          { id: "c", transcription: "gemini-c", confidence: 0.5, isDiagram: false },
        ]),
        mockResult([
          { id: "b", transcription: "sonnet-b", confidence: 0.9, isDiagram: false },
          { id: "c", transcription: "sonnet-c", confidence: 0.85, isDiagram: false },
        ]),
      ],
    });

    const results = await transcribeNotes(input, [], { model });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(fileIdsInCall(model.doGenerateCalls[1])).toEqual(["b", "c"]);

    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("a")).toMatchObject({ transcription: "gemini-a", model: "gemini-3.7-flash" });
    expect(byId.get("b")).toMatchObject({ transcription: "sonnet-b", model: "claude-sonnet-5" });
    expect(byId.get("c")).toMatchObject({ transcription: "sonnet-c", model: "claude-sonnet-5" });
  });

  it("throws a typed error on a malformed model response", async () => {
    const input = notes(["a"]);
    const model = new MockLanguageModelV3({ doGenerate: malformedResult() });

    await expect(transcribeNotes(input, [], { model })).rejects.toThrow(TranscriptionValidationError);
  });

  it("returns [] and makes zero calls for an empty input", async () => {
    const model = new MockLanguageModelV3({ doGenerate: mockResult([]) });
    const results = await transcribeNotes([], [], { model });

    expect(results).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns [] and makes zero calls when every id is already transcribed", async () => {
    const input = notes(["a", "b"]);
    const model = new MockLanguageModelV3({ doGenerate: mockResult([]) });

    const results = await transcribeNotes(input, ["a", "b"], { model });

    expect(results).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("requires either googleApiKey or model to be provided", async () => {
    const input = notes(["a"]);
    await expect(transcribeNotes(input, [], {})).rejects.toThrow(TranscriptionValidationError);
  });
});
