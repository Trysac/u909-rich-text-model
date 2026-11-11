# Architecture

`@trysac/rich-text-model` is a pure, deterministic, framework-free library for rich text document modeling. It decouples document schema, editing operations, and history from the DOM or view layer.

## Modules

- `src/errors.ts`: Error handling definitions and `RichTextError` base class.
- `src/model.ts`: Document data structures (`Doc`, `Block`, `Run`, `Mark`, `Pos`, `Selection`), canonicalization rules, and `parseDoc`.
- `src/steps.ts`: Invertible primitives (`replace`, `addMark`, `removeMark`, `setBlockType`), step application, slice extraction, and mapping.
- `src/transaction.ts`: `Transaction` atomic builder that validates input before execution.
- `src/state.ts`: Immutable `EditorState`, `undo`, and `redo` with a bounded history stack.

## Canonical Form & Invariants

Every `Doc` is immutable and in canonical form:
1. Empty runs are dropped; empty blocks have `runs: []`.
2. Adjacent runs with identical marks are merged.
3. Marks on a run are deduplicated and sorted: `bold`, `italic`, `code`, `link`.
4. All objects are deep-frozen.
