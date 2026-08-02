# Foundational Docs Policy

This policy protects the stable identity anchors of Hawkins Hollow while allowing implementation to evolve.

## Scope

The following documents are foundational:

- docs/Repository-Preface.md
- docs/Architecture.md
- docs/Build-Pipeline.md
- docs/Hawkins-Hollow-Promise.md
- docs/Hawkins-Hollow-Voice.md

## Policy

- Foundational documents are stable by default.
- Changes must be deliberate, discussed, and relatively rare.
- Product and implementation changes should usually adapt to these documents, not the other way around.

## When Changes Are Appropriate

A foundational update is appropriate only when at least one of these is true:

- A principle is unclear or contradictory.
- A confirmed project direction has changed.
- A missing principle is causing repeated confusion or regressions.

## Change Requirements

Before merging a foundational-doc change:

1. State the reason for change in plain language.
2. Describe impact on contributors and visitor experience.
3. Confirm alignment with the Hawkins Hollow Promise and Voice rules.
4. Verify related companion docs are still consistent.

## Foundational Change Note (Required)

Every foundational-doc update should include a short note in the pull request or release notes answering:

1. Why did this principle need to change?
2. How does the change better fulfill the Promise?
3. What existing experiences should be reviewed because of this change?

## Stability Rule

Code, UI, and content may evolve continuously.
Foundational documents should evolve intentionally.

Stable principles. Flexible implementation.

## Hawkins Hollow Operating Discipline

### Phase 1 - Create

Create in the environment that makes you productive.

- Write stories.
- Build companion packs.
- Expand the Visual Canon.
- Keep the Local Library authoritative.

### Phase 2 - Publish

Follow the publishing discipline:

1. Preview.
2. Review the integrity report.
3. Publish.
4. Verify.
5. Archive.
6. Celebrate milestones.

No shortcuts.

### Phase 3 - Learn

Listen before changing.

- Observe families.
- Record observations.
- Look for patterns.
- Make one small improvement the evidence has earned.

There is no standing step that says "redesign the architecture." Architecture changes require demonstrated production need.

## Trusted Infrastructure Rule

The publishing engine is designated Trusted Infrastructure.

Trusted Infrastructure has one job: it quietly works.

Once a subsystem becomes dependable, the team focuses on product experience rather than continuous redesign of that subsystem.

One Production Pain Rule:

- No infrastructure feature is added unless it solves a real production problem that has actually occurred.
- Default response to infrastructure requests is: Not yet.
- The response changes to yes only when production experience demonstrates measurable need.

Governance Freeze Rule:

- No new governance artifacts without a production incident, recurring family observation, or a superseding architectural decision.

## Documentation Growth Rule

Do not add a new documentation file unless it clearly cannot be represented as a section in an existing authoritative document.

Before creating a new document, explain:

1. Why an existing document is insufficient.
2. Which audience or responsibility the new document uniquely serves.
3. How overlap with existing docs will be prevented.

## Responsibility-Based Documentation Rule

Documentation should be organized by responsibility, not by topic alone.

- Constitutional and architectural intent belongs in the foundational architecture documents.
- Day-to-day practice belongs in the contributor guidance.
- Build behavior and generated-output expectations belong in the build pipeline documentation.
- Visitor-facing learning belongs in the visitor improvement log.

This keeps each document legible to the people who need it and prevents the same fact from being re-embedded in multiple places without a clear purpose.
