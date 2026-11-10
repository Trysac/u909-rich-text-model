# Testing

Tests are located in `test/index.test.ts`.

## Coverage Areas

1. **Acceptance Criteria**: All 8 defined scenarios, including cross-block deletions, split/join logic, mark merging, and error handling for invalid operations (e.g., surrogate pair splits, invalid link protocols).
2. **Boundary Cases**: UTF-16 surrogate pairs, link `href` sanitization, and history overflow behavior.
3. **Property Testing**: Uses `fast-check` (seed 42, 200 runs) to verify that applying N random valid transactions followed by N undo and N redo calls restores the original document and selection state deterministically.
