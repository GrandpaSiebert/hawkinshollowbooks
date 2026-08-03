# Agent Batch Prompt Template

Use this template to convert the Design Charter and production plan into tightly scoped daily work.

## Core Rule

Do not ask for architecture during production batches.

Ask for pattern application only.

## Reviewer Mindset (Silent Question)

Before answering checklist-style review questions, silently ask:

If this were my first visit, would I want to come back and spend another few minutes with this neighbor?

This keeps reviewer posture in visitor mode, not editor mode.

## Prompt Template

Batch: [Batch Number and Name]
Day: [Day Number]

Objective:
[One sentence tied to current batch definition of done.]

Targets:
- [Target 1]
- [Target 2]
- [Target 3]
- [Target 4]

Required Pattern:
[Name the approved pattern or checklist to apply.]

Constraints:
- Do not modify architecture.
- Do not invent new patterns.
- Do not change unrelated pages.
- Preserve current visual and editorial tone.
- Follow the completion checklist exactly.

Verification:
- Run relevant build/test checks.
- Confirm required checklist fields are complete.
- Report only files changed, validations run, and unresolved blockers.

Output Format:
1. Completed targets
2. Checklist updates made
3. Validation results
4. Remaining gaps

Reflection:

What did we learn that should improve tomorrow's batch without changing the architecture?

What did this batch teach us about Hawkins Hollow?

## Example Prompt A - Batch 1 Core Characters

Batch: 1 - Core Characters
Day: 2

Objective:
Apply the Character Complete pattern to four primary characters.

Targets:
- Austin
- Kaydence
- Callen
- Brandon

Required Pattern:
Use docs/spider/core-characters-checklist.csv and complete all Character Foundation Questions plus cross-link fields.

Constraints:
- Do not modify architecture.
- Do not invent new patterns.
- Do not edit non-target character pages unless required for a direct cross-link.
- Preserve invitation-first voice and one gentle next step.

Verification:
- Build site.
- Confirm target rows in docs/spider/core-characters-checklist.csv are updated.
- Confirm cross-links are present in generated pages.

Output Format:
1. Completed targets
2. Checklist updates made
3. Validation results
4. Remaining gaps

Reflection:

What did we learn that should improve tomorrow's batch without changing the architecture?

What did this batch teach us about Hawkins Hollow?

## Example Prompt B - Batch 3 Neighborhood Connections

Batch: 3 - Neighborhood Connections
Day: 1

Objective:
Make core neighborhood paths walkable across selected character and location pages.

Targets:
- Spencer
- Alice
- Reading Stump
- Old Oak
- Community Garden
- Callen

Required Pattern:
Cross-link verification standards in docs/spider/world-completeness-checklist.md.

Constraints:
- Do not redesign templates.
- Do not add new behavior.
- Add only meaningful links that support natural wandering.

Verification:
- Confirm each target has at least one meaningful incoming and outgoing core link.
- Confirm at least one character-to-place and one place-to-character path.
- Update Cross-link Verified in checklists where criteria are met.

Output Format:
1. Completed targets
2. Checklist updates made
3. Validation results
4. Remaining gaps

Reflection:

What did we learn that should improve tomorrow's batch without changing the architecture?

What did this batch teach us about Hawkins Hollow?

## Daily Production Note

Track progress as world-building, not file count.

Preferred daily summary line:
"[N] more neighbors moved into Hawkins Hollow today."
