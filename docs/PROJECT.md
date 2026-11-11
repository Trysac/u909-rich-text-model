# Project

## Objective

Provide an enterprise-grade, pure TypeScript rich text document model for server or client use.

## Scope

- Flat block structure (`paragraph`, `heading` levels 1..6, `code_block`).
- Inline runs with canonical marks (`bold`, `italic`, `code`, `link`).
- Invertible steps (`replace`, `addMark`, `removeMark`, `setBlockType`).
- Atomic `Transaction` builder and position mapping.
- Immutable `EditorState` with bounded `undo` and `redo`.

## Out of Scope

- Nested blocks (lists, tables, blockquotes).
- Rendering, DOM, or contenteditable bindings.
- Collaborative rebasing.
- Markdown import/export.

## Factory run u909 (measured from API usage)

| Date (UTC) | Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | generation | google/gemini-4-argon | yes | 6100 | 26555 | 0 | 0 | 0.5555 |
| 2026-11-10 | fix-2 | google/gemini-3.8-flash | no | 221723 | 626 | 0 | 118709 | 0.1775 |
| 2026-11-10 | audit | google/gemini-3.8-flash | no | 418804 | 1061 | 0 | 1093247 | 0.4001 |
| 2026-11-10 | docs | google/gemini-3.1-flash-lite | no | 24358 | 1874 | 0 | 0 | 0.0089 |

Total: $1.1420. Prices: vertex line, as measured by its adapter. Providers serve the current version of each model id, so the date tells which version answered; versions, launch stages and price sources per line are in the factory's model register (docs/MODELS.md).
