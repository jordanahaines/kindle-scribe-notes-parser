#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseNotebook, transcribeNotes } from "./index.js";
import type { HighlightRecord, NoteToTranscribe, TranscriptionResult } from "./types.js";

// Loads a .env file from the current directory, if present, so AI_GATEWAY_API_KEY
// (etc.) can be set there instead of exported in the shell. Silently a no-op when
// no .env file exists; existing environment variables always take precedence.
loadDotenv({ quiet: true });

function printUsage(): void {
  console.log(`Usage: kindle-scribe-parse <pdf-path> [options]

Parses a Kindle Scribe notebook export PDF into structured highlight and note records.

Options:
  -o, --out <dir>     Directory to write handwritten note images to
                       (default: "./kindle-scribe-parse/output/<pdf-name>")
  --json              Print the full parsed result as JSON to stdout. Handwritten
                       note images are still written to disk (unless deleted, see
                       --ocr); the JSON references their path rather than embedding
                       raw image bytes.
  --ocr               Transcribe handwritten notes into text via vision models,
                       routed through Vercel AI Gateway (Gemini 3.7 Flash,
                       escalating low-confidence results to Claude Sonnet).
                       Requires the AI_GATEWAY_API_KEY environment variable.
                       Handwritten note images are NOT written to disk unless
                       --keep-images is also given.
  --keep-images       Write handwritten note images to disk even when --ocr is
                       used. Images are always written when --ocr is not given,
                       so this flag has no effect in that case.
  -h, --help          Show this help message
`);
}

type CliArgs = {
  pdfPath: string;
  outDir?: string;
  json: boolean;
  ocr: boolean;
  keepImages: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let pdfPath: string | undefined;
  let outDir: string | undefined;
  let json = false;
  let ocr = false;
  let keepImages = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--ocr") {
      ocr = true;
    } else if (arg === "--keep-images") {
      keepImages = true;
    } else if (arg === "-o" || arg === "--out") {
      outDir = argv[++i];
      if (!outDir) {
        throw new Error(`Missing value for ${arg}`);
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!pdfPath) {
      pdfPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!pdfPath) {
    throw new Error("Missing required <pdf-path> argument");
  }

  return { pdfPath, outDir, json, ocr, keepImages };
}

type IdentifiedNote = {
  highlight: HighlightRecord;
  id: string;
  filename: string;
};

/**
 * Walks the highlights once, assigning each handwritten note the same
 * `page-<page>-<occurrence>` id/filename the CLI has always used, so file
 * names stay stable whether or not --ocr is involved.
 */
function identifyHandwrittenNotes(highlights: HighlightRecord[]): IdentifiedNote[] {
  const pageOccurrences = new Map<number, number>();
  const identified: IdentifiedNote[] = [];

  for (const highlight of highlights) {
    const occurrence = (pageOccurrences.get(highlight.page) ?? 0) + 1;
    pageOccurrences.set(highlight.page, occurrence);

    if (highlight.note?.type === "handwritten") {
      const id = `page-${String(highlight.page).padStart(4, "0")}-${occurrence}`;
      identified.push({ highlight, id, filename: `${id}.png` });
    }
  }

  return identified;
}

async function transcribeHandwrittenNotes(identified: IdentifiedNote[]): Promise<Map<string, TranscriptionResult>> {
  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  if (!gatewayApiKey) {
    throw new Error("--ocr requires the AI_GATEWAY_API_KEY environment variable to be set");
  }

  const notes: NoteToTranscribe[] = identified.map(({ highlight, id }) => {
    if (highlight.note?.type !== "handwritten") throw new Error("expected handwritten note");
    return { id, image: highlight.note.image };
  });

  const results = await transcribeNotes(notes, [], { gatewayApiKey });

  return new Map(results.map((result) => [result.id, result]));
}

async function run(args: CliArgs): Promise<void> {
  const pdfPath = resolve(args.pdfPath);
  const pdfName = basename(pdfPath, extname(pdfPath));
  const outDir = resolve(args.outDir ?? join("kindle-scribe-parse", "output", pdfName));

  const bytes = await readFile(pdfPath);
  const result = parseNotebook(new Uint8Array(bytes));

  const identified = identifyHandwrittenNotes(result.highlights);
  const idByHighlight = new Map(identified.map((entry) => [entry.highlight, entry]));
  const writeImages = !args.ocr || args.keepImages;

  if (!args.json) {
    console.log(`Book: ${result.book.title} — ${result.book.author} (${result.book.asin})`);
    console.log(`Highlights: ${result.highlights.length}\n`);
  }

  let transcriptions = new Map<string, TranscriptionResult>();
  if (args.ocr && identified.length > 0) {
    if (!args.json) {
      console.log(`Transcribing ${identified.length} handwritten note(s)...\n`);
    }
    transcriptions = await transcribeHandwrittenNotes(identified);
  }

  if (writeImages && identified.length > 0) {
    await mkdir(outDir, { recursive: true });
  }

  const jsonHighlights: unknown[] = [];

  for (const highlight of result.highlights) {
    let jsonNote: unknown = highlight.note;
    let imagePath: string | undefined;
    let transcription: TranscriptionResult | undefined;

    if (highlight.note?.type === "handwritten") {
      const entry = idByHighlight.get(highlight);
      if (!entry) throw new Error("internal error: handwritten note missing an assigned id");
      transcription = transcriptions.get(entry.id);

      if (writeImages) {
        imagePath = join(outDir, entry.filename);
        await writeFile(imagePath, highlight.note.image);
      }

      jsonNote = {
        type: "handwritten",
        width: highlight.note.width,
        height: highlight.note.height,
        ...(transcription
          ? {
              transcription: transcription.transcription,
              confidence: transcription.confidence,
              isDiagram: transcription.isDiagram,
              model: transcription.model,
            }
          : {}),
        ...(imagePath ? { imagePath } : {}),
      };
    }

    if (args.json) {
      jsonHighlights.push({ ...highlight, note: jsonNote });
    } else {
      console.log(`--- page ${highlight.page} (${highlight.chapter ?? "—"}) ---`);
      console.log(`date: ${highlight.date.toISOString()}`);
      console.log(`text: ${highlight.text}`);
      if (highlight.note?.type === "typed") {
        console.log(`note (typed): ${highlight.note.text}`);
      } else if (highlight.note?.type === "handwritten") {
        if (transcription) {
          const diagramFlag = transcription.isDiagram ? " [diagram]" : "";
          console.log(
            `note (handwritten, OCR${diagramFlag}, confidence ${transcription.confidence.toFixed(2)}, ${transcription.model}): ${transcription.transcription}`,
          );
        } else {
          console.log(
            `note (handwritten): ${highlight.note.width}x${highlight.note.height}` +
              (imagePath ? ` -> ${imagePath}` : ""),
          );
        }
      }
      console.log();
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ book: result.book, highlights: jsonHighlights }, null, 2));
  } else if (writeImages && identified.length > 0) {
    console.log(`Handwritten note images written to: ${outDir}`);
  }
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${(err as Error).message}\n`);
    printUsage();
    process.exit(1);
  }

  await run(args);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
