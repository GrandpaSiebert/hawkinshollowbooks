# Library Complete Punch List

Execution document for Promise Gate and Library Complete readiness.

Generated from a Promise Audit of `build-recovery/` on 2026-08-01.

## Current Readiness Snapshot

- HTML pages scanned: 293
- True missing internal destinations: 0
- CTA binding failures (`href="#"` / empty): 0
- Placeholder or coming-soon signals detected by scan: 0
- Library Complete status: Promise Audit pass complete; proceed to Internal QA

## Current Phase Status

- Library Complete: Green (Promise Audit passed)
- Internal QA: Yellow (in progress)
- Progressive Visitor Rollout: Waiting on QA completion

## Internal QA Baseline (Automated)

Baseline generated from `generated/internal-qa-baseline.json`:

- Pages scanned: 293
- Missing viewport tags: 0
- Missing html `lang` attribute: 0
- Images missing `alt`: 0
- Missing local download targets: 0
- Download-labeled links with `href="#"`: 0

Manual QA still required:

- Desktop walkthrough
- Mobile walkthrough
- Accessibility review (keyboard + screen-reader sanity pass)
- Download verification by click path
- Full-site experience walkthrough

## Promise-Centered Priority

### High Priority (Blocks Family Recognition and Promise Gate)

No open High priority items.

Completed in this pass:

- Removed 19 broken legacy character destination links by rendering the legacy button only when a destination file exists.
- Rebuilt the site and re-ran Promise Audit to confirm true missing internal destinations are now zero.

### Medium Priority (Promise Clarity)

No open Medium promise-clarity breaks.

Completed in this pass:

- Reworded book-card availability text to visitor-safe release wording.
- Reworded missing retail-link text to avoid broken-promise language.
- Updated detail-page fallback copy for books without workbook matches.

### Medium Priority (Placeholder Experience)

No open Medium placeholder-experience breaks.

Completed in this pass:

- Replaced placeholder text in reading-order resource data.
- Replaced "coming soon" fallback language on universal entity pages.

### Medium Priority (Scan Signals To Confirm)

No open scan-signal confirmations.

## Notes On Audit Noise (Not Action Items)

These were detected by raw link scanning but are script-template strings, not real broken visitor links:

- books.html: `' + escapeHtml(href) + '`
- map.html: `' + escapeHtml(href) + '`
- index.html: `' + selected.featureHref + '`

## Execution Sequence (Operational)

1. Resolve or intentionally suppress incomplete book promises (HH-B-0006 and HH-E-0007).
2. Replace placeholder content on the reading-order resource page.
3. Re-run Promise Audit and confirm:
   - 0 missing internal destinations.
   - 0 blocking placeholder promise pages.
4. Run internal QA pass, then proceed to Grandma stage.

## Definition of Done For This Punch List

This punch list is complete when all rows are either:

- Done (promise kept), or
- Intentionally deferred with visitor-safe language that does not create a broken promise.

No High priority items may remain open before Grandma visit.
