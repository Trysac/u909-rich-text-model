import { RichTextError } from "./errors.js";

/**
 * Supported inline mark type names.
 */
export type MarkType = "bold" | "italic" | "code" | "link";

/**
 * Inline formatting mark attached to a text run.
 */
export type Mark =
  | { readonly type: "bold" | "italic" | "code" }
  | { readonly type: "link"; readonly href: string };

/**
 * A contiguous run of text sharing the exact same set of canonical marks.
 */
export interface Run {
  readonly text: string;
  readonly marks: readonly Mark[];
}

/**
 * Supported top-level block types.
 */
export type BlockType = "paragraph" | "heading" | "code_block";

/**
 * Attributes associated with a heading block.
 */
export interface HeadingAttrs {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Empty attributes record for paragraph and code_block.
 */
export type EmptyAttrs = Record<string, never>;

/**
 * Block attribute union.
 */
export type BlockAttrs = EmptyAttrs | HeadingAttrs;

/**
 * A block node in a document.
 */
export interface Block {
  readonly type: BlockType;
  readonly attrs: BlockAttrs;
  readonly runs: readonly Run[];
}

/**
 * A flat rich-text document consisting of one or more blocks.
 */
export interface Doc {
  readonly blocks: readonly Block[];
}

/**
 * Position within a document: `block` index and UTF-16 code unit `offset`.
 */
export interface Pos {
  readonly block: number;
  readonly offset: number;
}

/**
 * Document selection consisting of an `anchor` and a `head` position.
 */
export interface Selection {
  readonly anchor: Pos;
  readonly head: Pos;
}

/**
 * Limits enforced by `parseDoc`.
 */
export interface ParseDocLimits {
  readonly maxBlocks?: number;
  readonly maxChars?: number;
}

/**
 * Default maximum number of blocks allowed by `parseDoc`.
 */
export const DEFAULT_MAX_BLOCKS = 10_000;

/**
 * Default maximum number of UTF-16 characters allowed across a document.
 */
export const DEFAULT_MAX_CHARS = 1_000_000;

/**
 * Maximum allowed length for a link `href`.
 */
export const MAX_HREF_LENGTH = 2_048;

const MARK_ORDER: Record<MarkType, number> = {
  bold: 0,
  italic: 1,
  code: 2,
  link: 3,
};

const SAFE_HREF_RE = /^(https?:|mailto:)/i;

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

/**
 * Deeply freezes a plain object/array graph in-place and returns it.
 */
export function deepFreeze<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i]);
    }
  } else {
    for (const key of Object.keys(obj)) {
      const val = (obj as Record<string, unknown>)[key];
      if (typeof val === "object" && val !== null && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
  }
  return obj;
}

/**
 * Validates that `text` contains no line breaks and no unpaired UTF-16 surrogates.
 */
export function validateRunText(text: unknown): string {
  if (typeof text !== "string") {
    throw new RichTextError("invalid_doc", "Run text must be a string");
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) {
      throw new RichTextError("invalid_doc", "Run text must not contain newline characters");
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= text.length) {
        throw new RichTextError("invalid_doc", "Run text contains an unpaired high surrogate");
      }
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new RichTextError("invalid_doc", "Run text contains an unpaired high surrogate");
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new RichTextError("invalid_doc", "Run text contains an unpaired low surrogate");
    }
  }
  return text;
}

/**
 * Validates and clones a single `Mark`.
 */
export function validateMark(raw: unknown): Mark {
  if (!isPlainObject(raw)) {
    throw new RichTextError("invalid_mark", "Mark must be a plain object");
  }
  const type = raw.type;
  if (type === "bold" || type === "italic" || type === "code") {
    const keys = Object.keys(raw);
    if (keys.length !== 1) {
      throw new RichTextError("invalid_mark", `Mark '${type}' must not have extra properties`);
    }
    return { type };
  }
  if (type === "link") {
    const keys = Object.keys(raw);
    if (keys.length !== 2 || typeof raw.href !== "string") {
      throw new RichTextError("invalid_mark", "Link mark requires a string href");
    }
    const trimmed = raw.href.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_HREF_LENGTH) {
      throw new RichTextError("invalid_mark", "Link href exceeds maximum length or is empty");
    }
    if (!SAFE_HREF_RE.test(trimmed)) {
      throw new RichTextError(
        "invalid_mark",
        "Link href must start with http:, https:, or mailto:",
      );
    }
    return { type: "link", href: trimmed };
  }
  throw new RichTextError("invalid_mark", "Unknown mark type");
}

/**
 * Validates and canonicalizes an array of marks:
 * - validates each mark
 * - rejects duplicate mark types in raw input when `rejectDuplicates` is true,
 *   or deduplicates keeping the latest mark of that type
 * - sorts in canonical order: bold, italic, code, link.
 */
export function canonicalizeMarks(rawMarks: unknown, rejectDuplicates = true): Mark[] {
  if (!Array.isArray(rawMarks)) {
    throw new RichTextError("invalid_mark", "Marks must be an array");
  }
  const byType = new Map<MarkType, Mark>();
  for (const item of rawMarks) {
    const mark = validateMark(item);
    if (byType.has(mark.type)) {
      if (rejectDuplicates) {
        throw new RichTextError("invalid_mark", `Duplicate mark type '${mark.type}'`);
      }
    }
    byType.set(mark.type, mark);
  }
  const result = Array.from(byType.values());
  result.sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]);
  return result;
}

/**
 * Checks whether two canonical mark arrays are equal.
 */
export function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const ma = a[i];
    const mb = b[i];
    if (!ma || !mb || ma.type !== mb.type) {
      return false;
    }
    if (ma.type === "link" && mb.type === "link" && ma.href !== mb.href) {
      return false;
    }
  }
  return true;
}

/**
 * Canonicalizes an array of runs:
 * - drops empty runs (`text === ""`)
 * - canonicalizes marks on each run
 * - merges adjacent runs with equal marks.
 */
export function canonicalizeRuns(
  rawRuns: readonly { readonly text: string; readonly marks: readonly Mark[] }[],
  blockType: BlockType,
  rejectDuplicateMarks = true,
): Run[] {
  const out: Run[] = [];
  for (const r of rawRuns) {
    if (!isPlainObject(r)) {
      throw new RichTextError("invalid_doc", "Run must be a plain object");
    }
    const keys = Object.keys(r);
    if (keys.length !== 2 || !("text" in r) || !("marks" in r)) {
      throw new RichTextError("invalid_doc", "Run must have only 'text' and 'marks'");
    }
    const text = validateRunText(r.text);
    const marks = canonicalizeMarks(r.marks, rejectDuplicateMarks);
    if (blockType === "code_block" && marks.length > 0) {
      throw new RichTextError("schema_violation", "code_block does not allow marks");
    }
    if (text.length === 0) {
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && marksEqual(prev.marks, marks)) {
      out[out.length - 1] = { text: prev.text + text, marks: prev.marks };
    } else {
      out.push({ text, marks });
    }
  }
  return out;
}

/**
 * Validates block type and attributes.
 */
export function validateBlockTypeAndAttrs(
  type: unknown,
  attrs: unknown,
): { type: BlockType; attrs: BlockAttrs } {
  if (type !== "paragraph" && type !== "heading" && type !== "code_block") {
    throw new RichTextError("schema_violation", "Invalid block type");
  }
  if (attrs === undefined) {
    if (type === "heading") {
      throw new RichTextError("schema_violation", "Heading block requires attrs.level in 1..6");
    }
    return { type, attrs: {} };
  }
  if (!isPlainObject(attrs)) {
    throw new RichTextError("schema_violation", "Block attrs must be a plain object");
  }
  const keys = Object.keys(attrs);
  if (type === "heading") {
    const level = attrs.level;
    if (
      keys.length !== 1 ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 6
    ) {
      throw new RichTextError("schema_violation", "Heading attrs.level must be an integer 1..6");
    }
    return { type: "heading", attrs: { level: level as 1 | 2 | 3 | 4 | 5 | 6 } };
  }
  if (keys.length !== 0) {
    throw new RichTextError("schema_violation", `Block type '${type}' must have empty attrs {}`);
  }
  return { type, attrs: {} };
}

/**
 * Returns the total UTF-16 code unit length of a block.
 */
export function blockTextLength(block: {
  readonly runs: readonly { readonly text: string }[];
}): number {
  let total = 0;
  for (const run of block.runs) {
    total += run.text.length;
  }
  return total;
}

/**
 * Returns the concatenated plain text of a block.
 */
export function blockPlainText(block: {
  readonly runs: readonly { readonly text: string }[];
}): string {
  let s = "";
  for (const run of block.runs) {
    s += run.text;
  }
  return s;
}

/**
 * Returns the total UTF-16 character count across all blocks in `blocks`.
 */
export function totalDocChars(
  blocks: readonly { readonly runs: readonly { readonly text: string }[] }[],
): number {
  let chars = 0;
  for (const b of blocks) {
    chars += blockTextLength(b);
  }
  return chars;
}

/**
 * Validates that `pos` is a valid position in `doc` and does not split a UTF-16 surrogate pair.
 */
export function validatePos(doc: Doc, pos: Pos): Pos {
  if (!isPlainObject(pos)) {
    throw new RichTextError("invalid_position", "Position must be an object");
  }
  const { block, offset } = pos;
  if (
    typeof block !== "number" ||
    !Number.isInteger(block) ||
    block < 0 ||
    block >= doc.blocks.length
  ) {
    throw new RichTextError("invalid_position", "Block index out of bounds");
  }
  const b = doc.blocks[block];
  if (!b) {
    throw new RichTextError("invalid_position", "Block index out of bounds");
  }
  const text = blockPlainText(b);
  if (
    typeof offset !== "number" ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > text.length
  ) {
    throw new RichTextError("invalid_position", "Offset out of bounds");
  }
  if (offset > 0 && offset < text.length) {
    const prevCode = text.charCodeAt(offset - 1);
    const nextCode = text.charCodeAt(offset);
    if (prevCode >= 0xd800 && prevCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      throw new RichTextError("invalid_position", "Offset splits a UTF-16 surrogate pair");
    }
  }
  return { block, offset };
}

/**
 * Compares two positions (`< 0` if `a < b`, `0` if equal, `> 0` if `a > b`).
 */
export function comparePos(a: Pos, b: Pos): number {
  if (a.block !== b.block) {
    return a.block - b.block;
  }
  return a.offset - b.offset;
}

/**
 * Validates a `[from, to]` range in `doc`, ensuring `from <= to`.
 */
export function validateRange(doc: Doc, from: Pos, to: Pos): { from: Pos; to: Pos } {
  const validFrom = validatePos(doc, from);
  const validTo = validatePos(doc, to);
  if (comparePos(validFrom, validTo) > 0) {
    throw new RichTextError("invalid_position", "Range 'from' must not be after 'to'");
  }
  return { from: validFrom, to: validTo };
}

/**
 * Validates a `Selection` against `doc`.
 */
export function validateSelection(doc: Doc, sel: Selection): Selection {
  if (!isPlainObject(sel)) {
    throw new RichTextError("invalid_position", "Selection must be an object");
  }
  const anchor = validatePos(doc, sel.anchor);
  const head = validatePos(doc, sel.head);
  return { anchor, head };
}

/**
 * Parses and validates an untrusted JSON value against the document schema,
 * returning a canonical, deep-frozen `Doc`.
 *
 * @param json - Untrusted value representing a document.
 * @param limits - Optional block and character limits (`maxBlocks` default 10,000; `maxChars` default 1,000,000).
 * @returns A canonical, deep-frozen `Doc`.
 * @throws {RichTextError} With code `'input_too_large'`, `'invalid_doc'`, `'schema_violation'`, or `'invalid_mark'`.
 */
export function parseDoc(json: unknown, limits?: ParseDocLimits): Doc {
  const maxBlocks = limits?.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const maxChars = limits?.maxChars ?? DEFAULT_MAX_CHARS;
  if (
    !Number.isInteger(maxBlocks) ||
    maxBlocks < 1 ||
    !Number.isInteger(maxChars) ||
    maxChars < 0
  ) {
    throw new RichTextError("invalid_doc", "Invalid limits configuration");
  }
  if (!isPlainObject(json)) {
    throw new RichTextError("invalid_doc", "Document must be a plain object");
  }
  const docKeys = Object.keys(json);
  if (docKeys.length !== 1 || !Array.isArray(json.blocks)) {
    throw new RichTextError("invalid_doc", "Document must have only a 'blocks' array");
  }
  const rawBlocks = json.blocks;
  if (rawBlocks.length === 0) {
    throw new RichTextError("schema_violation", "Document must contain at least one block");
  }
  if (rawBlocks.length > maxBlocks) {
    throw new RichTextError(
      "input_too_large",
      `Document block count exceeds maxBlocks (${maxBlocks})`,
    );
  }

  let charCount = 0;
  const blocks: Block[] = [];

  for (const rawBlock of rawBlocks) {
    if (!isPlainObject(rawBlock)) {
      throw new RichTextError("invalid_doc", "Block must be a plain object");
    }
    const bKeys = Object.keys(rawBlock);
    if (
      bKeys.length !== 3 ||
      !("type" in rawBlock) ||
      !("attrs" in rawBlock) ||
      !("runs" in rawBlock)
    ) {
      throw new RichTextError("invalid_doc", "Block must have 'type', 'attrs', and 'runs'");
    }
    const { type, attrs } = validateBlockTypeAndAttrs(rawBlock.type, rawBlock.attrs);
    if (!Array.isArray(rawBlock.runs)) {
      throw new RichTextError("invalid_doc", "Block 'runs' must be an array");
    }
    for (const r of rawBlock.runs) {
      if (isPlainObject(r) && typeof r.text === "string") {
        charCount += r.text.length;
        if (charCount > maxChars) {
          throw new RichTextError(
            "input_too_large",
            `Document character count exceeds maxChars (${maxChars})`,
          );
        }
      }
    }
    const runs = canonicalizeRuns(rawBlock.runs as { text: string; marks: Mark[] }[], type, true);
    blocks.push({ type, attrs, runs });
  }

  return deepFreeze({ blocks });
}

/**
 * Slices runs of a block in `[startOffset, endOffset)`.
 */
export function sliceRuns(runs: readonly Run[], startOffset: number, endOffset: number): Run[] {
  if (startOffset >= endOffset) {
    return [];
  }
  const result: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    if (runEnd <= startOffset || runStart >= endOffset) {
      continue;
    }
    const s = Math.max(0, startOffset - runStart);
    const e = Math.min(run.text.length, endOffset - runStart);
    const subText = run.text.slice(s, e);
    if (subText.length > 0) {
      result.push({
        text: subText,
        marks: run.marks.map((m) =>
          m.type === "link" ? { type: "link", href: m.href } : { type: m.type },
        ),
      });
    }
  }
  return result;
}
