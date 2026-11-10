import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Block,
  type BlockType,
  type Doc,
  EditorState,
  type Mark,
  type MarkType,
  mapPos,
  type Pos,
  parseDoc,
  RichTextError,
  redo,
  type Selection,
  Transaction,
  undo,
} from "../src/index.js";

describe("Acceptance criteria", () => {
  it("1. insertText at offset 5 on 'Hello world', undo restores exact doc, redo gives 'Hello, world' again", () => {
    const doc: Doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }],
    });
    const originalJson = JSON.stringify(doc);
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(state0.doc).insertText({ block: 0, offset: 5 }, ",");
    expect(tr.doc.blocks[0]?.runs).toEqual([{ text: "Hello, world", marks: [] }]);

    const state1 = state0.apply(tr);
    expect(state1.doc.blocks[0]?.runs).toEqual([{ text: "Hello, world", marks: [] }]);

    const undone = undo(state1);
    expect(undone).not.toBeNull();
    expect(JSON.stringify(undone?.doc)).toBe(originalJson);

    if (!undone) {
      throw new Error("undo returned null");
    }
    const redone = redo(undone);
    expect(redone).not.toBeNull();
    expect(redone?.doc.blocks[0]?.runs).toEqual([{ text: "Hello, world", marks: [] }]);
  });

  it("2. splitBlock at offset 5 on 'Hello world' and deleteRange joins them back", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }],
    });
    const tr1 = new Transaction(doc).splitBlock({ block: 0, offset: 5 });
    expect(tr1.doc.blocks).toEqual([
      { type: "paragraph", attrs: {}, runs: [{ text: "Hello", marks: [] }] },
      { type: "paragraph", attrs: {}, runs: [{ text: " world", marks: [] }] },
    ]);

    const tr2 = new Transaction(tr1.doc).deleteRange(
      { block: 0, offset: 5 },
      { block: 1, offset: 0 },
    );
    expect(tr2.doc.blocks).toEqual([
      { type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] },
    ]);
  });

  it("3. overlapping addMark merges adjacent bold runs into canonical form", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }],
    });
    const tr = new Transaction(doc).addMark(
      { block: 0, offset: 0 },
      { block: 0, offset: 5 },
      { type: "bold" },
    );
    expect(tr.doc.blocks[0]?.runs).toEqual([
      { text: "Hello", marks: [{ type: "bold" }] },
      { text: " world", marks: [] },
    ]);

    tr.addMark({ block: 0, offset: 3 }, { block: 0, offset: 8 }, { type: "bold" });
    expect(tr.doc.blocks[0]?.runs).toEqual([
      { text: "Hello wo", marks: [{ type: "bold" }] },
      { text: "rld", marks: [] },
    ]);
  });

  it("4. cross-block deleteRange from heading level 1 'Title' to paragraph 'Body text' and undo", () => {
    const doc = parseDoc({
      blocks: [
        { type: "heading", attrs: { level: 1 }, runs: [{ text: "Title", marks: [] }] },
        { type: "paragraph", attrs: {}, runs: [{ text: "Body text", marks: [] }] },
      ],
    });
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(state0.doc).deleteRange(
      { block: 0, offset: 2 },
      { block: 1, offset: 5 },
    );
    const state1 = state0.apply(tr);
    expect(state1.doc.blocks).toEqual([
      { type: "heading", attrs: { level: 1 }, runs: [{ text: "Titext", marks: [] }] },
    ]);

    const undone = undo(state1);
    expect(undone).not.toBeNull();
    expect(undone?.doc).toEqual(doc);
  });

  it("5. selection mapping on insertText before and at cursor, and undo restores prior selection", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }],
    });

    // Cursor at { block: 0, offset: 11 } becomes { block: 0, offset: 13 } after insertText({ block: 0, offset: 0 }, '!!')
    const stateA0 = EditorState.create({
      doc,
      selection: { anchor: { block: 0, offset: 11 }, head: { block: 0, offset: 11 } },
    });
    const trA = new Transaction(stateA0.doc).insertText({ block: 0, offset: 0 }, "!!");
    const stateA1 = stateA0.apply(trA);
    expect(stateA1.selection).toEqual({
      anchor: { block: 0, offset: 13 },
      head: { block: 0, offset: 13 },
    });

    // Cursor at { block: 0, offset: 5 } becomes { block: 0, offset: 6 } after insertText at that same position of 'X'
    const stateB0 = EditorState.create({
      doc,
      selection: { anchor: { block: 0, offset: 5 }, head: { block: 0, offset: 5 } },
    });
    const trB = new Transaction(stateB0.doc).insertText({ block: 0, offset: 5 }, "X");
    const stateB1 = stateB0.apply(trB);
    expect(stateB1.selection).toEqual({
      anchor: { block: 0, offset: 6 },
      head: { block: 0, offset: 6 },
    });

    // undo restores the selection held before the transaction
    const stateBUndone = undo(stateB1);
    expect(stateBUndone?.selection).toEqual({
      anchor: { block: 0, offset: 5 },
      head: { block: 0, offset: 5 },
    });
  });

  it("6. error codes for invalid positions, surrogate pair splits, schema violations, invalid marks, and input_too_large", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }],
    });

    // offset 12 on 'Hello world' throws RichTextError code 'invalid_position'
    expect(() => new Transaction(doc).insertText({ block: 0, offset: 12 }, "a")).toThrowError(
      RichTextError,
    );
    try {
      new Transaction(doc).insertText({ block: 0, offset: 12 }, "a");
    } catch (e) {
      expect(e).toBeInstanceOf(RichTextError);
      expect((e as RichTextError).code).toBe("invalid_position");
    }

    // offset between the two UTF-16 units of '\u{1F600}' throws 'invalid_position'
    const emojiDoc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "\u{1F600}", marks: [] }] }],
    });
    try {
      new Transaction(emojiDoc).insertText({ block: 0, offset: 1 }, "a");
      expect.fail("Expected invalid_position");
    } catch (e) {
      expect((e as RichTextError).code).toBe("invalid_position");
    }

    // addMark on a 'code_block' throws 'schema_violation'
    const codeDoc = parseDoc({
      blocks: [{ type: "code_block", attrs: {}, runs: [{ text: "const x = 1;", marks: [] }] }],
    });
    try {
      new Transaction(codeDoc).addMark(
        { block: 0, offset: 0 },
        { block: 0, offset: 5 },
        { type: "bold" },
      );
      expect.fail("Expected schema_violation");
    } catch (e) {
      expect((e as RichTextError).code).toBe("schema_violation");
    }

    // heading level 7 throws 'schema_violation'
    try {
      parseDoc({
        blocks: [{ type: "heading", attrs: { level: 7 }, runs: [] }],
      });
      expect.fail("Expected schema_violation");
    } catch (e) {
      expect((e as RichTextError).code).toBe("schema_violation");
    }

    // a link mark with href 'javascript:alert(1)' throws 'invalid_mark'
    try {
      new Transaction(doc).addMark(
        { block: 0, offset: 0 },
        { block: 0, offset: 5 },
        { type: "link", href: "javascript:alert(1)" },
      );
      expect.fail("Expected invalid_mark");
    } catch (e) {
      expect((e as RichTextError).code).toBe("invalid_mark");
    }

    // parseDoc with 10_001 blocks throws 'input_too_large'
    const tooManyBlocks = Array.from({ length: 10_001 }, () => ({
      type: "paragraph",
      attrs: {},
      runs: [],
    }));
    try {
      parseDoc({ blocks: tooManyBlocks });
      expect.fail("Expected input_too_large");
    } catch (e) {
      expect((e as RichTextError).code).toBe("input_too_large");
    }
  });

  it("7. history is capped at 100 entries and cleared on new transaction after undo", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [] }],
    });
    let state = EditorState.create({ doc });
    let docAfterFirst: Doc | undefined;

    for (let i = 0; i < 101; i++) {
      const tr = new Transaction(state.doc).insertText({ block: 0, offset: i }, "a");
      state = state.apply(tr);
      if (i === 0) {
        docAfterFirst = state.doc;
      }
    }

    for (let i = 0; i < 100; i++) {
      const next = undo(state);
      expect(next).not.toBeNull();
      if (!next) {
        throw new Error("undo returned null unexpectedly");
      }
      state = next;
    }

    expect(undo(state)).toBeNull();
    expect(state.doc).toEqual(docAfterFirst);

    // Applying a new transaction after an undo makes redo return null
    const trNew = new Transaction(state.doc).insertText({ block: 0, offset: 0 }, "b");
    const stateAfterNew = state.apply(trNew);
    expect(redo(stateAfterNew)).toBeNull();
  });

  it("8. property test (fast-check, seed 42, 200 runs): N random transactions then N undos and N redos", () => {
    const safeCharArb = fc.constantFrom(
      "a",
      "b",
      "c",
      " ",
      "1",
      "2",
      "!",
      "\u{1F600}",
      "\u{1F680}",
    );
    const safeTextArb = fc
      .array(safeCharArb, { minLength: 1, maxLength: 8 })
      .map((a) => a.join(""));

    const markArb: fc.Arbitrary<Mark> = fc.oneof(
      fc.constant({ type: "bold" as const }),
      fc.constant({ type: "italic" as const }),
      fc.constant({ type: "code" as const }),
      fc
        .constantFrom("https://example.com", "http://example.org/a", "mailto:info@example.com")
        .map((href) => ({ type: "link" as const, href })),
    );

    const marksArrayArb = fc
      .subarray(["bold", "italic", "code", "link"] as MarkType[])
      .chain((types) =>
        fc.tuple(
          ...types.map((t) =>
            t === "link"
              ? fc
                  .constantFrom("https://example.com", "mailto:info@example.com")
                  .map((href) => ({ type: "link" as const, href }))
              : fc.constant({ type: t as "bold" | "italic" | "code" }),
          ),
        ),
      );

    const blockArb = fc
      .oneof(
        fc.constant({ type: "paragraph" as const, attrs: {} }),
        fc.constant({ type: "code_block" as const, attrs: {} }),
        fc.integer({ min: 1, max: 6 }).map((level) => ({
          type: "heading" as const,
          attrs: { level: level as 1 | 2 | 3 | 4 | 5 | 6 },
        })),
      )
      .chain((header) => {
        const runArb =
          header.type === "code_block"
            ? safeTextArb.map((text) => ({ text, marks: [] as Mark[] }))
            : fc.record({ text: safeTextArb, marks: marksArrayArb });
        return fc
          .array(runArb, { minLength: 0, maxLength: 4 })
          .map((runs) => ({ type: header.type, attrs: header.attrs, runs }));
      });

    const rawDocArb = fc.array(blockArb, { minLength: 1, maxLength: 5 }).map((blocks) => ({
      blocks,
    }));

    function validOffsetsForBlock(b: Block): number[] {
      let text = "";
      for (const r of b.runs) {
        text += r.text;
      }
      const offsets: number[] = [0];
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          i++;
        }
        offsets.push(i + 1);
      }
      return offsets;
    }

    function pickPos(doc: Doc, rng: number): Pos {
      const bIdx = rng % doc.blocks.length;
      const blk = doc.blocks[bIdx];
      if (!blk) {
        throw new Error("Missing block at bIdx");
      }
      const offsets = validOffsetsForBlock(blk);
      const off = offsets[Math.floor(rng / doc.blocks.length) % offsets.length] ?? 0;
      return { block: bIdx, offset: off };
    }

    function pickOrderedRange(doc: Doc, r1: number, r2: number): { from: Pos; to: Pos } {
      const p1 = pickPos(doc, r1);
      const p2 = pickPos(doc, r2);
      if (p1.block < p2.block || (p1.block === p2.block && p1.offset <= p2.offset)) {
        return { from: p1, to: p2 };
      }
      return { from: p2, to: p1 };
    }

    type OpSeed =
      | { kind: "insert"; posSeed: number; text: string; mark: Mark }
      | { kind: "delete"; r1: number; r2: number }
      | { kind: "split"; posSeed: number }
      | { kind: "addMark"; r1: number; r2: number; mark: Mark }
      | { kind: "removeMark"; r1: number; r2: number; markType: MarkType }
      | { kind: "setBlockType"; bSeed: number; blockType: BlockType; level: number }
      | { kind: "setSelection"; r1: number; r2: number };

    const opSeedArb: fc.Arbitrary<OpSeed> = fc.oneof(
      fc.record({
        kind: fc.constant("insert" as const),
        posSeed: fc.nat(1000),
        text: safeTextArb,
        mark: markArb,
      }),
      fc.record({
        kind: fc.constant("delete" as const),
        r1: fc.nat(1000),
        r2: fc.nat(1000),
      }),
      fc.record({
        kind: fc.constant("split" as const),
        posSeed: fc.nat(1000),
      }),
      fc.record({
        kind: fc.constant("addMark" as const),
        r1: fc.nat(1000),
        r2: fc.nat(1000),
        mark: markArb,
      }),
      fc.record({
        kind: fc.constant("removeMark" as const),
        r1: fc.nat(1000),
        r2: fc.nat(1000),
        markType: fc.constantFrom("bold", "italic", "code", "link"),
      }),
      fc.record({
        kind: fc.constant("setBlockType" as const),
        bSeed: fc.nat(1000),
        blockType: fc.constantFrom("paragraph", "heading", "code_block"),
        level: fc.integer({ min: 1, max: 6 }),
      }),
      fc.record({
        kind: fc.constant("setSelection" as const),
        r1: fc.nat(1000),
        r2: fc.nat(1000),
      }),
    );

    fc.assert(
      fc.property(
        rawDocArb,
        fc.nat(1000),
        fc.nat(1000),
        fc.array(opSeedArb, { minLength: 1, maxLength: 30 }),
        (rawDoc, selSeed1, selSeed2, opSeeds) => {
          const initialDoc = parseDoc(rawDoc);
          const initialSelection: Selection = {
            anchor: pickPos(initialDoc, selSeed1),
            head: pickPos(initialDoc, selSeed2),
          };
          const initialState = EditorState.create({
            doc: initialDoc,
            selection: initialSelection,
          });
          const originalDocJson = JSON.stringify(initialState.doc);
          const originalSelJson = JSON.stringify(initialState.selection);

          let state = initialState;
          for (const op of opSeeds) {
            const tr = new Transaction(state.doc);
            if (op.kind === "insert") {
              const at = pickPos(tr.doc, op.posSeed);
              const blk = tr.doc.blocks[at.block];
              if (!blk) {
                throw new Error("Missing block at insert pos");
              }
              const marks = blk.type === "code_block" ? [] : [op.mark];
              tr.insertText(at, op.text, marks);
            } else if (op.kind === "delete") {
              const { from, to } = pickOrderedRange(tr.doc, op.r1, op.r2);
              const firstBlock = tr.doc.blocks[from.block];
              const lastBlock = tr.doc.blocks[to.block];
              const tailHasMarks = lastBlock?.runs.some((r) => r.marks.length > 0) ?? false;
              if (
                from.block !== to.block &&
                firstBlock?.type === "code_block" &&
                lastBlock?.type !== "code_block" &&
                tailHasMarks
              ) {
                // Joining a marked tail into a code_block would violate schema
                const at = pickPos(tr.doc, op.r1);
                tr.insertText(at, "d");
              } else {
                tr.deleteRange(from, to);
              }
            } else if (op.kind === "split") {
              const at = pickPos(tr.doc, op.posSeed);
              tr.splitBlock(at);
            } else if (op.kind === "addMark") {
              const { from, to } = pickOrderedRange(tr.doc, op.r1, op.r2);
              let hasCodeBlock = false;
              for (let b = from.block; b <= to.block; b++) {
                if (tr.doc.blocks[b]?.type === "code_block") {
                  hasCodeBlock = true;
                }
              }
              if (!hasCodeBlock && (from.block !== to.block || from.offset !== to.offset)) {
                tr.addMark(from, to, op.mark);
              } else {
                const at = pickPos(tr.doc, op.r1);
                tr.insertText(at, "x");
              }
            } else if (op.kind === "removeMark") {
              const { from, to } = pickOrderedRange(tr.doc, op.r1, op.r2);
              if (from.block !== to.block || from.offset !== to.offset) {
                tr.removeMark(from, to, op.markType);
              } else {
                const at = pickPos(tr.doc, op.r1);
                tr.insertText(at, "y");
              }
            } else if (op.kind === "setBlockType") {
              const bIdx = op.bSeed % tr.doc.blocks.length;
              const blk = tr.doc.blocks[bIdx];
              if (!blk) {
                throw new Error("Missing block at setBlockType");
              }
              const hasMarks = blk.runs.some((r) => r.marks.length > 0);
              const targetType =
                op.blockType === "code_block" && hasMarks ? "paragraph" : op.blockType;
              const attrs = targetType === "heading" ? { level: op.level } : {};
              tr.setBlockType(bIdx, targetType, attrs);
            } else {
              const at = pickPos(tr.doc, op.r1);
              tr.insertText(at, "z");
              tr.setSelection({
                anchor: pickPos(tr.doc, op.r1),
                head: pickPos(tr.doc, op.r2),
              });
            }
            state = state.apply(tr);
          }

          const finalDocJson = JSON.stringify(state.doc);
          const finalSelJson = JSON.stringify(state.selection);

          const N = opSeeds.length;
          for (let i = 0; i < N; i++) {
            const prev = undo(state);
            expect(prev).not.toBeNull();
            if (!prev) {
              throw new Error("undo returned null during property test undo phase");
            }
            state = prev;
          }

          expect(JSON.stringify(state.doc)).toBe(originalDocJson);
          expect(JSON.stringify(state.selection)).toBe(originalSelJson);

          for (let i = 0; i < N; i++) {
            const next = redo(state);
            expect(next).not.toBeNull();
            if (!next) {
              throw new Error("redo returned null during property test redo phase");
            }
            state = next;
          }

          expect(JSON.stringify(state.doc)).toBe(finalDocJson);
          expect(JSON.stringify(state.selection)).toBe(finalSelJson);
        },
      ),
      { seed: 42, numRuns: 200 },
    );
  });
});

describe("Edge cases and comprehensive unit tests", () => {
  it("deleteRange across three blocks preserves first block type and joins third block tail", () => {
    const doc = parseDoc({
      blocks: [
        { type: "heading", attrs: { level: 2 }, runs: [{ text: "First", marks: [] }] },
        { type: "code_block", attrs: {}, runs: [{ text: "Middle", marks: [] }] },
        { type: "paragraph", attrs: {}, runs: [{ text: "Last", marks: [{ type: "italic" }] }] },
      ],
    });
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(state0.doc).deleteRange(
      { block: 0, offset: 2 },
      { block: 2, offset: 2 },
    );
    const state1 = state0.apply(tr);
    expect(state1.doc.blocks).toEqual([
      {
        type: "heading",
        attrs: { level: 2 },
        runs: [
          { text: "Fi", marks: [] },
          { text: "st", marks: [{ type: "italic" }] },
        ],
      },
    ]);

    const undone = undo(state1);
    expect(undone?.doc).toEqual(doc);
  });

  it("removeMark on a range with mixed marks removes only the specified mark type and merges runs", () => {
    const doc = parseDoc({
      blocks: [
        {
          type: "paragraph",
          attrs: {},
          runs: [
            { text: "ab", marks: [{ type: "bold" }] },
            { text: "cd", marks: [{ type: "bold" }, { type: "italic" }] },
            { text: "ef", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(doc).removeMark(
      { block: 0, offset: 1 },
      { block: 0, offset: 5 },
      "italic",
    );
    const state1 = state0.apply(tr);
    expect(state1.doc.blocks[0]?.runs).toEqual([{ text: "abcdef", marks: [{ type: "bold" }] }]);

    const undone = undo(state1);
    expect(undone?.doc).toEqual(doc);
  });

  it("splitBlock at offset 0 and at end of block produces empty block runs [] and un-splits cleanly", () => {
    const doc = parseDoc({
      blocks: [{ type: "heading", attrs: { level: 3 }, runs: [{ text: "Hello", marks: [] }] }],
    });
    const state0 = EditorState.create({ doc });
    const trStart = new Transaction(doc).splitBlock({ block: 0, offset: 0 });
    expect(trStart.doc.blocks).toEqual([
      { type: "heading", attrs: { level: 3 }, runs: [] },
      { type: "heading", attrs: { level: 3 }, runs: [{ text: "Hello", marks: [] }] },
    ]);
    const state1 = state0.apply(trStart);
    expect(undo(state1)?.doc).toEqual(doc);

    const trEnd = new Transaction(doc).splitBlock({ block: 0, offset: 5 });
    expect(trEnd.doc.blocks).toEqual([
      { type: "heading", attrs: { level: 3 }, runs: [{ text: "Hello", marks: [] }] },
      { type: "heading", attrs: { level: 3 }, runs: [] },
    ]);
    const stateEnd = state0.apply(trEnd);
    expect(undo(stateEnd)?.doc).toEqual(doc);
  });

  it("link marks with different hrefs are not merged, while identical hrefs after trimming are merged", () => {
    const doc = parseDoc({
      blocks: [
        {
          type: "paragraph",
          attrs: {},
          runs: [
            { text: "One", marks: [{ type: "link", href: "https://a.example.com" }] },
            { text: "Two", marks: [{ type: "link", href: "https://b.example.com" }] },
            { text: "Three", marks: [{ type: "link", href: "  https://b.example.com  " }] },
          ],
        },
      ],
    });
    expect(doc.blocks[0]?.runs).toEqual([
      { text: "One", marks: [{ type: "link", href: "https://a.example.com" }] },
      { text: "TwoThree", marks: [{ type: "link", href: "https://b.example.com" }] },
    ]);
  });

  it("canonical mark sorting orders bold, italic, code, link", () => {
    const doc = parseDoc({
      blocks: [
        {
          type: "paragraph",
          attrs: {},
          runs: [
            {
              text: "styled",
              marks: [
                { type: "link", href: "MAILTO:user@example.com" },
                { type: "code" },
                { type: "italic" },
                { type: "bold" },
              ],
            },
          ],
        },
      ],
    });
    expect(doc.blocks[0]?.runs[0]?.marks).toEqual([
      { type: "bold" },
      { type: "italic" },
      { type: "code" },
      { type: "link", href: "MAILTO:user@example.com" },
    ]);
  });

  it("rejects newline and carriage return in insertText and parseDoc with invalid_doc", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [] }],
    });
    expect(() => new Transaction(doc).insertText({ block: 0, offset: 0 }, "a\nb")).toThrowError(
      expect.objectContaining({ code: "invalid_doc" }),
    );
    expect(() => new Transaction(doc).insertText({ block: 0, offset: 0 }, "a\rb")).toThrowError(
      expect.objectContaining({ code: "invalid_doc" }),
    );
  });

  it("validates transaction atomicity: a failing step leaves the transaction unchanged", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello", marks: [] }] }],
    });
    const tr = new Transaction(doc).insertText({ block: 0, offset: 5 }, "!");
    expect(() => tr.insertText({ block: 0, offset: 99 }, "?")).toThrowError(
      expect.objectContaining({ code: "invalid_position" }),
    );
    expect(tr.steps.length).toBe(1);
    expect(tr.doc.blocks[0]?.runs).toEqual([{ text: "Hello!", marks: [] }]);
  });

  it("mapPos handles positions before, inside, and after multi-block replacements", () => {
    const doc = parseDoc({
      blocks: [
        { type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] },
        { type: "paragraph", attrs: {}, runs: [{ text: "Second block", marks: [] }] },
      ],
    });
    const tr = new Transaction(doc).splitBlock({ block: 0, offset: 5 });
    // Before split
    expect(mapPos({ block: 0, offset: 2 }, tr.steps)).toEqual({ block: 0, offset: 2 });
    // At split
    expect(mapPos({ block: 0, offset: 5 }, tr.steps)).toEqual({ block: 1, offset: 0 });
    // After split on same block
    expect(mapPos({ block: 0, offset: 8 }, tr.steps)).toEqual({ block: 1, offset: 3 });
    // Next block shifts by +1
    expect(mapPos({ block: 1, offset: 4 }, tr.steps)).toEqual({ block: 2, offset: 4 });

    // Range deletion collapses interior positions to `from`
    const trDel = new Transaction(doc).deleteRange(
      { block: 0, offset: 2 },
      { block: 0, offset: 8 },
    );
    expect(mapPos({ block: 0, offset: 5 }, trDel.steps)).toEqual({ block: 0, offset: 2 });
    expect(mapPos({ block: 0, offset: 10 }, trDel.steps)).toEqual({ block: 0, offset: 4 });
  });

  it("apply with addToHistory: false does not push to undo stack", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "abc", marks: [] }] }],
    });
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(state0.doc).insertText({ block: 0, offset: 3 }, "!");
    const state1 = state0.apply(tr, { addToHistory: false });
    expect(state1.doc.blocks[0]?.runs[0]?.text).toBe("abc!");
    expect(undo(state1)).toBeNull();
  });

  it("setBlockType converts between block types, validates marks for code_block, and inverts on undo", () => {
    const doc = parseDoc({
      blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Heading", marks: [] }] }],
    });
    const state0 = EditorState.create({ doc });
    const tr = new Transaction(doc).setBlockType(0, "heading", { level: 2 });
    const state1 = state0.apply(tr);
    expect(state1.doc.blocks[0]?.type).toBe("heading");
    expect(state1.doc.blocks[0]?.attrs).toEqual({ level: 2 });
    expect(undo(state1)?.doc).toEqual(doc);

    // Cannot convert block with marks to code_block
    const markedDoc = parseDoc({
      blocks: [
        {
          type: "paragraph",
          attrs: {},
          runs: [{ text: "bold", marks: [{ type: "bold" }] }],
        },
      ],
    });
    expect(() => new Transaction(markedDoc).setBlockType(0, "code_block")).toThrowError(
      expect.objectContaining({ code: "schema_violation" }),
    );
  });

  it("enforces maxChars limit in parseDoc and rejects malformed inputs", () => {
    expect(() =>
      parseDoc(
        {
          blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "123456", marks: [] }] }],
        },
        { maxChars: 5 },
      ),
    ).toThrowError(expect.objectContaining({ code: "input_too_large" }));

    expect(() => parseDoc(null)).toThrowError(expect.objectContaining({ code: "invalid_doc" }));
    expect(() => parseDoc({ blocks: [] })).toThrowError(
      expect.objectContaining({ code: "schema_violation" }),
    );
    expect(() =>
      parseDoc({
        blocks: [{ type: "paragraph", attrs: { extra: 1 }, runs: [] }],
      }),
    ).toThrowError(expect.objectContaining({ code: "schema_violation" }));
    expect(() =>
      parseDoc({
        blocks: [
          {
            type: "paragraph",
            attrs: {},
            runs: [{ text: "dup", marks: [{ type: "bold" }, { type: "bold" }] }],
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_mark" }));
    expect(() =>
      parseDoc({
        blocks: [
          {
            type: "paragraph",
            attrs: {},
            runs: [{ text: "\uD800", marks: [] }],
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_doc" }));
  });
});
