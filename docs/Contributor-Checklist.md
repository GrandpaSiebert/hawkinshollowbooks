# Contributor Checklist

Use this checklist before approving any pull request, generated output, or major content update.

This is a stewardship checklist, not only a technical one.

## Standing Mission

Every completed task should make Hawkins Hollow feel a little more welcoming, a little easier to explore, or a little more worth returning to.

If it does not, ask whether it belongs in this release.

## Stewardship Checks

- Does this preserve the Canon as the source of truth?
- Does this make Hawkins Hollow feel more welcoming?
- Does it sound like Hawkins Hollow?
- Does it invite exploration rather than directing traffic?
- Does it leave visitors a little lighter than when they arrived?
- Would Grandpa recognize this as Hawkins Hollow?

If any answer is no, the work is not finished yet.

## Technical Checks

- Are stable IDs preserved for entities?
- Is relationship provenance still present and explainable?
- Are generated artifacts reproducible from the build pipeline?
- Are links and routes valid in generated output?

## Experience Checks

- Does the page feel calm and unhurried?
- Are choices meaningful and easy to understand?
- Is commerce presented as a continuation of belonging, not an interruption?
- Does the copy speak with visitors, not at them?

## Voice Checks

- Is the writing observational and inviting?
- Does the writing leave room for imagination?
- Does seasonal language notice rather than announce?
- Does the content feel like someone walking beside the visitor?

## Final Question

If this were the first page a grandparent or child saw, would they feel welcomed and want to come back?

## Release Reflection

Before publishing a meaningful release, answer this:

- What memory will this release create?

## Open the Gate Sprint Visitor Filter

For the current Open the Gate Sprint, begin every proposed task with this question:

- Will a visitor notice this?

If the answer is no, it likely belongs after soft launch.
If the answer is yes, move it to the top of the queue.

## Daily Standup: Today's Visitor

Begin each standup by choosing one visitor profile for the day.

Today we are helping:

- A grandmother
- A grandfather
- A first-grade teacher
- A homeschooling parent
- A five-year-old
- An older sibling
- A librarian

Then ask:

- What will make today better for them?

Use the answer to prioritize tasks before discussing implementation details.

## Open the Gate Task Closeout Rule

For the duration of the Open the Gate Sprint, every completed task must identify which visitor-facing launch gate it improved.

Use one or more tags in updates and release notes:

- Improved Welcome Journey
- Improved Story-to-Action
- Improved Trust and Comfort
- Improved Discoverability
- Improved Mobile Experience
- Improved Launch Readiness

If a completed task cannot map to at least one launch gate, move it to post-launch unless it is critical for reliability or safety.

Every completed task should also include two short statements in updates, PR descriptions, or release notes:

- Visitor memory created: one sentence describing what a family can now feel, notice, or do.
- How this makes Hawkins Hollow feel more like home: one sentence in plain language.

When describing launch-gate impact, write the outcome in visitor language first.

Preferred:

- Launch gate improved: Families can now begin exploring every published series immediately.

Avoid:

- Launch gate improved: Removed dead ends in series cards.

Use this prompt:

- How does this make Hawkins Hollow feel more like home?

## Open the Gate Sprint Workstreams

### 1. Welcome Journey

Goal: Make the first 30 seconds memorable.

Acceptance criteria:

- A first-time visitor understands they are welcome.
- A first-time visitor knows where to begin.
- A first-time visitor wants to click something within 30 seconds.

### 2. Story-to-Action

Goal: Every featured page gives families something gentle to do together.

Acceptance criteria:

- Every major landing page ends with one meaningful next step.
- Next steps are clear and gentle: read, explore, print, discuss, or discover another place.

### 3. Trust and Comfort QA

Goal: Remove friction without changing the personality of the site.

Acceptance criteria:

- Mobile layouts feel calm and readable.
- Accessibility basics are verified on key visitor journeys.
- Navigation and page flow feel clear and unhurried.

### 4. Launch Readiness

Goal: Learn safely from real visitors.

Acceptance criteria:

- Analytics is recording visits.
- Error monitoring is active.
- Backups and rollback steps are verified.
- Basic SEO essentials are present.

### 5. Open the Gate

Goal: Invite a small audience and observe real first visits.

Acceptance criteria:

- A small group of parents and grandparents can explore naturally.
- Feedback is collected about the experience, not only bug reports.

## Open the Gate Progress Reporting Format

For each meaningful update during the sprint, report progress in two sections:

### What changed

- Describe concrete implementation changes.

### What families will experience

- Use one or more launch gate tags.
- Explain the visitor-facing benefit in plain language.

## Open the Gate Launch Gates

Launch when these are true:

- The homepage makes people want to explore.
- The nine series are discoverable.
- Search consistently finds books, characters, and places.
- Every important page has somewhere meaningful to go next.
- Amazon links work.
- The site is responsive on phones.
- Images load acceptably.
- There are no obvious placeholders or broken links.
- Privacy, contact, and legal pages exist.
- Analytics are recording visits.

## Open the Gate Sprint Completion Milestone

The sprint is complete when this condition is true:

- A first-time visitor can spend fifteen enjoyable minutes in Hawkins Hollow without encountering a dead end, a broken promise, or uncertainty about where to go next.

## Pre-Family Milestone: Library Complete

Before inviting the first family session, this milestone must be true:

- Every page can fulfill the promise it makes.

If this is not true, First Ten Families is delayed.

### Family Recognition Audit

Before inviting families, confirm:

- Every recurring character has a profile.
- Every recurring family appears somewhere appropriate.
- Every major series is represented.
- Every cover displays correctly.
- Every companion pack linked from a book exists.
- No placeholder artwork remains.

### Readiness Gate 1: Technical

Everything works.

- No broken links.
- No missing files.
- No unresolved internal routes.
- Mobile layouts work on key journeys.
- Downloads work.
- Read and Learn More actions resolve correctly.

### Readiness Gate 2: Content

Everything promised exists.

- Book pages have required assets.
- Companion packs are present where promised.
- Character pages exist and are populated.
- Series pages are represented and navigable.
- Resources are present and usable.
- Any Coming Soon copy is intentional and time-bound.

### Readiness Gate 3: Emotional

Ask this before launch:

- Does this feel like Hawkins Hollow?

Run a short read-through and journey pass with this prompt:

- If Grandma visited today, would she say, "Yes, this feels like us"?

### Readiness Gate 4: Promise

Ask this question for every page:

- Does this page fully keep the promise it makes to the visitor?

Examples:

- If a page offers Download Companion Pack, the file downloads.
- If a page offers Meet this character, the character is represented.
- If a page offers Read the story, the story exists.
- If a page offers Learn more, meaningful follow-on content exists.

No empty promises.

### First Visitor Rule

- Internal final QA pass goes first.
- Grandma is the first real family experience.

### Staged Invitation Sequence

Use progressive audience stages before First Ten Families:

1. Stage 0: Internal QA.
2. Stage 1: Grandma.
3. Stage 2: Immediate family.
4. Stage 3: Neighbors.
5. Stage 4: Facebook friends.
6. Stage 5: First Ten Families study.

By Stage 5, feedback should primarily be about comfort, clarity, and emotional experience rather than broken mechanics.

## Open the Gate Objective

During this sprint, define success as removing reasons a first-time visitor would stop wandering.

Standing backlog note:

- Default answer to infrastructure requests: Not yet.
- Change to yes only when production experience demonstrates a measurable need.

Prioritize in this order:

- Eliminate visitor-facing dead ends.
- Replace placeholders with meaningful experiences.
- Ensure every major page answers: Where should I wander next?

## Open the Gate Success Metric

After invited visitors leave, ask exactly one question:

- If a friend with young children asked you to recommend one pleasant place to spend fifteen minutes online, would Hawkins Hollow come to mind?

Track one additional behavior metric during soft launch:

- Successful Wanders: number of visitor journeys that naturally continue through three or more connected experiences.
- First Voluntary Click: the first action a visitor chooses without coaching.

Use three levels for reporting:

- Good Wander: three connected experiences.
- Great Wander: five connected experiences.
- Wonderful Wander: visitor returns to Home or chooses another featured path instead of leaving.

For each observed journey, log:

- Entry page.
- First Voluntary Click.
- First Pause: where did they pause?
- Pause reason: Confused / Curious / Delighted / Reading / Other.
- First Smile: when did the visitor visibly relax or light up?
- Wander level reached: Good, Great, or Wonderful.
- Most Remembered Moment: what did the visitor mention later without being prompted?

Use this as one observation narrative per visitor:

- Record sessions in WHAT-FAMILIES-TAUGHT-US.md.

- Visitor Journey
- Journey observations:
- First Voluntary Click: ____________
- First Pause: ____________
- Pause Reason: ____________
- First Smile: ____________
- Outcome observations:
- Successful Wander: Good / Great / Wonderful
- Most Remembered Moment: ____________

After several sessions, prioritize recurring patterns over averages.

- Ask: What keeps showing up?
- Cluster repeated observations before deciding what to change.
- Never change the site because of one session. Change it because of a pattern.
- Before proposing any new framework/process document, ask: "Did the first ten families teach us that we need this?"
- If the answer is no, defer it until after the First Ten Families learning review.

Examples:

- Home -> Map -> Old Oak
- Home -> Character -> Story
- Home -> Resources -> Family Activity

## Post-Launch Observation Window

After launch, keep major changes limited for the first days while observing real behavior.

Focus on:

- Where families naturally wander.
- Which pages invite people to stay.
- Where visitors pause.
- What surprises and delights first-time visitors.

Use observations to guide the next release rather than reacting immediately to isolated feedback.

## Release Review Questions

Ask these at the start of every release review:

- What memory will this release create?
- What part of Hawkins Hollow feels more welcoming because of this release?
- What part of the visitor journey became easier or calmer?
- Is there anything in this release that feels rushed or distracting?

## Page Personality Check

Keep the first-screen triad structure consistent across major pages:

- Who is this for?
- What can I experience here?
- Where should I begin?

Then verify each page has a distinct personality, a clear leave feeling, and a clear first action:

- Home: leave feeling welcomed | first action begin exploring.
- Start Here: leave feeling comfortable | first action choose a path.
- Characters: leave feeling curious | first action meet someone.
- Map: leave feeling adventurous | first action wander.
- Resources: leave feeling encouraged | first action try something.
- Community: leave feeling connected | first action join in.
- Books: leave feeling inspired | first action read together.

Use representative voice samples per page when reviewing copy so contributors can calibrate rhythm, not copy templates:

- Home: "Look who's home."
- Start Here: "Choose the path that feels right today."
- Characters: "Every neighbor has a story."
- Map: "Some paths are better discovered slowly."
- Resources: "Take something useful with you."
- Community: "Pull up a chair."
- Books: "Pick one series and begin together."

## First-Screen Voice Audit

Run this as a read-aloud pass before publishing major copy changes:

- Read the first screen of each major page out loud.
- Ask: If I closed my eyes, would I know which page I am standing on?
- Ask: Would Grandpa naturally say this?
- Ask: Would Grandpa say it this way?
- Ask: Would Grandpa say it right now?
- If the page sounds like generic marketing copy, rewrite until the voice feels specific, calm, and neighborly.

## Observation Window Pattern

When using a rotating observation block (like Something Grandpa noticed today), keep the interaction pattern consistent:

- The Observation Window exists to remind visitors that Hawkins Hollow is already alive. The invitation is an opportunity to join it, not the reason it exists.

- The observation stands alone as a complete, worthwhile moment.
- The observation reveals something about Hawkins Hollow as a living place.
- One gentle invitation follows as a continuation, not a command.
- One unmistakable primary action is presented.

Quality bar:

- If a visitor closes the browser after reading only the observation, the moment should still feel like a small gift.

## Visitor-First Release Notes Format

For each release note, present visitor outcomes before technical details.

Start with:

- This week in Hawkins Hollow...
- Families can now...
- Grandparents can now...
- Children can now...
- Visitors may notice...

Then include implementation details as supporting information.

## Open the Gate Sprint Retrospective Question

At sprint close, ask:

- What new memories can families make today that they could not make two weeks ago?

## If You Changed Foundational Docs

If this change touches any foundational document (Architecture, Build Pipeline, Promise, Voice):

- Is the reason for change explicit and necessary?
- Is contributor and visitor impact clearly described?
- Are all related foundational docs still consistent?
- Is this an intentional principle change, not an implementation convenience?
- Did you include a Foundational Change Note that answers:
	- Why did this principle need to change?
	- How does the change better fulfill the Promise?
	- What existing experiences should be reviewed because of this change?

## If You Added A New Document

- Have you justified why this cannot be a section in an existing authoritative document?
- Did you identify the unique audience or responsibility it serves?
- Did you define how overlap with existing docs will be prevented?
