# Visitor Improvement Log

Use this log as field notes for visitor experience. Capture what changed, what visitors remembered after 30 seconds, and why a change was kept.

This log complements Git history and ADRs. Git history records implementation. ADRs record architectural reasoning. This log records what the visitor encountered and what judgment the project learned from that encounter.

Keep entries short and evidence-focused.

## Entry Format

Use this structure for every pass:

- Page:
- Goal:
- Single change:
- Memory check:
- Result:
- Pattern:
- Next pass:

Keep each entry to one short paragraph or compact bullets.

## VIP-001

Page:

- Spencer's Sound Trail

Goal:

- Introduce Spencer before introducing the publication.

Single change:

- Added a story-first first screen (welcome introduction, spoiler-free synopsis, You'll meet, You'll visit, and Continue actions) above the existing Library Record metadata block.

Memory check:

- Before: visitors primarily remembered publication details.
- After: visitors remembered Spencer, story tone, and clear continuation paths.

Result:

- Success.

Pattern:

- Confirmed. No pattern change required.

Next pass:

- VIP-002: Character section only.

## VIP-002

Page:

- Storybook Shelf / Storybook Series

Goal:

- Replace the Storybooks placeholder experience with a recognizable series page that feels like part of the broader site.

Single change:

- Routed the Storybooks pages through the shared series experience rather than leaving them as legacy placeholder routes.

Memory check:

- Before: a visitor arriving at Storybooks was likely to experience a placeholder feel rather than a clear invitation into the series.
- After: the visitor encounters a coherent series introduction, a clear description of the stories, and a path to continue exploring.
- Observed memory: After a brief review, I remember that Storybooks are intended as gentle shared stories for children and families, and that I can continue exploring them or browse the broader book collection. I do not yet have a strong impression of any individual story or character.

Result:

- Inconclusive.

Pattern:

- Inconclusive. The shared series experience is working, but the first-time visitor still needs a clearer invitation to continue.

Next pass:

- VIP-003: Clarify the next step for a first-time visitor on the Storybooks experience.

## VIP-003

Page:

- Storybook Shelf

Goal:

- Make the Storybooks landing page feel more welcoming by showing actual stories and guiding the visitor toward a clear next action.

Single change:

- Replaced the placeholder story card with a set of featured Storybook preview cards and added copy that invites the visitor to begin with one story that feels right.

Memory check:

- Before: the visitor saw a placeholder block and no clear invitation to choose a story.
- After: the visitor sees specific titles and direct links to open a story, and the page now feels like a real place to begin.
- Observed memory: I remember seeing several specific Storybooks and the phrase “Begin with one that feels right for today,” which makes the page feel more like an invitation than a placeholder.

Result:

- Success.

Pattern:

- Confirmed. A first-time visitor responds more warmly when the page shows actual content and a gentle next step.

Next pass:

- Continue with the next page that still feels thin or under-guided.

## VIP-004

Page:

- Books

Goal:

- Help a first-time visitor choose a starting point on the Books page without feeling overwhelmed by the number of collections.

Single change:

- Added a short “Where to begin” doorway above the collection grid with two direct next steps: Storybooks for shared reading and Bedtime Library for a quieter path.

Memory check:

- Before: the page presented several collections in a row, but it did not clearly tell a first-time visitor where to begin.
- After: the page now offers a simple invitation that feels more like guidance and less like a menu.
- Observed memory: I remember the page now giving a clear, gentle answer to “where should I start?” instead of leaving that choice implicit.

Result:

- Success.

Pattern:

- Confirmed. A first-time visitor benefits when a page answers the next-step question before offering a larger set of options.

Next pass:

- Continue with the next page that still needs a clearer invitation or a more immediate sense of purpose.

## VIP-005

Page:

- Home

Goal:

- Make the homepage feel more understandable on first arrival by showing a few clear entry points into the book series.

Single change:

- Added a short “Choose a shelf” section near the top of the homepage with three direct entry points: Storybooks, First Readers, and Bedtime Library.

Memory check:

- Before: the homepage welcomed the visitor but did not clearly help them understand the shape of the series collection.
- After: the homepage now gives a first-time visitor a clearer sense that the site is arranged around different kinds of visits and reading paths.
- Observed memory: I now notice the website offering distinct starting paths rather than only a general welcome.

Result:

- Success.

Pattern:

- Confirmed. A first-time visitor benefits when the homepage gives a few concrete, meaningful next steps instead of relying only on a general invitation.

Next pass:

- Continue with the next page that still needs a clearer invitation or a more immediate sense of purpose.

## VIP-006

Page:

- Story detail page

Goal:

- Make the story page feel like a clear next step after the Storybooks shelf instead of a static record page.

Changed:

- Added a stronger opening section with clearer next actions, a direct link back to the Storybook Shelf, and a small set of related Storybook cards to encourage another choice.

Observed:

- The page now feels more like a place to continue exploring than a page that simply displays metadata.
- The visitor is reminded that they are still inside the Storybooks world and can choose another story more naturally.

Result:

- Success.

Pattern:

- Confirmed. Story pages feel more welcoming when they provide a clear next step and connect visitors to more stories rather than stopping at a single title.

Next pass:

- Continue with the next step in the Storybooks journey and evaluate whether the story-to-story path feels coherent from one page to the next.
