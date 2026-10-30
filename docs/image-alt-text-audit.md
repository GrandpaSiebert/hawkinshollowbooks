# Local image accessibility repair — 2026-10-22

Status: complete local build, regenerated accessibility audit, and all 40 relevant regression tests passed. Nothing was committed, pushed, deployed, or published.

## Inventory and counts

| Measure | Result |
| --- | ---: |
| Regenerated HTML pages audited | 2,479 |
| Static image elements audited | 2,442 |
| Images missing an alt attribute | 0 |
| Existing alternatives identified for improvement | 1,171 |
| Corrections prepared in source | 1,171 |
| Corrections verified in a newly completed build | 1,171 |
| Existing intentional decorative alternatives retained | 93 |
| Additional repeated card images made decorative in source | 90 |
| Verified decorative total after rebuild | 183 |
| Illustrated discovery records exercised at runtime | 418 |
| Illustrated search results exercised at runtime | 500 (250 on each of two pages) |

The rebuild changed 1,186 alt values: the 1,171 planned improvements plus whitespace normalization in 15 existing cover alternatives (a doubled space in “Aralynn Fox Feels Left  Out”). Those 15 were not counted as inadequate in the original audit.

The runtime counts are render cases, separate from the static HTML inventory; these images are not all displayed simultaneously. The discovery test also covers the separate unclassified-results path. Tests additionally cover quoted titles.

Of the 1,171 inadequate alternatives, 872 were insufficient artwork descriptions and 299 repeated their card's destination heading. The repairs provide 1,081 informative descriptions and empty alternatives on 90 redundant map/catalog thumbnails. The 209 book-cast portraits receive informative visual descriptions rather than merely repeating a name. These are editorial accessibility improvements, not a claim that every original name-only alternative was a standards violation.

## Inspection and decisions

Image generation was traced to 24 image-emitting sites in three files: `scripts/generate-site.js` (21), `scripts/visitor-discovery.js` (2), and `scripts/freebie-page-associations.js` (1). This includes the browser search renderer and discovery DOM renderer. Searches also covered templates, components, scripts, and styles for other image mechanisms.

The 134 distinct primary character, environment, landmark, relationship, and banner artworks were visually inspected. Existing Visual Canon documents were consulted for identity; 117 descriptions record a Canon reference. Character thumbnail aliases reuse descriptions of the same portrait. Existing book-cover and song/rhyme title-art alternatives identify the publication and remain appropriate in context; no unseen scene details were invented for those images.

Descriptions live in a new presentation-only mapping, not in the authoritative Library or catalog. Character/place/relationship art is described by visible subject and setting. Explicit decorative alternatives are preserved. Map and character-directory thumbnails within fully named destination links become decorative. Existing discovery and homepage decorative artwork remains silent beside its text label. Reuse of the same alternative for the same artwork on multiple pages is intentional.

Existing cover/title alternatives are retained, with attribute escaping added to previously unescaped book templates. Shared banner rendering now escapes alternatives and preserves an explicitly empty alternative. Image paths, navigation, layout, and other functionality were not edited.

## Registry correction and completed build

The owner authorized correcting the identity-registry filename from `Relationships/G[a-Ali Visual Canon.docx` to `Relationships/Gpa-Ali Visual Canon.docx`. The entry retains **REL-0009** and was placed in the required serialized key order. The same single filename reference was corrected in `data/world-canon-fallback.json` so the checked-in comparison snapshot agrees. No IDs, canon text, or canon documents changed, and the snapshot was not substituted for authoritative Library content.

The complete local command was `npm run build`, with `HH_ENTITY_ID_STRICT=1`, `REQUIRE_FREEBIE_TITLE_ART_PUBLICATION=true`, and `HH_SITEMAP_DEPLOYMENT_DATE=2026-10-22`. It exited **0**, completing generation, title-art verification, freebie discovery validation, strict canonical-ID validation, and published-route validation.

All 2,479 pages and all image paths remain present. Comparing parsed HTML with only image alt attributes removed found two changed pages: `entities/character/alice-mole-alice-mole.html` and `entities/character/gpa-grandpa.html`. Reversing only the authorized filename string in those two comparison inputs produces the exact baseline hashes. Thus their only additional changes are the corrected source filename displayed in existing entity-graph references; there are no unexplained changes to layout, links, or content. All 117 referenced Canon-document fingerprints match.

## Checks and actual results

- Complete strict local build: **passed**, exit 0.
- `node scripts/audit-image-alt.js build-recovery generated/alt-text-review/final-audit.json`: **passed**; 2,479 pages, 2,442 images, zero missing alternatives, zero violations, 183 intentional decorative alternatives.
- `node --test test/entity-id-stability.test.js test/validate-canonical-ids.test.js`: **17 passed, 0 failed** after the filename-related corrections. An earlier attempt exposed the stale snapshot filename and registry ordering; both were corrected without weakening tests.
- `node --test test/image-alt-text.test.js test/map-place-presentation.test.js test/homepage-illustrations.test.js test/character-catalog.test.js test/freebie-page-associations.test.js test/search-navigation-output.test.js test/public-artifact-safety.test.js test/visitor-link-integrity.test.js`: **23 passed, 0 failed**, against the newly regenerated output.
- Runtime regression coverage: all 418 illustrated discovery records, the unclassified-results path, and 500 illustrated search-result cases across homepage/books, plus escaping fixtures.
- Output/baseline comparison: no missing pages, no image-path changes, no unexplained non-alt changes, and no changes to the 117 referenced Canon documents.
- Syntax and whitespace checks: passed.

**Remaining failures: none.** Existing nonfatal diagnostics remain: 26 legacy character-code compatibility warnings, seven story-master unresolved-name warnings, and search-title review notices. The build also reports 55 unattached literal Route mentions (32 distinct labels). These catalog/editorial matters were left unchanged. Strict canonical validation reports **0 errors**.

Final evidence is in the ignored local folder `generated/alt-text-review/`: `build-followup.log`, `tests-registry-followup.log`, `tests-regenerated-followup.log`, `final-audit.json`, and `comparison-followup.json`. Earlier failed-build logs are retained as history and are superseded by these final results.

## Owner confirmation

The owner confirmed on 2026-10-22 that the young rabbit in `assets/relationship-portraits/rel-0004.webp` is **Brandon Rabbit**. Its alternative is now **“Baxter Badger beside Brandon Rabbit near a wooden gate.”** The presentation mapping records that confirmation. No Canon document, portrait image, relationship title, or identity was altered. There are no outstanding image-identity review requests from this audit.

## Files changed by this task

- `data/entity-id-registry.json` — authorized filename correction, preserving REL-0009 and serialization order.
- `data/world-canon-fallback.json` — matching filename reference only in the comparison snapshot.
- `data/image-alt-text.json` — reviewed accessibility descriptions and owner-confirmed Brandon Rabbit identity.
- `scripts/image-alt-text.js` — description lookup, aliases, explicit decoration, and safe attribute escaping.
- `scripts/generate-site.js` — shared source-rendering changes, including decorative catalog/map thumbnails.
- `scripts/audit-image-alt.js` — repeatable full-output audit with named-link and decorative-context checks.
- `test/image-alt-text.test.js` — new negative, identity, generated-output, and runtime renderer regression tests.
- `test/map-place-presentation.test.js` — assertions updated for the intended accessibility behavior, with destination-name and identity checks preserved.
- `docs/image-alt-text-audit.md` — this report.

Pre-existing untracked homepage-review documents and `reports/` were left alone. Outside the explicitly authorized registry filename correction and matching snapshot reference, no catalog data changed. No manuscript, publication status, production image, Canon document, CSS, or workflow file was edited.

## Final state

All changes remain local and uncommitted, ready for review. No push, deployment, publication, or production workflow was triggered.
