/**
 * The `{{placeholder}}` marker pattern — whitespace-tolerant inside the braces
 * (`{{ name }}` matches `name`), capturing a dotted identifier path
 * (`{{outcome.total}}` captures `outcome.total`). Global so a `replace`
 * substitutes every occurrence.
 *
 * @remarks
 * A global `RegExp` carries a mutable `lastIndex`, so a scan must build a FRESH
 * `RegExp` from this one's `source` + `flags` (never reuse this instance's
 * `lastIndex` directly) — the pattern here is the canonical definition, not a
 * shared scanner.
 */
export const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*}}/g
