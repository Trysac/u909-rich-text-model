import { RichTextError } from "./errors.js";
import {
  type Block,
  type BlockAttrs,
  type BlockType,
  blockTextLength,
  canonicalizeMarks,
  canonicalizeRuns,
  comparePos,
  DEFAULT_MAX_BLOCKS,
  DEFAULT_MAX_CHARS,
  type Doc,
  deepFreeze,
  type Mark,
  type MarkType,
  type Pos,
  type Run,
  sliceRuns,
  totalDocChars,
  validateBlockTypeAndAttrs,
  validateMark,
  validateRange,
} from "./model.js";

/**
 * A block fragment inside a replace step's `Slice`.
 */
export interface Fragment {
  readonly type: BlockType;
  readonly attrs: BlockAttrs;
  readonly runs: readonly Run[];
}

/**
 * A slice of document content used by a `ReplaceStep`.
 */
export interface Slice {
  readonly fragments: readonly Fragment[];
}

/**
 * Step that replaces `[from, to]` with `slice`.
 */
export interface ReplaceStep {
  readonly kind: "replace";
  readonly from: Pos;
  readonly to: Pos;
  readonly slice: Slice;
  invert(docBefore: Doc): Step;
}

/**
 * Step that adds `mark` to `[from, to]`.
 */
export interface AddMarkStep {
  readonly kind: "addMark";
  readonly from: Pos;
  readonly to: Pos;
  readonly mark: Mark;
  invert(docBefore: Doc): Step;
}

/**
 * Step that removes marks of `markType` from `[from, to]`.
 */
export interface RemoveMarkStep {
  readonly kind: "removeMark";
  readonly from: Pos;
  readonly to: Pos;
  readonly markType: MarkType;
  invert(docBefore: Doc): Step;
}

/**
 * Step that updates block `block`'s `blockType` and `attrs`.
 */
export interface SetBlockTypeStep {
  readonly kind: "setBlockType";
  readonly block: number;
  readonly blockType: BlockType;
  readonly attrs: BlockAttrs;
  invert(docBefore: Doc): Step;
}

/**
 * Discriminated union of the 4 supported step kinds.
 */
export type Step = ReplaceStep | AddMarkStep | RemoveMarkStep | SetBlockTypeStep;

/**
 * Extracts the slice from `doc` between `from` and `to` so that replacing with it restores
 * the exact removed content, block types, and attributes.
 */
export function extractSlice(doc: Doc, from: Pos, to: Pos): Slice {
  validateRange(doc, from, to);
  const fragments: Fragment[] = [];
  if (from.block === to.block) {
    const blk = doc.blocks[from.block];
    if (!blk) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    const runs = sliceRuns(blk.runs, from.offset, to.offset);
    fragments.push({
      type: blk.type,
      attrs: blk.attrs,
      runs,
    });
  } else {
    for (let bIdx = from.block; bIdx <= to.block; bIdx++) {
      const blk = doc.blocks[bIdx];
      if (!blk) {
        throw new RichTextError("invalid_position", "Block index out of bounds");
      }
      const len = blockTextLength(blk);
      const start = bIdx === from.block ? from.offset : 0;
      const end = bIdx === to.block ? to.offset : len;
      fragments.push({
        type: blk.type,
        attrs: blk.attrs,
        runs: sliceRuns(blk.runs, start, end),
      });
    }
  }
  return deepFreeze({ fragments });
}

/**
 * Computes the end position of the inserted `slice` when replacing `[from, to]`.
 */
export function replaceEndPos(from: Pos, slice: Slice): Pos {
  const k = slice.fragments.length;
  if (k === 0) {
    return { block: from.block, offset: from.offset };
  }
  if (k === 1) {
    const f0 = slice.fragments[0];
    const len0 = f0 ? blockTextLength(f0) : 0;
    return { block: from.block, offset: from.offset + len0 };
  }
  const lastFrag = slice.fragments[k - 1];
  const lastLen = lastFrag ? blockTextLength(lastFrag) : 0;
  return {
    block: from.block + k - 1,
    offset: lastLen,
  };
}

/**
 * Creates a deep-frozen `ReplaceStep`.
 */
export function createReplaceStep(from: Pos, to: Pos, slice: Slice): ReplaceStep {
  if (slice.fragments.length === 0) {
    throw new RichTextError("invalid_doc", "Replace slice must have at least one fragment");
  }
  const normalizedFragments: Fragment[] = slice.fragments.map((f) => {
    const { type, attrs } = validateBlockTypeAndAttrs(f.type, f.attrs);
    const runs = canonicalizeRuns(f.runs, type, true);
    return { type, attrs, runs };
  });
  const frozenFrom = deepFreeze({ block: from.block, offset: from.offset });
  const frozenTo = deepFreeze({ block: to.block, offset: to.offset });
  const frozenSlice = deepFreeze({ fragments: normalizedFragments });

  const step: ReplaceStep = {
    kind: "replace",
    from: frozenFrom,
    to: frozenTo,
    slice: frozenSlice,
    invert(docBefore: Doc): Step {
      const removedSlice = extractSlice(docBefore, frozenFrom, frozenTo);
      const newTo = replaceEndPos(frozenFrom, frozenSlice);
      return createReplaceStep(frozenFrom, newTo, removedSlice);
    },
  };
  return Object.freeze(step);
}

/**
 * Creates a deep-frozen `AddMarkStep`.
 */
export function createAddMarkStep(from: Pos, to: Pos, mark: Mark): AddMarkStep {
  const validatedMark = validateMark(mark);
  const frozenFrom = deepFreeze({ block: from.block, offset: from.offset });
  const frozenTo = deepFreeze({ block: to.block, offset: to.offset });
  const frozenMark = deepFreeze(validatedMark);

  const step: AddMarkStep = {
    kind: "addMark",
    from: frozenFrom,
    to: frozenTo,
    mark: frozenMark,
    invert(docBefore: Doc): Step {
      const originalSlice = extractSlice(docBefore, frozenFrom, frozenTo);
      return createReplaceStep(frozenFrom, frozenTo, originalSlice);
    },
  };
  return Object.freeze(step);
}

/**
 * Creates a deep-frozen `RemoveMarkStep`.
 */
export function createRemoveMarkStep(from: Pos, to: Pos, markType: MarkType): RemoveMarkStep {
  if (markType !== "bold" && markType !== "italic" && markType !== "code" && markType !== "link") {
    throw new RichTextError("invalid_mark", "Invalid mark type");
  }
  const frozenFrom = deepFreeze({ block: from.block, offset: from.offset });
  const frozenTo = deepFreeze({ block: to.block, offset: to.offset });

  const step: RemoveMarkStep = {
    kind: "removeMark",
    from: frozenFrom,
    to: frozenTo,
    markType,
    invert(docBefore: Doc): Step {
      const originalSlice = extractSlice(docBefore, frozenFrom, frozenTo);
      return createReplaceStep(frozenFrom, frozenTo, originalSlice);
    },
  };
  return Object.freeze(step);
}

/**
 * Creates a deep-frozen `SetBlockTypeStep`.
 */
export function createSetBlockTypeStep(
  block: number,
  blockType: BlockType,
  attrs?: object,
): SetBlockTypeStep {
  const validated = validateBlockTypeAndAttrs(
    blockType,
    attrs ?? (blockType === "heading" ? undefined : {}),
  );
  const frozenAttrs = deepFreeze(validated.attrs);

  const step: SetBlockTypeStep = {
    kind: "setBlockType",
    block,
    blockType: validated.type,
    attrs: frozenAttrs,
    invert(docBefore: Doc): Step {
      if (!Number.isInteger(block) || block < 0 || block >= docBefore.blocks.length) {
        throw new RichTextError("invalid_position", "Block index out of bounds");
      }
      const oldBlock = docBefore.blocks[block];
      if (!oldBlock) {
        throw new RichTextError("invalid_position", "Block index out of bounds");
      }
      return createSetBlockTypeStep(block, oldBlock.type, oldBlock.attrs);
    },
  };
  return Object.freeze(step);
}

/**
 * Applies a single `Step` to `doc` and returns the new canonical deep-frozen `Doc`.
 */
export function applyStep(doc: Doc, step: Step): Doc {
  switch (step.kind) {
    case "replace":
      return applyReplaceStep(doc, step);
    case "addMark":
      return applyAddMarkStep(doc, step);
    case "removeMark":
      return applyRemoveMarkStep(doc, step);
    case "setBlockType":
      return applySetBlockTypeStep(doc, step);
  }
}

function applyReplaceStep(doc: Doc, step: ReplaceStep): Doc {
  const { from, to, slice } = step;
  validateRange(doc, from, to);
  const k = slice.fragments.length;
  if (k === 0) {
    throw new RichTextError("invalid_doc", "Replace slice must have at least one fragment");
  }

  const firstBlock = doc.blocks[from.block];
  const lastBlock = doc.blocks[to.block];
  if (!firstBlock || !lastBlock) {
    throw new RichTextError("invalid_position", "Block index out of bounds");
  }

  const headRuns = sliceRuns(firstBlock.runs, 0, from.offset);
  const tailRuns = sliceRuns(lastBlock.runs, to.offset, blockTextLength(lastBlock));

  const replacementBlocks: Block[] = [];
  if (k === 1) {
    const f0 = slice.fragments[0];
    if (!f0) {
      throw new RichTextError("invalid_doc", "Missing fragment");
    }
    const combinedRuns = canonicalizeRuns(
      [...headRuns, ...f0.runs, ...tailRuns],
      firstBlock.type,
      false,
    );
    replacementBlocks.push({
      type: firstBlock.type,
      attrs: firstBlock.attrs,
      runs: combinedRuns,
    });
  } else {
    const f0 = slice.fragments[0];
    const fLast = slice.fragments[k - 1];
    if (!f0 || !fLast) {
      throw new RichTextError("invalid_doc", "Missing fragment");
    }
    // First block keeps firstBlock's type and attrs
    const firstRuns = canonicalizeRuns([...headRuns, ...f0.runs], firstBlock.type, false);
    replacementBlocks.push({
      type: firstBlock.type,
      attrs: firstBlock.attrs,
      runs: firstRuns,
    });
    // Middle fragments become blocks directly
    for (let i = 1; i < k - 1; i++) {
      const mid = slice.fragments[i];
      if (!mid) {
        throw new RichTextError("invalid_doc", "Missing fragment");
      }
      const midRuns = canonicalizeRuns(mid.runs, mid.type, false);
      replacementBlocks.push({
        type: mid.type,
        attrs: mid.attrs,
        runs: midRuns,
      });
    }
    // Last fragment uses its own type and attrs, followed by lastBlock's tail
    const lastRuns = canonicalizeRuns([...fLast.runs, ...tailRuns], fLast.type, false);
    replacementBlocks.push({
      type: fLast.type,
      attrs: fLast.attrs,
      runs: lastRuns,
    });
  }

  const newBlocks = [
    ...doc.blocks.slice(0, from.block),
    ...replacementBlocks,
    ...doc.blocks.slice(to.block + 1),
  ];

  if (newBlocks.length > DEFAULT_MAX_BLOCKS) {
    throw new RichTextError("input_too_large", "Document block count exceeds maximum limit");
  }
  if (totalDocChars(newBlocks) > DEFAULT_MAX_CHARS) {
    throw new RichTextError("input_too_large", "Document character count exceeds maximum limit");
  }

  return deepFreeze({ blocks: newBlocks });
}

function applyAddMarkStep(doc: Doc, step: AddMarkStep): Doc {
  const { from, to, mark } = step;
  validateRange(doc, from, to);
  const validatedMark = validateMark(mark);

  // Check schema across all touched blocks first (even if range within block is empty)
  for (let bIdx = from.block; bIdx <= to.block; bIdx++) {
    const blk = doc.blocks[bIdx];
    if (!blk) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    if (blk.type === "code_block") {
      throw new RichTextError("schema_violation", "Cannot add marks to a code_block");
    }
  }

  if (comparePos(from, to) === 0) {
    return doc;
  }

  const newBlocks = doc.blocks.map((blk, bIdx) => {
    if (bIdx < from.block || bIdx > to.block) {
      return blk;
    }
    const len = blockTextLength(blk);
    const start = bIdx === from.block ? from.offset : 0;
    const end = bIdx === to.block ? to.offset : len;
    if (start >= end) {
      return blk;
    }
    const beforeRuns = sliceRuns(blk.runs, 0, start);
    const middleRuns = sliceRuns(blk.runs, start, end).map((r) => ({
      text: r.text,
      marks: canonicalizeMarks(
        [...r.marks.filter((m) => m.type !== validatedMark.type), validatedMark],
        false,
      ),
    }));
    const afterRuns = sliceRuns(blk.runs, end, len);
    return {
      type: blk.type,
      attrs: blk.attrs,
      runs: canonicalizeRuns([...beforeRuns, ...middleRuns, ...afterRuns], blk.type, false),
    };
  });

  return deepFreeze({ blocks: newBlocks });
}

function applyRemoveMarkStep(doc: Doc, step: RemoveMarkStep): Doc {
  const { from, to, markType } = step;
  validateRange(doc, from, to);

  if (comparePos(from, to) === 0) {
    return doc;
  }

  const newBlocks = doc.blocks.map((blk, bIdx) => {
    if (bIdx < from.block || bIdx > to.block) {
      return blk;
    }
    const len = blockTextLength(blk);
    const start = bIdx === from.block ? from.offset : 0;
    const end = bIdx === to.block ? to.offset : len;
    if (start >= end) {
      return blk;
    }
    const beforeRuns = sliceRuns(blk.runs, 0, start);
    const middleRuns = sliceRuns(blk.runs, start, end).map((r) => ({
      text: r.text,
      marks: r.marks.filter((m) => m.type !== markType),
    }));
    const afterRuns = sliceRuns(blk.runs, end, len);
    return {
      type: blk.type,
      attrs: blk.attrs,
      runs: canonicalizeRuns([...beforeRuns, ...middleRuns, ...afterRuns], blk.type, false),
    };
  });

  return deepFreeze({ blocks: newBlocks });
}

function applySetBlockTypeStep(doc: Doc, step: SetBlockTypeStep): Doc {
  const { block, blockType, attrs } = step;
  if (!Number.isInteger(block) || block < 0 || block >= doc.blocks.length) {
    throw new RichTextError("invalid_position", "Block index out of bounds");
  }
  const targetBlock = doc.blocks[block];
  if (!targetBlock) {
    throw new RichTextError("invalid_position", "Block index out of bounds");
  }
  const validated = validateBlockTypeAndAttrs(blockType, attrs);
  if (validated.type === "code_block") {
    for (const r of targetBlock.runs) {
      if (r.marks.length > 0) {
        throw new RichTextError(
          "schema_violation",
          "Cannot convert block with marks to code_block",
        );
      }
    }
  }
  const newBlocks = doc.blocks.map((blk, idx) =>
    idx === block
      ? {
          type: validated.type,
          attrs: validated.attrs,
          runs: blk.runs,
        }
      : blk,
  );
  return deepFreeze({ blocks: newBlocks });
}

/**
 * Maps a single position `pos` through a single `step`.
 */
export function mapPosThroughStep(pos: Pos, step: Step): Pos {
  if (step.kind !== "replace") {
    return { block: pos.block, offset: pos.offset };
  }
  const { from, to, slice } = step;
  // Positions strictly before `from` are unchanged
  if (comparePos(pos, from) < 0) {
    return { block: pos.block, offset: pos.offset };
  }
  // Positions in [from, to) when to > from map to `from`
  if (comparePos(from, to) < 0 && comparePos(pos, to) < 0) {
    return { block: from.block, offset: from.offset };
  }
  // Positions at or after `to` shift to the end of the inserted content
  const endInserted = replaceEndPos(from, slice);
  if (pos.block === to.block) {
    return {
      block: endInserted.block,
      offset: endInserted.offset + (pos.offset - to.offset),
    };
  }
  const blockDelta = endInserted.block - to.block;
  return {
    block: pos.block + blockDelta,
    offset: pos.offset,
  };
}

/**
 * Maps `pos` sequentially through `steps`.
 *
 * @param pos - Starting document position.
 * @param steps - Sequence of applied steps.
 * @returns The mapped position.
 */
export function mapPos(pos: Pos, steps: readonly Step[]): Pos {
  if (
    typeof pos !== "object" ||
    pos === null ||
    typeof pos.block !== "number" ||
    !Number.isInteger(pos.block) ||
    pos.block < 0 ||
    typeof pos.offset !== "number" ||
    !Number.isInteger(pos.offset) ||
    pos.offset < 0
  ) {
    throw new RichTextError("invalid_position", "Invalid position to map");
  }
  let current: Pos = { block: pos.block, offset: pos.offset };
  for (const step of steps) {
    current = mapPosThroughStep(current, step);
  }
  return deepFreeze(current);
}
