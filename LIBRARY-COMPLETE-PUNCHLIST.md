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

## Internal QA Dashboard

| QA Area | Status |
| --- | --- |
| Automated QA | Complete |
| Navigation QA | Complete |
| Visual QA | Complete |
| Story Journey QA | Ready |
| Character Journey QA | Ready |
| Experience QA | Ready |

## Manual Internal QA Sessions

### Walkthrough 1 - Can I get anywhere?

Status: Complete

Evidence:

- Pages scanned: 293
- Pages missing site navigation: 0
- Pages missing footer: 0
- Header/navigation links checked: 2050
- Navigation link resolution failures: 0
- Internal links checked: 4421
- Internal link failures: 3 (all known script-template artifacts already classified as non-visitor-facing noise)

### Walkthrough 2 - Can I read comfortably?

Status: Complete

Evidence (prep scan):

- Pages scanned: 293
- Long title candidates: 6 (down from 37 after label normalization)
- Long H1 candidates: 10 (down from 41 after label normalization)
- Image-heavy candidates: 1 (`characters.html`)

Fix completed in this pass:

- Normalized oversized entity display labels in universal entity pages so generated `<title>` and `<h1>` values remain readable.
- Fixed small-screen header/navigation wrapping to remove horizontal overflow on core pages.

Validation checks completed:

- Desktop + mobile visual sweep on key visitor pages: no horizontal overflow.
- 200% zoom overflow check on core landing pages: no horizontal overflow.

Exception review completed (remaining long label candidates):

- Reviewed remaining title and heading outliers across desktop, tablet, mobile, and 200% zoom.
- No clipped headings, no horizontal heading overflow, and no readability blockers found.
- Remaining longer labels are descriptive by content and accepted as visitor-readable.

Scope:

- Desktop pass for spacing, wrapping, image cropping, and typography consistency.
- Tablet and mobile pass for responsive flow and readability.
- 200% zoom pass for readability and reflow behavior.
- Spot-check long titles, long character names, and large galleries.

### Walkthrough 3 - Does the world feel consistent?

Status: Ready

Scope:

- Review cross-page tone, color, and artwork consistency.
- Confirm pages feel like one shared world.

### Walkthrough 4 - Can I complete a journey?

Status: Ready

Scope:

- Validate complete visitor journeys across page types.
- Capture friction points between transitions, not only within pages.

### Walkthrough 5 - Would I stay?

Status: Ready

Scope:

- Browse freely for 20 to 30 minutes with no checklist.
- Record whether the experience invites continued exploration.

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
