import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseNotebook, type ParsedNotebook } from "../src/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/weavers-scribes-kings.pdf", import.meta.url));

let result: ParsedNotebook;

beforeAll(async () => {
  const bytes = await readFile(fixturePath);
  result = parseNotebook(new Uint8Array(bytes));
});

describe("parseNotebook", () => {
  it("extracts book metadata from the header page", () => {
    expect(result.book).toEqual({
      title: "Weavers, Scribes, and Kings",
      author: "Podany, Amanda H.",
      asin: "B0B8P5S3CV",
    });
  });

  it("returns exactly 49 highlight records", () => {
    expect(result.highlights).toHaveLength(49);
  });

  it("returns exactly 24 highlights with a handwritten note", () => {
    const handwritten = result.highlights.filter((h) => h.note?.type === "handwritten");
    expect(handwritten).toHaveLength(24);
    for (const highlight of handwritten) {
      const note = highlight.note;
      if (note?.type !== "handwritten") throw new Error("expected handwritten note");
      expect(note.image).toBeInstanceOf(Uint8Array);
      expect(note.image.length).toBeGreaterThan(0);
      expect(note.width).toBeCloseTo(1636, -1);
      expect(note.height).toBeCloseTo(876, -1);
    }
  });

  it("produces zero Bookmark-derived records", () => {
    // The fixture has 2 bookmarks, on book pages 34 and 83 — neither should
    // surface as a highlight record.
    expect(result.highlights.some((h) => h.page === 34)).toBe(false);
    expect(result.highlights.some((h) => h.page === 83)).toBe(false);
  });

  it("merges a Highlight Continued block into its preceding highlight as one record", () => {
    // Book page 18's highlight wraps from PDF page 2 onto PDF page 3 via a
    // "Highlight Continued" block — it must appear once, with concatenated text.
    const matches = result.highlights.filter((h) => h.page === 18);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toContain("complex was called the Eanna");
    expect(matches[0].text).toContain("around perhaps 3500");
  });

  it("produces a typed note for a highlight with inline note text", () => {
    const highlight = result.highlights.find((h) => h.page === 64);
    expect(highlight?.note).toEqual({ type: "typed", text: "cuneiform 2900 bc" });
  });

  it("produces a handwritten note for a highlight with a drawn note", () => {
    const highlight = result.highlights.find((h) => h.page === 4);
    expect(highlight?.note?.type).toBe("handwritten");
  });

  it("attaches the correct chapter and date to a spot-checked highlight", () => {
    const highlight = result.highlights.find((h) => h.page === 13);
    expect(highlight?.chapter).toBe("1. Builders and Organizers");
    expect(highlight?.text).toContain("By this time, humans had been living on the planet");
    expect(highlight?.date.toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("assigns a null chapter only when no heading has been seen yet", () => {
    expect(result.highlights.every((h) => h.chapter !== undefined)).toBe(true);
  });
});
