# Compile structural edits to canonical replace steps and mark edits to slice-inverted steps

Status: accepted (generated, pending human review)

## Context

Rich text editors require every document mutation to be invertible so that undo/redo restores the exact prior document (including block types, attributes, and inline marks) and maps selections deterministically.

## Decision

Represent structural text and block edits (`insertText`, `deleteRange`, `splitBlock`) as a single `replace` step operating on typed block fragments (`Slice`), where the first fragment merges with the start block's head keeping the start block's type and the last fragment merges with the end block's tail keeping the last fragment's type. Invert `replace`, `addMark`, and `removeMark` steps by extracting the original slice over the affected range from `docBefore`, and normalize runs into canonical deep-frozen form after every step.

## Consequences

Every forward and inverse step produces a canonical deep-frozen `Doc`, position mapping (`mapPos`) only needs to inspect `replace` steps, and `N` transactions followed by `N` undos and `N` redos are guaranteed to round-trip `JSON.stringify(doc)` and `selection` identically.
