import { RichTextError } from "./errors.js";
import { type Doc, deepFreeze, parseDoc, type Selection, validateSelection } from "./model.js";
import { applyStep, mapPos, type Step } from "./steps.js";
import type { Transaction } from "./transaction.js";

/**
 * Default maximum number of undo history entries.
 */
export const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Options for `EditorState.create`.
 */
export interface EditorStateConfig {
  readonly doc: Doc;
  readonly selection?: Selection;
  readonly historyLimit?: number;
}

/**
 * Options for `EditorState.apply`.
 */
export interface ApplyTransactionOptions {
  readonly addToHistory?: boolean;
}

interface HistoryEntry {
  readonly invertedSteps: readonly Step[];
  readonly selectionBefore: Selection;
}

/**
 * Immutable editor state holding the current `Doc`, `Selection`, and bounded undo/redo stacks.
 */
export class EditorState {
  /**
   * Current canonical document.
   */
  public readonly doc: Doc;

  /**
   * Current selection.
   */
  public readonly selection: Selection;

  private readonly _historyLimit: number;
  private readonly _undoStack: readonly HistoryEntry[];
  private readonly _redoStack: readonly HistoryEntry[];

  private constructor(
    doc: Doc,
    selection: Selection,
    historyLimit: number,
    undoStack: readonly HistoryEntry[],
    redoStack: readonly HistoryEntry[],
  ) {
    this.doc = doc;
    this.selection = selection;
    this._historyLimit = historyLimit;
    this._undoStack = undoStack;
    this._redoStack = redoStack;
    Object.freeze(this);
  }

  /**
   * Creates a new `EditorState`.
   *
   * @param opts - State creation options (`doc`, optional `selection`, optional `historyLimit`).
   * @returns A frozen `EditorState`.
   */
  public static create(opts: EditorStateConfig): EditorState {
    if (typeof opts !== "object" || opts === null) {
      throw new RichTextError("invalid_doc", "EditorState.create requires an options object");
    }
    const canonicalDoc = parseDoc(opts.doc);
    const historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isInteger(historyLimit) || historyLimit < 0) {
      throw new RichTextError("invalid_doc", "historyLimit must be a non-negative integer");
    }
    const rawSelection = opts.selection ?? {
      anchor: { block: 0, offset: 0 },
      head: { block: 0, offset: 0 },
    };
    const validSelection = deepFreeze(validateSelection(canonicalDoc, rawSelection));
    return new EditorState(canonicalDoc, validSelection, historyLimit, [], []);
  }

  /**
   * Applies a `Transaction` to this state, returning a new `EditorState`.
   *
   * @param tr - Transaction to apply.
   * @param opts - Options (`addToHistory` defaults to `true`).
   * @returns Updated `EditorState`.
   */
  public apply(tr: Transaction, opts?: ApplyTransactionOptions): EditorState {
    if (typeof tr !== "object" || tr === null || !Array.isArray(tr.steps)) {
      throw new RichTextError("invalid_doc", "Invalid transaction");
    }

    const steps = tr.steps;
    let currentDoc = this.doc;
    const inverted: Step[] = [];

    for (const step of steps) {
      const inv = step.invert(currentDoc);
      currentDoc = applyStep(currentDoc, step);
      inverted.push(inv);
    }
    inverted.reverse();

    const nextSelection: Selection =
      tr.selection !== undefined
        ? deepFreeze(validateSelection(currentDoc, tr.selection))
        : deepFreeze({
            anchor: mapPos(this.selection.anchor, steps),
            head: mapPos(this.selection.head, steps),
          });

    const addToHistory = opts?.addToHistory !== false;
    if (steps.length > 0 && addToHistory) {
      let nextUndo: HistoryEntry[] = [
        ...this._undoStack,
        {
          invertedSteps: Object.freeze(inverted),
          selectionBefore: this.selection,
        },
      ];
      if (nextUndo.length > this._historyLimit) {
        nextUndo = nextUndo.slice(nextUndo.length - this._historyLimit);
      }
      return new EditorState(
        currentDoc,
        nextSelection,
        this._historyLimit,
        Object.freeze(nextUndo),
        [],
      );
    }

    return new EditorState(
      currentDoc,
      nextSelection,
      this._historyLimit,
      this._undoStack,
      this._redoStack,
    );
  }

  /**
   * Internal undo implementation.
   * @internal
   */
  public _undo(): EditorState | null {
    if (this._undoStack.length === 0) {
      return null;
    }
    const entry = this._undoStack[this._undoStack.length - 1];
    if (!entry) {
      return null;
    }
    let currentDoc = this.doc;
    const redoInverted: Step[] = [];
    for (const step of entry.invertedSteps) {
      const inv = step.invert(currentDoc);
      currentDoc = applyStep(currentDoc, step);
      redoInverted.push(inv);
    }
    redoInverted.reverse();

    const nextUndo = Object.freeze(this._undoStack.slice(0, -1));
    const nextRedo = Object.freeze([
      ...this._redoStack,
      {
        invertedSteps: Object.freeze(redoInverted),
        selectionBefore: this.selection,
      },
    ]);

    return new EditorState(
      currentDoc,
      entry.selectionBefore,
      this._historyLimit,
      nextUndo,
      nextRedo,
    );
  }

  /**
   * Internal redo implementation.
   * @internal
   */
  public _redo(): EditorState | null {
    if (this._redoStack.length === 0) {
      return null;
    }
    const entry = this._redoStack[this._redoStack.length - 1];
    if (!entry) {
      return null;
    }
    let currentDoc = this.doc;
    const undoInverted: Step[] = [];
    for (const step of entry.invertedSteps) {
      const inv = step.invert(currentDoc);
      currentDoc = applyStep(currentDoc, step);
      undoInverted.push(inv);
    }
    undoInverted.reverse();

    const nextRedo = Object.freeze(this._redoStack.slice(0, -1));
    let nextUndo: HistoryEntry[] = [
      ...this._undoStack,
      {
        invertedSteps: Object.freeze(undoInverted),
        selectionBefore: this.selection,
      },
    ];
    if (nextUndo.length > this._historyLimit) {
      nextUndo = nextUndo.slice(nextUndo.length - this._historyLimit);
    }

    // Compute the mapped selection after re-applying the forward steps, or if the transaction
    // had set an explicit selection, `entry.selectionBefore` when undone was the selection held
    // right after that transaction!
    // Wait: in `_undo()`, we pushed `selectionBefore: this.selection` (which was the post-transaction selection)
    // onto `_redoStack`. So `entry.selectionBefore` IS the exact selection after the transaction!
    return new EditorState(
      currentDoc,
      entry.selectionBefore,
      this._historyLimit,
      Object.freeze(nextUndo),
      nextRedo,
    );
  }
}

/**
 * Undoes the most recent history entry in `state`, returning the restored `EditorState`,
 * or `null` when the undo history is empty.
 *
 * @param state - Current editor state.
 * @returns Restored `EditorState` or `null`.
 */
export function undo(state: EditorState): EditorState | null {
  if (!(state instanceof EditorState)) {
    throw new RichTextError("invalid_doc", "undo requires an EditorState instance");
  }
  return state._undo();
}

/**
 * Redoes the most recently undone history entry in `state`, returning the restored `EditorState`,
 * or `null` when the redo history is empty.
 *
 * @param state - Current editor state.
 * @returns Restored `EditorState` or `null`.
 */
export function redo(state: EditorState): EditorState | null {
  if (!(state instanceof EditorState)) {
    throw new RichTextError("invalid_doc", "redo requires an EditorState instance");
  }
  return state._redo();
}
