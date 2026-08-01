# Library Complete Punch List

Execution document for Promise Gate and Library Complete readiness.

Generated from a Promise Audit of `build-recovery/` on 2026-08-01.

## Current Readiness Snapshot

- HTML pages scanned: 293
- True missing internal destinations: 0
- CTA binding failures (`href="#"` / empty): 0
- Placeholder or coming-soon signals detected by scan: 2 pages
- Library Complete status: BLOCKED

## Promise-Centered Priority

### High Priority (Blocks Family Recognition and Promise Gate)

No open High priority items.

Completed in this pass:

- Removed 19 broken legacy character destination links by rendering the legacy button only when a destination file exists.
- Rebuilt the site and re-ran Promise Audit to confirm true missing internal destinations are now zero.

### Medium Priority (Promise Clarity)

| Page | Promise | Status | Missing | Priority |
| --- | --- | --- | --- | --- |
| books/hh-b-0006.html | Read the story / book detail completeness | Incomplete | Record has only one DOCX indexed, no buy links, no reading asset path presented | Medium |
| books.html (HH-B-0006 card) | Read/Buy readiness signal | Incomplete | "PDF not discovered yet" and "Amazon listing not linked yet" | Medium |
| books.html (HH-E-0007 card) | Buy flow consistency | Incomplete | Amazon listing not linked yet | Medium |

### Medium Priority (Placeholder Experience)

| Page | Promise | Status | Missing | Priority |
| --- | --- | --- | --- | --- |
| entities/resource/reading-order-reading-order.html | Learn more | Placeholder | "placeholder resource" text and "coming soon" copy still present | Medium |

### Medium Priority (Scan Signals To Confirm)

| Page | Promise | Status | Missing | Priority |
| --- | --- | --- | --- | --- |
| books.html | Read/Buy readiness messaging | Confirm | Scan flags "not discovered yet" and "not linked yet" wording; verify these are intentional and visitor-safe | Medium |

## Notes On Audit Noise (Not Action Items)

These were detected by raw link scanning but are script-template strings, not real broken visitor links:

- books.html: `' + escapeHtml(href) + '`
- map.html: `' + escapeHtml(href) + '`
- index.html: `' + selected.featureHref + '`

## Execution Sequence (Operational)

1. Resolve or intentionally suppress incomplete book promises (HH-B-0006 and HH-E-0007).
2. Replace placeholder content on the reading-order resource page.
3. Verify `books.html` readiness language for visitor-safe intent.
4. Re-run Promise Audit and confirm:
   - 0 missing internal destinations.
   - 0 blocking placeholder promise pages.
5. Run internal QA pass, then proceed to Grandma stage.

## Definition of Done For This Punch List

This punch list is complete when all rows are either:

- Done (promise kept), or
- Intentionally deferred with visitor-safe language that does not create a broken promise.

No High priority items may remain open before Grandma visit.
