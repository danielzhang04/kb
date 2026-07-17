/**
 * `workOrderOf` — pure `## Work order` body extractor, split out of `challenge.ts` (D2.2) so it can be
 * shared by the browser Approvals corroboration panel WITHOUT dragging `challenge.ts`'s `node:crypto`
 * import into the client bundle. Behaviour is byte-for-byte identical to the original definition; the
 * authoritative challenge/content-hash construction stays in `challenge.ts` and continues to call this.
 *
 * A byte-for-byte mirror of the fleet channel's extractor (`scripts/approvals.work_order_of`) so both
 * approval channels agree on exactly what "the body" is — see `challenge.ts` for the full canonical
 * preimage spec that consumes this. Do NOT change the extraction rules here without updating D2.3's
 * Python verifier in lockstep.
 */

/**
 * The exact line boundaries Python's `str.splitlines()` recognizes, so `workOrderOf` splits a card
 * body identically to `scripts/approvals.work_order_of` (which uses `splitlines()`). `\r\n` MUST lead
 * the alternation so a CRLF is consumed as ONE boundary, not two. (Card bodies the verifier sees are
 * already `\n`-normalised by `cards.parse_text`; this fuller set keeps the TS issuer byte-identical
 * even if it is ever handed a raw CRLF / unusual-separator body.)
 */
const PY_LINE_BOUNDARIES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `str.splitlines()` semantics: split on the boundaries above, and — like Python — do NOT emit a
 * trailing empty element when the string ends with a boundary. */
function pySplitlines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split(PY_LINE_BOUNDARIES);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Extract the FIRST top-level `## Work order` section, fence-aware. A byte-for-byte mirror of
 * `scripts/approvals.work_order_of` (the fleet channel's extractor) so both channels agree on what
 * "the body" is: a column-0 ``` toggles fenced state; fenced lines are never headings; only a
 * column-0 unfenced `## ` line is a heading; capture runs from the line after the exact
 * `## Work order` heading to the next such heading (or EOF); later occurrences do not re-arm; the
 * captured lines are joined with `\n` and `.trim()`med. Throws if there is no `## Work order` section
 * (the verifier treats that as a fail-closed rejection).
 */
export function workOrderOf(body: string): string {
  const lines: string[] = [];
  let capture = false;
  let fenced = false;
  let found = false;
  let done = false;
  for (const line of pySplitlines(body)) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      if (capture) lines.push(line);
      continue;
    }
    const isHeading = !fenced && line.startsWith('## ');
    if (isHeading) {
      if (capture) {
        capture = false;
        done = true;
      } else if (!done && line === '## Work order') {
        capture = true;
        found = true;
      }
      continue;
    }
    if (capture) lines.push(line);
  }
  if (!found) throw new Error("no '## Work order' section");
  return lines.join('\n').trim();
}
