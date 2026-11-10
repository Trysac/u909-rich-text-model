# Security & Threat Model

`@trysac/rich-text-model` processes untrusted document JSON and edit operations.

## Controls

- **Resource exhaustion**: `parseDoc` enforces `maxBlocks` (default 10,000) and `maxChars` (default 1,000,000), throwing `'input_too_large'`. History is capped at `historyLimit` (default 100).
- **XSS via `href`**: Link marks validate `href` via regex `^(https?:|mailto:)` (case-insensitive) after trimming, limited to 2,048 characters. Rejects `javascript:`, `data:`, `vbscript:`.
- **Injection/Pollution**: `parseDoc` accepts only plain objects (Object prototype or null) and returns deep-frozen objects, preventing prototype pollution.
- **Safe Error Handling**: `RichTextError` truncates messages to 180 characters, avoiding echo of untrusted payloads.
