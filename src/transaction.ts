import { RichTextError } from "./errors.js";
import {
  type BlockType,
  canonicalizeMarks,
  type Doc,
  deepFreeze,
  type Mark,
  type MarkType,
  type Pos,
  type Selection,
  validateBlockTypeAndAttrs,
  validatePos,
  validateRange,
  validateRunText,
  validateSelection,
} from "./model.js";
import {
  applyStep,
  createAddMarkStep,
  createRemoveMarkStep,
  createReplaceStep,
  createSetBlockTypeStep,
  type Step,
} from "./steps.js";

/**
 * Builds and validates a sequence of document steps atomically on top of a starting `Doc`.
 * Each mutating method validates its arguments before updating the transaction's state,
 * so any error leaves the transaction untouched.
 */
export class Transaction {
  private _doc: Doc;
  private readonly _steps: Step[] = [];
  private readonly _docsBefore: Doc[] = [];
  private _selection: Selection | undefined = undefined;

  /**
   * Creates a new `Transaction` starting from `doc`.
   *
   * @param doc - Starting document.
   */
  public constructor(doc: Doc) {
    if (
      typeof doc !== "object" ||
      doc === null ||
      !Array.isArray(doc.blocks) ||
      doc.blocks.length === 0
    ) {
      throw new RichTextError("invalid_doc", "Transaction requires a valid Doc");
    }
    this._doc = doc;
  }

  /**
   * Current document after all steps recorded so far.
   */
  public get doc(): Doc {
    return this._doc;
  }

  /**
   * Read-only list of steps recorded in this transaction.
   */
  public get steps(): readonly Step[] {
    return Object.freeze([...this._steps]);
  }

  /**
   * Explicit selection set on this transaction, if any.
   */
  public get selection(): Selection | undefined {
    return this._selection;
  }

  /**
   * Internal snapshot of documents before each step (used by EditorState for inversion).
   * @internal
   */
  public get docsBefore(): readonly Doc[] {
    return this._docsBefore;
  }

  private _pushStep(step: Step): void {
    const nextDoc = applyStep(this._doc, step);
    this._docsBefore.push(this._doc);
    this._steps.push(step);
    this._doc = nextDoc;
    if (this._selection !== undefined) {
      // If an explicit selection was set earlier in the transaction, map or revalidate if needed
      this._selection = undefined;
    }
  }

  /**
   * Inserts `text` with optional `marks` at position `at`.
   * Compiles to a single-fragment `replace` step.
   *
   * @param at - Insertion position.
   * @param text - Text to insert (must not contain `'\n'` or `'\r'`).
   * @param marks - Optional inline marks for the inserted text.
   */
  public insertText(at: Pos, text: string, marks?: Mark[]): this {
    const validAt = validatePos(this._doc, at);
    const validText = validateRunText(text);
    const validMarks = marks !== undefined ? canonicalizeMarks(marks, true) : [];
    const targetBlock = this._doc.blocks[validAt.block];
    if (!targetBlock) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    if (targetBlock.type === "code_block" && validMarks.length > 0) {
      throw new RichTextError("schema_violation", "code_block does not allow marks");
    }
    const runs = validText.length > 0 ? [{ text: validText, marks: validMarks }] : [];
    const step = createReplaceStep(validAt, validAt, {
      fragments: [
        {
          type: targetBlock.type,
          attrs: targetBlock.attrs,
          runs,
        },
      ],
    });
    this._pushStep(step);
    return this;
  }

  /**
   * Deletes the range `[from, to]`.
   * Compiles to a single-fragment `replace` step with an empty fragment typed like the first block.
   *
   * @param from - Start of range.
   * @param to - End of range.
   */
  public deleteRange(from: Pos, to: Pos): this {
    const { from: validFrom, to: validTo } = validateRange(this._doc, from, to);
    const firstBlock = this._doc.blocks[validFrom.block];
    if (!firstBlock) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    const step = createReplaceStep(validFrom, validTo, {
      fragments: [
        {
          type: firstBlock.type,
          attrs: firstBlock.attrs,
          runs: [],
        },
      ],
    });
    this._pushStep(step);
    return this;
  }

  /**
   * Splits the block at position `at` into two blocks of the same type and attributes.
   * Compiles to a `replace` step with two empty fragments.
   *
   * @param at - Split position.
   */
  public splitBlock(at: Pos): this {
    const validAt = validatePos(this._doc, at);
    const targetBlock = this._doc.blocks[validAt.block];
    if (!targetBlock) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    const step = createReplaceStep(validAt, validAt, {
      fragments: [
        { type: targetBlock.type, attrs: targetBlock.attrs, runs: [] },
        { type: targetBlock.type, attrs: targetBlock.attrs, runs: [] },
      ],
    });
    this._pushStep(step);
    return this;
  }

  /**
   * Adds `mark` across `[from, to]`.
   *
   * @param from - Start of range.
   * @param to - End of range.
   * @param mark - Mark to add.
   */
  public addMark(from: Pos, to: Pos, mark: Mark): this {
    const { from: validFrom, to: validTo } = validateRange(this._doc, from, to);
    const step = createAddMarkStep(validFrom, validTo, mark);
    this._pushStep(step);
    return this;
  }

  /**
   * Removes any mark of `type` across `[from, to]`.
   *
   * @param from - Start of range.
   * @param to - End of range.
   * @param type - Mark type to remove.
   */
  public removeMark(from: Pos, to: Pos, type: MarkType): this {
    const { from: validFrom, to: validTo } = validateRange(this._doc, from, to);
    const step = createRemoveMarkStep(validFrom, validTo, type);
    this._pushStep(step);
    return this;
  }

  /**
   * Sets the block type and attributes of the block at index `block`.
   *
   * @param block - Block index.
   * @param type - New block type.
   * @param attrs - Block attributes (`{ level: 1..6 }` for heading, `{}` otherwise).
   */
  public setBlockType(block: number, type: BlockType, attrs?: object): this {
    if (!Number.isInteger(block) || block < 0 || block >= this._doc.blocks.length) {
      throw new RichTextError("invalid_position", "Block index out of bounds");
    }
    const validated = validateBlockTypeAndAttrs(
      type,
      attrs ?? (type === "heading" ? undefined : {}),
    );
    const step = createSetBlockTypeStep(block, validated.type, validated.attrs);
    this._pushStep(step);
    return this;
  }

  /**
   * Sets an explicit selection on this transaction, validated against the current transaction document.
   *
   * @param sel - New selection.
   */
  public setSelection(sel: Selection): this {
    const validSel = validateSelection(this._doc, sel);
    this._selection = deepFreeze(validSel);
    return this;
  }
}
