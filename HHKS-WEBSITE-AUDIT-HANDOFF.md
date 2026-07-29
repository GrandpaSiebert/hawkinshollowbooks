# Hawkins Hollow Website Audit Handoff

Audit date: 2026-07-22

Scope: Read-only repository inspection. No site source, assets, historical build output, or recovery output was modified by this audit.

## 1. Executive Summary

- One workspace/project root was found: `hawkins-hollow-site`.
- The current JavaScript generator reads source data and writes to `build-recovery/`; the preview server still serves the historical `build/` directory. This is a release-path mismatch.
- `assets/covers/` is the authoritative source cover library. It contains 77 PNG front-cover files across nine series/group folders.
- All 77 source covers map one-to-one to `data/books.json` records. No source cover is unreferenced; no duplicate catalog code or slug was found; every catalog cover path exists.
- `build-recovery/assets/covers/` contains 77 byte-identical copies of source covers. `build/assets/covers/` contains 76 byte-identical historical copies, some with stale filenames/codes.
- No Amazon URLs, ASINs, ISBNs, purchase links, package manifest, deployment configuration, PDFs, spreadsheets, ZIPs, or completed downloadable family/educator materials were found.
- All 77 book records currently say `published: false`. The active generator does not use that field to gate manually registered book pages.
- Under the requested local cover-evidence rule, the 77 covers are `confirmed-cover` catalog candidates. The repository does not independently prove current Amazon availability because it contains no Amazon listing metadata.

## 2. Project Structure

| Area | Location | Observed role |
|---|---|---|
| Project root | `.` | Single project root; no separate extraction, ZIP, or additional project found. |
| Active source inputs | `assets/`, `data/`, `styles.css` | Read by `scripts/generate-site.js`. |
| Historical generated pages | `build/` | Protected historical output; preview server serves this directory. |
| Current recovery output | `build-recovery/` | Current generator output. |
| Build scripts | `scripts/` | `generate-site.js` is authoritative; `generate-site.py` is deprecated. |
| Data | `data/` | JSON registries and configuration. |
| Characters | `data/characters.json`, `assets/characters/`, `build/characters/` | Source records/images and generated character details. |
| Covers | `assets/covers/` | Authoritative source cover set. |
| Illustrations | `assets/` | Covers, banners, characters, environments, landmarks, logos, icons, seasonal art. |
| Resources/downloads | `data/resources.json` | One placeholder record; no downloadable files. |
| Templates/components | `layouts/`, `components/`, `content/` | Present, but not used by the active JavaScript generator. |
| Deployment configuration | Not found | No package manifest, hosting config, or CI configuration found. |

### Source and Output Evidence

- `scripts/generate-site.js:4-5` sets the source root to the project root and writes to `build-recovery/`.
- `scripts/generate-site.js:500-583` loads data, copies `styles.css` and `assets/`, and writes generated HTML.
- `scripts/preview-site.js:5-6` serves `build/`, not `build-recovery/`.
- `README.md:5-8` identifies the JavaScript generator as authoritative and the Python generator as deprecated.

## 3. Cover Inventory

All source covers are PNG files under `assets/covers/`. Visual samples from each series group confirmed final front-cover artwork, printed series labeling, story numbers, and bylines. The source cover set contains no duplicate hashes.

| Cover folder | Codes | Count | Dimensions | Source-copy status |
|---|---|---:|---|---|
| `assets/covers/Storybooks/` | `SB001`-`SB033` | 33 | 1254x1254 | All copied identically to recovery; historical copies use bare number filenames. |
| `assets/covers/First Readers/` | `FR001`-`FR005` | 5 | 1024x1536 | All copied identically to both outputs. |
| `assets/covers/Second Readers/` | `SR001`-`SR006` | 6 | 1024x1536 | `SR006` absent from historical output but present in source and recovery. |
| `assets/covers/Growing Together/` | `GT001`-`GT007` | 7 | 1024x1536 | All copied identically to both outputs. |
| `assets/covers/Tender Times/` | `TT001`-`TT007` | 7 | 1254x1254 | All copied identically to both outputs. |
| `assets/covers/Hero Play Poems/` | `HR001`-`HR003` | 3 | 1254x1254 | All copied identically to both outputs. |
| `assets/covers/Basic Training/` | `BT001`-`BT003` | 3 | 1254x1254 | Historical output has stale/misnamed copies for BT002 and BT003. |
| `assets/covers/Bedtime Library/` | `BL001`-`BL006` | 6 | 1254x1254 | All copied identically to both outputs. |
| `assets/covers/Holiday Story Poems/` | `HSP001`-`HSP007` | 7 | 1254x1254 | Historical output calls HSP007 `HS007`; hash confirms same artwork. |

### Cover Classification

- Every source cover appears to be a front cover.
- No source back covers, full wraps, thumbnails, mockups, alternate source editions, or duplicate source files were found.
- Every source cover has an exact `coverImage` reference in `data/books.json`.
- Historical and recovery copies are output duplicates, not additional titles.

## 4. Cover-Confirmed Catalog

The following catalog is based only on final source cover evidence. `confirmed-cover` means an identifiable final cover exists in `assets/covers/`; it does not prove a current Amazon listing without external marketplace identifiers.

| Series / printed variation | Codes | Distinct titles | Catalog source |
|---|---|---:|---|
| Storybooks / printed `Hawkins Hollow Storybook Series` | SB001-SB033 | 33 | `data/books.json:3-35` |
| First Readers | FR001-FR005 | 5 | `data/books.json:37-41` |
| Second Readers | SR001-SR006 | 6 | `data/books.json:43-48` |
| Growing Together | GT001-GT007 | 7 | `data/books.json:50-56` |
| Tender Times / printed `Tender Times in the Family` | TT001-TT007 | 7 | `data/books.json:58-64` |
| Hero Play Poems | HR001-HR003 | 3 | `data/books.json:66-68` |
| Basic Training | BT001-BT003 | 3 | `data/books.json:70-72` |
| Bedtime Library / printed `Hawkins Hollow Bedtime Library: Big Feelings` | BL001-BL006 | 6 | `data/books.json:74-79` |
| Holiday Story Poems | HSP001-HSP007 | 7 | `data/books.json:81-87` |

Total distinct confirmed-cover titles: 77.

## 5. Catalog Comparison

### A. Cover and Catalog Agree

All 77 source covers have one exact current catalog record in `data/books.json` with matching title, code, series slug, and source-cover path.

- Source covers: 77
- Current book records: 77
- Missing referenced covers: 0
- Unreferenced source covers: 0
- Duplicate slugs: 0
- Duplicate codes: 0

### B. Cover Exists Without Matching Catalog Record

None.

### C. Catalog Record Exists Without Matching Cover

- `The Porch Light` appears only in the legacy root `series.json` and historical preservation data. It has no source cover in `assets/covers/` and is not a current `data/books.json` record. Do not classify it as live from this repository.

### D. Conflicts and Stale Material

| Conflict | Evidence |
|---|---|
| Every current book is marked `published: false`. | `data/books.json:3-87` |
| Printed `Hawkins Hollow Storybook Series` differs from current data title `Storybooks`. | Sampled SB001 cover; `data/series.json:2-8` |
| Printed `Tender Times in the Family` differs from data title `Tender Times`. | Sampled TT001 cover; `data/series.json` |
| Printed `Hawkins Hollow Bedtime Library: Big Feelings` differs from data title `Bedtime Library`. | Sampled BL001 cover; `data/series.json` |
| Historical Storybook copies use `001`-`033` rather than `SB001`-`SB033`. | `build/assets/covers/Storybooks/` |
| Historical Holiday copy uses `HS007` rather than `HSP007`. | `build/assets/covers/Holiday Story Poems/` |
| Historical Basic Training names include `BL003 Brandon’s Muddy Boots` and malformed BT002 punctuation. | `build/assets/covers/Basic Training/` |
| Root legacy `series.json` uses `storybook-series` / `The Porch Light`, inconsistent with active `data/series.json`. | `series.json:2-14`, `data/series.json` |
| No Amazon URLs, reused URLs, ASINs, ISBNs, or purchase fields exist to compare. | Repository-wide audit |

## 6. Current Book-Page Pipeline

1. Pages are manually registered in `data/pages.json`.
2. Series pages require `template: "series"` plus `seriesSlug` in a manual page record.
3. Book detail pages require `template: "book-detail"` plus `bookSlug` in a manual page record.
4. Books and series are not automatically discovered from their respective data files.
5. The authoritative generator is `scripts/generate-site.js`.
6. Fields currently used by the book renderer are `slug`, `code`, `title`, `seriesSlug`, `coverImage`, and `description`; records also hold `summary`, `characters`, `published`, and `sortOrder`.
7. Root-style `/assets/...` paths are normalized through `toOutputAssetPath()` in `scripts/generate-site.js:28-30`; all assets are recursively copied by `copyDir()` at lines 11-21.
8. `renderSeriesPage()` uses a page's `seriesSlug`, selects matching books, and renders at most three book cards. It links to `${book.slug}.html`, but it does not generate those book routes automatically. See `scripts/generate-site.js:377-405`.
9. Routes use `page.slug + '.html'`, except `index`, which becomes `index.html`. Featured character pages are auto-emitted as `characters/{slug}.html`. See `scripts/generate-site.js:556-582`.
10. Output is not cleaned before generation, so stale pages and assets can survive a rebuild.
11. The generator only checks whether manually referenced book/series records exist and renders a legacy/under-construction fallback for a missing reference. It has no validation for missing image files, broken links, duplicate routes, duplicate IDs/slugs, schema completeness, or public visibility based on `published`.

## 7. Public Resource Inventory

| Title or Filename | Path | Format | Intended Audience | Linked From Website? | Complete? | Notes |
|---|---|---|---|---|---|---|
| Reading Order | `data/resources.json:2-8` | JSON record | Families/readers, inferred | No | No | Explicitly a placeholder; active generator does not load the file. |
| Resources page | `build-recovery/resources.html` | HTML | General visitors | Yes, primary navigation | No | Under-construction fallback, not a resource library. |
| Educator/parent/free-child-resource ribbon art | `assets/banners/` | PNG | Implied by banner labels | No corresponding resource pages | Artwork only | Does not establish downloadable content. |

No PDFs, activity sheets, discussion guides, teacher packs, family downloads, accessibility files, or educational documents were found.

## 8. Immediate Release Recommendation

### Can Do With Current Structure

- Use `assets/covers/` plus `data/books.json` as the current 77-title cover-confirmed source list.
- Preserve `build/` as historical material and use `build-recovery/` only for current generated output.
- Retain the present static generator and visual system; a framework replacement is not warranted.
- Require cover file, title, series, and an explicit release decision before publishing each catalog item.

### Requires a Small Structural Change

- Add release-specific fields such as `releaseStatus`, `amazonUrl` or `asin`, `publicCatalog`, and `publishedAt` to book records.
- Filter generated books, series membership, sitemaps, and detail routes by `publicCatalog === true`.
- Generate series and book pages from the filtered book data rather than manual `pages.json` entries.
- Replace hard-coded legacy Storybook Shelf links in the generator with current data-derived routes.
- Point the preview server at the selected release output, or make its output root configurable.
- Add checks for duplicate routes/slugs/codes, missing cover files, unresolved internal links, and missing marketplace metadata for purchasable items.
- Build a resource index from complete resource records before adding Family and Educator navigation entries.

### Should Wait for Full HHKS Implementation

- Places, environments, landmarks, relationship pages, author pages, updates, and graph-based related content.
- Retirement of legacy historical routes.
- A public resource library beyond a deliberately minimal and clearly labeled page.

## 9. Risks and Unanswered Questions

- Cover presence is the agreed local catalog evidence but cannot prove present Amazon availability without ASINs or URLs.
- All 77 current book records say `published: false`; the intended semantics require confirmation before release gating is implemented.
- The preview server serves `build/`, whereas current generation writes `build-recovery/`.
- Series cards can link to book pages that are not automatically generated.
- The current resource page has no resource library or downloadable content behind it.
- Series naming needs an editorial decision where printed cover labels differ from site taxonomy.
- The author-line formatting was visually sampled across series, not manually transcribed from every individual cover.

## 10. Machine-Readable Data

### Confirmed Live Catalog

```json
{
  "generatedFrom": "local cover asset audit",
  "books": [
    {
      "series": "Storybooks",
      "number": "SB001-SB033",
      "title": "Spencer’s First Friend; The Sharing Acorn; Alice’s Underground Party; When Callen Said Sorry; The New Animals in the Hollow; Taking Turns at the Pond; Callen’s New Baby Brother; Aralynn Fox’s Promise; The Thank You Trail; Aralynn Fox Feels Left Out; Brandon’s Listening Ears; The Forgiveness Garden; Standing Up for Spencer; The Compliment Chain; Austin’s Quiet Day; When Aralynn Fox Told the Truth; Lex Learns to Wait; The Secret Keeper; Playing Fair at the Fair; The Helping Paws Club; The Berry Basket Truth; The Kindness Competition; Callen’s Gossip Problem; The Buddy System; Respecting Differences; The Friendship Recipe; Spencer’s Big Feelings; The Angry Hedgehog; Brandon’s Wiggly Worries; Callen’s Jealous Feathers; The Sad Day; Alice Mole Feels Left Out; The Excitement Overflow",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Storybooks/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L3-L35"],
      "notes": ["33 distinct 1254x1254 PNG front covers", "Printed series label differs from current data taxonomy"]
    },
    {
      "series": "First Readers",
      "number": "FR001-FR005",
      "title": "Spencer’s Sound Trail; The Vowel Mystery; Austin Turtle and the Sight Word Challenge; The Hollow Rhyme Day; Aralynn Fox’s Word Family Discovery",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/First Readers/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L37-L41"],
      "notes": ["5 distinct 1024x1536 PNG front covers"]
    },
    {
      "series": "Second Readers",
      "number": "SR001-SR006",
      "title": "The Summary Mystery; Aralynn Fox’s Five-Minute Clock Discovery; Austin Turtle’s Alphabetical Trail; Spencer and the Peace Talk Challenge; Aralynn Fox’s Rights Trail; Bentley’s First Week in the Nest",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Second Readers/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L43-L48"],
      "notes": ["6 distinct 1024x1536 PNG front covers"]
    },
    {
      "series": "Growing Together",
      "number": "GT001-GT007",
      "title": "The Healthy Heart Walk; Brandon Rabbit’s Make-Believe Farm; Callen Crow’s Leadership; The Birthday Surprise; Brandon Rabbit’s Garden Helpers; The Community Garden; Callen Crow’s Lost Feather",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Growing Together/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L50-L56"],
      "notes": ["7 distinct 1024x1536 PNG front covers"]
    },
    {
      "series": "Tender Times in the Family",
      "number": "TT001-TT007",
      "title": "Alice Mole and the Anniversary Star Wish; Callen Crow and the Night of Many Feelings; Alice Mole and the New Family Picnic; Baby Bentley and the Small Invitation; Brandon Rabbit and the Long Goodbye Lantern; Aralynn Fox and the Hard News Raincloud; Asher and the Goodbye Song",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Tender Times/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L58-L64"],
      "notes": ["7 distinct 1254x1254 PNG front covers", "Printed series name differs from current data taxonomy"]
    },
    {
      "series": "Hero Play Poems",
      "number": "HR001-HR003",
      "title": "Aydin and Albert Einstein’s Map; Emmitt and Martin Luther King Jr.’s Promise; Aydin and Davy Crockett’s Map",
      "authorLine": "Grandpa Siebert, sampled format",
      "coverPath": "assets/covers/Hero Play Poems/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L66-L68"],
      "notes": ["3 distinct 1254x1254 PNG front covers"]
    },
    {
      "series": "Basic Training",
      "number": "BT001-BT003",
      "title": "Spencer Washes Up before Snack; Lex and the Waiting Coat Hook; Brandon’s Muddy Boots",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Basic Training/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L70-L72"],
      "notes": ["3 distinct 1254x1254 PNG front covers"]
    },
    {
      "series": "Bedtime Library: Big Feelings",
      "number": "BL001-BL006",
      "title": "Spencer’s Grumpy Wake-Up; Lex’s Trying Again After a Mistake; Spencer’s Not Wanting to Share the Lead; Aralynn Fox’s My Body Belongs to Me; Callen Crow’s First Train Ride Dream; Lex’s First Drop-Off Tears",
      "authorLine": "By Grandpa Siebert (aka Uncle David), sampled format",
      "coverPath": "assets/covers/Bedtime Library/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L74-L79"],
      "notes": ["6 distinct 1254x1254 PNG front covers", "Printed series name differs from current data taxonomy"]
    },
    {
      "series": "Holiday Story Poems",
      "number": "HSP001-HSP007",
      "title": "Austin Turtle’s Independence Day Quilt Square; Aleea’s Independence Day Paper Star; Baby Bentley’s Friendship Day Painted Pebble; Aralynn Fox’s Friendship Day Kindness Circle; Callen Crow’s Labor Day Helping Hands Morning; Aydin’s Labor Day Worker Thank-You; Aleea’s Grandparents Day Story Chair Welcome Sign",
      "authorLine": "Grandpa Siebert aka Uncle David, sampled format",
      "coverPath": "assets/covers/Holiday Story Poems/",
      "confidence": "confirmed-cover",
      "existingCatalogMatches": ["data/books.json#L81-L87"],
      "notes": ["7 distinct 1254x1254 PNG front covers"]
    }
  ]
}
```

### Repository Handoff

```json
{
  "projectRoots": ["hawkins-hollow-site"],
  "likelySourceRoot": ".",
  "likelyBuildOutput": "build-recovery/",
  "coverDirectories": [
    "assets/covers/",
    "build/assets/covers/",
    "build-recovery/assets/covers/"
  ],
  "dataFiles": [
    "data/books.json",
    "data/series.json",
    "data/pages.json",
    "data/characters.json",
    "data/resources.json",
    "data/places.json",
    "data/environments.json",
    "data/landmarks.json",
    "data/relationships.json",
    "data/updates.json",
    "data/legacy-content.json"
  ],
  "resourceDirectories": ["data/resources.json", "content/resources.html"],
  "buildCommands": [
    "& 'C:\\Program Files\\nodejs\\node.exe' scripts/generate-site.js",
    "& 'C:\\Program Files\\nodejs\\node.exe' scripts/preview-site.js"
  ],
  "keyScripts": [
    "scripts/generate-site.js",
    "scripts/preview-site.js",
    "scripts/generate-site.py"
  ],
  "knownRisks": [
    "Preview script serves build/ while generator writes build-recovery/.",
    "All 77 book records have published:false and the generator does not enforce it.",
    "Book and series pages require pages.json registration; they are not automatically discovered.",
    "Series renderer links to book-slug.html routes that are not automatically generated.",
    "Generator does not clean output, so stale output can remain.",
    "No Amazon URLs, ASINs, ISBNs, or purchase metadata exists in the repository.",
    "No completed downloadable family or educator resources were found.",
    "Historical build cover filenames contain stale code and punctuation variants."
  ],
  "recommendedNextFilesToInspect": [
    "data/books.json",
    "data/series.json",
    "data/pages.json",
    "scripts/generate-site.js",
    "scripts/preview-site.js",
    "data/resources.json",
    "data/legacy-content.json"
  ]
}
```