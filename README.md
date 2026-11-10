# @trysac/rich-text-model

Framework-free rich text document model with a schema, invertible steps, transactions, mapped selections, and a bounded undo/redo history.

## The Problem

Editors built on contenteditable need a document model that is not the DOM: a schema that rejects invalid content, edits expressed as steps that can be inverted, selections that follow edits, and an undo history that restores the exact previous document. Full editor frameworks bundle all of this with a view layer, making them difficult to test in isolation. This library is the model alone, pure and deterministic, allowing any view or server to share the same logic.

## Installation

```bash
npm install @trysac/rich-text-model
```

## Usage

```ts
import { EditorState, parseDoc, redo, Transaction, undo } from "@trysac/rich-text-model";

const doc = parseDoc({ blocks: [{ type: "paragraph", attrs: {}, runs: [{ text: "Hello world", marks: [] }] }] });
const state0 = EditorState.create({ doc });
const tr = new Transaction(state0.doc).insertText({ block: 0, offset: 5 }, ",");
const state1 = state0.apply(tr);
const undone = undo(state1)!;
const redone = redo(undone)!;
```

## Public API Summary

- `parseDoc(json: unknown, limits?: { maxBlocks?: number, maxChars?: number }): Doc`: Validates untrusted JSON and returns a canonical, deep-frozen `Doc`.
- `Transaction`: Atomic builder for `insertText`, `deleteRange`, `splitBlock`, `addMark`, `removeMark`, `setBlockType`, and `setSelection`.
- `EditorState`: Immutable state container created via `EditorState.create({ doc, selection?, historyLimit? })` and updated via `state.apply(tr, opts?)`.
- `undo(state)` / `redo(state)`: Navigates history stacks.
- `mapPos(pos, steps)`: Maps a `{ block, offset }` position through a step sequence.
- `RichTextError`: Exception with stable codes: `'invalid_position' | 'schema_violation' | 'invalid_mark' | 'input_too_large' | 'invalid_doc'`.

## Why not ProseMirror?

A small, dependency-free, flat model whose invertibility is property-tested.

## Security

See [docs/SECURITY.md](docs/SECURITY.md).
