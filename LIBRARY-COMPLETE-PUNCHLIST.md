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
| Promise Audit | Complete |
| Automated QA | Complete |
| Session 1 Navigation | Complete |
| Session 2 Visual | Complete |
| Session 3 Story Experience | Complete |
| Session 4 Character Journey | Complete |
| Session 5 Experience | Complete |

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

### Walkthrough 3 - Story Experience (representative sample)

Status: Complete

Session 3 guardrail:

- Complete all six representative stories before creating any action items.

Scope:

- Read a representative set in a first-visit mindset (no developer lens) and intentionally jump formats:
   - Storybook
   - Second Reader
   - Tender Times
   - Holiday Story
   - Growing Together
   - First Reader
- After each story, answer:
   - What did I want to do next?
   - Did I naturally want to click something else?
   - Was the next step obvious?
   - Did anything interrupt the emotional flow?
   - Did I feel invited to keep exploring?
- Treat positive findings as first-class evidence, not only problems.
- If an observation starts with "I expected...", keep it exactly as written and defer any action decision until pattern review across multiple stories.

Session 3 execution rhythm:

1. Experience the story naturally.
2. Record first reaction.
3. Record whether I wanted to continue.
4. Record what I wanted to do next.
5. Record why.
6. Finish all six stories, then look for recurring patterns before deciding whether any action is needed.

After all six entries are complete, pattern-check with prompts like:

- Did three or more stories show the same hesitation?
- Did several stories naturally lead to another click?
- Did one story consistently feel different from the rest?

Session 3 lightweight log (not every observation becomes a task):

| Story | First Reaction | Continue? | What did I want to do next? | Action? | Why? |
| --- | --- | --- | --- | --- | --- |
| Spencer's First Friend (Storybook) | "I landed on a catalog record, not a story-reading page." | Yes | Find where to actually read the story in-page. |  | The page is metadata-heavy (ID/series/files) and did not immediately provide story immersion. |
| The Summary Mystery (Second Reader) | "I paused; this feels like library indexing instead of a reader journey." | Yes | Return to Books and look for a more narrative entry point. |  | Primary content is record fields and discovered files, so the emotional flow starts late. |
| Alice Mole and the Anniversary Star Wish (Tender Times) | "I expected a comforting story opening, but saw technical record details first." | Yes | Look for character context before purchase links. |  | The first-view hierarchy prioritizes catalog metadata over story invitation cues. |
| Austin Turtle's Independence Day Quilt Square (Holiday Story) | "I felt informed, but not yet pulled into the holiday mood." | Yes | Find another Holiday Story page hoping for a stronger narrative handoff. |  | Useful publication details are present, but emotional tone is minimal at the top of page. |
| The Healthy Heart Walk (Growing Together) | "I understood the catalog facts quickly, then stalled." | Yes | Go back to Books and continue browsing series-level entries. |  | The structure is clear, but next-step momentum came from site navigation, not story pull-forward. |
| Spencer's Sound Trail (First Reader) | "I recognized consistency, but the experience still reads as an index page." | Yes | Meet Spencer on Characters after seeing the title. |  | Character curiosity appeared, but mostly from title recognition rather than on-page narrative content. |

Session 3 success metric:

- Did the story naturally pull me into another part of Hawkins Hollow?

Session 3 representative run summary (2026-07-31):

- Representative stories reviewed: 6
- Pulled Forward: 1
- Paused: 5
- Exited: 0
- Recurring expectations observed:
   - "I expected" style expectation: story-opening cues before catalog metadata (seen across multiple entries)
   - Desire for narrative handoff to character/series exploration without relying on back-navigation
- Action items: Deferred until pattern review complete.

Cross-session interpretation hold:

- Do not promote Session 3 patterns into implementation tasks until Walkthrough 4 evidence is complete.
- Treat current interpretation as a pattern candidate to validate across character-journey observations.

Post-session synthesis scaffold (after Walkthrough 5):

| Pattern | Stories | Strength |
| --- | --- | --- |
| Pulled into another story | 1/6 | Weak |
| Paused on catalog-first detail pages | 5/6 | Strong |
| Exited | 0/6 | None |
| Wanted to meet characters | Recurred in Session 3 and Session 4 pathways | Emerging |
| Wanted Companion Pack | Not observed as a recurring pull-forward action in this sample | Unknown |

Synthesis note:

- Keep this table evidence-only until all manual sessions are complete.

Session 3 pattern synthesis (observation only):

- Evidence type: qualitative sample from six representative stories; useful for pattern candidates, not standalone design decisions.

1. What made me keep reading?

Observed strengths:

- Consistent page structure created confidence.
- Navigation remained predictable.
- No hard dead ends interrupted exploration.
- Hawkins Hollow identity remained recognizable across the representative sample.

Evidence status: Recurring across the sample.

2. Where did I consistently pause?

Recurring observation:

- Readers frequently paused on book detail pages because first view emphasized catalog information before story invitation.

Important distinction:

- Pause did not become exit.
- Readers were still willing to continue.
- Momentum often came from navigation rather than immediate story immersion.

Evidence status: Strong recurring pattern in Session 3 sample.

3. What expectations appeared more than once?

Recurring expectations observed:

- Wanting to move deeper into the story world.
- Wanting character context sooner.
- Expecting emotional invitation before descriptive catalog information.

Interpretation guardrail:

- Keep these as observations until Walkthrough 4 and Walkthrough 5 confirm or weaken the same expectations.

4. What surprised me in a positive way?

Positive recurring themes:

- Predictable navigation.
- Structural consistency.
- Trust from absence of broken promises.
- Confidence that another meaningful destination existed.

Key distinction:

- Paused does not equal Exited.

Session 3 outcome snapshot:

- Pulled Forward: 1
- Paused: 5
- Exited: 0

Pattern summary candidate (not yet an action):

- Book detail experience currently behaves more like a catalog entry than a story-opening experience, producing pauses more often than exits.
- Next validation question: Does Walkthrough 4 show the same pause-without-exit pattern?

### Walkthrough 4 - Can I complete a journey?

Status: Complete

Scope:

- Validate complete visitor journeys across page types.
- Capture friction points between transitions, not only within pages.

Walkthrough 4 representative journey log (observation only):

| Journey | First Reaction | Continue? | What did I want to do next? | Why? |
| --- | --- | --- | --- | --- |
| Community -> Explore Friendships -> Books (#library-search) | "This felt like a clear handoff." | Yes | Start searching names/series in the library view. | The transition preserved context and delivered an immediate next action. |
| Community -> Meet Characters -> Alice Mole (character page) | "Warm introduction, then a pause." | Yes | Return to characters or use top navigation to continue. | Character detail page in this route had minimal onward cues beyond back/nav links. |
| Map -> 1 Red Barn Gate (entity environment) | "This invited me to keep wandering." | Yes | Follow suggested next places/characters from the page. | "Where would you like to wander next?" created a strong onward invitation. |
| Red Barn Gate -> Grandpa (entity character) | "Dense, but connected." | Yes | Open one of the linked relationships/environments next. | High-link connection graph supported continuation even with canon-heavy content. |

Walkthrough 4 outcome snapshot:

- Pulled Forward: 3
- Paused: 1
- Exited: 0

Cross-session evidence update:

- Session 3 candidate (catalog-first pause) appears strong on book detail routes.
- Session 4 shows stronger momentum on map/entity routes with explicit onward prompts.
- Session 4 does not indicate systemic abandonment; continuation remained intact.

### Walkthrough 5 - Would I stay?

Status: Complete

Scope:

- Browse freely for 20 to 30 minutes with no checklist.
- Record whether the experience invites continued exploration.

Walkthrough 5 free-browse log (observation only):

| Route | First Reaction | Continue? | What did I want to do next? | Why? |
| --- | --- | --- | --- | --- |
| Character profile (Alice Mole) -> top navigation | "Welcoming but brief." | Yes | Use navigation to keep exploring. | The page felt kind, but onward momentum depended on global nav rather than in-page prompts. |
| Map landing | "Exploration felt immediately invited." | Yes | Open a place and follow connections. | Place-first framing and wander language created immediate curiosity. |
| Resources landing | "Practical and warm." | Yes | Pick one gentle next step. | Clear path cards offered low-friction continuation choices. |
| Home landing | "Strong invitation energy." | Yes | Choose a featured path or books. | Multiple welcoming entry points reduced decision friction. |
| Start Here | "Calm orientation with clear fit-by-need paths." | Yes | Jump to a series that matched reading mood. | Family-state prompts made next steps feel personal and obvious. |
| Book detail (Spencer's Sound Trail) | "Informative, then slower momentum." | Yes | Go back to Books or use top nav. | Metadata-first layout still encouraged pause before emotional continuation. |
| Community landing | "Friendly re-entry point." | Yes | Follow a pathway card (friendship/place/character). | Community pathways supported easy re-engagement after wandering. |

Walkthrough 5 outcome snapshot:

- Pulled Forward: 5
- Paused: 2
- Exited: 0

Cross-session evidence table (Sessions 3-5, observation only):

| Candidate Pattern | Session 3 | Session 4 | Session 5 | Confidence |
| --- | --- | --- | --- | --- |
| Catalog-first detail pages reduce momentum | Yes | Partial (route-dependent) | Yes | Emerging -> Strong (page-type localized) |
| No visitor exits during representative journeys | Yes | Yes | Yes | Strong |
| Navigation restores confidence and continuation | Yes | Yes | Yes | Strong |
| Character pages increase engagement | Mixed | Mixed by route (entity strong, profile lighter) | Mixed | Emerging |

Positive observations to preserve before recommendations:

- Predictable navigation consistently prevents dead-end experiences.
- Trust remains high across routes (no exits observed in Sessions 3-5).
- Map/entity "wander next" cues reliably pull visitors forward.
- Home/Start Here pathway language reduces choice friction and supports re-entry.

Final cross-session synthesis (observation-first):

1. Evidence

- Session 3 (Story Experience): Pulled Forward 1, Paused 5, Exited 0.
- Session 4 (Character Journey): Pulled Forward 3, Paused 1, Exited 0.
- Session 5 (Free Browse): Pulled Forward 5, Paused 2, Exited 0.
- Representative positive findings: predictable navigation, world continuity, reliable onward pathways.
- Representative hesitations: pauses occurred more often on routes where first view emphasized catalog/detail information over immediate story-world invitation.

2. Patterns (recurring observations only)

- Visitors consistently paused without abandoning.
- Trust remained intact across all walkthrough types (no exits in Sessions 3-5).
- Momentum varied by entry route and page type.
- World-first pathways (map/entity/community pathways) produced stronger pull-forward behavior than metadata-first detail routes.

3. Strengths to preserve

- Navigation as a confidence anchor: visitors continued exploring even after pauses.
- World consistency across major areas: experience felt coherent without relearning page behavior.
- No dead-end journeys: continuation remained available across routes.
- Clear progression between major areas (Home, Start Here, Community, Map, Resources) that supports re-entry.

4. Candidate opportunities (hypotheses for future validation)

- Hypothesis A: When first-view content foregrounds story-world invitation, pull-forward behavior increases.
- Hypothesis B: When first-view content foregrounds catalog/metadata details, evaluation pauses are more likely.
- Hypothesis C: Character profile routes may benefit from stronger in-page onward prompts similar to map/entity "wander next" patterns.

Interpretation guardrail:

- Candidate opportunities remain hypotheses until validated in future sessions; they are not accepted implementation work items in this cycle.

Final closeout summary:

Visitors rarely abandon Hawkins Hollow once they begin exploring. Trust remains consistently high, while momentum varies by journey type rather than across the site as a whole.

Part 1 - What should never change (preservation findings):

1. Preserve trust: Session 3 Exited 0, Session 4 Exited 0, Session 5 Exited 0; visitors may pause, but they continue believing there is value in exploring.
2. Preserve predictable navigation: navigation repeatedly restored momentum after pauses and functions as a confidence anchor, not only as infrastructure.
3. Preserve world consistency: characters, places, and relationships read as one connected world, reducing uncertainty and supporting continued exploration.
4. Preserve multiple discovery paths: visitors continued exploration from Home, Start Here, Community, Map, and character routes; varied entry points are a strength.
5. Preserve no-dead-end journeys: every meaningful visitor path should retain a worthwhile next step.

Part 2 - Recommendations supported by evidence:

1. Recommendation candidate A: Increase first-view story momentum on book detail pages. Evidence: Sessions 3 and 5 both showed pauses concentrated on metadata-first book-detail experiences.
2. Recommendation candidate B: Learn from high-performing exploration pathways. Evidence: Community -> Map -> Entity journeys consistently showed stronger pull-forward behavior.
3. Recommendation candidate C: Keep representative walkthroughs as a standing quality method. Evidence: Sessions 1-5 surfaced cross-route behavior patterns that automated checks cannot detect.
4. Recommendation candidate D: Optimize momentum locally while preserving trust globally. Evidence: no broad trust break was observed; pattern indicates route-specific momentum variation rather than systemic abandonment.

Evidence status:

- Trust: High confidence.
- Navigation continuity: High confidence.
- World consistency: High confidence.
- Momentum differences by journey type: Moderate confidence.
- Cause of momentum differences: Hypothesis requiring future validation.

## Phase 2 - Baseline Comparison

Purpose:

- Compare real family experiences against Baseline v1 to understand what remains stable, what changes, and what new patterns emerge.
- Objective: learn from evidence, not confirm previous conclusions.

Phase naming note:

- Use "Baseline Comparison" for the next phase (instead of validation framing) to keep observation-first posture.

Baseline freeze rule:

- Treat this completed internal cycle as Baseline v1.
- Do not rewrite Baseline v1 after family sessions begin.
- Produce Baseline v2 after Family 10 is complete.
- Reserve Baseline v3 for a later public-launch comparison window.

Per-family capture (lightweight):

| Observation | Compare to Baseline | Result |
| --- | --- | --- |
| Trust | Higher / Same / Lower |  |
| Momentum | Higher / Same / Lower |  |
| New Pattern | None / Candidate |  |
| Surprise | Positive / Neutral / Negative |  |

Session prompt to preserve delight signal:

- What delighted them?

Promotion ladder (from observation to backlog):

1. Stage 0 - Observation: one family noticed something. No action.
2. Stage 1 - Pattern Candidate: multiple families independently observed something similar. Record it. No action.
3. Stage 2 - Supported Pattern: observation repeats across different family types (age ranges, Hawkins Hollow familiarity, and reading preferences). Keep as evidence.
4. Stage 3 - Accepted Work Item: only after recurrence, meaningful impact, and preservation-strength check.

Phase 2 interpretation guardrail:

- Compare new family evidence against Baseline v1; do not use family sessions to confirm prior assumptions.

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
