/**
 * Public entry point of `@trysac/rich-text-model`.
 *
 * Framework-free rich text document model with a schema, invertible steps,
 * transactions, mapped selections and a bounded undo/redo history.
 */

export { RichTextError, type RichTextErrorCode } from "./errors.js";
export {
  type Block,
  type BlockAttrs,
  type BlockType,
  DEFAULT_MAX_BLOCKS,
  DEFAULT_MAX_CHARS,
  type Doc,
  type EmptyAttrs,
  type HeadingAttrs,
  MAX_HREF_LENGTH,
  type Mark,
  type MarkType,
  type ParseDocLimits,
  type Pos,
  parseDoc,
  type Run,
  type Selection,
} from "./model.js";
export {
  type ApplyTransactionOptions,
  DEFAULT_HISTORY_LIMIT,
  EditorState,
  type EditorStateConfig,
  redo,
  undo,
} from "./state.js";
export {
  type AddMarkStep,
  type Fragment,
  mapPos,
  type RemoveMarkStep,
  type ReplaceStep,
  type SetBlockTypeStep,
  type Slice,
  type Step,
} from "./steps.js";
export { Transaction } from "./transaction.js";
