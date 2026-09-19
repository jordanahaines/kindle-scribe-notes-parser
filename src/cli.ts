#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseNotebook } from "./index.js";

function printUsage(): void {
  console.log(`Usage: kindle-scribe-parse <pdf-path> [options]

Parses a Kindle Scribe notebook export PDF into structured highlight and note records.

Options:
  -o, --out <dir>   Directory to write handwritten note images to
                     (default: "<pdf-name>-notes" next to the PDF)
  --json            Print the full parsed result as JSON to stdout. Handwritten note
                     images are still written to disk; the JSON references their path
                     rather than embedding raw image bytes.
  -h, --help        Show this help message
`);
}

type CliArgs = {
  pdfPath: string;
  outDir?: string;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let pdfPath: string | undefined;
  let outDir: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--json") {
      json = true;
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

  return { pdfPath, outDir, json };
}

async function run(args: CliArgs): Promise<void> {
  const pdfPath = resolve(args.pdfPath);
  const pdfName = basename(pdfPath, extname(pdfPath));
  const outDir = resolve(args.outDir ?? join(dirname(pdfPath), `${pdfName}-notes`));

  const bytes = await readFile(pdfPath);
  const result = parseNotebook(new Uint8Array(bytes));

  const handwrittenCount = result.highlights.filter((h) => h.note?.type === "handwritten").length;
  if (handwrittenCount > 0) {
    await mkdir(outDir, { recursive: true });
  }

  if (!args.json) {
    console.log(`Book: ${result.book.title} — ${result.book.author} (${result.book.asin})`);
    console.log(`Highlights: ${result.highlights.length}\n`);
  }

  const pageOccurrences = new Map<number, number>();
  const jsonHighlights: unknown[] = [];

  for (const highlight of result.highlights) {
    const occurrence = (pageOccurrences.get(highlight.page) ?? 0) + 1;
    pageOccurrences.set(highlight.page, occurrence);

    let jsonNote: unknown = highlight.note;
    let imagePath: string | undefined;

    if (highlight.note?.type === "handwritten") {
      const filename = `page-${String(highlight.page).padStart(4, "0")}-${occurrence}.png`;
      imagePath = join(outDir, filename);
      await writeFile(imagePath, highlight.note.image);
      jsonNote = {
        type: "handwritten",
        width: highlight.note.width,
        height: highlight.note.height,
        imagePath,
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
        console.log(
          `note (handwritten): ${highlight.note.width}x${highlight.note.height} -> ${imagePath}`,
        );
      }
      console.log();
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ book: result.book, highlights: jsonHighlights }, null, 2));
  } else if (handwrittenCount > 0) {
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
