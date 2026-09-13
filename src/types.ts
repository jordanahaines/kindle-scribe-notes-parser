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
