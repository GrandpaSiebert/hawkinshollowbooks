# Library Complete Punch List

Execution document for Promise Gate and Library Complete readiness.

Generated from a Promise Audit of `build-recovery/` on 2026-08-01.

## Current Readiness Snapshot

- HTML pages scanned: 293
- True missing internal destinations: 19
- CTA binding failures (`href="#"` / empty): 0
- Placeholder or coming-soon signals that affect promises: 2 pages
- Library Complete status: BLOCKED

## Promise-Centered Priority

### High Priority (Blocks Family Recognition and Promise Gate)

| Page | Promise | Status | Missing | Priority |
| --- | --- | --- | --- | --- |
| entities/character/ara-aralynn-fox.html | Meet this character | Broken | characters/aralynn-fox.html missing | High |
| entities/character/bax-baxter-badger.html | Meet this character | Broken | characters/baxter-badger.html missing | High |
| entities/character/blain-blain-turtle.html | Meet this character | Broken | characters/blain-turtle.html missing | High |
| entities/character/bra-brandon-rabbit.html | Meet this character | Broken | characters/brandon-rabbit.html missing | High |
| entities/character/cal-callen-crow.html | Meet this character | Broken | characters/callen-crow.html missing | High |
| entities/character/emm-emmitt-armadillo.html | Meet this character | Broken | characters/emmitt-armadillo.html missing | High |
| entities/character/gar-garrett-hedgehog.html | Meet this character | Broken | characters/garrett-hedgehog.html missing | High |
| entities/character/gma-grandma-siebert.html | Meet this character | Broken | characters/grandma-siebert.html missing | High |
| entities/character/gpa-grandpa.html | Meet this character | Broken | characters/grandpa.html missing | High |
| entities/character/har-harlie-mouse.html | Meet this character | Broken | characters/harlie-mouse.html missing | High |
| entities/character/hay-haylee-prairie-dog.html | Meet this character | Broken | characters/haylee-prairie-dog.html missing | High |
| entities/character/kayla-kayla-rabbit.html | Meet this character | Broken | characters/kayla-rabbit.html missing | High |
| entities/character/lex-lex-hedgehog.html | Meet this character | Broken | characters/lex-hedgehog.html missing | High |
| entities/character/lil-lillian-squirrel.html | Meet this character | Broken | characters/lillian-squirrel.html missing | High |
| entities/character/mimi-mimi-hawkins.html | Meet this character | Broken | characters/mimi-hawkins.html missing | High |
| entities/character/pop-pop-pop-farmer-hawkins.html | Meet this character | Broken | characters/pop-pop-farmer-hawkins.html missing | High |
| entities/character/sky-skylin-crow.html | Meet this character | Broken | characters/skylin-crow.html missing | High |
| entities/character/trinity-trinity-egret.html | Meet this character | Broken | characters/trinity-egret.html missing | High |
| entities/character/zyl-zylar-squirrel.html | Meet this character | Broken | characters/zylar-squirrel.html missing | High |

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

## Notes On Audit Noise (Not Action Items)

These were detected by raw link scanning but are script-template strings, not real broken visitor links:

- books.html: `' + escapeHtml(href) + '`
- map.html: `' + escapeHtml(href) + '`
- index.html: `' + selected.featureHref + '`

## Execution Sequence (Operational)

1. Fix all 19 broken character destinations.
2. Resolve or intentionally suppress incomplete book promises (HH-B-0006 and HH-E-0007).
3. Replace placeholder content on the reading-order resource page.
4. Re-run Promise Audit and confirm:
   - 0 missing internal destinations.
   - 0 blocking placeholder promise pages.
5. Run internal QA pass, then proceed to Grandma stage.

## Definition of Done For This Punch List

This punch list is complete when all rows are either:

- Done (promise kept), or
- Intentionally deferred with visitor-safe language that does not create a broken promise.

No High priority items may remain open before Grandma visit.
