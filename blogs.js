// blogs.js — v6.36
// v6.36 (2026-11-25): ALSOASKED TREE at the write step. write-blog-body now accepts an optional `alsoAskedCsv`
//   (raw AlsoAsked CSV export). A proper CSV parser (handles quoted newlines) reads the question tree from the
//   "tier 1 position" / "tier 2 position" columns (tier1>0 + tier2=0 = a branch parent; tier2>0 = its sub-questions;
//   the seed row tier1=0 is skipped; answers are ignored — blank/locked on the free plan). The branches are fed into
//   the body prompt as section structure, with an explicit instruction to IGNORE off-topic People-Also-Ask drift and
//   never keyword-stuff. Optional and per-blog; no tree = writes exactly as before. Pairs with html v6.54.
// v6.35 (2026-11-25): PRIORITY-FROM-GSC reuse + link. (1) discover-group-to-write lock check now BLOCKS only a
//   keyword locked to another BLOG (same intent → cannibalise); a keyword locked to a PRODUCT / other page is
//   different intent → ALLOWED, and its URL is remembered. (2) The reused main keyword's product + any grouped
//   product-locked queries are saved to data/blog-link-targets.json (keyed by the blog keyword), replacing the old
//   auto-link-rule step. (3) finish-blog adds ONE clean contextual IN-BODY link to the (primary) product — the AI
//   only picks a paragraph + a verbatim anchor phrase, we build the <a> ourselves; no natural fit → no link. (4)
//   publish-blog resolves those product URL(s) → GID and puts them (first, so the 4-item cap keeps them) in the
//   blog's related-products metafield custom.blog_products_list. Pairs with html v6.53.
// v6.34 (2026-11-24): FOUR fixes. (1) MONTH IN PROGRESS — a blog now leaves that tab ONLY when Mae clicks its own
//   "Mark as done" (recorded in data/blog-done.json); publishing keeps the month tag so completed blogs stay visible
//   until she marks them. (2) Thick black divider between GSC rows (front end). (3) H1 TITLE — write-blog-body now
//   generates the click-worthy H1 and returns it so the card shows it at the write step; publish reuses that exact title.
//   (4) AUTO-LINK — approving a GSC query locked to a PRODUCT adds an auto-link rule (query → product URL) so the blog
//   links to it for SEO, without touching the blog body.
// v6.33 (2026-11-24): PERMANENT BLOG IMAGE CODE (bug fix — orphaned images). Each blog's image code now lives in
//   data/blog-codes.json keyed by its keyword and is SET ONCE, NEVER CHANGED. New helper stableBlogCode() + action
//   get-blog-code. write-blog-body returns it; finish-blog + publish-blog read it from there (seeding from the draft's
//   existing code so in-flight blogs keep theirs). The front end fetches the code from the server instead of minting a
//   random one — so a re-write, reload, reorder or "mark as done" can no longer give a blog a new code and orphan the
//   images it already has in Shopify (named "<slug>-<code>").
// v6.32 (2026-11-24): GSC gaps — locked keywords now distinguish WHERE they're locked: EXACT match to a BLOG (same
//   intent) → hidden; locked to a PRODUCT / other page, or any SIMILAR match → only flagged (reusable for a blog, Mae
//   decides). Each overlap flag now carries the blog's URL so the front end's "Add to that blog" can append a paragraph
//   to the existing post (reuses add-angle-preview/apply). Pairs with html v6.50.
// v6.31 (2026-11-24): GSC gaps — smarter overlap. gsc-blog-gaps now flags against published + scheduled + PIPELINE
//   (To Write + grouped + singles), and adds a TOPIC flag (2+ distinctive shared words), not only room/style. Locked
//   keywords: EXACT (locked to a page/blog) → filtered out; SIMILAR → flagged (Mae decides). NEW gsc-ai-check: reasoned
//   intent-overlap via Haiku (cannibalise | angle | new + reason), cached in data/gsc-topic-overlap-cache.json; the
//   front end auto-runs it only on queries with no mechanical hit, plus a per-row "Ask AI" button (fresh=true).
// v6.30 (2026-11-24): DISCOVER + GSC upgrades. (1) Custom rooms/styles Mae adds by hand (data/discover-custom-rooms.json
//   + discover-custom-styles.json) are merged into the live taxonomy (TOPIC_*_DICT) → show in the cards AND are seen by
//   the duplicate check; built-in names protected. NEW actions discover-add-room/add-style/remove-room/remove-style;
//   discover-gaps now flags isCustom per room/style. (2) NEW gsc-blog-gaps: a BROAD live 12-month GSC query pull (not the
//   small cron "opportunities" list), kept to informational / no-blog ones above an editable impressions floor, each
//   flagged if a live blog shares its room and/or style; sorted by searches, top 300 — powers the improved tab-2 panel.
// v6.29 (2026-11-23): DISCOVER review controls. NEW discover-discard ("Discard forever" → data/discover-discarded.json);
//   discover-search now also skips forever-discarded questions (alongside pool/idea dupes). Pairs with the HTML change
//   where review questions come UNticked, cards are clearer, and each ticked set can go to Group / To decide later /
//   Discard forever.
// v6.28 (2026-11-23): No code change — version sync only (the "searched seeds re-tickable" fix was HTML-only;
//   this bump just satisfied the version check. blogs.js behaviour identical to v6.27).
// v6.27 (2026-11-23): DISCOVER TOPICS — group into one blog. NEW discover-group-to-write: Mae ticks topics, pastes
//   the keyword she chose in Ubersuggest (+ volume/difficulty), and it (1) checks the keyword isn't LOCKED to
//   another URL (registry, fresh), (2) creates ONE approved blog in To Write (status TO_WRITE + blog-approved.json),
//   (3) saves the metrics to keyword-metrics.json, (4) stores the other grouped topics as "also covers"
//   (blog-fused-groups.json), (5) clears them from the pool. The Ubersuggest prompt is generated in the tool
//   (broad, style-keeping, informational-first, editable volume floor). No second filter — it's ready to write.
// v6.26 (2026-11-23): DISCOVER TOPICS — suggest, don't filter. (1) discover-search no longer DROPS questions: it
//   returns EVERY new question (only skipping exact pool/idea dupes), each flagged maybeCovered + coveredReason.
//   "Maybe covered" now fires ONLY when the EXACT style AND room (or synonyms) are both present in another blog —
//   the old filter also matched a single axis (via TOPIC_PHASES singleMatch), which dropped almost everything. It
//   no longer auto-saves to the pool. (2) NEW discover-add-questions — saves only the questions Mae ticks. (3) NEW
//   discover-compare — type two keywords, returns the live blogs that relate to BOTH (manual overlap check).
//   TOPIC_PHASES is untouched (still used by the dedup); the stricter both-axes rule is local to Discover.
// v6.25 (2026-11-22): PUBLISH GATE EXTENDED — publish-blog now runs its OWN missing-content gate FIRST (before
//   any SEO/AI call): if the finished body still has a dead [[IMG|...]] image OR a [[PRODUCT|topic]] product
//   placeholder, it STOPS and returns the list so the tool asks Mae (fix it, or Cancel → drop + publish clean).
//   This catches drafts finished before the gate existed and direct publishes (the gate used to live only in
//   finish-blog, and publish silently stripped [[IMG]] — never [[PRODUCT]] — so product holes slipped through).
//   The final safety strip now also removes [[PRODUCT|...]]. (Front: regenProducts "Find again" now keeps the
//   ticks for ALL re-matched products, not only SKU extras — a re-fetch no longer wipes the chosen products.)
// v6.24 (2026-11-22): (1) CRASH FIX — the missing-images feature was split across two actions, so finish-blog
//   threw "missingImages is not defined" and publish-blog threw "Assignment to constant variable". The whole
//   missing-images gate now lives in finish-blog (step 5, where images are resolved): it declares its own
//   missingImages/dropMissingImages, returns needsImageDecision before saving, and strips dropped markers;
//   publish-blog's duplicate gate was removed and its body is now `let` with a safety strip for old drafts.
//   (2) ADD-ANGLE retry — the group "add angle" AI call now retries up to 3× before the "did not return the
//   section" error (it was intermittent).
// v6.23 (2026-11-21): (1) INTERNAL LINK placement — the ranking page now links to the covered blog with an
//   IN-BODY contextual link whose anchor is the keyword (or a natural variant), chosen in the most relevant
//   paragraph, instead of a "Related reading" line tacked on the bottom (better SEO). Falls back to a short
//   natural sentence only if no paragraph fits. Backup + dedup kept. (2) YEARS — now AVOID a year unless
//   genuinely needed; when needed use next year (we're near the end of the current one), never an earlier year.
// v6.22 (2026-11-21): ADD-ANGLE FIX — "Add angle to the blog" from the duplicate check now covers the WHOLE
//   group. Before, it rewrote ONE paragraph with ONE phrase, so it dropped most grouped searches and often
//   skipped the main topic. Now, for a group (2+ searches) it writes ONE new section led by the MAIN topic
//   that naturally works in EVERY grouped search. Single-keyword adds keep the light paragraph rewrite. Year
//   rule applied here too. (Internal linking from the ranking page → this blog is unchanged, in add-angle-apply.)
// v6.21 (2026-11-21): (1) NEVER publish with dead image placeholders — before creating the blog on Shopify,
//   if any image (cover or body) isn't generated, STOP and return the list so the tool asks Mae: Generate
//   (she gets each prompt + the exact save-name) or Cancel (drops the placeholder + publishes clean). Safety
//   strip removes any leftover [[IMG|...]] before create. (2) YEARS — the blog body + SEO fields may only ever
//   use the current year or the next one (computed live), never a past year. (3) CLICK-WORTHY TITLE — when the
//   saved title is just the raw keyword (lowercase), the SEO pass now writes a proper H1 title and it is used
//   as the Shopify article title + handle; titles that are already proper are kept.
// v6.20 (2026-11-21): PUBLISH FIX — "related blogs" at publish are now chosen from LIVE Shopify, not from the
//   saved blog-index.json (which still named deleted blogs → Shopify rejected the whole publish with
//   "Value references non-existent resource"). One live pass gets every real article + its inbound-link count,
//   so a deleted blog can never be linked again. The daily watcher (scripts/blog-index-sync.js) keeps the
//   saved list clean for everything else that still reads it.
// v6.19 (2026-11-18): (1) discover-probe — test one seed, returns EVERY question Google brings with kept/dropped
//   + the reason (which blog / idea / pipeline item matched), nothing saved, to check the filter isn't too strict.
//   (2) mark-idea-towrite — the Blog Ideas "Mark for Writing" button now persists the row as TO_WRITE AND
//   approves the keyword, so it actually appears in To Write instead of vanishing.
// v6.18 (2026-11-18): (1) discover-promote now ATTACHES the same-seed angle topics to the blog (writes them as
//   secondary in blog-fused-groups.json → "+ also covers" + used as sections when writing). (2) New delete-blog-row
//   (removes ONE matching keyword[+title] row from blog_ideas.csv — for the To Write 🗑 delete button; a duplicate
//   pair loses exactly one). (3) New gsc-approve-dedup: approving GSC topics runs the duplicate check right there —
//   covered → a 'covered' group, the rest → Singles — so nothing lands in limbo.
// v6.17 (2026-11-18): Discover polish. discover-promote now sends an approved topic STRAIGHT TO TO WRITE
//   (status TO_WRITE + adds the keyword to blog-approved.json so it shows; updates the existing row instead of
//   duplicating) and clears the same-seed angle topics from the pool. discover-gaps + discover-search now also
//   count IN-PROGRESS topics (To Write / pending / Blog Ideas / month, plus Grouped winners+secondary and
//   Singles) via gatherPipelineTexts, so a room/style already being worked on is greyed ("in pipeline") and
//   never re-offered. Ignored topics are NOT counted (can resurface).
// v6.16 (2026-11-18): DISCOVER topics (Serper). New actions: discover-gaps (per-room general count + which
//   styles are covered/already searched, from the room+style dictionaries), discover-search (searches each
//   seed × 2 terms "wall art"/"home decor" on Serper via SERPER_KEY, keeps only questions NOT already covered
//   by a blog / an idea / the pool, saves to data/discover-pool.json, records searched seeds in
//   data/discover-searched.json), discover-list-pool, discover-set-keyword (Claude fills the main keyword),
//   discover-promote (ready pool item → Blog Idea row). Added "Reading room" to the room dictionary and fixed
//   the Nursery/Kids synonyms (phrases, not loose single words).
// v6.15 (2026-11-17): (A) updateGitHubFile now RETRIES on a 409 SHA conflict (re-fetch the current SHA, up to
//   3 tries) — fixes "Failed to update …: status 409" when GitHub's contents API returns a stale SHA. (B)
//   reject-fusion-keyword ("✕ not this one") now puts the rejected keyword straight back into the Singles list
//   (and kept members too if the group dissolves), so it's usable immediately without re-running the check.
// v6.14 (2026-11-17): three new dedup actions. (1) fusion-suggest-singles-for-group → singles that fit a
//   grouped card by the same 4-step room/style cascade. (2) fusion-add-single-to-group → move a single into an
//   existing group's secondary and drop it from Singles. (3) fusion-single-to-blog → match a single to a chosen
//   published/scheduled blog, turning it into an Already-covered group (where the angle paragraph is written).
// v6.13 (2026-11-16): add-angle-preview now also accepts a blogUrl (resolves it to the article id) so the
//   Blog Ideas "Add paragraph to that blog" button can add an angle to the conflicting blog directly.
// v6.12 (2026-11-16): (A) new action fusion-ignore-single → sets the keyword IGNORED in blog_ideas.csv (adds
//   a row if it's a rank keyword) so it moves to the Ignored tab and leaves Singles for good. (B) add-angle-
//   apply now AUTO-PLACES the internal link on the OLD ranking page instead of only queuing it in MPD: old
//   page = BLOG → append a short "Related reading" link paragraph (body backed up to blog-angle-backups.json,
//   undo-able); old page = PRODUCT → add this blog to the product's custom.linked_blogs metafield (previous
//   value saved to linked-blogs-backups.json). Anything that fails falls back to the MPD "Add the link" queue.
// v6.11 (2026-11-16): covered match tightened — a single-dimension match (style-only OR room-only) now only
//   covers a GENERAL blog on the other dimension (style-only kw ↔ style-only blog, room-only kw ↔ room-only
//   blog). Before, "old money living room" / "grey and beige living room" were flagged covered by an
//   "Abstract + Living room" blog just because both were Living room. Now those genuinely different topics go
//   to Grouped/Singles for a new blog instead of being wrongly marked already-covered. Pair matches unchanged.
// v6.10 (2026-11-16): ROOT-CAUSE fix for "no blogs found". fetchBlogsPubAndSched had query:"published_status:any"
//   on the articles query, which Shopify honours by returning only ~21 articles (hasNextPage:false) instead
//   of all ~250. So the dedup + blog search only ever saw ~21 (the scheduled ones) → published blogs like
//   coastal/old-money/office were invisible, and "covered" only ever matched scheduled blogs. Removed the
//   filter (the code already skips drafts by publishedAt), so the full catalogue is fetched.
// v6.9 (2026-11-16): search-blogs-for-group now RETURNS already-used blogs too (with used:true) instead of
//   hiding them — so Mae can see the search is working. Available first, used last; the UI greys the used
//   ones out and disables them. Empty result now truly means "no blog matches".
// v6.8 (2026-11-16): duplicate-check reliability. (1) fetchBlogsPubAndSched made robust — 100/page +
//   retry + partial results (first:250 was intermittently failing the WHOLE fetch → the dedup + the blog
//   search found "no blogs"). (2) search-blogs-for-group now also matches by the room/style cascade, not
//   only the literal typed words. (3) grouping no longer DROPS overflow to singles — a bucket of same
//   style/room is split into groups of ≤4 so nothing (incl. low-volume "already ranks") falls through.
// v6.7 (2026-11-16): duplicate-check matching rebuilt. Shared topic matcher (room/style) used by BOTH the
//   automatic check AND the by-hand Singles grouping. Matches the PRINCIPAL word first, then synonyms, and
//   pairs (style+room) before singles (style OR room) — exactly: (1) principal pair, (2) synonym pair,
//   (3) principal single, (4) synonym single. Tolerant of plurals (office/offices) and words written
//   joined or split (playroom / play room). The style/room list now includes each name as its own
//   principal (e.g. "old money" was missing → that's why old-money keywords never matched/grouped). New
//   actions: search-blogs-for-group (live blog search by title, hides blogs already used as covered) and
//   fusion-attach-blog (attach a chosen blog to a grouped card → moves it to Already covered).
// v6.6 (2026-11-15): "one place at a time" flow. To Write only shows APPROVED blogs now — a topic lives in
//   the Duplicate check (Singles/Grouped/Covered) until Mae approves it, then it moves to To Write. New
//   data/blog-approved.json (lowercased keywords); apply-fusion-group + fusion-single-to-write add to it;
//   get-fused-groups returns `approved`; find-fusion-groups EXCLUDES approved keywords from the pool so an
//   approved blog never re-appears in the dedup.
// v6.5 (2026-11-15): Blog Manager 8-tab reorg. save-blog-ideas honours a row.status (so pasted ideas land
//   as BLANK = Blog Ideas, not TO_WRITE). New set-keyword-metric (saves target keyword vol/difficulty to
//   data/keyword-metrics.json). find-fusion-groups now ALSO returns `singles` (tagged leftovers not covered
//   and not grouped) so the Duplicate check "Singles" sub-tab can show them; lead keyword of a group now
//   prioritises already-ranks + metrics. New fusion-manual-group (group chosen singles → match an existing
//   blog by TITLE only → covered-add-angle, else a new To Write group).
// v6.4 (2026-11-14): covered detection now DISTRIBUTES keywords across the matching blogs instead of dumping
//   them all on the first one. Phase 1: specifics (style+room) spread across blogs of the same style+room,
//   max 5 per blog, never the same blog twice. Phase 2: the leftovers (style-only, room-only, or specifics
//   that didn't fit) go to a blog sharing style OR room, same cap. Keywords that fit no blog stay separate.
//   One card per blog (no more repeating the same blog). Grouping of uncovered keywords is unchanged.
// v6.3 (2026-11-14): find-fusion-groups takes reset:true → wipes the saved pending + the "already checked"
//   cache first, so a run re-evaluates EVERYTHING with the current logic (powers the "Reset & re-check"
//   button — old cached groups no longer mask new results). Covered cards are now split into chunks of ≤5
//   so no card is a giant wall of keywords (merge groups were already capped at 4).
// v6.2 (2026-11-14): synonym dictionary culled by Mae (1×1 review) + matching is now EXACT (no substring,
//   no typos) so "toilet"≠"toile", "wallpaper"≠"wall". Coffee style removed (no synonyms left). Grouping is
//   back to Mae's model: same style and/or room (general vs specific) — the meaningful-overlap experiment is
//   gone. Covered no longer uses the loose common-word fallback. Merge groups capped at 4 per blog. Kept:
//   persistent reject memory, and add-angle-apply auto-queues the Money Page Doctor link for folded keywords
//   that already rank (claim-to-registry → "Add the link").
// v6.0 (2026-11-14): fusion reject now PERSISTS. reject-fusion-keyword records the rejected keyword+bucket
//   in data/blog-fusion-rejections.json so future runs never re-form that same grouping (the keyword stays
//   free to join a different group/room or a future one). find-fusion-groups honours those rejections when
//   bucketing + detecting covered. New action restore-fusion-rejection powers a session-only "put back"
//   (undo) that re-adds the keyword to its original group and clears its rejection record.
// v5.9 (2026-11-14): find-fusion-groups is now DETERMINISTIC (no AI). Groups keywords by a STYLE (29) +
//   ROOM (10) synonym dictionary, typo-tolerant (Levenshtein on words ≥5 chars). General = only a style OR
//   only a room; specific = both. Generals group by shared style/room; a specific rolls into a general of
//   its style (preferred) or room; two specifics need style AND room. Covered keywords (already answered by
//   a published/scheduled blog) are pulled out first, bucketed per blog. New action reject-fusion-keyword
//   drops ONE keyword from a pending group and frees it for a future run. The old AI prompt is left unused.
// v5.7 (2026-11-13): find-fusion-groups — compact output {groups:[[..]], covered:[{k,blog}]} so the AI stops
//   listing every keyword (which overflowed tokens → 0 results). Keeps existing/scheduled-blog detection as
//   the priority. JSON-only, max_tokens 8000. Parse normalises the object into the group/covered entries.
// v5.6 (2026-11-13): find-fusion-groups prompt rewritten — groups by GENERAL vs SPECIFIC (same style and/or
//   same room; a specific can roll into a general of its style or room; two specifics need style+room match;
//   never across a different room/style). FIXES the "0 groups" bug where the AI returned every keyword as a
//   1-member group: output now must be real 2+ groups or a single keyword that is covered_by an existing blog.
// v5.5 (2026-11-13): UNIFIED duplicate check. find-fusion-groups now pools To Write + "You already rank"
//   in one run AND cross-checks published + scheduled blogs (new helpers fetchBlogsPubAndSched + getRankPool).
//   A group can be a merge (new blog) or "covered" (already in a published/scheduled blog). New actions:
//   remove-covered, add-angle-preview, add-angle-apply (Shopify articleUpdate + backup to
//   data/blog-angle-backups.json), add-angle-undo. apply-fusion-group now also adds a rank winner as a
//   TO_WRITE row and hides folded ranked keywords (gsc-performing-dismissed.json).
// v5.2 (2026-09-27): performing-keywords-blog cleans ranking URLs (drop query) so the real page shows + URL-lock check matches.
// v5.1 (2026-09-27): performing-keywords-blog now also hides the shared "✕ Dismiss" list (gsc-performing-dismissed.json).
// v5.0 (2026-09-27): new GET action performing-keywords-blog — "Ya rankeás — capturá más" (blog side):
//   informational keywords you already get clicks on (data/gsc-performing-keywords.json), not locked /
//   not already a blog / not dismissed; ranking URL shown only if free (taken URL = write a new blog).
//   The "add to registry to optimise" button reuses /api/keywords claim-to-registry; "use in blog" reuses
//   save-blog-ideas.
// blogs.js — v4.9
// v4.9 (2026-09-27): FIX — the fusion groups were found + saved but never SHOWED on screen. The two
//                    GET readers (get-fusion-pending, get-fused-groups) had been placed inside the POST
//                    block, but a GET request returns from the GET block first (default "return {blogs}")
//                    and never reaches the POST section — so the page got a blog list instead of the
//                    groups and rendered nothing. Moved both readers to the TOP of the GET block.
// v4.8 (2026-09-27): fix find-fusion-groups returning 0 groups despite real duplicates existing —
//                    the AI was asked to echo back exact keyword TEXT, and small rewording (case, a
//                    word) on echo silently dropped every group during exact-match filtering. Now the
//                    AI is sent a NUMBERED list and returns INDEX NUMBERS instead (immune to rewording).
//                    Also: the raw AI response is now ALWAYS saved to data/blog-fusion-last-raw.json
//                    (debugging never has to guess), and the result message shows "AI proposed N,
//                    M valid" when they differ.
// v4.7 (2026-09-27): blog fusion (anti-cannibalisation WITHIN To Write) — AI groups keywords that
//                    share the same search intent so they don't compete with each other; the group
//                    merges into ONE blog (winner picked by volume/GSC impressions, else AI's pick),
//                    the rest become secondary angles covered as H2 sections. New actions:
//                    find-fusion-groups, get-fusion-pending, apply-fusion-group, discard-fusion-group,
//                    get-fused-groups. New data files: blog-fusion-checked.json (cache — only new
//                    keywords get sent to AI next time), blog-fusion-pending.json (proposed, awaiting
//                    review), blog-fused-groups.json (applied, permanent). write-blog-body now accepts
//                    `secondaryAngles` and tells the writer to cover each as its own H2 section.
// v4.6 (2026-09-27): approving GSC blog topics now (a) auto-dismisses them from the panel so they
//                    don't reappear, and (b) saves them SPREAD through blog_ideas.csv (save-blog-ideas
//                    `spread:true`) instead of all at the end, so the monthly auto-pick distributes
//                    them across months. `dismiss-gsc-blog-topic` also accepts a `keywords` array.
// v4.5 (2026-09-26): gsc-blog-opportunities returns ALL informational topics (no cap) and excludes
//                    dismissed ones; new action `dismiss-gsc-blog-topic` (data/gsc-blog-dismissed.json).
// v4.4 (2026-09-26): new GET action `gsc-blog-opportunities` — informational GSC opportunity keywords
//                    for new blogs, minus ones a blog already covers (registry Published/To_Write blog).
// v4.3 (Sep 4, 2026): Scrappa competitor fallback now retries transient HTTP 503/429 (up to 3×,
//                     short backoff) before dead-ending — matches api/analyze-money-page.js v51.8.
// v4.2 (Aug 21, 2026): Blog scheduling now spaces new blogs EVERY OTHER DAY (1 day on, 1 day off)
//                      instead of one per day — the next free slot is now 2 days after the last
//                      scheduled blog, not 1. (publish-blog: gap 86400000 → 2 * 86400000.)
// v4.1 (Aug 2, 2026): Money Page Doctor Removed tab — mark-removed (bulk) sets registry rows to
//                     action REMOVED (page shows ONLY in the Removed tab, never back in Start Here/
//                     Optimized/Winners); restore-removed sends a page back to TO_OPTIMIZE.
// v4.0 (June 30, 2026): Money Page Doctor Winner-Hold — get-mpd-hold / save-mpd-hold actions
//                       (data/mpd-hold.json, array of URLs flagged "winner — don't optimise yet").
// v3.0: Blog Manager Batch 1 — send-to-sheet now auto-generates content sources (colG–colK):
//        authority article (title+URL) + YouTube video (title+link+embed) via Claude web search.
//        Fail-loud: if either is missing the row is NOT written; frontend collects missing parts manually.
//        maxDuration raised to 60s so the web search has time to finish.
// v3.1: colK embed format changed to width=100%/height=400; added colL = responsive embed (same video).
// v3.2: Blog Manager Batch 2 — send-to-sheet also generates People Also Ask (colP), More About (colQ),
//        More about URL (colR = colH), Meta Description (colT), Excerpt (colU), SEO Title (colV) via 3
//        parallel Claude writes; Visibility (colW)='Hidden' and Author (colX)='Mae Osz' fixed.
//        Fail-loud: if any write errors the row is NOT written; the user retries.
// v3.3: Blog Manager taxonomy — cluster classifier fills Primary (colY), Intent (colZ),
//        Supporting 1/2/3 (colAA/AB/AC, 2–3 picked), then Blogs by Topic (colO, JSON) using those clusters.
//        All values restricted to the CLUSTER SYSTEM MAP / allowed topic list. Fail-loud as above.
// v3.4: cluster classifier loosened — Supporting Clusters may come from ANY group (no more false
//        rejections like 'space-planning'); added fallbacks (living-room-decor for Primary, general
//        decor concept tags for Supporting) so a sensible result is always returned.
// v3.5: Blog Manager internal links — AD='full-metafields-blog-post', AE blank, AF–AM = the chosen
//        cluster tags (Primary + Supporting) as anchor text + their CLUSTER SYSTEM MAP URL. No new AI call.
// v3.6: Visual Inspiration (colAP HTML) — AI picks 3–5 trend pages by style/topic, also fills BB–BI
//        (first 4 as URL+anchor pairs). Video metafield (colAQ) = "WATCH:" + YouTube title linked to URL.
// v3.7: Products — picks 4 topic-matched products (2 About Wall Art + 2 Collective by value) from the
//        cluster collections → colAU–AX + colS (joined). Skips products used in the last ~30 blogs via
//        data/recent-blog-products.json (written AFTER the sheet append, best-effort, never blocks send).
// v3.8: Pro Tips / related blogs — 3 published blogs matched by Primary cluster concept in the TITLE
//        (then supporting clusters, then general recent posts as fallback). Fills AR + BM–BR + BU–CF.
//        Best-effort Shopify search; no new AI call (keyword used for the H2).
// v3.9: FIX related-blogs query — Blog.articles rejects query/sortKey; switched to the top-level
//        articles connection with query:"title:*term*" + sortKey PUBLISHED_AT (was silently failing → blank).
// v1.1: Added OPTIMISED_DATE column (col 11) to mark-optimized, unmark-optimized, get-registry
// v1.2: Strip \r from CSV lines to fix Windows line ending corruption; add-to-optimize action
// v1.3: Pad all written rows to 12 columns for consistent CSV structure
// v1.4: sanitizeRow() ensures 12 cols on every write; detectIntent() auto-sets intent from URL; repair-registry action fixes existing rows
// v1.5: delete-registry-row action — targeted single-row delete by keyword+url (used by Duplicate Finder)
// v1.6: repair-registry now overwrites intent on ALL rows (not just blank) — corrects historically wrong intent values
// v1.7: all write actions always use detectIntent(url) — frontend-passed intent is ignored, URL is ground truth
// v2.6: fix all write actions to use findIndex for header detection — prevents header row being wiped on CSV rewrite
import fs from 'fs';
import path from 'path';

// Raise serverless time limit — auto-generating content sources (web search) can take longer than the 10s default
export const config = { maxDuration: 60 };

// ── Cluster taxonomy (from CLUSTER SYSTEM MAP) — allowed tag names by group ──
const CLUSTER_TAXONOMY = {
  room: ['babies-kids-decor','bathroom-decor','bedroom-decor','breakfast-nook-decor','dressing-room-decor','dining-room-decor','fireplace-decor','games-room-decor','hallway-decor','home-bar-decor','kitchen-decor','laundry-room-decor','living-room-decor','pets-decor','office-decor','outdoor-decor','teens-decor','above-fireplace-decor'],
  style: ['abstract-style','bohemian-style','chinoiserie-style','christian-style','coastal-style','coffee-style','contemporary-style','eclectic-style','maximalist-style','farmhouse-style','french-country-style','islamic-style','japandi-style','marble-style','minimalist-style','scandinavian-style','shabby-chic-style','sun-moon-style','travel-style','tropical-style','wildlife-style','zen-style','industrial-style','masculine-style','mediterranean-style','mid-century-style','moroccan-style','old-money-style','preppy-style','transitional-style','biophilic-style','black-white-style'],
  colour: ['black-white','earth-toned','gold-accents','pastel-tones','pink-tones','neutral-tones','teal-tones','blue-tones'],
  accessory: ['appliances-decor','bar-decor','candles','clocks','sculptures','desk-decor','fireplace-accessories','shelves','foot-stools','games-decor','garden-decor','kitchen-accessories','lamps-lighting','mirrors','plants-pots','pet-accessories','rugs','storage-solutions','tableware','textiles','toilet-accessories','wall-panels','wallpaper'],
  occasion: ['birthday-decor','birthstone-decor','christmas-decor','family-decor','love-decor','zodiac-decor'],
  educational: ['interior-design-concepts','home-decor-theory','design-principles','interior-styling-frameworks','decor-mistakes','space-planning','room-layout-ideas','interior-trends','aesthetic-guides','colour-psychology','colour-theory','colour-combinations','how-to-use-colour','monochrome-design','contrast-in-design','warm-vs-cool-tones','accent-colour-ideas'],
  intent: ['styling-tips','buying-guide','inspiration','trend-report','how-to','gift-ideas','seasonal-decor','comparison','product-roundup']
};

// ── Blogs by Topic — allowed friendly labels (separate vocabulary from cluster tags) ──
const BLOGS_BY_TOPIC_OPTIONS = ['Kitchen','Bedroom','Bathroom','Living room','Office','Nursery','Hallways','Fireplaces','Laundry','Outdoor','Teens','Dressing Room','Breakfast Nook','Home Bar','Games Room','Pets','Above Fireplace','Minimalist','Scandinavian','Japandi','Bohemian','Farmhouse','Contemporary','Industrial','Mid-Century','Mediterranean','Moroccan','Coastal','Eclectic','Maximalist','Zen','Biophilic','Black & White','Christian','Islamic','Holidays','Gifts','Interior Design Concepts','Design Principles','Space Planning','Room Layout Ideas','Colour Theory','Colour Psychology','Colour Combinations','Accent Colour Ideas','Decor Mistakes','Colour Trends','Decor Trends','Buying Guides','How-To Guides','Styling Tips','Product Roundups','Trend Reports','Inspiration','Home Decor'];

// ── Cluster tag → destination URL (from CLUSTER SYSTEM MAP) — used for internal links (AF–AM) ──
const CLUSTER_URLS = {
  // Room
  'babies-kids-decor':'https://aboutwallart.com/collections/childrens-bedroom-decor-1','bathroom-decor':'https://aboutwallart.com/collections/bathroom-decor-for-walls','bedroom-decor':'https://aboutwallart.com/collections/wall-art-for-a-bedroom','breakfast-nook-decor':'https://aboutwallart.com/collections/breakfast-nook-decor','dressing-room-decor':'https://aboutwallart.com/collections/dressing-room-decor','dining-room-decor':'https://aboutwallart.com/collections/dining-room-decor','fireplace-decor':'https://aboutwallart.com/collections/above-fireplaces','games-room-decor':'https://aboutwallart.com/collections/games-room-decor-1','hallway-decor':'https://aboutwallart.com/collections/hallway-decor','home-bar-decor':'https://aboutwallart.com/collections/home-bar-decoration','kitchen-decor':'https://aboutwallart.com/collections/kitchen-wall-art-decor','laundry-room-decor':'https://aboutwallart.com/collections/laundry-room-decor','living-room-decor':'https://aboutwallart.com/collections/framed-wall-pictures-for-living-room','pets-decor':'https://aboutwallart.com/collections/all-you-need-for-your-pets-at-home','office-decor':'https://aboutwallart.com/collections/office-wall-artwork','outdoor-decor':'https://aboutwallart.com/collections/outdoors-home-decorations','teens-decor':'https://aboutwallart.com/collections/teens-bedroom-decor','above-fireplace-decor':'https://aboutwallart.com/collections/above-fireplaces',
  // Style
  'abstract-style':'https://aboutwallart.com/collections/abstract-art-prints','bohemian-style':'https://aboutwallart.com/collections/bohemian-wall-art','chinoiserie-style':'https://aboutwallart.com/collections/chinoiserie-wall-decor','christian-style':'https://aboutwallart.com/collections/christian-wall-art','coastal-style':'https://aboutwallart.com/collections/coastal-decor','coffee-style':'https://aboutwallart.com/collections/coffee-wall-art','contemporary-style':'https://aboutwallart.com/collections/contemporary-wall-art','eclectic-style':'https://aboutwallart.com/collections/eclectic-maximalist-decor','maximalist-style':'https://aboutwallart.com/collections/eclectic-maximalist-decor','farmhouse-style':'https://aboutwallart.com/collections/farmhouse-wall-art','french-country-style':'https://aboutwallart.com/collections/french-country-wall-art','islamic-style':'https://aboutwallart.com/collections/wall-islamic-art','japandi-style':'https://aboutwallart.com/pages/japandi-home-decor-trend','marble-style':'https://aboutwallart.com/collections/marble-wall-art','minimalist-style':'https://aboutwallart.com/collections/minimalist-art-prints','scandinavian-style':'https://aboutwallart.com/collections/scandinavian-wall-art','shabby-chic-style':'https://aboutwallart.com/collections/shabby-and-chic-home-decor','sun-moon-style':'https://aboutwallart.com/collections/sun-and-moon-art','travel-style':'https://aboutwallart.com/collections/travel-wall-art','tropical-style':'https://aboutwallart.com/collections/tropical-wall-art','wildlife-style':'https://aboutwallart.com/collections/wild-life-decor','zen-style':'https://aboutwallart.com/pages/zen-room-decorations','industrial-style':'https://aboutwallart.com/pages/industrial-home-decor-trend','masculine-style':'https://aboutwallart.com/pages/masculine-living-room-ideas','mediterranean-style':'https://aboutwallart.com/pages/mediterranean-home-decor-trend','mid-century-style':'https://aboutwallart.com/collections/mid-century-decor','moroccan-style':'https://aboutwallart.com/pages/moroccan-home-decor-trend','old-money-style':'https://aboutwallart.com/pages/old-money-home-decor','preppy-style':'https://aboutwallart.com/pages/preppy-style-interiors','transitional-style':'https://aboutwallart.com/pages/transitional-interior-design','biophilic-style':'https://aboutwallart.com/pages/biophilic-interior-design','black-white-style':'https://aboutwallart.com/pages/black-white-home-decor-trend',
  // Colour
  'black-white':'https://aboutwallart.com/collections/black-and-white-art-on-wall','earth-toned':'https://aboutwallart.com/collections/earth-tone-wall-decor','gold-accents':'https://aboutwallart.com/collections/gold-wall-art','pastel-tones':'https://aboutwallart.com/collections/pastel-art','pink-tones':'https://aboutwallart.com/collections/pink-wall-art','neutral-tones':'https://aboutwallart.com/collections/neutral-wall-art','teal-tones':'https://aboutwallart.com/collections/teal-colour-wall-art','blue-tones':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme',
  // Decor accessory
  'appliances-decor':'https://aboutwallart.com/collections/modern-smart-home-appliances','bar-decor':'https://aboutwallart.com/collections/bar-accessories-for-home','candles':'https://aboutwallart.com/collections/candles','clocks':'https://aboutwallart.com/collections/wall-clocks','sculptures':'https://aboutwallart.com/collections/sculptures-ornaments','desk-decor':'https://aboutwallart.com/collections/desk-accessories','fireplace-accessories':'https://aboutwallart.com/collections/fireplace-accessories','shelves':'https://aboutwallart.com/collections/floating-shelves-for-home','foot-stools':'https://aboutwallart.com/collections/footstools','games-decor':'https://aboutwallart.com/collections/tabletop-games','garden-decor':'https://aboutwallart.com/collections/garden-decor-accessories','kitchen-accessories':'https://aboutwallart.com/collections/kitchen-items','lamps-lighting':'https://aboutwallart.com/collections/lightning-lamps','mirrors':'https://aboutwallart.com/collections/wall-mirrors','plants-pots':'https://aboutwallart.com/collections/plants-pots-planters','pet-accessories':'https://aboutwallart.com/collections/all-you-need-for-your-pets-at-home','rugs':'https://aboutwallart.com/collections/rugs','storage-solutions':'https://aboutwallart.com/collections/storage-items','tableware':'https://aboutwallart.com/collections/dining-tableware','textiles':'https://aboutwallart.com/collections/home-textiles','toilet-accessories':'https://aboutwallart.com/collections/bathroom-accessories','wall-panels':'https://aboutwallart.com/collections/wall-paneling','wallpaper':'https://aboutwallart.com/collections/wallpaper',
  // Occasion
  'birthday-decor':'https://aboutwallart.com/collections/unique-birthday-gifts','birthstone-decor':'https://aboutwallart.com/collections/birthstone-gifts-that-arent-jewelry','christmas-decor':'https://aboutwallart.com/collections/christmas-wall-decor','family-decor':'https://aboutwallart.com/collections/personalised-family-gifts','love-decor':'https://aboutwallart.com/collections/prints-of-love','zodiac-decor':'https://aboutwallart.com/collections/zodiac-in-art',
  // Educational / concept
  'interior-design-concepts':'https://aboutwallart.com/pages/home-decor-by-trend','home-decor-theory':'https://aboutwallart.com/pages/home-decor-by-trend','design-principles':'https://aboutwallart.com/pages/home-decor-by-trend','interior-styling-frameworks':'https://aboutwallart.com/pages/home-decor-by-trend','decor-mistakes':'https://aboutwallart.com/pages/home-decor-by-trend','space-planning':'https://aboutwallart.com/pages/home-decor-by-room','room-layout-ideas':'https://aboutwallart.com/pages/home-decor-by-room','interior-trends':'https://aboutwallart.com/pages/home-decor-by-trend','aesthetic-guides':'https://aboutwallart.com/pages/home-decor-by-trend','colour-psychology':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','colour-theory':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','colour-combinations':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','how-to-use-colour':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','monochrome-design':'https://aboutwallart.com/collections/black-and-white-art-on-wall','contrast-in-design':'https://aboutwallart.com/pages/home-decor-by-trend','warm-vs-cool-tones':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','accent-colour-ideas':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme',
  // Intent
  'styling-tips':'https://aboutwallart.com/pages/home-decor-by-room','buying-guide':'https://aboutwallart.com/pages/home-decor-items','inspiration':'https://aboutwallart.com/pages/home-decor-by-trend','trend-report':'https://aboutwallart.com/pages/home-decor-by-trend','how-to':'https://aboutwallart.com/pages/home-decor-by-room','comparison':'https://aboutwallart.com/pages/home-decor-by-type','product-roundup':'https://aboutwallart.com/collections/best-sellers','gift-ideas':'https://aboutwallart.com/pages/celebration-gifts-shop-by-ocassion','seasonal-decor':'https://aboutwallart.com/collections/holiday-home-decor'
};

// ── Allowed Trend Pages (for Visual Inspiration AP + BB–BI) — name → URL ──
const TREND_PAGES = {
  'Mid Century Trend':'https://aboutwallart.com/pages/mid-century-trend',
  'Modern Glam Luxe Interior Trend':'https://aboutwallart.com/pages/modern-glam-luxe-interiors',
  'Boho Home Decor Trend':'https://aboutwallart.com/pages/boho-home-decor-trend',
  'Coastal Home Decor Trend':'https://aboutwallart.com/pages/coastal-home-decor-trend',
  'Modern Contemporary Home Decor Trend':'https://aboutwallart.com/pages/modern-contemporary-home-decor',
  'Eclectic Maximalist Home Decor Trend':'https://aboutwallart.com/pages/eclectic-maximalist-home-decor-trend',
  'Modern Farmhouse Home Decor Trend':'https://aboutwallart.com/pages/modern-farmhouse-home-decor',
  'French Country Home Decor Trend':'https://aboutwallart.com/pages/french-country-home-decor',
  'Industrial Home Decor Trend':'https://aboutwallart.com/pages/industrial-home-decor-trend',
  'Japandi Home Decor Trend':'https://aboutwallart.com/pages/japandi-home-decor-trend',
  'Mediterranean Home Decor Trend':'https://aboutwallart.com/pages/mediterranean-home-decor-trend',
  'Cosy Minimalism Home Decor Trend':'https://aboutwallart.com/pages/cosy-minimalism-home-decor-trend',
  'Moroccan Home Decor Trend':'https://aboutwallart.com/pages/moroccan-home-decor-trend',
  'Country Cottage Home Decor Trend':'https://aboutwallart.com/pages/country-cottage-home-decor-trend',
  'Scandi Home Decor Trend':'https://aboutwallart.com/pages/scandi-home-decor-trend',
  'Wildlife Home Decor Trend':'https://aboutwallart.com/pages/wildlife-home-decor-trend',
  'Biophilic Interior Design Trend':'https://aboutwallart.com/pages/biophilic-interior-design',
  'Zen Room Decoration Trend':'https://aboutwallart.com/pages/zen-room-decorations',
  'Tropical Decor for Home Trend':'https://aboutwallart.com/pages/tropical-decor-for-home',
  'Transitional Interior Design Trend':'https://aboutwallart.com/pages/transitional-interior-design',
  'Preppy Style Interiors Trend':'https://aboutwallart.com/pages/preppy-style-interiors',
  'Old Money Home Decor Trend':'https://aboutwallart.com/pages/old-money-home-decor',
  'Coffee House Interior Design Trend':'https://aboutwallart.com/pages/coffee-house-interior-design',
  'Masculine Home Decor Trend':'https://aboutwallart.com/pages/masculine-living-room-ideas',
  'Black & White Home Decor Trend':'https://aboutwallart.com/pages/black-white-home-decor-trend'
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'aboutwallart/seo-tools';
  const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;

  // Helper: fetch file from GitHub
  async function getGitHubFile(filePath) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
    const data = await response.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha
    };
  }

  // Helper: update file on GitHub
  async function updateGitHubFile(filePath, content, sha, message) {
    // Retry on a 409 SHA conflict: GitHub's contents API is read-after-write lagged, so a freshly-read SHA
    // can already be stale → re-fetch the current SHA and try again (up to 3 attempts) instead of failing.
    let attempt = 0, lastErr = '';
    while (attempt < 3) {
      const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          content: Buffer.from(content).toString('base64'),
          sha
        })
      });
      if (response.ok) return true;
      lastErr = await response.text();
      const isConflict = response.status === 409 || /but expected|does not match|sha/i.test(lastErr);
      if (!isConflict) throw new Error(`Failed to update ${filePath}: ${lastErr}`);
      attempt++;
      if (attempt >= 3) break;
      await new Promise(r => setTimeout(r, 400 * attempt));
      try { const cur = await getGitHubFile(filePath); sha = cur.sha; } catch (e) { /* keep old sha, retry anyway */ }
    }
    throw new Error(`Failed to update ${filePath}: ${lastErr}`);
  }

  // Helper: quote a CSV field if it contains commas, quotes or newlines
  function csvField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // Helper: detect intent from URL
  function detectIntent(url) {
    if (!url || url === 'N/A') return 'UNKNOWN';
    if (url.includes('/collections/') || url.includes('/products/')) return 'COMMERCIAL';
    if (url.includes('/blog')) return 'INFORMATIONAL';
    if (url.includes('/pages/')) return 'NAVIGATIONAL';
    return 'UNKNOWN';
  }

  // Helper: find title lines, header line, and data start index in registry CSV
  // Returns { titleLines, header, startIdx } — works whether CSV has a title row or not
  function findRegistryHeader(lines) {
    const FALLBACK_HEADER = 'Keyword,Page URL,LOCKED,Status,Action,Clicks,Position,Match Score,AI Score,Source,INTENT,OPTIMIZED DATE';
    const headerIdx = lines.findIndex(l => l.includes('Keyword') && l.includes('Page URL'));
    const titleLines = headerIdx > 0 ? lines.slice(0, headerIdx) : [];
    const header = headerIdx >= 0 ? lines[headerIdx] : FALLBACK_HEADER;
    const startIdx = headerIdx >= 0 ? headerIdx + 1 : 1;
    return { titleLines, header, startIdx };
  }

  // Helper: pad cols array to exactly 12 and return a properly quoted CSV row string
  function sanitizeRow(cols) {
    const padded = [...cols];
    while (padded.length < 12) padded.push('');
    padded.length = 12;
    return padded.map(csvField).join(',');
  }

  // Helper: parse CSV line handling quoted fields
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"'; i++; // escaped quote "" → "
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim()); current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Helper: append row to Google Sheet via Apps Script webhook
  // sources (optional) = { authorityTitle, authorityUrl, youtubeTitle, youtubeLink, youtubeEmbed } → columns G–K
  async function appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl, sources = {}) {
    if (!SHEETS_WEBHOOK) {
      console.log('SHEETS_WEBHOOK_URL not configured - skipping Google Sheets append');
      return { skipped: true };
    }
    const response = await fetch(SHEETS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        colA: 'BLOG MANAGER TOOL',
        colB: perspective || '',
        colC: keyword || '',
        colD: galleryCode || '',
        colE: collectionUrl || '',
        colF: title || '',
        colG: sources.authorityTitle || '',
        colH: sources.authorityUrl || '',
        colI: sources.youtubeTitle || '',
        colJ: sources.youtubeLink || '',
        colK: sources.youtubeEmbed || '',
        colL: sources.youtubeEmbedResponsive || '',
        colO: sources.blogsByTopic || '',
        colP: sources.peopleAlsoAsk || '',
        colQ: sources.moreAbout || '',
        colR: sources.moreAboutUrl || '',
        colS: sources.productList || '',
        colT: sources.metaDescription || '',
        colU: sources.excerpt || '',
        colV: sources.seoTitle || '',
        colW: sources.visibility || '',
        colX: sources.author || '',
        colY: sources.primaryCluster || '',
        colZ: sources.intentTag || '',
        colAA: sources.supporting1 || '',
        colAB: sources.supporting2 || '',
        colAC: sources.supporting3 || '',
        colAD: 'full-metafields-blog-post',   // Theme template (fixed)
        colAE: '',                            // Visibility date (always blank)
        colAF: sources.anchor1 || '',
        colAG: sources.url1 || '',
        colAH: sources.anchor2 || '',
        colAI: sources.url2 || '',
        colAJ: sources.anchor3 || '',
        colAK: sources.url3 || '',
        colAL: sources.anchor4 || '',
        colAM: sources.url4 || '',
        colAP: sources.visualInspirationHtml || '',
        colAQ: sources.videoMetafield || '',
        colAR: sources.proTipsMetafield || '',
        colAS: 'READY TO GENERATE BLOG',
        colAU: sources.product1 || '',
        colAV: sources.product2 || '',
        colAW: sources.product3 || '',
        colAX: sources.product4 || '',
        colAY: '',
        colBB: sources.viUrl1 || '',
        colBC: sources.viAnchor1 || '',
        colBD: sources.viUrl2 || '',
        colBE: sources.viAnchor2 || '',
        colBF: sources.viUrl3 || '',
        colBG: sources.viAnchor3 || '',
        colBH: sources.viUrl4 || '',
        colBI: sources.viAnchor4 || '',
        colBM: sources.pt1Anchor || '',
        colBN: sources.pt1Url || '',
        colBO: sources.pt2Anchor || '',
        colBP: sources.pt2Url || '',
        colBQ: sources.pt3Anchor || '',
        colBR: sources.pt3Url || '',
        colBU: sources.pt1Handle || '',
        colBV: sources.pt2Handle || '',
        colBW: sources.pt3Handle || '',
        colBX: sources.pt1Image || '',
        colBY: sources.pt2Image || '',
        colBZ: sources.pt3Image || '',
        colCA: sources.blog1Gid || '',
        colCB: sources.blog1Id || '',
        colCC: sources.blog2Gid || '',
        colCD: sources.blog2Id || '',
        colCE: sources.blog3Gid || '',
        colCF: sources.blog3Id || ''
      })
    });
    if (!response.ok) throw new Error(`Sheets webhook error: ${response.status}`);
    return await response.json();
  }

  // Helper: extract the 11-char YouTube video id from a watch/share/embed/shorts link. Returns '' if none.
  function extractYouTubeId(link) {
    if (!link) return '';
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,        // watch?v=ID
      /youtu\.be\/([A-Za-z0-9_-]{11})/,    // youtu.be/ID
      /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/, // /embed/ID
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/ // /shorts/ID
    ];
    for (const p of patterns) {
      const m = link.match(p);
      if (m) return m[1];
    }
    return '';
  }

  // Column K — simple fixed embed. Returns '' if no id.
  function buildYouTubeEmbed(id) {
    if (!id) return '';
    return `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe>`;
  }

  // Column L — responsive embed wrapped in a 16:9 sizing div. Returns '' if no id.
  function buildYouTubeEmbedResponsive(id) {
    if (!id) return '';
    return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;"><iframe src="https://www.youtube.com/embed/${id}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen></iframe></div>`;
  }

  // Helper: auto-generate Batch 1 content sources via Claude web search.
  // Returns { authorityTitle, authorityUrl, youtubeTitle, youtubeLink } — any field may be '' if not found.
  async function generateContentSources(keyword, title) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const prompt = `You are preparing a blog post for aboutwallart.com, an interior design and wall art e-commerce site.
Blog topic / main keyword: "${keyword}"
Blog working title: "${title}"

Use web search to find:
1. ONE authoritative, trustworthy external article on this topic from a reputable source (a design magazine, established publication, museum, university, or recognised expert site). It MUST NOT be an online shop selling wall art, prints or home decor (no competitor stores). Give its exact published title and full URL.
2. ONE relevant, good-quality YouTube video on this topic. Give its exact title and full watch URL in the form https://www.youtube.com/watch?v=VIDEOID

Return ONLY a JSON object, with no commentary before or after, in exactly this shape:
{"authorityTitle":"","authorityUrl":"","youtubeTitle":"","youtubeLink":""}
If you genuinely cannot find one of the two, leave its two fields as empty strings.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      const low = (errText || '').toLowerCase();
      const outOfCredits = response.status === 402 || response.status === 429 || low.includes('credit') || low.includes('billing') || low.includes('quota') || low.includes('insufficient');
      throw new Error(outOfCredits
        ? 'Claude is out of credits or rate-limited — top up your Anthropic account, then press again.'
        : `Claude API error: ${response.status} ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not read the search result (no data returned)');

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) { throw new Error('Search result was not in a readable format'); }

    return {
      authorityTitle: (parsed.authorityTitle || '').trim(),
      authorityUrl: (parsed.authorityUrl || '').trim(),
      youtubeTitle: (parsed.youtubeTitle || '').trim(),
      youtubeLink: (parsed.youtubeLink || '').trim()
    };
  }

  // Helper: fetch ALL live-published blog articles (title + real URL) for the cannibalisation check.
  // Paginates the Shopify articles connection; skips drafts and future-scheduled posts.
  async function fetchPublishedBlogs() {
    const out = [];
    let cursor = null;
    const now = Date.now();
    for (let page = 0; page < 12; page++) {
      const data = await shopifyGraphQL(
        `query($cursor:String){ articles(first:250, after:$cursor, sortKey:PUBLISHED_AT, reverse:true){ edges{ cursor node{ title handle publishedAt blog{ handle } } } pageInfo{ hasNextPage } } }`,
        { cursor }
      );
      const conn = data.articles;
      if (!conn) break;
      const edges = conn.edges || [];
      for (const e of edges) {
        const n = e.node;
        if (!n || !n.publishedAt) continue;                       // draft / not published
        if (new Date(n.publishedAt).getTime() > now) continue;    // scheduled for the future
        const blogHandle = (n.blog && n.blog.handle) || 'news-articles-home-decor-inspiration';
        out.push({ title: n.title || '', url: `https://aboutwallart.com/blogs/${blogHandle}/${n.handle || ''}` });
      }
      if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
      cursor = edges.length ? edges[edges.length - 1].cursor : null;
      if (!cursor) break;
    }
    return out;
  }

  // Helper: published AND future-scheduled blog articles (id + title + handle + status) — used by the
  // unified duplicate check (to flag a topic already covered) and by "add angle to an existing blog".
  async function fetchBlogsPubAndSched() {
    // Robust: 100/page (first:250 intermittently failed the whole fetch → the dedup + blog search found
    // "no blogs"), retry each page once, and keep whatever we already have if a later page still fails
    // (partial beats empty). Never throws, so a Shopify hiccup never silently empties the blog list.
    const out = [];
    let cursor = null;
    const now = Date.now();
    const QUERY = `query($cursor:String){ articles(first:100, after:$cursor, sortKey:PUBLISHED_AT, reverse:true){ edges{ cursor node{ id title handle publishedAt blog{ handle } } } pageInfo{ hasNextPage } } }`;
    for (let page = 0; page < 30; page++) {
      let data = null;
      try { data = await shopifyGraphQL(QUERY, { cursor }); }
      catch (e1) { try { await new Promise(r => setTimeout(r, 600)); data = await shopifyGraphQL(QUERY, { cursor }); } catch (e2) { console.error('fetchBlogsPubAndSched page ' + page + ' failed:', (e2 && e2.message) || e2); break; } }
      const conn = data && data.articles; if (!conn) break;
      const edges = conn.edges || [];
      for (const e of edges) {
        const n = e.node; if (!n) continue;
        const t = n.publishedAt ? new Date(n.publishedAt).getTime() : null;
        const status = (t == null) ? 'draft' : (t > now ? 'scheduled' : 'published');
        if (status === 'draft') continue; // tool-side drafts are handled separately
        const blogHandle = (n.blog && n.blog.handle) || 'news-articles-home-decor-inspiration';
        out.push({ id: n.id, title: n.title || '', handle: n.handle || '', status, url: `https://aboutwallart.com/blogs/${blogHandle}/${n.handle || ''}` });
      }
      if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
      cursor = edges.length ? edges[edges.length - 1].cursor : null;
      if (!cursor) break;
    }
    return out;
  }

  // ── Shared topic matcher (duplicate check) ──────────────────────────────────────────────────────────
  // Tags a keyword / blog TITLE with a STYLE and a ROOM. The FIRST word in each list is the PRINCIPAL
  // (the canonical word, e.g. "old money", "office"); the rest are synonyms. Matching is plural-tolerant
  // (office/offices) and joined/split tolerant (playroom = play room). Used by find-fusion-groups AND
  // fusion-manual-group so the automatic check and the by-hand grouping behave identically.
  const TOPIC_STYLE_DICT = [
    ['Biophilic', ['biophilic','botanical','plants','greenery','nature']],
    ['Farmhouse', ['farmhouse','floral','rustic','country','barn','cottage','cottagecore','wildflower']],
    ['Shabby chic', ['shabby chic','romantic','pastel','antique rose']],
    ['Vintage', ['vintage','retro','antique','nostalgic','heritage','old-fashioned']],
    ['Japandi', ['japandi','japan','japanese','asian','oriental','wabi-sabi','crane','cranes']],
    ['Zen', ['zen','buddha','buddhist','buddhism','lotus','meditation','mindfulness','yoga','spiritual']],
    ['Scandinavian', ['scandinavian','scandi','nordic','hygge']],
    ['Travel', ['travel','world','wanderlust']],
    ['Christian', ['christian','faith','bible','scripture','cross','jesus','god','prayer','psalm','verse','church','blessing','holy']],
    ['Islamic', ['islamic','islam','muslim','quran','arabic','arab','arabesque','mosque','allah','calligraphy','ayat','ramadan','eid','kaaba']],
    ['Minimalism', ['minimalist','minimal','minimalism']],
    ['Masculine', ['masculine','male','manly','gentleman']],
    ['Industrial', ['industrial','urban','loft','steampunk']],
    ['Moroccan', ['moroccan','morocco','marrakech','mosaic','tile']],
    ['Abstract', ['abstract','modern art']],
    ['Bohemian', ['bohemian','boho','hippie']],
    ['Coastal', ['coastal','beach','sea','ocean','nautical','seaside','shells','waves','lighthouse','sailing','hamptons']],
    ['Tropical', ['tropical','jungle','exotic']],
    ['Wildlife', ['wildlife','safari','elephant','lion','tiger']],
    ['Sun & moon', ['sun and moon','celestial','moon','stars','lunar','galaxy','constellation']],
    ['Black & white', ['black and white','monochrome','greyscale']],
    ['Chinoiserie', ['chinoiserie']],
    ['Mid century', ['mid century','midcentury','retro','lux','luxury']],
    ['Mediterranean', ['mediterranean']],
    ['Contemporary', ['contemporary','modern']],
    ['Maximalism', ['maximalism','maximalist','eclectic']],
    ['French country', ['french country','provence','bees','hives','beehive']],
    ['Old money', ['old money','heritage','classic']]
  ];
  const TOPIC_ROOM_DICT = [
    ['Living room', ['living room','lounge','sitting room','tv room','snug']],
    ['Family room', ['family room']],
    ['Bedroom', ['bedroom','master bedroom','guest room','above bed']],
    ['Nursery/Kids', ['nursery','kids room','kids bedroom','children bedroom','children room','baby room','playroom','boys room','girls room','teen bedroom','toddlers room','toddlers bedroom']],
    ['Bathroom', ['bathroom','toilet','washroom','restroom']],
    ['Kitchen', ['kitchen','breakfast nook','breakfast']],
    ['Dining', ['dining room','dining']],
    ['Hallway', ['hallway','corridor','entryway','entrance','foyer']],
    ['Office', ['office','home office','study','workspace','desk']],
    ['Reading room', ['reading room','reading nook','library']],
    ['Outdoor', ['outdoor','garden','patio','balcony']]
  ];
  // ── Custom rooms/styles Mae adds by hand from the Discover tab (persisted on GitHub). They are merged into
  // the live taxonomy above, so BOTH the Discover cards AND the duplicate check (topicTagBoth) recognise them
  // — there is only one live list to keep in sync. Built-in names are captured first so the tool can tell a
  // custom entry apart (for the remove "×"). Loaded only for discover/fusion/gsc actions; files may not exist.
  const BUILTIN_STYLE_NAMES = new Set(TOPIC_STYLE_DICT.map(e => String(e[0]).toLowerCase()));
  const BUILTIN_ROOM_NAMES = new Set(TOPIC_ROOM_DICT.map(e => String(e[0]).toLowerCase()));
  if (/discover|fusion|gsc/i.test(String((req.body && req.body.action) || (req.query && req.query.action) || ''))) {
    try {
      const _customToPair = (e) => {
        const name = String((e && e.name) || '').trim();
        if (!name) return null;
        const term = name.toLowerCase();
        const syns = Array.isArray(e && e.synonyms) ? e.synonyms.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [];
        return [name, [term, ...syns]];
      };
      const _cs = await readJsonFileSafe('data/discover-custom-styles.json', []);
      const _cr = await readJsonFileSafe('data/discover-custom-rooms.json', []);
      (Array.isArray(_cs) ? _cs : []).map(_customToPair).filter(Boolean).forEach(p => { if (!TOPIC_STYLE_DICT.some(e => String(e[0]).toLowerCase() === p[0].toLowerCase())) TOPIC_STYLE_DICT.push(p); });
      (Array.isArray(_cr) ? _cr : []).map(_customToPair).filter(Boolean).forEach(p => { if (!TOPIC_ROOM_DICT.some(e => String(e[0]).toLowerCase() === p[0].toLowerCase())) TOPIC_ROOM_DICT.push(p); });
    } catch (e) { /* custom taxonomy optional */ }
  }
  const topicNorm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const topicDepl = (w) => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w; // singular/plural tolerant
  // A synonym "hits" if it appears as a whole word / consecutive phrase (plural tolerant), OR two adjacent
  // words joined equal it (play room → playroom), OR a multi-word synonym joined equals one token.
  const topicSynHit = (tokens, synRaw) => {
    const syn = topicNorm(synRaw); if (!syn) return false;
    const sw = syn.split(' ');
    if (sw.length === 1) {
      const s = topicDepl(syn);
      for (let i = 0; i < tokens.length; i++) { if (topicDepl(tokens[i]) === s) return true; }
      for (let i = 0; i + 1 < tokens.length; i++) { if (topicDepl(tokens[i] + tokens[i + 1]) === s) return true; }
      return false;
    }
    const swd = sw.map(topicDepl);
    for (let i = 0; i + sw.length <= tokens.length; i++) {
      let ok = true; for (let j = 0; j < sw.length; j++) { if (topicDepl(tokens[i + j]) !== swd[j]) { ok = false; break; } }
      if (ok) return true;
    }
    const joined = topicDepl(sw.join(''));
    for (let i = 0; i < tokens.length; i++) { if (topicDepl(tokens[i]) === joined) return true; }
    return false;
  };
  const topicTag = (text, principalOnly) => {
    const tokens = topicNorm(text).split(' ').filter(Boolean);
    let style = null, room = null;
    for (const e of TOPIC_STYLE_DICT) { const syns = principalOnly ? [e[1][0]] : e[1]; if (syns.some(s => topicSynHit(tokens, s))) { style = e[0]; break; } }
    for (const e of TOPIC_ROOM_DICT) { const syns = principalOnly ? [e[1][0]] : e[1]; if (syns.some(s => topicSynHit(tokens, s))) { room = e[0]; break; } }
    return { style, room };
  };
  const topicTagBoth = (text) => ({ tagP: topicTag(text, true), tagS: topicTag(text, false) });
  // The 4-step cascade: (1) principal pair, (2) synonym pair, (3) principal single, (4) synonym single.
  // Each returns true if keyword-tag t matches blog-tag b at that level (both carry tagP + tagS).
  // A single-dimension match (style-only or room-only) only covers a GENERAL blog on the other dimension —
  // a style-only keyword is covered by a style-only blog, a room-only keyword by a room-only blog. So a
  // Living-room keyword is never flagged covered by a specific "Abstract + Living room" blog (that blog is
  // about abstract art, not the keyword's topic). Specific topics instead go to Grouped for a new blog.
  // Pair matches (style+room both) stay exact.
  const singleMatch = (tag, bt) => {
    const styleOk = tag.style && bt.style === tag.style && !bt.room;  // keyword's style ↔ a general style blog
    const roomOk  = tag.room  && bt.room  === tag.room  && !bt.style; // keyword's room  ↔ a general room blog
    return !!(styleOk || roomOk);
  };
  const TOPIC_PHASES = [
    (t, b) => !!(t.tagP.style && t.tagP.room && b.tagP.style === t.tagP.style && b.tagP.room === t.tagP.room),
    (t, b) => !!(t.tagS.style && t.tagS.room && b.tagS.style === t.tagS.style && b.tagS.room === t.tagS.room),
    (t, b) => singleMatch(t.tagP, b.tagP),
    (t, b) => singleMatch(t.tagS, b.tagS)
  ];

  // Helper: the "You already rank" pool (informational keywords you already get clicks on, not locked,
  // not already a blog, not dismissed) — mirrors the performing-keywords-blog action, returns ALL of them
  // with the ranking URL + whether that URL is free. Used to fold "You already rank" into the duplicate check.
  async function getRankPool() {
    let list = [];
    try {
      const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-performing-keywords.json?t=${Date.now()}`);
      if (rr.ok) { const j = await rr.json(); list = Array.isArray(j.keywords) ? j.keywords : []; }
    } catch (e) { /* no list yet */ }
    const lockedSet = new Set(); const blogKws = []; const urlLock = {};
    const cleanU = u => String(u || '').split(/[?#]/)[0];
    const nrm = u => cleanU(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    try {
      const rc = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/keyword-locker-registry.csv?t=${Date.now()}`);
      if (rc.ok) {
        const txt = await rc.text();
        txt.split('\n').forEach((line, i) => {
          if (i === 0 || !line.trim()) return;
          const c = parseCSVLine(line.replace(/\r/g, ''));
          const kw = (c[0] || '').toLowerCase(); const url = (c[1] || '').trim(); const lk = (c[2] || '').toUpperCase(); const src = (c[9] || '');
          if (kw && lk === 'LOCKED') lockedSet.add(kw);
          if (url && url !== 'N/A' && lk === 'LOCKED') { const k = nrm(url); if (!urlLock[k]) urlLock[k] = c[0] || ''; }
          if ((src === 'Published Blog' || src === 'To_Write_Blog') && c[0]) blogKws.push(kw);
        });
      }
    } catch (e) { /* ignore */ }
    let dismissed = [];
    try { const df = await getGitHubFile('data/gsc-blog-dismissed.json'); dismissed = (JSON.parse(df.content) || []).map(s => String(s).toLowerCase()); } catch (e) { dismissed = []; }
    let perfDismissed = [];
    try { const pf = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-performing-dismissed.json?t=${Date.now()}`); if (pf.ok) { const j = await pf.json(); perfDismissed = (Array.isArray(j) ? j : []).map(s => String(s).toLowerCase()); } } catch (e) { perfDismissed = []; }
    const lockedArr = [...lockedSet];
    return list
      .filter(k => k && k.keyword && k.intent === 'blog')
      .filter(k => { const kw = k.keyword.toLowerCase();
        if (lockedSet.has(kw)) return false;
        if (lockedArr.some(lk => lk.includes(kw))) return false;
        if (blogKws.some(bk => bk === kw || bk.includes(kw))) return false;
        if (dismissed.includes(kw)) return false;
        if (perfDismissed.includes(kw)) return false;
        return true;
      })
      .map(k => {
        const cleanRanking = k.rankingUrl ? cleanU(k.rankingUrl) : null;
        const lockedTo = cleanRanking ? urlLock[nrm(cleanRanking)] : null;
        return { keyword: k.keyword, impressions: k.impressions || null, pageUrl: cleanRanking || null, urlFree: !!(cleanRanking && !lockedTo), lockedToKeyword: lockedTo || null };
      });
  }

  // Helper: for each working title, derive the TRUE short main keyword and flag cannibalisation
  // against the already-published blogs — judged the way Google would: by SEARCH INTENT, not shared words.
  // Method: (1) derive the real short keyword, (2) NARROW to a shortlist of published blogs that share a
  // distinctive word (generic site words like "wall art" ignored; a few synonyms expanded), (3) let Claude
  // pick the SINGLE closest blog by whether a searcher would be satisfied by the same page.
  // Returns [{ title, keyword, cannibalization, conflictingKeyword (blog TITLE), conflictingUrl, looserCount }].
  async function analyzeTitlesForKeywords(titles, published) {
    // Words shared across the whole site — not clues to cannibalisation.
    const GENERIC = new Set(['wall','art','arts','decor','decoration','home','house','best','how','what','why','can','do','does','i','my','me','the','a','an','in','on','for','to','of','with','your','you','and','or','is','are','be','ideas','idea','tips','tip','guide','using','use','into','without','make','made']);
    // Tiny synonym map so a same-intent blog worded differently still gets shortlisted.
    const SYN = { protect:['care','maintain','preserve','clean'], care:['protect','maintain','preserve'], maintain:['care','protect','preserve'], colour:['color','colours','colors','colourway','colorway'], color:['colour','colours','colors'], small:['tiny','compact','little'], kids:['children','child','nursery'], budget:['cheap','affordable','inexpensive'] };
    const sig = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !GENERIC.has(w));
    const expand = (words) => { const out = new Set(words); words.forEach(w => (SYN[w] || []).forEach(x => out.add(x))); return out; };

    const results = [];
    const CHUNK = 8;
    for (let i = 0; i < titles.length; i += CHUNK) {
      const chunk = titles.slice(i, i + CHUNK);
      // Build a per-title candidate shortlist (max 15) from shared distinctive words.
      const blocks = chunk.map((t, j) => {
        const want = expand(sig(t));
        const cands = [];
        for (const b of published) {
          const bw = sig(b.title);
          if (bw.some(w => want.has(w))) cands.push(b);
          if (cands.length >= 15) break;
        }
        const candText = cands.length
          ? cands.map((c, k) => `  C${k + 1}. ${c.title}`).join('\n')
          : '  (none)';
        return { title: t, cands, text: `T${j + 1}. ${t}\n${candText}` };
      });
      const titlesBlock = blocks.map(b => b.text).join('\n\n');

      const prompt = `You are an SEO editor for aboutwallart.com (wall art + home decor). Judge cannibalisation the way Google would — by the FULL SEARCH INTENT, not shared words.

For EACH working title (T#), with its candidate published blogs (C#):
1) Give the TRUE main keyword a real person types into Google. CRUCIAL: keep the QUALIFIER that defines the intent — e.g. "gallery wall WITHOUT NAILS", "biophilic design in SMALL SPACES", "wall art FOR KIDS". The qualifier is the whole point; never strip it to the head topic ("gallery wall"). 2 to 6 words, UK spelling ("colour", "decor" no accent), lowercase.
2) Decide if any CANDIDATE targets the SAME QUALIFIED SEARCH. THE HARD RULE: sharing the head topic word (gallery, match, bohemian, colour, small...) is NOT a clash by itself. Two blogs clash ONLY when the QUALIFIER — the specific thing the searcher wants — is essentially the SAME. If the qualifiers differ, it is NO CONFLICT.
   Worked examples (follow this exactly):
   - "gallery wall WITHOUT NAILS" vs "gallery wall IDEAS" → NO CONFLICT (nails ≠ ideas).
   - "match wall art with OFFICE FURNITURE" vs "match wall art to PAINT COLOURS" → NO CONFLICT (furniture ≠ paint).
   - "mix patterns in BOHEMIAN wall art" vs "master BOHEMIAN wall decor" → NO CONFLICT (mixing patterns ≠ general boho decor).
   - "gallery wall without nails" vs "how to hang a gallery wall WITHOUT DAMAGE / no nails" → DANGER (same qualified search).
   DEFAULT TO NO CONFLICT. Only flag when you are confident the qualified intent is the same.
   - "DANGER"      = same qualified search (a real clash).
   - "CAUTION"     = the qualifier is nearly the same, only a small framing difference. Use RARELY.
   - "NO CONFLICT" = qualifiers differ, or no candidate matches (the normal answer).
   Pick only the SINGLE closest candidate.

WORKING TITLES with candidates:
${titlesBlock}

Return ONLY a JSON array, one object per working title in order, exactly:
[{"t":1,"keyword":"","verdict":"NO CONFLICT","closest":0,"shared":"","looser":0}]
- keyword: the full main keyword WITH its qualifier.
- verdict: NO CONFLICT | CAUTION | DANGER.
- closest: the C-number of the single closest candidate for THIS title, or 0 if none clash. Never invent a number.
- shared: if it clashes, the short search phrase BOTH target (2-5 words, e.g. "hanging a gallery wall without nails"); "" if no clash.
- looser: how many OTHER candidates are loosely related but not the closest (a count, 0 if none).`;
      const raw = await callClaudeText(prompt, 3000);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('Could not read the keyword check result');
      let arr;
      try { arr = JSON.parse(m[0]); }
      catch (e) { throw new Error('Keyword check result was not in a readable format'); }
      for (let j = 0; j < chunk.length; j++) {
        const o = arr.find(x => Number(x.t) === j + 1) || arr[j] || {};
        const verdict = ['NO CONFLICT', 'CAUTION', 'DANGER'].includes(String(o.verdict || '').toUpperCase())
          ? String(o.verdict).toUpperCase() : 'NO CONFLICT';
        const cands = blocks[j].cands;
        const ci = parseInt(o.closest, 10);
        let blogTitle = '', blogUrl = '';
        if (verdict !== 'NO CONFLICT' && ci >= 1 && ci <= cands.length) {
          blogTitle = cands[ci - 1].title;
          blogUrl = cands[ci - 1].url;
        }
        const finalVerdict = blogTitle ? verdict : 'NO CONFLICT';
        results.push({
          title: chunk[j],
          keyword: String(o.keyword || '').trim(),
          cannibalization: finalVerdict,
          conflictingKeyword: blogTitle,
          conflictingUrl: blogUrl,
          clashIntent: finalVerdict === 'NO CONFLICT' ? '' : String(o.shared || '').trim(),
          looserCount: Math.max(0, parseInt(o.looser, 10) || 0)
        });
      }
    }
    return results;
  }

  // Helper: build the pre-write brief from the top-ranking competitor pages (reuse MPD's approach).
  async function generateCompetitorBrief(keyword, pages) {
    const summary = pages.map((p, i) => `Competitor ${i + 1}: ${p.url}\n  H1: ${(p.h1 || []).join(' | ') || '-'}\n  H2s: ${(p.h2 || []).join(' | ') || '-'}\n  ~words: ${p.words || 0}`).join('\n\n');
    const prompt = `You are an SEO content strategist for aboutwallart.com (wall art + home decor). A NEW blog will target the keyword "${keyword}". Below are the pages currently ranking top for it. Build a brief to OUTRANK them.

${summary}

Return ONLY a JSON object, no commentary, exactly:
{"wordTarget":0,"faqCount":4,"mustCover":["",""],"gaps":["",""],"angle":""}
- wordTarget: integer word count to match/beat their depth.
- faqCount: how many FAQ questions the blog should answer, 3 to 5.
- mustCover: the key H2 topics the blog MUST include to compete.
- gaps: topics they MISS that this blog can win on.
- angle: one sentence on the winning angle.`;
    const raw = await callClaudeText(prompt, 1500);
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not read the competitor brief');
    let o;
    try { o = JSON.parse(m[0]); }
    catch (e) { throw new Error('Competitor brief was not in a readable format'); }
    return {
      wordTarget: Math.min(2500, parseInt(o.wordTarget, 10) || 2200), // never ask for more than 2500 words (avoids cut-offs)
      faqCount: Math.min(5, Math.max(3, parseInt(o.faqCount, 10) || 4)),
      mustCover: Array.isArray(o.mustCover) ? o.mustCover.filter(Boolean) : [],
      gaps: Array.isArray(o.gaps) ? o.gaps.filter(Boolean) : [],
      angle: String(o.angle || '').trim()
    };
  }

  // Helper: plain Claude text call (no web search) — used by Batch 2 writers
  async function callClaudeText(prompt, maxTokens, model) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    const _mkCall = (mdl) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: mdl,
        max_tokens: maxTokens || 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const _wanted = model || 'claude-sonnet-4-6';
    let response = await _mkCall(_wanted);
    // Safety net: if a cheaper engine was requested and it's unavailable (model error), fall back to the good engine so nothing breaks.
    if (!response.ok && _wanted !== 'claude-sonnet-4-6' && (response.status === 404 || response.status === 400)) {
      response = await _mkCall('claude-sonnet-4-6');
    }
    if (!response.ok) {
      const errText = await response.text();
      const low = (errText || '').toLowerCase();
      const outOfCredits = response.status === 402 || response.status === 429 || low.includes('credit') || low.includes('billing') || low.includes('quota') || low.includes('insufficient');
      throw new Error(outOfCredits
        ? 'Claude is out of credits or rate-limited — top up your Anthropic account, then press again.'
        : `Claude API error: ${response.status} ${errText.slice(0, 150)}`);
    }
    const data = await response.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    return text.trim();
  }

  // Same as callClaudeText but with ONE image (for reading a style photo). imageBase64 = the raw
  // base64 (no "data:" prefix); mediaType = e.g. "image/jpeg" / "image/png" / "image/webp".
  async function callClaudeVision(prompt, imageBase64, mediaType, maxTokens) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      const low = (errText || '').toLowerCase();
      const outOfCredits = response.status === 402 || response.status === 429 || low.includes('credit') || low.includes('billing') || low.includes('quota') || low.includes('insufficient');
      throw new Error(outOfCredits
        ? 'Claude is out of credits or rate-limited — top up your Anthropic account, then press again.'
        : `Claude API error: ${response.status} ${errText.slice(0, 150)}`);
    }
    const data = await response.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    return text.trim();
  }

  // Small JSON-file helpers for fusion data (blog-fusion-checked.json, blog-fusion-pending.json,
  // blog-fused-groups.json). readJsonFileSafe returns `fallback` for a missing/broken file (never throws).
  async function readJsonFileSafe(filePath, fallback) {
    try { const f = await getGitHubFile(filePath); return JSON.parse(f.content); } catch (e) { return fallback; }
  }
  async function writeJsonFile(filePath, obj, message) {
    let sha = null;
    try { const existing = await getGitHubFile(filePath); sha = existing.sha; } catch (e) { sha = null; }
    await updateGitHubFile(filePath, JSON.stringify(obj, null, 2) + '\n', sha, message);
  }
  // A blog's image-code is PERMANENT: stored in data/blog-codes.json keyed by its (normalised) keyword, so every step
  // (write → image prompts → finish → publish) and every re-write, reload or reordering reads the SAME code. The images
  // a blog already has (named "<slug>-<code>") can therefore never be orphaned by a changed code. Set once, never changed.
  // `fallback` seeds the code for an in-flight blog that already had one (from its draft) so nothing current breaks.
  async function stableBlogCode(keyword, fallback) {
    const clean = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const kw = String(keyword || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const fb = clean(fallback);
    if (!kw) return fb;
    let map = {};
    try { map = await readJsonFileSafe('data/blog-codes.json', {}); if (!map || typeof map !== 'object' || Array.isArray(map)) map = {}; } catch (e) { map = {}; }
    const existing = clean(map[kw]);
    if (existing) return existing;                 // already set → NEVER change it
    const code = fb || (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
    map[kw] = code;
    try { await writeJsonFile('data/blog-codes.json', map, 'Blog code (permanent): ' + kw + ' = ' + code); } catch (e) {}
    return code;
  }

  // Column P — 3 "People Also Ask" Q&A pairs, plain text
  async function generatePeopleAlsoAsk(keyword, title) {
    const prompt = `You are a professional home decor expert writing in a calm, authoritative, and helpful tone.

Generate exactly 3 "People Also Ask" style questions based on the blog title provided.

Blog title: "${title}"
Main keyword: "${keyword}"

SEO Requirements:
- At least ONE question must include the main keyword phrase "${keyword}".
- Questions must sound like real Google search queries.
- Questions must be directly related to the blog topic.

Answer Style Requirements:
- Write in a professional, advisory tone.
- Do NOT write in first person.
- Do NOT sound overly casual.
- Provide clear, practical guidance.
- Each answer must be 4-6 sentences.
- Maintain a structured, informative style similar to high-quality interior design blogs.
- Avoid fluff and repetition.
- Avoid overly sales-focused language.

Formatting Rules:
Return PLAIN TEXT ONLY. DO NOT use HTML tags.
Format exactly like this:

1. Question text here

Answer paragraph...

2. Question text here

Answer paragraph...

3. Question text here

Answer paragraph...

Rules:
- Use plain text only - NO HTML tags
- Include the number at the start of each question
- Add a blank line between question and answer
- Add a blank line between each Q&A pair
- Do not add any HTML, markdown, or formatting
- Return only plain text`;
    const text = await callClaudeText(prompt, 2500);
    if (!text) throw new Error('People Also Ask came back empty');
    return text;
  }

  // Column Q — single <p> "More About" paragraph introducing the authority article
  async function generateMoreAbout(keyword, title, articleTitle) {
    const prompt = `You are a professional home decor writer.

Write a short section that introduces an authoritative external article related to the blog topic.

Blog title: "${title}"
Blog topic / main keyword: "${keyword}"
External article title: "${articleTitle}"

Tone Requirements:
- Professional and editorial.
- Informative and supportive.
- Not salesy. Not overly promotional.
- Natural and contextual.

Content Rules:
- Mention the external article title "${articleTitle}" naturally.
- Encourage readers to explore it for deeper insight.
- Keep the paragraph 3-5 sentences.
- Do not exaggerate authority.
- Do not use first person.

Formatting Rules:
Return valid HTML only. Use a single <p> block.
Rules:
- Use only a single <p> block.
- Do not add extra tags.
- Do not add commentary.
- Return only valid HTML.`;
    let text = await callClaudeText(prompt, 1000);
    text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    if (!text) throw new Error('More About paragraph came back empty');
    return text;
  }

  // Columns V, T, U — SEO title + meta description + excerpt, returned as JSON
  async function generateSeoMeta(keyword, title) {
    const prompt = `You are an SEO optimization specialist for a home decor blog.

Blog title: "${title}"
Main keyword: "${keyword}"

Generate:
- SEO_Title
- Meta_Description
- Excerpt

STRICT RULES:
SEO_Title:
- Maximum 59 characters.
- Include the main keyword naturally.
- No emojis. No clickbait. No quotation marks.
Meta_Description:
- Maximum 155 characters.
- Include the main keyword once.
- Clear, compelling, natural.
- No emojis. No quotation marks.
Excerpt:
- 150-300 characters.
- Engaging summary. Professional tone.
- No emojis. No quotation marks. No HTML.

Return valid JSON only using this exact structure:
{
"SEO_Title": "",
"Meta_Description": "",
"Excerpt": ""
}
Do not exceed character limits.
Return only JSON.`;
    let text = await callClaudeText(prompt, 1500);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('SEO/meta result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('SEO/meta result was not valid JSON'); }
    const seoTitle = (parsed.SEO_Title || '').trim();
    const metaDescription = (parsed.Meta_Description || '').trim();
    const excerpt = (parsed.Excerpt || '').trim();
    if (!seoTitle || !metaDescription || !excerpt) throw new Error('SEO/meta result was incomplete');
    return { seoTitle, metaDescription, excerpt };
  }

  // Columns Y, Z, AA, AB, AC — cluster classifier. 1 Primary + 1 Intent + 2-3 Supporting, only from the taxonomy.
  async function generateClusters(keyword, title) {
    const prompt = `You are a strict blog tag classification engine.
You must assign tags ONLY from the taxonomy lists below. You may not create, modify, guess, or rephrase tags.

Blog title: "${title}"
Main keyword: "${keyword}"

TAGGING RULES
1. Select exactly ONE Primary_Cluster — the single most relevant ROOM, STYLE or COLOUR cluster for the blog. If none clearly applies, use living-room-decor.
2. Select exactly ONE Intent_Tag — from INTENT clusters (mandatory). Do NOT choose the "how-to" intent tag unless this blog is a GENUINE step-by-step how-to guide; for anything that is not step-by-step, pick a different intent tag.
3. Select 2 or 3 Supporting_Clusters related to the blog's topic — these may come from ANY group (Room, Style, Colour, Decor Accessory, Occasion or Educational/Concept). If fewer than 2 clearly apply, add general decor concept tags such as home-decor-theory, design-principles or interior-design-concepts.
4. Minimum 4 tags total.
5. Do NOT invent new tags. Do NOT modify spelling. Do NOT repeat tags.
6. Every selected tag must appear EXACTLY in the lists below.

ROOM CLUSTERS: ${CLUSTER_TAXONOMY.room.join(', ')}
STYLE CLUSTERS: ${CLUSTER_TAXONOMY.style.join(', ')}
COLOUR CLUSTERS: ${CLUSTER_TAXONOMY.colour.join(', ')}
DECOR ACCESSORY CLUSTERS: ${CLUSTER_TAXONOMY.accessory.join(', ')}
OCCASION CLUSTERS: ${CLUSTER_TAXONOMY.occasion.join(', ')}
EDUCATIONAL / CONCEPT CLUSTERS: ${CLUSTER_TAXONOMY.educational.join(', ')}
INTENT CLUSTERS: ${CLUSTER_TAXONOMY.intent.join(', ')}

OUTPUT FORMAT (STRICT)
Return valid JSON only:
{
"Primary_Cluster": "",
"Intent_Tag": "",
"Supporting_Cluster_1": "",
"Supporting_Cluster_2": "",
"Supporting_Cluster_3": ""
}
If only 2 supporting clusters apply, leave Supporting_Cluster_3 as an empty string.
Return only JSON. No extra text.`;
    let text = await callClaudeText(prompt, 800);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Cluster result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Cluster result was not valid JSON'); }

    const primary = (parsed.Primary_Cluster || '').trim();
    const intent  = (parsed.Intent_Tag || '').trim();
    const supps   = [parsed.Supporting_Cluster_1, parsed.Supporting_Cluster_2, parsed.Supporting_Cluster_3]
      .map(s => (s || '').trim()).filter(Boolean);

    // Any non-intent tag is valid for Primary and Supporting (no group restriction beyond "not an intent tag")
    const nonIntent = new Set([...CLUSTER_TAXONOMY.room, ...CLUSTER_TAXONOMY.style, ...CLUSTER_TAXONOMY.colour, ...CLUSTER_TAXONOMY.accessory, ...CLUSTER_TAXONOMY.occasion, ...CLUSTER_TAXONOMY.educational]);
    const allowedPrimary    = nonIntent;
    const allowedIntent     = new Set(CLUSTER_TAXONOMY.intent);
    const allowedSupporting = nonIntent;

    if (!primary) throw new Error('No Primary Cluster returned');
    if (!intent)  throw new Error('No Intent Tag returned');
    if (supps.length < 2) throw new Error('Fewer than 2 Supporting Clusters returned');
    if (!allowedPrimary.has(primary)) throw new Error('Invalid Primary Cluster: ' + primary);
    if (!allowedIntent.has(intent))   throw new Error('Invalid Intent Tag: ' + intent);
    for (const s of supps) if (!allowedSupporting.has(s)) throw new Error('Invalid Supporting Cluster: ' + s);
    const all = [primary, ...supps];
    if (new Set(all).size !== all.length) throw new Error('Duplicate cluster tags returned');

    return { primaryCluster: primary, intentTag: intent, supporting: supps };
  }

  // Column O — Blogs by Topic. 2-4 friendly labels, only from the allowed list, using the clusters as input.
  async function generateBlogsByTopic(keyword, title, clusters) {
    const prompt = `You are a strict blog topic selector.
Select relevant values ONLY from the predefined list below. Do not create new values, modify spelling, or return anything outside the list.

Blog Title: "${title}"
Main keyword: "${keyword}"
Primary Cluster: ${clusters.primaryCluster}
Intent Tag: ${clusters.intentTag}
Supporting Clusters: ${clusters.supporting.join(', ')}

Rules:
- Select between 2 and 4 relevant topics.
- Each value must EXACTLY match one of the allowed options below.
- If fewer than 4 apply, return only the applicable ones.
- Do not return empty strings.
- Do not return text outside JSON.

Allowed Options:
${BLOGS_BY_TOPIC_OPTIONS.join('\n')}

Return valid JSON only using this exact structure:
{
"Blogs_By_Topic": ["", "", ""]
}
Return only JSON.`;
    let text = await callClaudeText(prompt, 600);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Blogs by Topic result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Blogs by Topic result was not valid JSON'); }

    const arr = Array.isArray(parsed.Blogs_By_Topic)
      ? parsed.Blogs_By_Topic.map(s => (s || '').trim()).filter(Boolean)
      : [];
    if (arr.length < 2 || arr.length > 4) throw new Error('Blogs by Topic must have 2-4 values');
    const allowed = new Set(BLOGS_BY_TOPIC_OPTIONS);
    for (const t of arr) if (!allowed.has(t)) throw new Error('Invalid Blogs by Topic value: ' + t);
    if (new Set(arr).size !== arr.length) throw new Error('Duplicate Blogs by Topic values');

    return JSON.stringify({ Blogs_By_Topic: arr });
  }

  // Column AP (HTML) + BB–BI — Visual Inspiration. Picks 3–5 trend pages by style/topic.
  // Returns { html, trends: [{name, url, description}] }.
  async function generateVisualInspiration(keyword, title, styleCluster) {
    const allowedNames = Object.keys(TREND_PAGES);
    const prompt = `You are a strict internal linking assistant generating a Visual Inspiration section for a blog post.

Blog title: "${title}"
Main keyword: "${keyword}"
Style cluster: "${styleCluster || '(none provided)'}"

SELECTION RULES:
- Select EXACTLY 3 relevant Trend Pages from the ALLOWED list below.
- If a Style cluster is provided, choose the trend(s) most related to that style first.
- If the Style cluster is empty or too general, choose the trends closest to the blog topic.
- If nothing clearly fits, default to "Cosy Minimalism Home Decor Trend".
- Use ONLY names written EXACTLY as in the allowed list. Do NOT invent or modify names.
- Each trend needs a short descriptive phrase of 4-6 words.

ALLOWED TREND PAGES:
${allowedNames.join('\n')}

Return ONLY valid JSON in this exact shape, no other text:
{"trends":[{"name":"","description":""}]}
Include EXACTLY 3 items.`;
    let text = await callClaudeText(prompt, 900);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Visual Inspiration result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Visual Inspiration result was not valid JSON'); }

    const items = Array.isArray(parsed.trends) ? parsed.trends : [];
    const trends = [];
    for (const it of items) {
      const name = (it.name || '').trim();
      const description = (it.description || '').trim();
      if (!name) continue;
      const url = TREND_PAGES[name];
      if (!url) throw new Error('Invalid trend page: ' + name);
      if (trends.some(t => t.name === name)) continue; // skip duplicates
      trends.push({ name, url, description });
    }
    if (trends.length < 2) throw new Error('Visual Inspiration returned fewer than 2 trends');
    if (trends.length > 3) trends.length = 3;

    const lis = trends.map(t => `<li><a href="${t.url}">${t.name}</a> - ${t.description}</li>`).join('');
    const html = `<h3>Visual Inspiration</h3><p>Explore complementary design ideas on our Home Decor by Trend page:</p><ul>${lis}</ul>`;
    return { html, trends };
  }

  // Helper: Shopify Admin GraphQL
  async function shopifyGraphQL(query, variables) {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token  = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!domain || !token) throw new Error('Shopify credentials not configured');
    const r = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) throw new Error('Shopify error: ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(d.errors).slice(0, 200));
    return d.data;
  }

  // Columns S + AU–AX — 4 topic-matched products: 2 About Wall Art + 2 Collective (higher value first),
  // pulled from the collections behind the chosen cluster tags, skipping recently-used products when possible.
  async function selectProducts(clusterTags, recentSet) {
    const AWA_VENDOR = 'About Wall Art';
    const handles = [];
    for (const tag of clusterTags) {
      const url = CLUSTER_URLS[tag];
      if (url && url.includes('/collections/')) {
        const h = url.split('/collections/')[1].split('/')[0].split('?')[0];
        if (h && !handles.includes(h)) handles.push(h);
      }
    }
    if (!handles.length) handles.push('best-sellers'); // fallback when clusters map to /pages/ only

    const seen = new Set();
    const candidates = [];
    for (const handle of handles) {
      const data = await shopifyGraphQL(
        `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:60){ edges{ node{ id vendor variants(first:1){ edges{ node{ price } } } } } } } }`,
        { handle }
      );
      const coll = data.collectionByHandle;
      if (!coll) continue;
      for (const e of coll.products.edges) {
        const n = e.node;
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const price = parseFloat((n.variants.edges[0] && n.variants.edges[0].node.price) || '0');
        candidates.push({ gid: n.id, vendor: n.vendor || '', price });
      }
    }
    if (candidates.length < 4) throw new Error('Not enough products in the matching collections');

    const awa  = candidates.filter(c => c.vendor === AWA_VENDOR);
    const coll = candidates.filter(c => c.vendor !== AWA_VENDOR).sort((a, b) => b.price - a.price);

    const pick = (arr, n) => {
      const fresh = arr.filter(c => !recentSet.has(c.gid));
      const used  = arr.filter(c => recentSet.has(c.gid));
      return [...fresh, ...used].slice(0, n);
    };
    let chosen = [...pick(awa, 2), ...pick(coll, 2)];

    // top up to 4 from whatever is left if one vendor type was short
    if (chosen.length < 4) {
      const have = new Set(chosen.map(c => c.gid));
      const rest = candidates.filter(c => !have.has(c.gid));
      const fresh = rest.filter(c => !recentSet.has(c.gid));
      const used  = rest.filter(c => recentSet.has(c.gid));
      for (const c of [...fresh, ...used]) { if (chosen.length >= 4) break; chosen.push(c); }
    }
    if (chosen.length < 4) throw new Error('Could not assemble 4 products');
    return chosen.slice(0, 4).map(c => c.gid);
  }

  // Helper: derive the room/style/colour concept word(s) from a cluster tag (bedroom-decor → "bedroom")
  function deriveSearchTerm(tag) {
    if (!tag) return '';
    return tag.replace(/-(decor|style|tones|toned|accents)$/, '').replace(/-/g, ' ').trim().toLowerCase();
  }

  // Columns AR + BM–BR + BU–CF — 3 related published blogs matched by cluster concept in the TITLE,
  // topping up via supporting clusters then general recent posts. Best-effort; never throws.
  async function getRelatedBlogs(orderedClusterTags) {
    const FALLBACK_BLOG_GID = 'gid://shopify/Blog/93572858142'; // About Wall Art blog
    const found = [];
    const seen = new Set();
    const addArticle = (a) => {
      if (found.length >= 3 || !a || seen.has(a.id)) return;
      seen.add(a.id);
      found.push({
        articleGid: a.id,
        blogGid: (a.blog && a.blog.id) || FALLBACK_BLOG_GID,
        title: a.title || '',
        handle: a.handle || '',
        url: `https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/${a.handle || ''}`,
        image: (a.image && a.image.url) || ''
      });
    };

    // 1 + 2: cluster concepts (primary, then supporting) matched in the title (top-level articles search)
    for (const tag of orderedClusterTags) {
      if (found.length >= 3) break;
      const term = deriveSearchTerm(tag);
      if (!term) continue;
      const firstWord = term.split(' ')[0];
      try {
        const data = await shopifyGraphQL(
          `query($q:String!){ articles(first:25, query:$q, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} blog{id} } } } }`,
          { q: `title:*${firstWord}*` }
        );
        const arts = data.articles ? data.articles.edges.map(e => e.node) : [];
        for (const a of arts) { if (found.length >= 3) break; addArticle(a); }
      } catch (e) { /* best-effort */ }
    }

    // 3: general fallback — most recent published posts
    if (found.length < 3) {
      try {
        const data = await shopifyGraphQL(
          `query{ articles(first:12, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} blog{id} } } } }`,
          {}
        );
        const arts = data.articles ? data.articles.edges.map(e => e.node) : [];
        for (const a of arts) { if (found.length >= 3) break; addArticle(a); }
      } catch (e) { /* best-effort */ }
    }

    return found;
  }

  // Build the Pro Tips metafield (AR) plain-text block from the related blogs
  function buildProTips(keyword, blogs) {
    if (!blogs.length) return '';
    let out = `H2: Pro Tips for ${keyword}`;
    blogs.forEach((b, i) => {
      const n = i + 1;
      out += `\n\nBLOG${n}_TITLE: ${b.title}\nBLOG${n}_URL: ${b.url}\nBLOG${n}_HANDLE: ${b.handle}`;
    });
    return out;
  }

  try {

    // ============================================
    // GET - Read published blogs from registry
    // ============================================
    if (req.method === 'GET') {

      // ── ACTION: get-fusion-pending ── proposed-but-not-yet-applied fusion groups (for the review panel).
      // ── ACTION: get-fused-groups ── APPLIED fusion groups, keyed by winner keyword (for card badges + writer).
      // These GET handlers MUST sit at the top of the GET block — the GET block ends in a default
      // "return { blogs }", so anything placed after that default never runs for a GET request.
      if (req.query.action === 'get-fusion-pending') {
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        return res.status(200).json({ success: true, groups: pending, singles: Array.isArray(singles) ? singles : [] });
      }
      if (req.query.action === 'get-fused-groups') {
        const groups = await readJsonFileSafe('data/blog-fused-groups.json', {});
        const approved = await readJsonFileSafe('data/blog-approved.json', []);
        return res.status(200).json({ success: true, groups, approved: Array.isArray(approved) ? approved : [] });
      }

      // ── ACTION: performing-keywords-blog ── "Ya rankeás — capturá más" (BLOG side): informational
      // keywords you already get clicks on (data/gsc-performing-keywords.json), not locked, not already
      // a blog, not dismissed. Each carries its ranking URL only if that URL is free (not locked to
      // another keyword) — a taken URL means "write a new blog instead". Mirrors the product-side logic.
      if (req.query.action === 'performing-keywords-blog') {
        let list = [];
        try {
          const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-performing-keywords.json?t=${Date.now()}`);
          if (rr.ok) { const j = await rr.json(); list = Array.isArray(j.keywords) ? j.keywords : []; }
        } catch (e) { /* no list yet */ }
        const lockedSet = new Set(); const blogKws = []; const urlLock = {};
        // Strip ?variant=… query so the real page shows + the "URL locked?" check matches the registry.
        const cleanU = u => String(u || '').split(/[?#]/)[0];
        const nrm = u => cleanU(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
        try {
          const rc = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/keyword-locker-registry.csv?t=${Date.now()}`);
          if (rc.ok) {
            const txt = await rc.text();
            txt.split('\n').forEach((line, i) => {
              if (i === 0 || !line.trim()) return;
              const c = parseCSVLine(line.replace(/\r/g, ''));
              const kw = (c[0] || '').toLowerCase(); const url = (c[1] || '').trim(); const lk = (c[2] || '').toUpperCase(); const src = (c[9] || '');
              if (kw && lk === 'LOCKED') lockedSet.add(kw);
              if (url && url !== 'N/A' && lk === 'LOCKED') { const k = nrm(url); if (!urlLock[k]) urlLock[k] = c[0] || ''; }
              if ((src === 'Published Blog' || src === 'To_Write_Blog') && c[0]) blogKws.push(kw);
            });
          }
        } catch (e) { /* ignore */ }
        let dismissed = [];
        try { const df = await getGitHubFile('data/gsc-blog-dismissed.json'); dismissed = (JSON.parse(df.content) || []).map(s => String(s).toLowerCase()); } catch (e) { dismissed = []; }
        // Shared "✕ Dismiss" list (hidden from BOTH the product and blog performing panels).
        let perfDismissed = [];
        try { const pf = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-performing-dismissed.json?t=${Date.now()}`); if (pf.ok) { const j = await pf.json(); perfDismissed = (Array.isArray(j) ? j : []).map(s => String(s).toLowerCase()); } } catch (e) { perfDismissed = []; }
        const lockedArr = [...lockedSet];
        const options = list
          .filter(k => k && k.keyword && k.intent === 'blog')
          .filter(k => { const kw = k.keyword.toLowerCase();
            if (lockedSet.has(kw)) return false;
            if (lockedArr.some(lk => lk.includes(kw))) return false;
            if (blogKws.some(bk => bk === kw || bk.includes(kw))) return false;
            if (dismissed.includes(kw)) return false;
            if (perfDismissed.includes(kw)) return false;
            return true;
          })
          .map(k => {
            const cleanRanking = k.rankingUrl ? cleanU(k.rankingUrl) : null;
            const lockedTo = cleanRanking ? urlLock[nrm(cleanRanking)] : null;
            const urlFree = !!(cleanRanking && !lockedTo);
            return { keyword: k.keyword, impressions: k.impressions, clicks: k.clicks, position: k.position,
              pageUrl: cleanRanking || null, urlFree: urlFree, lockedToKeyword: lockedTo || null, topSix: (k.position != null && k.position <= 6) };
          })
          .slice(0, 100);
        return res.status(200).json({ success: true, options });
      }

      // ── NEW ACTION: get-published-keywords ──
      if (req.query.action === 'get-published-keywords') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) {
          return res.status(404).json({ error: 'Registry file not found' });
        }
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const publishedBlogs = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 10) {
            const keyword = cols[0];
            const url = cols[1];
            const source = cols[9];
            if ((source === 'Published Blog' || source === 'To_Write_Blog') && keyword) {
              publishedBlogs.push({ keyword: keyword.toLowerCase(), url });
            }
          }
        }
        return res.status(200).json({ success: true, publishedBlogs });
      }

      // ── ACTION: gsc-blog-opportunities ── informational GSC opportunities for new blogs,
      // minus any keyword a blog already covers (registry source Published Blog / To_Write_Blog).
      if (req.query.action === 'gsc-blog-opportunities') {
        let list = [];
        try {
          const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-opportunity-keywords.json?t=${Date.now()}`);
          if (rr.ok) { const j = await rr.json(); list = Array.isArray(j.keywords) ? j.keywords : []; }
        } catch (e) { /* no list yet */ }
        const blogKws = [];
        try {
          const rc = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/keyword-locker-registry.csv?t=${Date.now()}`);
          if (rc.ok) {
            const txt = await rc.text();
            txt.split('\n').forEach((line, i) => {
              if (i === 0 || !line.trim()) return;
              const c = parseCSVLine(line.replace(/\r/g, ''));
              const src = (c[9] || '');
              if ((src === 'Published Blog' || src === 'To_Write_Blog') && c[0]) blogKws.push(c[0].toLowerCase());
            });
          }
        } catch (e) { /* ignore */ }
        let dismissed = [];
        try { const df = await getGitHubFile('data/gsc-blog-dismissed.json'); dismissed = (JSON.parse(df.content) || []).map(s => String(s).toLowerCase()); } catch (e) { dismissed = []; }
        const options = list
          .filter(k => k && k.keyword && k.intent === 'blog')
          .filter(k => { const kw = k.keyword.toLowerCase();
            if (dismissed.includes(kw)) return false;                       // discarded earlier
            return !blogKws.some(bk => bk === kw || bk.includes(kw));        // already covered by a blog
          })
          .map(k => ({ keyword: k.keyword, impressions: k.impressions, clicks: k.clicks, position: k.position }));
        return res.status(200).json({ success: true, options });
      }

      // ── ACTION: get-registry ──
      if (req.query.action === 'get-registry') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) return res.status(200).json({ success: true, registry: [] });
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const registry = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 2 && cols[0]) {
            registry.push({
              keyword: cols[0],
              url: cols[1],
              locked: cols[2] === 'LOCKED',
              status: cols[3] || '',
              action: cols[4] || '',
              winnerUrl: cols[5] || '',
              source: cols[9] || '',
              intent: cols[10] || '',
              optimisedDate: cols[11] || ''
            });
          }
        }
        return res.status(200).json({ success: true, registry });
      }

      // ── ACTION: awa-collection-handles ── (product handles in the "Discountable Products" collection = About Wall Art's own products)
      if (req.query.action === 'awa-collection-handles') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });
        const COLLECTION_HANDLE = 'products-with-applicable-discounts';
        const handles = [];
        let cursor = null, hasNext = true, guard = 0;
        while (hasNext && guard < 30) {
          guard++;
          const q = `query($cursor:String){ collectionByHandle(handle:"${COLLECTION_HANDLE}"){ products(first:250, after:$cursor){ pageInfo{ hasNextPage endCursor } edges{ node{ handle } } } } }`;
          const r = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, variables: { cursor } })
          });
          if (!r.ok) return res.status(500).json({ error: `Shopify error: ${r.status}` });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          const coll = d.data && d.data.collectionByHandle;
          if (!coll) return res.status(404).json({ error: 'Collection not found' });
          coll.products.edges.forEach(e => { if (e.node.handle) handles.push(e.node.handle); });
          hasNext = coll.products.pageInfo.hasNextPage;
          cursor = coll.products.pageInfo.endCursor;
        }
        return res.status(200).json({ success: true, handles });
      }

      // ── ACTION: get-revenue-by-month ──
      if (req.query.action === 'get-revenue-by-month') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const months = {};
        const since = new Date();
        since.setMonth(since.getMonth() - 13);
        since.setDate(1);
        since.setHours(0, 0, 0, 0);

        let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=created_at,total_price,financial_status`;

        while (url) {
          const orderRes = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': shopifyToken }
          });
          if (!orderRes.ok) throw new Error('Shopify Orders API error: ' + orderRes.status);
          const data = await orderRes.json();

          for (const order of (data.orders || [])) {
            if (['voided', 'refunded'].includes(order.financial_status)) continue;
            const month = order.created_at.slice(0, 7);
            months[month] = (months[month] || 0) + parseFloat(order.total_price || 0);
          }

          const linkHeader = orderRes.headers.get('Link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = nextMatch ? nextMatch[1] : null;
        }

        const revenue = {};
        Object.entries(months).forEach(([month, total]) => {
          revenue[month.replace('-', '')] = Math.round(total);
        });

        return res.status(200).json({ success: true, revenue });
      }

      // ── ACTION: get-social-revenue ──
      if (req.query.action === 'get-social-revenue') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const days = parseInt(req.query.days || '90');
        const since = new Date();
        since.setDate(since.getDate() - days);
        since.setHours(0, 0, 0, 0);

        const socialMap = {
          'facebook': 'Facebook', 'instagram': 'Instagram', 'pinterest': 'Pinterest',
          'tiktok': 'TikTok', 'youtube': 'YouTube', 'twitter': 'Twitter/X',
          't.co': 'Twitter/X', 'x.com': 'Twitter/X', 'linkedin': 'LinkedIn'
        };

        function getPlatform(referringSite) {
          if (!referringSite) return null;
          const s = referringSite.toLowerCase();
          const key = Object.keys(socialMap).find(k => s.includes(k));
          return key ? socialMap[key] : null;
        }

        function getLandingPath(landingSite) {
          if (!landingSite) return null;
          try {
            const url = new URL(landingSite.startsWith('http') ? landingSite : 'https://x.com' + landingSite);
            return url.pathname || '/';
          } catch(e) { return landingSite.split('?')[0] || '/'; }
        }

        const byPlatform = {};
        const byPage = {};

        let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=created_at,total_price,financial_status,referring_site,landing_site`;

        while (url) {
          const orderRes = await fetch(url, { headers: { 'X-Shopify-Access-Token': shopifyToken } });
          if (!orderRes.ok) throw new Error('Shopify Orders API error: ' + orderRes.status);
          const data = await orderRes.json();

          for (const order of (data.orders || [])) {
            if (['voided', 'refunded'].includes(order.financial_status)) continue;
            const platform = getPlatform(order.referring_site);
            if (!platform) continue;
            const amount = parseFloat(order.total_price || 0);
            byPlatform[platform] = (byPlatform[platform] || 0) + amount;
            const path = getLandingPath(order.landing_site) || '/';
            if (!byPage[path]) byPage[path] = { total: 0, orders: 0, topPlatform: platform, topAmount: 0 };
            byPage[path].total  += amount;
            byPage[path].orders += 1;
            if (amount > byPage[path].topAmount) { byPage[path].topPlatform = platform; byPage[path].topAmount = amount; }
          }

          const linkHeader = orderRes.headers.get('Link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = nextMatch ? nextMatch[1] : null;
        }

        // Round revenue values
        Object.keys(byPlatform).forEach(k => { byPlatform[k] = Math.round(byPlatform[k] * 100) / 100; });
        Object.keys(byPage).forEach(k => { byPage[k].total = Math.round(byPage[k].total * 100) / 100; });

        return res.status(200).json({ success: true, byPlatform, byPage });
      }

      // ── ACTION: get-susp-events ──
      if (req.query.action === 'get-susp-events') {
        try {
          const file = await getGitHubFile('data/suspicious-events.json');
          return res.status(200).json({ success: true, events: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, events: [] });
        }
      }

      // ── ACTION: get-optimisations ──
      if (req.query.action === 'get-optimisations') {
        try {
          const file = await getGitHubFile('data/keyword-optimisations.json');
          return res.status(200).json({ success: true, optimisations: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, optimisations: {} });
        }
      }

      // ── ACTION: get-tracked-keywords ──
      if (req.query.action === 'get-tracked-keywords') {
        try {
          const file = await getGitHubFile('data/tracked-keywords.json');
          const keywords = JSON.parse(file.content);
          return res.status(200).json({ success: true, keywords });
        } catch(e) {
          return res.status(200).json({ success: true, keywords: [] });
        }
      }

      // ── ACTION: get-dismissed-keywords ──
      if (req.query.action === 'get-dismissed-keywords') {
        try {
          const file = await getGitHubFile('data/kwr-dismissed.json');
          const keywords = JSON.parse(file.content);
          return res.status(200).json({ success: true, keywords });
        } catch(e) {
          return res.status(200).json({ success: true, keywords: [] });
        }
      }

      // ── ACTION: get-tech-status ──
      if (req.query.action === 'get-tech-status') {
        try {
          const file = await getGitHubFile('data/tech-status.json');
          return res.status(200).json({ success: true, statuses: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, statuses: {} });
        }
      }

      // ── ACTION: get-reindex-done ──
      if (req.query.action === 'get-reindex-done') {
        try {
          const file = await getGitHubFile('data/reindex-done.json');
          return res.status(200).json({ success: true, done: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, done: [] });
        }
      }

      // ── ACTION: get-keyword-tabs ──
      if (req.query.action === 'get-keyword-tabs') {
        try {
          const file = await getGitHubFile('data/keyword-tracker.json');
          const tabs = JSON.parse(file.content);
          return res.status(200).json({ success: true, tabs });
        } catch(e) {
          return res.status(200).json({ success: true, tabs: [] });
        }
      }

      // ── ACTION: get-autolink-rules ──
      if (req.query.action === 'get-autolink-rules') {
        try {
          const file = await getGitHubFile('data/autolink-rules.json');
          return res.status(200).json({ success: true, rules: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, rules: [] });
        }
      }

      // ── ACTION: get-metafield-links ──
      if (req.query.action === 'get-metafield-links') {
        try {
          const file = await getGitHubFile('data/metafield-product-links.json');
          return res.status(200).json({ success: true, links: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, links: [] });
        }
      }

      // ── ACTION: get-lw-counters ──
      if (req.query.action === 'get-lw-counters') {
        try {
          const file = await getGitHubFile('data/lw-counters.json');
          const data = JSON.parse(file.content);
          return res.status(200).json({ success: true, brokenLinks: data.brokenLinks ?? null, orphanedProducts: data.orphanedProducts ?? null });
        } catch(e) {
          return res.status(200).json({ success: true, brokenLinks: null, orphanedProducts: null });
        }
      }

      // ── ACTION: get-rank-audits ──
      if (req.query.action === 'get-rank-audits') {
        try {
          const file = await getGitHubFile('data/rank-recent-audits.json');
          return res.status(200).json({ success: true, audits: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, audits: [] });
        }
      }

      // ── ACTION: get-lw-settings ──
      if (req.query.action === 'get-lw-settings') {
        try {
          const file = await getGitHubFile('data/lw-settings.json');
          return res.status(200).json({ success: true, settings: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, settings: null });
        }
      }

      // ── ACTION: get-mpd-checklist ── (Money Page Doctor — checkbox states)
      if (req.query.action === 'get-mpd-checklist') {
        try {
          const file = await getGitHubFile('data/mpd-checklist.json');
          return res.status(200).json({ success: true, checklist: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, checklist: {} });
        }
      }

      // ── ACTION: get-mpd-snapshots ── (Money Page Doctor — 90-day GSC baselines)
      if (req.query.action === 'get-mpd-snapshots') {
        try {
          const file = await getGitHubFile('data/mpd-snapshots.json');
          return res.status(200).json({ success: true, snapshots: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, snapshots: {} });
        }
      }

      // ── ACTION: get-mpd-push-state ── (Money Page Doctor — Push to Shopify state)
      if (req.query.action === 'get-mpd-push-state') {
        try {
          const file = await getGitHubFile('data/mpd-push-state.json');
          return res.status(200).json({ success: true, pushState: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, pushState: {} });
        }
      }

      // ── ACTION: get-mpd-hold ── (Money Page Doctor — Winner-Hold: URLs to NOT optimise yet)
      if (req.query.action === 'get-mpd-hold') {
        try {
          const file = await getGitHubFile('data/mpd-hold.json');
          const arr = JSON.parse(file.content);
          return res.status(200).json({ success: true, hold: Array.isArray(arr) ? arr : [] });
        } catch(e) {
          return res.status(200).json({ success: true, hold: [] });
        }
      }

      // ── ACTION: get-mpd-winner-out ── (Money Page Doctor — winners the user manually sent to Start Here to optimise)
      if (req.query.action === 'get-mpd-winner-out') {
        try {
          const file = await getGitHubFile('data/mpd-winner-out.json');
          const arr = JSON.parse(file.content);
          return res.status(200).json({ success: true, out: Array.isArray(arr) ? arr : [] });
        } catch(e) {
          return res.status(200).json({ success: true, out: [] });
        }
      }

      // ── ACTION: get-mpd-winner-serp ── (Money Page Doctor — stored SERP UK positions for winners)
      // Map of "normalizedPath|||keyword" → { position, checkedAt } (position null = checked, not in top 10).
      if (req.query.action === 'get-mpd-winner-serp') {
        try {
          const file = await getGitHubFile('data/mpd-winner-serp.json');
          const obj = JSON.parse(file.content);
          return res.status(200).json({ success: true, serp: (obj && typeof obj === 'object') ? obj : {} });
        } catch(e) {
          return res.status(200).json({ success: true, serp: {} });
        }
      }

      // ── ACTION: get-briefs ── (saved competitor briefs, keyed by lowercased blog title)
      if (req.query.action === 'get-briefs') {
        try {
          const file = await getGitHubFile('data/blog-briefs.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, briefs: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, briefs: {} });
        }
      }

      // ── ACTION: get-drafts ── (saved written blogs, keyed by lowercased blog title)
      if (req.query.action === 'get-drafts') {
        try {
          const file = await getGitHubFile('data/blog-drafts.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, drafts: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, drafts: {} });
        }
      }

      // ── ACTION: get-products ── (saved product picks per blog, keyed by lowercased blog title)
      if (req.query.action === 'get-products') {
        try {
          const file = await getGitHubFile('data/blog-products.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, products: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, products: {} });
        }
      }

      // ── ACTION: seo-metafield-scan ──
      if (req.query.action === 'seo-metafield-scan') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const cursor = req.query.cursor || null;
        const gqlQuery = `
          query($cursor: String) {
            products(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  title
                  handle
                  metafield(namespace: "SEO", key: "meta_description") {
                    id
                    value
                  }
                }
              }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: gqlQuery, variables: { cursor } })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const products = data.data.products;
        const found = [];

        for (const edge of products.edges) {
          const p = edge.node;
          if (p.metafield) {
            found.push({
              productId: p.id.replace('gid://shopify/Product/', ''),
              productGid: p.id,
              title: p.title,
              handle: p.handle,
              metafieldId: p.metafield.id.replace('gid://shopify/Metafield/', ''),
              value: p.metafield.value
            });
          }
        }

        return res.status(200).json({
          success: true,
          found,
          hasNextPage: products.pageInfo.hasNextPage,
          endCursor: products.pageInfo.endCursor
        });
      }

      // ── ACTION: bulk-get-options ── (Bulk Editor — collections list for filter dropdowns)
      if (req.query.action === 'bulk-get-options') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const gqlQuery = `{
          collections(first: 250, sortKey: TITLE) {
            edges { node { id title } }
          }
        }`;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gqlQuery })
        });
        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });
        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const collections = data.data.collections.edges.map(e => ({ id: e.node.id, title: e.node.title }));
        return res.status(200).json({ success: true, collections });
      }

      // ── ACTION: bulk-product-scan ── (Bulk Editor — filtered product fetch)
      if (req.query.action === 'bulk-product-scan') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const cursor = req.query.cursor || null;
        const queryParts = [];

        if (req.query.vendor) queryParts.push(`vendor:'${req.query.vendor.replace(/'/g, "\\'")}' `);
        if (req.query.productType) queryParts.push(`product_type:'${req.query.productType.replace(/'/g, "\\'")}'`);
        if (req.query.status) queryParts.push(`status:${req.query.status}`);
        if (req.query.collection) queryParts.push(`collection_id:${req.query.collection.replace('gid://shopify/Collection/', '')}`);
        if (req.query.keyword) queryParts.push(`title:*${req.query.keyword}*`);
        if (req.query.tags) {
          req.query.tags.split(',').forEach(t => { if (t.trim()) queryParts.push(`tag:'${t.trim()}'`); });
        }

        const queryStr = queryParts.join(' AND ');

        const gqlQuery = `
          query($cursor: String, $queryStr: String) {
            products(first: 50, after: $cursor, query: $queryStr) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id title handle vendor productType status tags
                  descriptionHtml publishedAt
                  seo { title description }
                  featuredImage { url altText }
                  metafields(first: 30) {
                    edges { node { id namespace key value type } }
                  }
                  variants(first: 100) {
                    edges {
                      node {
                        id sku barcode price compareAtPrice weight weightUnit inventoryQuantity
                        inventoryItem { unitCost { amount currencyCode } }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gqlQuery, variables: { cursor, queryStr } })
        });
        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });
        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        let products = data.data.products.edges.map(edge => {
          const p = edge.node;
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor,
            productType: p.productType,
            status: p.status,
            tags: p.tags,
            descriptionHtml: p.descriptionHtml,
            publishedAt: p.publishedAt,
            seo: p.seo,
            featuredImage: p.featuredImage,
            metafields: p.metafields.edges.map(e => e.node),
            variants: p.variants.edges.map(e => e.node)
          };
        });

        if (req.query.excludeKeyword) {
          const excl = req.query.excludeKeyword.toLowerCase();
          products = products.filter(p => !p.title.toLowerCase().includes(excl));
        }
        if (req.query.excludeTags) {
          const exclTags = req.query.excludeTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          products = products.filter(p => !exclTags.some(et => p.tags.map(t => t.toLowerCase()).includes(et)));
        }

        return res.status(200).json({
          success: true,
          products,
          hasNextPage: data.data.products.pageInfo.hasNextPage,
          endCursor: data.data.products.pageInfo.endCursor
        });
      }

      // ── ORIGINAL GET: Read published blogs from registry ──
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');

      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'Registry file not found', path: csvPath });
      }

      const csvText = fs.readFileSync(csvPath, 'utf-8');
      const lines = csvText.split('\n');
      const blogs = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim().replace(/\r/g, '');
        if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length >= 10) {
          const keyword = cols[0];
          const url = cols[1];
          const source = cols[9];
          if (source === 'Published Blog' && keyword) {
            blogs.push({ title: keyword, keyword, status: 'published', url, date: null });
          }
        }
      }

      return res.status(200).json({ blogs });
    }

    // ============================================
    // POST
    // ============================================
    if (req.method === 'POST') {

      // ── ACTION: lock-keyword ──
      if (req.body.action === 'lock-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url, intent, losers } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // ── DUPLICATE CHECK — reject if keyword already locked anywhere ──
        // ── Proper CSV line parser (handles quoted fields) ──
        function parseCSVLine(line) {
          const cols = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
          cols.push(cur.trim());
          return cols;
        }
        const resolvedIntent = detectIntent(url);
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols    = parseCSVLine(line);
          const rowKw     = (cols[0]||'').toLowerCase();
          const rowLocked = (cols[2]||'').toUpperCase();
          const rowStatus = (cols[3]||'').toUpperCase();
          const rowAction = (cols[4]||'').toUpperCase();
          const rowUrl    = cols[1]||'';
          const rowIntent = (cols[10]||'').toUpperCase();
          const isRealLock = rowLocked === 'LOCKED' && rowStatus === 'DONE' && ['TO_OPTIMIZE','OPTIMIZED'].includes(rowAction);
          // Per-intent lock: only block when the SAME keyword is locked under the SAME intent.
          // A keyword CAN be locked to different pages under different intents.
          if (isRealLock && rowKw === keyword.toLowerCase() && rowIntent === (resolvedIntent||'').toUpperCase()) {
            return res.status(409).json({ duplicate: true, error: `DUPLICATE_KEYWORD`, lockedTo: rowUrl });
          }
        }
        // Remove any existing SAVED_FOR_FUTURE row for this keyword before adding the locked row
        const cleanedLines = lines.filter(line => {
          if (!line.trim()) return true;
          const cols = parseCSVLine(line);
          const rowKw = (cols[0]||'').toLowerCase();
          const rowAction = (cols[4]||'').toUpperCase();
          return !(rowKw === keyword.toLowerCase() && rowAction === 'SAVED_FOR_FUTURE');
        });
        // 12 columns — empty 12th col keeps registry consistent with mark-optimized rows
        let newRows = `${csvField(keyword)},${csvField(url)},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,User Resolved,${resolvedIntent},`;
        // Add loser rows for internal linking
        if (Array.isArray(losers)) {
          losers.forEach(loser => {
            newRows += `\n${csvField(keyword)},${csvField(loser.url)},,DONE,INTERNAL_LINK,${csvField(url)},${loser.clicks || 'N/A'},${loser.impressions || 'N/A'},${loser.position || 'N/A'},Auto Detected,${resolvedIntent},`;
          });
        }
        const updated = cleanedLines.join('\n').trimEnd() + '\n' + newRows + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Lock keyword: ${keyword}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: mark-optimized ──
      if (req.body.action === 'mark-optimized') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        let found = false;
        const updatedLines = [...titleLines, header];
        const today = new Date().toISOString().split('T')[0];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          const rowUrl = cols[1]?.trim().toLowerCase();
          const rowKeyword = cols[0]?.trim().toLowerCase();
          if (rowUrl === url.toLowerCase() && rowKeyword === keyword.toLowerCase()) {
            cols[2] = 'LOCKED'; cols[3] = 'DONE'; cols[4] = 'OPTIMIZED';
            cols[11] = today;
            updatedLines.push(sanitizeRow(cols));
            found = true;
          } else {
            updatedLines.push(sanitizeRow(cols));
          }
        }
        if (!found) {
          updatedLines.push(`${keyword},${url},LOCKED,DONE,OPTIMIZED,,,,,,User Resolved,${today}`);
        }
        const updated = updatedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Mark optimized: ${keyword} on ${url}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: unmark-optimized ──
      if (req.body.action === 'unmark-optimized') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        let found = false;
        const updatedLines = [...titleLines, header];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          if (cols[1]?.trim().toLowerCase() === url.toLowerCase() && cols[0]?.trim().toLowerCase() === keyword.toLowerCase()) {
            cols[4] = 'TO_OPTIMIZE';
            cols[11] = '';
            updatedLines.push(sanitizeRow(cols));
            found = true;
          } else { updatedLines.push(sanitizeRow(cols)); }
        }
        if (!found) return res.status(404).json({ error: 'Page not found in registry' });
        await updateGitHubFile('data/keyword-locker-registry.csv', updatedLines.join('\n') + '\n', registry.sha, `Unmark optimized: ${keyword}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: mark-removed ── (Money Page Doctor — move page(s) to the Removed tab; bulk)
      // Sets the registry row action to REMOVED so the page shows ONLY in the Removed tab and never
      // returns to Start Here / Optimized / Winners. Accepts a single {keyword,url} OR {pages:[...]}.
      if (req.body.action === 'mark-removed') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let pages = Array.isArray(req.body.pages) ? req.body.pages : [];
        if (!pages.length && req.body.keyword && req.body.url) pages = [{ keyword: req.body.keyword, url: req.body.url }];
        pages = pages.filter(p => p && p.keyword && p.url);
        if (!pages.length) return res.status(400).json({ error: 'pages (or keyword+url) required' });
        const wanted = new Map(pages.map(p => [`${String(p.keyword).trim().toLowerCase()}|${String(p.url).trim().toLowerCase()}`, p]));
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const updatedLines = [...titleLines, header];
        const seen = new Set();
        const today = new Date().toISOString().split('T')[0];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          const key = `${(cols[0]||'').trim().toLowerCase()}|${(cols[1]||'').trim().toLowerCase()}`;
          if (wanted.has(key)) { cols[2] = 'LOCKED'; cols[3] = 'DONE'; cols[4] = 'REMOVED'; seen.add(key); }
          updatedLines.push(sanitizeRow(cols));
        }
        // Any requested page not already in the registry → add it as a REMOVED row.
        for (const [key, p] of wanted) {
          if (seen.has(key)) continue;
          updatedLines.push(sanitizeRow([p.keyword, p.url, 'LOCKED', 'DONE', 'REMOVED', '', '', '', '', 'User Resolved', detectIntent(p.url), today]));
        }
        await updateGitHubFile('data/keyword-locker-registry.csv', updatedLines.join('\n') + '\n', registry.sha, `MPD remove: ${pages.length} page(s)`);
        return res.status(200).json({ success: true, removed: pages.length });
      }

      // ── ACTION: restore-removed ── (Money Page Doctor — bring a Removed page back to the queue)
      if (req.body.action === 'restore-removed') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        let found = false;
        const updatedLines = [...titleLines, header];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          if ((cols[1]||'').trim().toLowerCase() === url.toLowerCase() && (cols[0]||'').trim().toLowerCase() === keyword.toLowerCase()) {
            cols[4] = 'TO_OPTIMIZE'; cols[11] = ''; found = true;
          }
          updatedLines.push(sanitizeRow(cols));
        }
        if (!found) return res.status(404).json({ error: 'Page not found in registry' });
        await updateGitHubFile('data/keyword-locker-registry.csv', updatedLines.join('\n') + '\n', registry.sha, `MPD restore: ${keyword}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: add-to-optimize ──
      if (req.body.action === 'add-to-optimize') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        // Check if already exists
        const exists = lines.slice(1).some(l => {
          const cols = l.split(',');
          return cols[1]?.trim().toLowerCase() === url.toLowerCase() && cols[0]?.trim().toLowerCase() === keyword.toLowerCase();
        });
        if (exists) return res.status(200).json({ success: true, alreadyExists: true });
        const newRow = `${csvField(keyword)},${csvField(url)},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,User Resolved,${detectIntent(url)},`;
        const updated = lines.filter(l => l.trim()).join('\n') + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Add to optimize: ${keyword} on ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: mpd-change-keyword ── (Money Page Doctor — swap a page's target keyword and FREE the old one)
      // Rewrites the page's existing registry row to the NEW keyword as TO_OPTIMIZE, so the old weak keyword
      // is released (no leftover row) and the page shows once in Start Here on the new keyword.
      if (req.body.action === 'mpd-change-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, oldKeyword, newKeyword } = req.body;
        if (!url || !oldKeyword || !newKeyword) return res.status(400).json({ error: 'url, oldKeyword and newKeyword required' });
        const urlLower = String(url).trim().toLowerCase();
        const oldLower = String(oldKeyword).trim().toLowerCase();
        const nkLower  = String(newKeyword).trim().toLowerCase();
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        // Guard: refuse if the new keyword is already locked/queued to a DIFFERENT page.
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const c = parseCSVLine(lines[i]);
          const kw = (c[0] || '').trim().toLowerCase();
          const ru = (c[1] || '').trim().toLowerCase();
          const act = (c[4] || '').trim().toUpperCase();
          if (kw === nkLower && ru !== urlLower && (act === 'OPTIMIZED' || act === 'TO_OPTIMIZE')) {
            return res.status(200).json({ success: false, locked: true, error: 'That keyword is already locked to another page.' });
          }
        }
        let found = false;
        const updatedLines = [...titleLines, header];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          if (!found && (cols[1] || '').trim().toLowerCase() === urlLower && (cols[0] || '').trim().toLowerCase() === oldLower) {
            cols[0] = newKeyword; cols[2] = 'LOCKED'; cols[3] = 'DONE'; cols[4] = 'TO_OPTIMIZE'; cols[9] = 'Retargeted'; cols[11] = '';
            updatedLines.push(sanitizeRow(cols));
            found = true;
          } else { updatedLines.push(sanitizeRow(cols)); }
        }
        if (!found) {
          // Old row not in the registry (e.g. a seeded page) → just add a fresh TO_OPTIMIZE row for the new keyword.
          updatedLines.push(sanitizeRow([newKeyword, url, 'LOCKED', 'DONE', 'TO_OPTIMIZE', 'N/A', 'N/A', 'N/A', 'N/A', 'Retargeted', detectIntent(url), '']));
        }
        await updateGitHubFile('data/keyword-locker-registry.csv', updatedLines.join('\n') + '\n', registry.sha, `MPD change keyword: ${oldKeyword} → ${newKeyword} on ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: repurpose-page ── (saves a URL as REPURPOSE — no keyword assigned yet)
      if (req.body.action === 'repurpose-page') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const urlLower = url.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[1]||'').toLowerCase() === urlLower && (cols[4]||'').toUpperCase() === 'REPURPOSE';
        });
        if (alreadyExists) return res.status(200).json({ success: true, skipped: true });
        const intent = detectIntent(url);
        const urlPath = url.replace('https://aboutwallart.com','').replace('https://www.aboutwallart.com','');
        const newRow = sanitizeRow([urlPath,url,'','DONE','REPURPOSE','','','','','System',intent,'']);
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Repurpose page: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-for-later ──
      if (req.body.action === 'save-for-later') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, intent } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // Duplicate check — skip if already exists with any action
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[0]||'').toLowerCase() === kwLower;
        });
        if (alreadyExists) return res.status(200).json({ success: true, keyword, skipped: true });
        const newRow = `${csvField(keyword)},N/A,LOCKED,DONE,SAVED_FOR_FUTURE,N/A,N/A,N/A,N/A,User Action,UNKNOWN,`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Save for later: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: skw-ignore ── (ban a keyword FOR A SPECIFIC PAGE from the "Ranking, Not Locked" tab; keyword stays usable on other pages)
      if (req.body.action === 'skw-ignore') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url, intent } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const kwLower = keyword.toLowerCase(), urlLower = url.toLowerCase();
        // Skip if this exact keyword+url is already marked IGNORED
        const already = registry.content.split('\n').some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[0]||'').toLowerCase() === kwLower && (cols[1]||'').toLowerCase() === urlLower && (cols[4]||'').toUpperCase() === 'IGNORED';
        });
        if (already) return res.status(200).json({ success: true, keyword, url, skipped: true });
        const newRow = `${csvField(keyword)},${csvField(url)},,DONE,IGNORED,N/A,N/A,N/A,N/A,User Action,${csvField(intent||'')},`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Ignore keyword for page: ${keyword} on ${url}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: mpd-liberate ── (Money Page Doctor: free a keyword+URL so the page goes back to the Keyword Locker)
      if (req.body.action === 'mpd-liberate') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const kwLower = keyword.toLowerCase(), urlLower = url.toLowerCase();
        let removed = 0;
        const kept = registry.content.split('\n').filter(line => {
          if (!line.trim()) return true;
          const cols = parseCSVLine(line);
          const rowKw = (cols[0]||'').toLowerCase();
          const rowUrl = (cols[1]||'').toLowerCase();
          const rowAction = (cols[4]||'').toUpperCase();
          const rowWinner = (cols[5]||'').toLowerCase();
          // remove this page's lock row for this keyword
          if (rowKw === kwLower && rowUrl === urlLower && ['TO_OPTIMIZE','OPTIMIZED'].includes(rowAction)) { removed++; return false; }
          // remove its loser internal-link rows (same keyword, winner = this page)
          if (rowKw === kwLower && rowAction === 'INTERNAL_LINK' && rowWinner === urlLower) { removed++; return false; }
          return true;
        });
        const updated = kept.join('\n').replace(/\n+$/, '') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Liberate (back to Locker): ${keyword} on ${url}`);
        return res.status(200).json({ success: true, keyword, url, removed });
      }

      // ── ACTION: mpd-switch-url ── (Money Page Doctor: point a lock at the current URL when the old one 301-redirects)
      if (req.body.action === 'mpd-switch-url') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, oldUrl, newUrl } = req.body;
        if (!keyword || !oldUrl || !newUrl) return res.status(400).json({ error: 'keyword, oldUrl and newUrl required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const kwLower = keyword.toLowerCase(), oldLower = oldUrl.toLowerCase();
        let changed = 0;
        const out = registry.content.split('\n').map(line => {
          if (!line.trim()) return line;
          const cols = parseCSVLine(line);
          const rowKw = (cols[0]||'').toLowerCase();
          const rowUrl = (cols[1]||'').toLowerCase();
          const rowAction = (cols[4]||'').toUpperCase();
          const rowWinner = (cols[5]||'').toLowerCase();
          // the lock row for keyword+oldUrl → change its page URL to the current one
          if (rowKw === kwLower && rowUrl === oldLower && ['TO_OPTIMIZE','OPTIMIZED'].includes(rowAction)) { cols[1] = newUrl; changed++; return cols.map(csvField).join(','); }
          // loser internal-link rows pointing at the old URL → repoint to the current one
          if (rowKw === kwLower && rowAction === 'INTERNAL_LINK' && rowWinner === oldLower) { cols[5] = newUrl; changed++; return cols.map(csvField).join(','); }
          return line;
        });
        // Fallback: the analysed/old URL was wrong or truncated so it didn't match by URL. If this keyword has
        // exactly ONE lock row, repoint THAT one (match by keyword, not by the broken URL). Safe: only when unique.
        if (!changed) {
          const locks = [];
          registry.content.split('\n').forEach(line => {
            if (!line.trim()) return;
            const cols = parseCSVLine(line);
            if ((cols[0]||'').toLowerCase() === kwLower && ['TO_OPTIMIZE','OPTIMIZED'].includes((cols[4]||'').toUpperCase())) locks.push((cols[1]||'').toLowerCase());
          });
          if (locks.length === 1) {
            const target = locks[0];
            for (let i = 0; i < out.length; i++) {
              if (!out[i].trim()) continue;
              const cols = parseCSVLine(out[i]);
              const rowKw = (cols[0]||'').toLowerCase(), rowUrl = (cols[1]||'').toLowerCase(), rowAction = (cols[4]||'').toUpperCase(), rowWinner = (cols[5]||'').toLowerCase();
              if (rowKw === kwLower && rowUrl === target && ['TO_OPTIMIZE','OPTIMIZED'].includes(rowAction)) { cols[1] = newUrl; changed++; out[i] = cols.map(csvField).join(','); }
              else if (rowKw === kwLower && rowAction === 'INTERNAL_LINK' && rowWinner === target) { cols[5] = newUrl; changed++; out[i] = cols.map(csvField).join(','); }
            }
          }
        }
        if (!changed) return res.status(404).json({ error: 'No matching lock row found for that keyword + URL' });
        const updated = out.join('\n').replace(/\n+$/, '') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Switch URL: ${keyword} ${oldUrl} → ${newUrl}`);
        return res.status(200).json({ success: true, keyword, oldUrl, newUrl, changed });
      }

      // ── ACTION: delete-keyword ──
      if (req.body.action === 'delete-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, intent } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // Duplicate check — skip if already exists with any action
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[0]||'').toLowerCase() === kwLower;
        });
        if (alreadyExists) return res.status(200).json({ success: true, keyword, skipped: true });
        const newRow = `${csvField(keyword)},N/A,LOCKED,DONE,DELETED,N/A,N/A,N/A,N/A,User Action,UNKNOWN,`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Delete keyword: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: remove-from-registry ──
      if (req.body.action === 'remove-from-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const filtered = lines.filter(line => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          const cols = parseCSVLine(trimmed);
          return cols[0].toLowerCase() !== keyword.toLowerCase();
        });
        const updated = filtered.join('\n');
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Remove from registry: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: delete-registry-row ── (targeted: removes one specific keyword+url row)
      if (req.body.action === 'delete-registry-row') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const urlLower = url.toLowerCase();
        const filtered = lines.filter(line => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          const cols = parseCSVLine(trimmed);
          return !((cols[0]||'').toLowerCase() === kwLower && (cols[1]||'').toLowerCase() === urlLower);
        });
        await updateGitHubFile('data/keyword-locker-registry.csv', filtered.join('\n'), registry.sha, `Delete registry row: ${keyword} on ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: repair-registry ── (one-time fix: pad all rows to 12 cols, fill blank intent)
      if (req.body.action === 'repair-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const repairedLines = [...titleLines, header];
        let fixedCount = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          while (cols.length < 12) cols.push('');
          cols.length = 12;
          const correctIntent = detectIntent(cols[1] || 'N/A');
          if (cols[10] !== correctIntent) {
            cols[10] = correctIntent;
            fixedCount++;
          }
          repairedLines.push(sanitizeRow(cols));
        }
        const updated = repairedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Repair registry: pad to 12 columns, fill blank intent`);
        return res.status(200).json({ success: true, fixedCount, totalRows: repairedLines.length - 1 });
      }

      // ── ACTION: deduplicate-registry ── (removes duplicate SAVED_FOR_FUTURE and DELETED rows, keeps one per keyword)
      if (req.body.action === 'deduplicate-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const seen = new Set();
        const cleaned = [...titleLines, header];
        let removed = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const action = (cols[4]||'').toUpperCase();
          const kw = (cols[0]||'').toLowerCase();
          if (action === 'SAVED_FOR_FUTURE' || action === 'DELETED') {
            const key = kw + '::' + action;
            if (seen.has(key)) { removed++; continue; }
            seen.add(key);
          }
          cleaned.push(sanitizeRow(cols));
        }
        const updated = cleaned.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Deduplicate registry: removed ${removed} duplicate rows`);
        return res.status(200).json({ success: true, removed, total: cleaned.length - 1 });
      }

      // ── ACTION: fix-url-format ── (replaces https://www.aboutwallart.com with https://aboutwallart.com in all rows)
      if (req.body.action === 'fix-url-format') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const fixedLines = [...titleLines, header];
        let fixedCount = 0;
        const totalRows = lines.length - startIdx;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const before = cols[1] || '';
          cols[1] = before.replace('https://www.aboutwallart.com', 'https://aboutwallart.com');
          if (cols[1] !== before) fixedCount++;
          fixedLines.push(sanitizeRow(cols));
        }
        const updated = fixedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Fix URL format: remove www from registry URLs`);
        return res.status(200).json({ success: true, fixed: fixedCount, total: totalRows });
      }

      // ── ACTION: save-susp-events ──
      if (req.body.action === 'save-susp-events') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { events } = req.body;
        const jsonContent = JSON.stringify(events, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/suspicious-events.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/suspicious-events.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update suspicious traffic events', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-optimisations ──
      if (req.body.action === 'save-optimisations') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { optimisations } = req.body;
        const jsonContent = JSON.stringify(optimisations, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-optimisations.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-optimisations.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword optimisations', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-tracked-keywords ──
      if (req.body.action === 'save-tracked-keywords') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords must be an array' });
        const jsonContent = JSON.stringify(keywords, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/tracked-keywords.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/tracked-keywords.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update tracked keywords', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: keywords.length });
      }

      // ── ACTION: save-dismissed-keywords ──
      if (req.body.action === 'save-dismissed-keywords') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords must be an array' });
        const jsonContent = JSON.stringify(keywords, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/kwr-dismissed.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/kwr-dismissed.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update dismissed keywords', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: keywords.length });
      }

      // ── ACTION: dismiss-gsc-blog-topic ── permanently hide a GSC blog topic from the panel
      if (req.body.action === 'dismiss-gsc-blog-topic') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        // Accept a single `keyword` or a `keywords` array (bulk — used when approving several at once).
        const kws = (Array.isArray(req.body.keywords) ? req.body.keywords : [req.body.keyword])
          .map(s => (s == null ? '' : String(s)).toLowerCase().trim())
          .filter(Boolean);
        if (!kws.length) return res.status(400).json({ error: 'keyword or keywords required' });
        let arr = []; let sha = null;
        try { const existing = await getGitHubFile('data/gsc-blog-dismissed.json'); sha = existing.sha; arr = JSON.parse(existing.content) || []; } catch (e) { arr = []; }
        const have = new Set(arr.map(s => String(s).toLowerCase()));
        kws.forEach(kw => { if (!have.has(kw)) { arr.push(kw); have.add(kw); } });
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/gsc-blog-dismissed.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Dismiss GSC blog topic(s): ${kws.length}`, content: Buffer.from(JSON.stringify(arr, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-tech-status ──
      if (req.body.action === 'save-tech-status') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { statuses } = req.body;
        if (!statuses || typeof statuses !== 'object') return res.status(400).json({ error: 'statuses object required' });
        await updateGitHubFile('data/tech-status.json', JSON.stringify(statuses, null, 2), null, 'Update tech health statuses');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-reindex-done ──
      if (req.body.action === 'save-reindex-done') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { done } = req.body;
        if (!Array.isArray(done)) return res.status(400).json({ error: 'done must be an array' });
        await updateGitHubFile('data/reindex-done.json', JSON.stringify(done, null, 2), null, 'Update reindex done list');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-checklist ── (Money Page Doctor — checkbox states)
      if (req.body.action === 'save-mpd-checklist') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { checklist } = req.body;
        if (!checklist || typeof checklist !== 'object') return res.status(400).json({ error: 'checklist object required' });
        let sha = null;
        try { const existing = await getGitHubFile('data/mpd-checklist.json'); sha = existing.sha; } catch(e) {}
        await updateGitHubFile('data/mpd-checklist.json', JSON.stringify(checklist, null, 2), sha, 'Update MPD checklist state');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-snapshot ── (Money Page Doctor — save one GSC baseline)
      if (req.body.action === 'save-mpd-snapshot') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, snapshot } = req.body;
        if (!url || !snapshot) return res.status(400).json({ error: 'url and snapshot required' });
        let existing = {};
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-snapshots.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        existing[url] = snapshot;
        await updateGitHubFile('data/mpd-snapshots.json', JSON.stringify(existing, null, 2), sha, `Save MPD snapshot: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-push-state ── (Money Page Doctor — Push to Shopify state)
      if (req.body.action === 'save-mpd-push-state') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, pushed, linksPushed } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        let existing = {};
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-push-state.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        existing[url] = { pushed: !!pushed, linksPushed: !!linksPushed };
        await updateGitHubFile('data/mpd-push-state.json', JSON.stringify(existing, null, 2), sha, `Save MPD push state: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-hold ── (Money Page Doctor — toggle a Winner-Hold URL)
      if (req.body.action === 'save-mpd-hold') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, hold } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        let existing = [];
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-hold.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (!Array.isArray(existing)) existing = [];
        const set = new Set(existing);
        if (hold) set.add(url); else set.delete(url);
        const updated = [...set];
        await updateGitHubFile('data/mpd-hold.json', JSON.stringify(updated, null, 2), sha, `${hold ? 'Hold' : 'Unhold'} MPD winner: ${url}`);
        return res.status(200).json({ success: true, hold: updated });
      }

      // ── ACTION: save-mpd-hold-set ── (Money Page Doctor — replace the whole winners set in ONE write; used for bulk auto-adopt)
      if (req.body.action === 'save-mpd-hold-set') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const arr = Array.isArray(req.body.hold) ? req.body.hold : null;
        if (!arr) return res.status(400).json({ error: 'hold array required' });
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-hold.json'); sha = file.sha; } catch(e) {}
        const updated = [...new Set(arr.filter(Boolean))];
        await updateGitHubFile('data/mpd-hold.json', JSON.stringify(updated, null, 2), sha, `Set MPD winners (bulk, ${updated.length})`);
        return res.status(200).json({ success: true, hold: updated });
      }

      // ── ACTION: save-mpd-winner-out ── (Money Page Doctor — toggle a winner the user sent to Start Here to optimise)
      if (req.body.action === 'save-mpd-winner-out') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, out } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        let existing = [];
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-winner-out.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (!Array.isArray(existing)) existing = [];
        const set = new Set(existing);
        if (out) set.add(url); else set.delete(url);
        const updated = [...set];
        await updateGitHubFile('data/mpd-winner-out.json', JSON.stringify(updated, null, 2), sha, `${out ? 'Send to Start Here' : 'Return to Winners'} MPD: ${url}`);
        return res.status(200).json({ success: true, out: updated });
      }

      // ── ACTION: save-mpd-winner-serp ── (Money Page Doctor — store SERP UK positions for winners)
      // Body: { entries: { "normalizedPath|||keyword": { position, checkedAt } , ... } } — merged into the file.
      if (req.body.action === 'save-mpd-winner-serp') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const entries = (req.body.entries && typeof req.body.entries === 'object') ? req.body.entries : null;
        if (!entries) return res.status(400).json({ error: 'entries object required' });
        let existing = {};
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-winner-serp.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (!existing || typeof existing !== 'object') existing = {};
        Object.assign(existing, entries);
        await updateGitHubFile('data/mpd-winner-serp.json', JSON.stringify(existing, null, 2), sha, `MPD winner SERP UK positions (${Object.keys(entries).length} update(s))`);
        return res.status(200).json({ success: true, serp: existing });
      }

      // ── ACTION: save-keyword-tabs ──
      if (req.body.action === 'save-keyword-tabs') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { tabs } = req.body;
        if (!Array.isArray(tabs)) return res.status(400).json({ error: 'tabs must be an array' });
        const jsonContent = JSON.stringify(tabs, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-tracker.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-tracker.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword tracker tabs', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: tabs.length });
      }

      // ── ACTION: save-metafield-links ──
      if (req.body.action === 'save-metafield-links') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { links } = req.body;
        if (!Array.isArray(links)) return res.status(400).json({ error: 'links must be an array' });
        const jsonContent = JSON.stringify(links, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/metafield-product-links.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/metafield-product-links.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update metafield product links', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: links.length });
      }

      // ── ACTION: save-lw-counters ──
      if (req.body.action === 'save-lw-counters') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let existing = { brokenLinks: 0, orphanedProducts: 0 };
        let sha = null;
        try { const file = await getGitHubFile('data/lw-counters.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (req.body.brokenLinks !== undefined) existing.brokenLinks = req.body.brokenLinks;
        if (req.body.orphanedProducts !== undefined) existing.orphanedProducts = req.body.orphanedProducts;
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/lw-counters.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update LW counters', content: Buffer.from(JSON.stringify(existing, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-rank-audits ──
      if (req.body.action === 'save-rank-audits') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { audits } = req.body;
        if (!Array.isArray(audits)) return res.status(400).json({ error: 'audits must be an array' });
        let sha = null;
        try { const file = await getGitHubFile('data/rank-recent-audits.json'); sha = file.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/rank-recent-audits.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update rank recent audits', content: Buffer.from(JSON.stringify(audits, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-lw-settings ──
      if (req.body.action === 'save-lw-settings') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { wordsToIgnore, dataTypes, ignoreNumbers } = req.body;
        const settings = {
          wordsToIgnore: Array.isArray(wordsToIgnore) ? wordsToIgnore : [],
          dataTypes: Array.isArray(dataTypes) ? dataTypes : [],
          ignoreNumbers: ignoreNumbers !== false
        };
        const jsonContent = JSON.stringify(settings, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/lw-settings.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/lw-settings.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update link whisperer settings', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-autolink-rules ──
      if (req.body.action === 'save-autolink-rules') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { rules } = req.body;
        if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules must be an array' });
        const jsonContent = JSON.stringify(rules, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/autolink-rules.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/autolink-rules.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update autolink rules', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: rules.length });
      }

      // ── ACTION: seo-metafield-delete ──
      if (req.body.action === 'seo-metafield-delete') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const { productGid } = req.body;
        if (!productGid) return res.status(400).json({ error: 'productGid required' });

        const mutation = `
          mutation {
            metafieldsDelete(metafields: [{ ownerId: "${productGid}", namespace: "SEO", key: "meta_description" }]) {
              deletedMetafields { key namespace ownerId }
              userErrors { field message }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: mutation })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const result = data.data.metafieldsDelete;
        if (result.userErrors.length > 0) return res.status(500).json({ error: result.userErrors[0].message });

        return res.status(200).json({ success: true });
      }

      // ── ACTION: bulk-product-update ── (Bulk Editor — apply changes to one product)
      if (req.body.action === 'bulk-product-update') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const { productId, productFields, variantUpdates, metafieldUpdates } = req.body;
        if (!productId) return res.status(400).json({ error: 'productId required' });

        const headers = { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' };
        const endpoint = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;

        if (productFields && Object.keys(productFields).length > 0) {
          const mutation = `
            mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { input: { id: productId, ...productFields } } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.productUpdate.userErrors.length > 0) return res.status(500).json({ error: d.data.productUpdate.userErrors[0].message });
        }

        if (variantUpdates && variantUpdates.length > 0) {
          const mutation = `
            mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants { id }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { productId, variants: variantUpdates } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.productVariantsBulkUpdate.userErrors.length > 0) return res.status(500).json({ error: d.data.productVariantsBulkUpdate.userErrors[0].message });
        }

        if (metafieldUpdates && metafieldUpdates.length > 0) {
          const mutation = `
            mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields { namespace key }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { metafields: metafieldUpdates } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.metafieldsSet.userErrors.length > 0) return res.status(500).json({ error: d.data.metafieldsSet.userErrors[0].message });
        }

        return res.status(200).json({ success: true });
      }

      // ── ACTION: mark-blog-done ── (title → STATUS=PUBLISHED + clear MONTH, so it leaves the write list for good.
      // Uses the SAME columns the publish flow uses: match on title (col 1), STATUS = col 5, MONTH = col 9.)
      if (req.body.action === 'mark-blog-done') {
        const title = String(req.body.title || '').trim();
        if (!title) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const nrm = (s) => String(s || '').trim().toLowerCase();
        const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const f = await getGitHubFile('data/blog_ideas.csv');
        let found = false;
        const out = f.content.split('\n').map(line => {
          const t = line.trim().replace(/\r/g, '');
          if (!t) return line;
          const cols = parseCSVLine(t);
          if (nrm(cols[1]) === 'blog post title') return line;
          if (nrm(cols[1]) === nrm(title)) { while (cols.length < 10) cols.push(''); cols[5] = 'PUBLISHED'; cols[9] = ''; found = true; return cols.map(esc).join(','); }
          return line;
        });
        if (!found) return res.status(404).json({ error: 'blog not found in the list' });
        await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, 'Mark blog done: ' + title);
        // Record the EXPLICIT "done" in a dedicated permanent list. The Month-in-progress tab hides ONLY the blogs in
        // this list — so a blog leaves that view only when Mae clicks its own "Mark as done", never on publish/refresh.
        try { let done = await readJsonFileSafe('data/blog-done.json', []); if (!Array.isArray(done)) done = []; const lc = title.trim().toLowerCase(); if (!done.includes(lc)) { done.push(lc); await writeJsonFile('data/blog-done.json', done, 'Marked done: ' + title); } } catch (e) {}
        return res.status(200).json({ success: true });
      }

      // ── ACTION: swap-month-blog ── (ONE CSV write: clear removeTitle's month AND set addTitle's month.
      // Atomic so a remove-and-replace can never half-apply and shrink the month. MONTH = col 9, title = col 1.)
      if (req.body.action === 'swap-month-blog') {
        const month = String(req.body.month || '').trim();
        const removeTitle = String(req.body.removeTitle || '').trim();
        const addTitle = String(req.body.addTitle || '').trim();
        if (!month || !removeTitle) return res.status(400).json({ error: 'month and removeTitle required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const nrm = (s) => String(s || '').trim().toLowerCase();
        const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const f = await getGitHubFile('data/blog_ideas.csv');
        let removed = false, added = false;
        const out = f.content.split('\n').map(line => {
          const t = line.trim().replace(/\r/g, '');
          if (!t) return line;
          const cols = parseCSVLine(t);
          if (nrm(cols[1]) === 'blog post title') return line;
          if (nrm(cols[1]) === nrm(removeTitle)) { while (cols.length < 10) cols.push(''); cols[9] = ''; removed = true; return cols.map(esc).join(','); }
          if (addTitle && nrm(cols[1]) === nrm(addTitle)) { while (cols.length < 10) cols.push(''); cols[9] = month; added = true; return cols.map(esc).join(','); }
          return line;
        });
        await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, `Swap month ${month}: -${removeTitle} +${addTitle || '(none)'}`);
        return res.status(200).json({ success: true, removed, added });
      }

      // ── ACTION: update-blog-status ── (single keyword — updates STATUS column in blog_ideas.csv)
      if (req.body.action === 'update-blog-status') {
        const { keyword, status } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const ideasLines = ideasFile.content.split('\n');
        let found = false;
        const updatedIdeas = ideasLines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if ((cols[0] || '').toLowerCase() === keyword.toLowerCase()) {
            while (cols.length < 7) cols.push('');
            cols[6] = status || '';
            found = true;
            return cols.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
          }
          return line;
        }).join('\n');
        if (!found) return res.status(404).json({ error: 'keyword not found in blog_ideas.csv' });
        await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Update blog status: ${keyword} → ${status || 'blank'}`);
        return res.status(200).json({ success: true, keyword, status });
      }

      // ── ACTION: send-to-sheet ── (only calls Apps Script — no GitHub writes)
      // Batch 1: auto-generates content sources (colG–colK) via web search, or accepts manual values (manual:true).
      // Fail-loud: the row is written ONLY when authority article + YouTube video are both complete.
      if (req.body.action === 'send-to-sheet') {
        const { keyword, title, perspective, galleryCode, collectionUrl, manual } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });

        let authorityTitle = (req.body.authorityTitle || '').trim();
        let authorityUrl   = (req.body.authorityUrl || '').trim();
        let youtubeTitle   = (req.body.youtubeTitle || '').trim();
        let youtubeLink    = (req.body.youtubeLink || '').trim();

        // Auto mode (first send): search the web for both sources
        if (!manual) {
          try {
            const gen = await generateContentSources(keyword, title);
            authorityTitle = gen.authorityTitle;
            authorityUrl   = gen.authorityUrl;
            youtubeTitle   = gen.youtubeTitle;
            youtubeLink    = gen.youtubeLink;
          } catch (genError) {
            console.error('Content source generation failed:', genError.message);
            // Hand back to the user for manual entry — nothing written to the sheet
            return res.status(200).json({
              success: false,
              needsManual: true,
              error: genError.message,
              found: { authorityTitle: '', authorityUrl: '', youtubeTitle: '', youtubeLink: '' }
            });
          }
        }

        // Build both embed formats from whatever link we have (same video id)
        const youtubeId = extractYouTubeId(youtubeLink);
        const youtubeEmbed = buildYouTubeEmbed(youtubeId);
        const youtubeEmbedResponsive = buildYouTubeEmbedResponsive(youtubeId);

        // Completeness check — both groups must be fully present, and the video link must be a valid YouTube link
        const articleOk = !!(authorityTitle && authorityUrl);
        const youtubeOk = !!(youtubeTitle && youtubeLink && youtubeEmbed);
        if (!articleOk || !youtubeOk) {
          let error;
          if (!articleOk && !youtubeOk) error = 'Could not find a trustworthy article or a YouTube video — please add them manually.';
          else if (!articleOk)         error = 'Could not find a trustworthy article — please add it manually.';
          else if (youtubeTitle && youtubeLink && !youtubeEmbed) error = 'That YouTube link is not valid — please check it.';
          else                         error = 'Could not find a YouTube video — please add it manually.';
          return res.status(200).json({
            success: false,
            needsManual: true,
            error,
            found: { authorityTitle, authorityUrl, youtubeTitle, youtubeLink }
          });
        }

        // Batch 2 + taxonomy — generate in parallel: People Also Ask (P), More About (Q),
        // SEO title+meta+excerpt (V/T/U), and the cluster classifier (Y/Z/AA/AB/AC).
        // Blogs by Topic (O) runs after, because it needs the clusters.
        // Fail-loud: if any write errors, nothing is written; the user simply sends again.
        let peopleAlsoAsk, moreAbout, metaDescription, excerpt, seoTitle;
        let primaryCluster, intentTag, supporting1, supporting2, supporting3, blogsByTopic;
        let linkAnchor1 = '', linkUrl1 = '', linkAnchor2 = '', linkUrl2 = '', linkAnchor3 = '', linkUrl3 = '', linkAnchor4 = '', linkUrl4 = '';
        let visualInspirationHtml = '', videoMetafield = '';
        let viUrl1 = '', viAnchor1 = '', viUrl2 = '', viAnchor2 = '', viUrl3 = '', viAnchor3 = '', viUrl4 = '', viAnchor4 = '';
        let productList = '', product1 = '', product2 = '', product3 = '', product4 = '', chosenProductGids = [];
        let proTipsMetafield = '';
        let pt1Anchor = '', pt1Url = '', pt2Anchor = '', pt2Url = '', pt3Anchor = '', pt3Url = '';
        let pt1Handle = '', pt2Handle = '', pt3Handle = '', pt1Image = '', pt2Image = '', pt3Image = '';
        let blog1Gid = '', blog1Id = '', blog2Gid = '', blog2Id = '', blog3Gid = '', blog3Id = '';
        try {
          const [paa, more, seo, clusters] = await Promise.all([
            generatePeopleAlsoAsk(keyword, title),
            generateMoreAbout(keyword, title, authorityTitle),
            generateSeoMeta(keyword, title),
            generateClusters(keyword, title)
          ]);
          peopleAlsoAsk   = paa;
          moreAbout       = more;
          metaDescription = seo.metaDescription;
          excerpt         = seo.excerpt;
          seoTitle        = seo.seoTitle;
          primaryCluster  = clusters.primaryCluster;
          intentTag       = clusters.intentTag;
          supporting1     = clusters.supporting[0] || '';
          supporting2     = clusters.supporting[1] || '';
          supporting3     = clusters.supporting[2] || '';

          // Blogs by Topic (O), Visual Inspiration (AP/BB–BI) and Products (S/AU–AX) all need the clusters — run together
          const styleTags = [primaryCluster, supporting1, supporting2, supporting3].filter(t => CLUSTER_TAXONOMY.style.includes(t));
          const prodClusterTags = [primaryCluster, supporting1, supporting2, supporting3].filter(Boolean);
          let recentProductSet = new Set();
          try { const rf = await getGitHubFile('data/recent-blog-products.json'); recentProductSet = new Set(JSON.parse(rf.content)); } catch (e) {}
          const [bbt, vi, prodGids, relatedBlogs] = await Promise.all([
            generateBlogsByTopic(keyword, title, clusters),
            generateVisualInspiration(keyword, title, styleTags[0] || ''),
            selectProducts(prodClusterTags, recentProductSet),
            getRelatedBlogs(prodClusterTags)
          ]);
          blogsByTopic = bbt;
          chosenProductGids = prodGids;
          product1 = prodGids[0] || ''; product2 = prodGids[1] || ''; product3 = prodGids[2] || ''; product4 = prodGids[3] || '';
          productList = prodGids.join(',');

          // Pro Tips / related blogs (AR + BM–BR + BU–CF)
          proTipsMetafield = buildProTips(keyword, relatedBlogs);
          if (relatedBlogs[0]) { pt1Anchor = relatedBlogs[0].title; pt1Url = relatedBlogs[0].url; pt1Handle = relatedBlogs[0].handle; pt1Image = relatedBlogs[0].image; blog1Gid = relatedBlogs[0].articleGid; blog1Id = relatedBlogs[0].blogGid; }
          if (relatedBlogs[1]) { pt2Anchor = relatedBlogs[1].title; pt2Url = relatedBlogs[1].url; pt2Handle = relatedBlogs[1].handle; pt2Image = relatedBlogs[1].image; blog2Gid = relatedBlogs[1].articleGid; blog2Id = relatedBlogs[1].blogGid; }
          if (relatedBlogs[2]) { pt3Anchor = relatedBlogs[2].title; pt3Url = relatedBlogs[2].url; pt3Handle = relatedBlogs[2].handle; pt3Image = relatedBlogs[2].image; blog3Gid = relatedBlogs[2].articleGid; blog3Id = relatedBlogs[2].blogGid; }

          visualInspirationHtml = vi.html;
          if (vi.trends[0]) { viUrl1 = vi.trends[0].url; viAnchor1 = vi.trends[0].name; }
          if (vi.trends[1]) { viUrl2 = vi.trends[1].url; viAnchor2 = vi.trends[1].name; }
          if (vi.trends[2]) { viUrl3 = vi.trends[2].url; viAnchor3 = vi.trends[2].name; }
          if (vi.trends[3]) { viUrl4 = vi.trends[3].url; viAnchor4 = vi.trends[3].name; }

          // Video metafield (AQ) — built from the YouTube title + link we already have
          videoMetafield = `WATCH: <a href="${youtubeLink}">${youtubeTitle}</a>`;

          // Internal links (AF–AM): the chosen cluster tags as anchor text + their CLUSTER SYSTEM MAP URL
          const linkTags = [primaryCluster, supporting1, supporting2, supporting3].filter(Boolean);
          const links = linkTags.map(tag => {
            const url = CLUSTER_URLS[tag];
            if (!url) throw new Error('No URL in cluster map for tag: ' + tag);
            return { anchor: tag, url };
          });
          if (links[0]) { linkAnchor1 = links[0].anchor; linkUrl1 = links[0].url; }
          if (links[1]) { linkAnchor2 = links[1].anchor; linkUrl2 = links[1].url; }
          if (links[2]) { linkAnchor3 = links[2].anchor; linkUrl3 = links[2].url; }
          if (links[3]) { linkAnchor4 = links[3].anchor; linkUrl4 = links[3].url; }
        } catch (b2Error) {
          console.error('Batch 2/taxonomy generation failed:', b2Error.message);
          return res.status(200).json({ success: false, error: 'Could not generate blog details — ' + b2Error.message });
        }

        // Complete row — write to the sheet
        try {
          const sheetsResult = await appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl, {
            authorityTitle, authorityUrl, youtubeTitle, youtubeLink, youtubeEmbed, youtubeEmbedResponsive,
            peopleAlsoAsk,
            moreAbout,
            moreAboutUrl: authorityUrl,   // column R = column H
            metaDescription, excerpt, seoTitle,
            visibility: 'Hidden',
            author: 'Mae Osz',
            blogsByTopic,
            primaryCluster, intentTag, supporting1, supporting2, supporting3,
            anchor1: linkAnchor1, url1: linkUrl1,
            anchor2: linkAnchor2, url2: linkUrl2,
            anchor3: linkAnchor3, url3: linkUrl3,
            anchor4: linkAnchor4, url4: linkUrl4,
            visualInspirationHtml, videoMetafield,
            viUrl1, viAnchor1, viUrl2, viAnchor2, viUrl3, viAnchor3, viUrl4, viAnchor4,
            productList, product1, product2, product3, product4,
            proTipsMetafield,
            pt1Anchor, pt1Url, pt2Anchor, pt2Url, pt3Anchor, pt3Url,
            pt1Handle, pt2Handle, pt3Handle, pt1Image, pt2Image, pt3Image,
            blog1Gid, blog1Id, blog2Gid, blog2Id, blog3Gid, blog3Id
          });

          // Record the products just used (best-effort — runs AFTER the sheet append, never blocks the send)
          try {
            let rSha = null, rExisting = [];
            try { const rf = await getGitHubFile('data/recent-blog-products.json'); rExisting = JSON.parse(rf.content); rSha = rf.sha; } catch (e) {}
            const rUpdated = [...rExisting, ...chosenProductGids].slice(-120); // ~30 blogs × 4
            await fetch(`https://api.github.com/repos/${REPO}/contents/data/recent-blog-products.json`, {
              method: 'PUT',
              headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Update recent blog products', content: Buffer.from(JSON.stringify(rUpdated, null, 2)).toString('base64'), ...(rSha ? { sha: rSha } : {}) })
            });
          } catch (e) { console.error('Recent products save failed (non-fatal):', e.message); }

          return res.status(200).json({ success: true, sheetsResult });
        } catch (sheetsError) {
          console.error('Google Sheets append failed:', sheetsError.message);
          return res.status(200).json({ success: false, error: sheetsError.message });
        }
      }

      // ── ACTION: bulk-update-blog-status ── (multiple keywords — one GitHub write)
      if (req.body.action === 'bulk-update-blog-status') {
        const { keywords, status } = req.body;
        if (!Array.isArray(keywords) || keywords.length === 0) return res.status(400).json({ error: 'keywords array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const keywordSet = new Set(keywords.map(k => (k || '').toLowerCase()));
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const ideasLines = ideasFile.content.split('\n');
        const updatedIdeas = ideasLines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (keywordSet.has((cols[0] || '').toLowerCase())) {
            while (cols.length < 7) cols.push('');
            cols[6] = status || '';
            return cols.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
          }
          return line;
        }).join('\n');
        await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Bulk update blog status: ${keywords.length} keywords → ${status || 'blank'}`);
        return res.status(200).json({ success: true, count: keywords.length, status });
      }

      // ── ACTION: analyze-blog-titles ── (the brain: real short keyword + cannibalisation flag)
      // Input: { titles: ["...", ...] }. Fetches live published blogs once, then judges each title.
      // Saves NOTHING — the tool shows the result for review first.
      if (req.body.action === 'analyze-blog-titles') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles.map(t => String(t || '').trim()).filter(Boolean) : [];
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        const published = await fetchPublishedBlogs();
        const results = await analyzeTitlesForKeywords(titles, published);
        return res.status(200).json({ success: true, publishedCount: published.length, results });
      }

      // ── ACTION: save-blog-ideas ── (writes reviewed keyword + cannibalisation into blog_ideas.csv)
      // Input: { rows: [{ title, keyword, cannibalization, conflictingKeyword, conflictingUrl, perspective?, isNew? }] }
      // Existing rows (matched by Blog Post Title) get their Keyword + CANNIBALIZATION + conflict columns updated.
      // Rows flagged isNew that aren't already present are APPENDED with STATUS = TO_WRITE.
      if (req.body.action === 'save-blog-ideas') {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ error: 'rows array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const byTitle = new Map(rows.map(r => [norm(r.title), r]));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          // Header row — make sure the CLASH INTENT (8th) + CHECKED (9th) column names exist.
          if (norm(cols[1]) === 'blog post title') {
            while (cols.length < 9) cols.push('');
            if (!cols[7]) cols[7] = 'CLASH INTENT';
            if (!cols[8]) cols[8] = 'CHECKED';
            return cols.map(esc).join(',');
          }
          const key = norm(cols[1]);
          const r = byTitle.get(key);
          if (r && !done.has(key)) {
            while (cols.length < 9) cols.push('');
            if (r.keyword !== undefined && r.keyword !== null) cols[0] = r.keyword;
            if (r.newTitle) cols[1] = r.newTitle;
            if (r.cannibalization) cols[3] = r.cannibalization;
            cols[4] = r.conflictingKeyword || '';
            cols[5] = r.conflictingUrl || '';
            cols[7] = r.clashIntent || '';
            cols[8] = '1';
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        while (updated.length && updated[updated.length - 1].trim() === '') updated.pop();
        let appended = 0;
        const newLines = [];
        for (const r of rows) {
          if (r.isNew && !done.has(norm(r.title))) {
            const newCols = [
              r.keyword || '', r.title || '', r.perspective || '',
              r.cannibalization || 'NO CONFLICT', r.conflictingKeyword || '', r.conflictingUrl || '', (r.status !== undefined && r.status !== null ? r.status : 'TO_WRITE'), r.clashIntent || ''
            ];
            newLines.push(newCols.map(esc).join(','));
            done.add(norm(r.title));
            appended++;
          }
        }
        // Default: append at the end. With `spread:true` (GSC approve), insert the new rows evenly
        // among the existing ones so the monthly auto-pick distributes them, not all in one month.
        if (req.body.spread && newLines.length) {
          const base = updated.length; // header (index 0) + existing rows
          const placed = newLines.map((line, n) => {
            let pos = Math.round((n + 1) * base / (newLines.length + 1));
            if (pos < 1) pos = 1;          // never before the header row
            if (pos > base) pos = base;
            return { line, pos };
          });
          placed.sort((a, b) => b.pos - a.pos); // insert from the end so earlier positions don't shift
          placed.forEach(p => updated.splice(p.pos, 0, p.line));
        } else {
          newLines.forEach(line => updated.push(line));
        }
        const out = updated.join('\n') + '\n';
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Blog keywords + cannibalisation: ${done.size} rows (${appended} new)`);
        return res.status(200).json({ success: true, updated: done.size, appended });
      }

      // ── ACTION: set-keyword-metric ── save a target keyword's Ubersuggest volume/difficulty into
      // data/keyword-metrics.json (merged by keyword). Powers the Blog Ideas "needs keyword research" fields.
      if (req.body.action === 'set-keyword-metric') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const vol = (req.body.volume === '' || req.body.volume == null) ? null : Number(req.body.volume);
        const diff = (req.body.difficulty === '' || req.body.difficulty == null) ? null : Number(req.body.difficulty);
        const metrics = await readJsonFileSafe('data/keyword-metrics.json', {});
        const prev = metrics[kw] || {};
        metrics[kw] = Object.assign({}, prev,
          (vol != null && !Number.isNaN(vol)) ? { volume: vol } : {},
          (diff != null && !Number.isNaN(diff)) ? { difficulty: diff } : {});
        await writeJsonFile('data/keyword-metrics.json', metrics, `Keyword metric: ${kw}`);
        return res.status(200).json({ success: true, keyword: kw, metric: metrics[kw] });
      }

      // ── ACTION: find-fusion-groups ── AI groups To Write keywords that share the SAME search intent
      // (so they'd fight each other in Google — cannibalisation WITHIN the write list, as opposed to
      // analyze-blog-titles above which only checks against ALREADY PUBLISHED blogs). Only sends
      // keywords never checked before (cache in data/blog-fusion-checked.json) — cheap on repeat runs.
      // Proposed groups are saved to data/blog-fusion-pending.json for Mae to review + apply/discard;
      // nothing in blog_ideas.csv changes until apply-fusion-group is called.
      if (req.body.action === 'find-fusion-groups') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        // reset = wipe the saved results + the "already checked" cache so EVERYTHING is re-evaluated from
        // scratch with the current logic (used by the "Reset & re-check" button).
        if (req.body.reset) {
          try { await writeJsonFile('data/blog-fusion-pending.json', [], 'Fusion: reset pending (re-check all)'); } catch (e) {}
          try { await writeJsonFile('data/blog-fusion-checked.json', { singletons: [], grouped: [] }, 'Fusion: reset checked (re-check all)'); } catch (e) {}
          try { await writeJsonFile('data/blog-fusion-singles.json', [], 'Fusion: reset singles (re-check all)'); } catch (e) {}
        }
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const poolMap = new Map(); // lowercase keyword -> { keyword, title, source }
        lines.forEach((line, i) => {
          if (i === 0) return;
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return;
          const cols = parseCSVLine(trimmed);
          const status = (cols[6] || '').trim().toUpperCase();
          const kw = (cols[0] || '').trim();
          if (!kw || (status !== 'TO_WRITE' && status !== 'TO_WRITE_PENDING')) return;
          poolMap.set(kw.toLowerCase(), { keyword: kw, title: cols[1] || '', source: 'towrite' });
        });
        // Also fold the "You already rank" keywords into the SAME run (unified dedup). They are not in
        // blog_ideas.csv; each carries its ranking URL so the review card can add the link via MPD.
        try {
          const rankPool = await getRankPool();
          rankPool.forEach(r => {
            const lc = r.keyword.toLowerCase();
            if (poolMap.has(lc)) return; // a To Write row already covers this keyword
            poolMap.set(lc, { keyword: r.keyword, title: '', source: 'rank', pageUrl: r.pageUrl, urlFree: r.urlFree, lockedToKeyword: r.lockedToKeyword, impressions: r.impressions });
          });
        } catch (e) { /* if the rank list fails, To Write still runs */ }

        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const groupedSet = new Set((checked.grouped || []).map(s => String(s).toLowerCase()));
        const approvedArr = await readJsonFileSafe('data/blog-approved.json', []);
        const approvedSet = new Set((Array.isArray(approvedArr) ? approvedArr : []).map(s => String(s).toLowerCase()));
        const pool = [...poolMap.values()].filter(p => !groupedSet.has(p.keyword.toLowerCase()) && !approvedSet.has(p.keyword.toLowerCase()));

        if (!pool.length) {
          return res.status(200).json({ success: true, newGroups: [], checkedCount: 0, message: 'Nothing new to check.' });
        }

        // Existing blogs (published + scheduled) — so the AI can flag a topic that is ALREADY covered
        // (→ "Remove" or "Add angle"), instead of proposing a duplicate new blog.
        let existingBlogs = [];
        try { existingBlogs = await fetchBlogsPubAndSched(); } catch (e) { existingBlogs = []; }

        // Best-effort volume/impressions data — never blocks the run if missing.
        let metrics = {};
        try { const mf = await getGitHubFile('data/keyword-metrics.json'); metrics = JSON.parse(mf.content) || {}; } catch (e) { metrics = {}; }
        let gscOpp = [];
        try {
          const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/gsc-opportunity-keywords.json?t=${Date.now()}`);
          if (rr.ok) { const j = await rr.json(); gscOpp = Array.isArray(j.keywords) ? j.keywords : []; }
        } catch (e) { gscOpp = []; }
        const metricsLc = {}; Object.keys(metrics).forEach(k => { metricsLc[k.toLowerCase()] = metrics[k]; });
        const gscLc = {}; gscOpp.forEach(k => { if (k && k.keyword) gscLc[k.keyword.toLowerCase()] = k; });

        // Numbered list + the AI returns INDEX NUMBERS (not repeated text) — a model that paraphrases
        // even slightly while echoing text back (capitalisation, a comma, "the") used to make groups
        // silently vanish during exact-text matching. Numbers can't drift.
        const prompt = `You are grouping SEO keywords for About Wall Art (a UK wall-art & home-decor shop) so we don't write two blog posts that compete for the same Google search. Keywords are mostly about a ROOM (living room, bedroom, bathroom, nursery, kitchen, hallway, family room…) and/or a STYLE or theme (farmhouse, boho, coastal, japandi, grey, floral, minimalist, scandinavian…). USE JUDGEMENT — think about whether ONE blog post would sensibly serve the reader of all of them. Be willing to group; don't split hairs.

Think GENERAL vs SPECIFIC:
- GENERAL = names ONLY a style, OR ONLY a room (or is broad). e.g. "farmhouse room ideas" (style only), "living room wall art" (room only), "grey wall art" (style only), "wall art types" (broad).
- SPECIFIC = fixes a style AND a room together. e.g. "farmhouse living room ideas", "coastal bedroom".

GROUPING RULES:
1. Two GENERAL keywords that share the SAME style → group. That share the SAME room → group.
2. A SPECIFIC keyword can join a GENERAL blog/keyword of its SAME style, OR of its SAME room (the specific fits under that broader umbrella).
3. Two SPECIFIC keywords group ONLY when they share BOTH the same style AND the same room.
4. NEVER group across a DIFFERENT room or a DIFFERENT style. (A specific one needs room + style to match another specific; a general one needs the shared style or room.)
5. Also group obvious same-search variants: UK/US spelling (colour/color), singular/plural, word order, clear synonyms.

WORKED EXAMPLES (About Wall Art):
- GROUP: "farmhouse living rooms" + "cozy farmhouse living room ideas" → same style (farmhouse) + same room (living room).
- GROUP: "farmhouse room ideas" (general farmhouse) with the farmhouse group → the general one fits under the farmhouse umbrella.
- GROUP: "pictures of grey walls" + "grey wall art" → same style/topic.
- DO NOT GROUP: "coastal bedroom" with a farmhouse or a living-room group → different style AND room.
- DO NOT GROUP two specifics with different rooms (e.g. "farmhouse living room" vs "farmhouse kitchen") or different styles.

ALSO: for each group, and for any SINGLE keyword already fully answered by an EXISTING blog below, set "covered_by" to that blog's NUMBER; otherwise null.

THE MOST IMPORTANT JOB: flag any keyword already answered by an EXISTING blog below, so we never rewrite something we already published or scheduled.

OUTPUT — return ONLY compact JSON, ONE object, NOTHING else (no preamble, no explanation — start your reply with "{"). Use keyword NUMBERS and blog NUMBERS:
{"groups":[[3,17],[5,9]],"covered":[{"k":22,"blog":4},{"k":31,"blog":7}]}
- "groups" = clusters of 2+ keyword numbers that should share ONE blog (per the rules above). List ONLY real clusters of 2 or more. NEVER list a keyword that clusters with nothing.
- "covered" = ONLY the keyword numbers already answered by an EXISTING blog, each with that blog's number. List ONLY covered ones. NEVER list an uncovered keyword.
- Each keyword appears in AT MOST one place. If a cluster is already covered by an existing blog, put its members in "covered" (not "groups").
- Most keywords will appear in NEITHER list — that is correct and expected. Omit them. Do NOT output one entry per keyword.

KEYWORDS (numbered)${existingBlogs.length ? '' : ' — (no existing blogs loaded, so covered_by will be null)'}:
${pool.map((p, i) => (i + 1) + '. ' + p.keyword + (p.source === 'rank' ? ' [already ranks elsewhere]' : '')).join('\n')}

EXISTING BLOGS (numbered — published or scheduled):
${existingBlogs.length ? existingBlogs.map((b, i) => (i + 1) + '. ' + b.title).join('\n') : '(none)'}`;

        // ── DETERMINISTIC grouping (no AI) ── the prompt above is NO LONGER USED. The AI kept returning
        // 0 groups, so grouping is now done in code from a STYLE + ROOM dictionary, typo-tolerant.
        // Mae's rules: GENERAL = only a style OR only a room; SPECIFIC = a style AND a room. Two generals
        // that share a style group; that share a room group. A specific rolls into a general of its same
        // style (preferred) or same room. Two specifics group only if they share BOTH style and room.
        // Covered = an existing (published/scheduled) blog already answers that scope → pulled out first.
        // Mae reviewed the synonyms 1×1 (14 Nov) and culled them; matching is EXACT (no substring, no typos).
        const STYLE_DICT = [
          ['Biophilic', ['biophilic','botanical','plants','greenery','nature']],
          ['Farmhouse', ['farmhouse','floral','rustic','country','barn','cottage','cottagecore','wildflower']],
          ['Shabby chic', ['shabby chic','romantic','pastel','antique rose']],
          ['Vintage', ['vintage','retro','antique','nostalgic','heritage','old-fashioned']],
          ['Japandi', ['japandi','japan','japanese','asian','oriental','wabi-sabi','crane','cranes']],
          ['Zen', ['zen','buddha','buddhist','buddhism','lotus','meditation','mindfulness','yoga','spiritual']],
          ['Scandinavian', ['scandinavian','scandi','nordic','hygge']],
          ['Travel', ['travel','world','wanderlust']],
          ['Christian', ['christian','faith','bible','scripture','cross','jesus','god','prayer','psalm','verse','church','blessing','holy']],
          ['Islamic', ['islamic','islam','muslim','quran','arabic','arab','arabesque','mosque','allah','calligraphy','ayat','ramadan','eid','kaaba']],
          ['Minimalism', ['minimalist','minimal']],
          ['Masculine', ['masculine','male','manly','gentleman']],
          ['Industrial', ['industrial','urban','loft','steampunk']],
          ['Moroccan', ['moroccan','morocco','marrakech','mosaic','tile']],
          ['Abstract', ['abstract','modern art']],
          ['Bohemian', ['bohemian','boho','hippie']],
          ['Coastal', ['coastal','beach','sea','ocean','nautical','seaside','shells','waves','lighthouse','sailing','hamptons']],
          ['Tropical', ['tropical','jungle','exotic']],
          ['Wildlife', ['wildlife','safari','elephant','lion','tiger']],
          ['Sun & moon', ['sun and moon','celestial','moon','stars','lunar','galaxy','constellation']],
          ['Black & white', ['black and white','monochrome','greyscale']],
          ['Chinoiserie', ['chinoiserie']],
          ['Mid century', ['mid century','midcentury','retro','lux','luxury','50s','60s']],
          ['Mediterranean', ['mediterranean']],
          ['Contemporary', ['contemporary','modern']],
          ['Maximalism', ['maximalism','maximalist','eclectic']],
          ['French country', ['french country','provence','bees','hives','beehive']],
          ['Old money', ['map','maps','classic']]
        ];
        const ROOM_DICT = [
          ['Living room', ['living room','lounge','sitting room','tv room','snug']],
          ['Family room', ['family room']],
          ['Bedroom', ['bedroom','master bedroom','guest room','above bed']],
          ['Nursery/Kids', ['nursery','kids','children','child','baby','playroom','boys room','girls room','teen']],
          ['Bathroom', ['bathroom','toilet','washroom','restroom','spa']],
          ['Kitchen', ['kitchen','breakfast nook','breakfast']],
          ['Dining', ['dining room']],
          ['Hallway', ['hallway','corridor','entryway','entrance','foyer']],
          ['Office', ['office','home office','study','workspace','desk']],
          ['Outdoor', ['garden','patio','balcony','outdoor']]
        ];
        const normTxt = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        // EXACT matching only — a synonym matches a WHOLE word (or whole consecutive phrase). No substring,
        // no typo tolerance. So "toilet" never matches "toile", "wallpaper" never matches "wall".
        const synHit = (norm, tokens, synRaw) => {
          const syn = normTxt(synRaw);
          if (!syn) return false;
          const sw = syn.split(' ');
          if (sw.length === 1) return tokens.indexOf(syn) !== -1;
          for (let i = 0; i + sw.length <= tokens.length; i++) {
            let ok = true;
            for (let j = 0; j < sw.length; j++) { if (tokens[i + j] !== sw[j]) { ok = false; break; } }
            if (ok) return true;
          }
          return false;
        };
        const tagOne = (text) => {
          const norm = normTxt(text);
          const tokens = norm.split(' ').filter(Boolean);
          let style = null, room = null;
          for (const [name, syns] of STYLE_DICT) { if (syns.some(s => synHit(norm, tokens, s))) { style = name; break; } }
          for (const [name, syns] of ROOM_DICT) { if (syns.some(s => synHit(norm, tokens, s))) { room = name; break; } }
          return { style, room, tokens };
        };

        const tagged = pool.map((p, i) => { const tb = topicTagBoth(p.keyword + ' ' + (p.title || '')); return { idx: i + 1, p, tag: tb.tagS, tagP: tb.tagP, tagS: tb.tagS }; });
        const blogTags = existingBlogs.map((b, i) => { const tb = topicTagBoth(b.title || ''); return { idx: i + 1, b, tag: tb.tagS, tagP: tb.tagP, tagS: tb.tagS }; });

        // Persisted rejections: Mae said "this keyword does NOT belong in that group". We never re-form the
        // same grouping for it. Map keyword(lowercase) -> array of forbidden bucket signatures
        // ('S:<style>' | 'R:<room>' | 'SP:<style>|<room>' | 'COV:<blog handle/id>').
        const rejections = await readJsonFileSafe('data/blog-fusion-rejections.json', {});
        const isRejected = (kwLc, sig) => Array.isArray(rejections[kwLc]) && rejections[kwLc].includes(sig);
        const covSigFor = (b, blogIdx) => 'COV:' + ((b && (b.handle || b.id)) || blogIdx);

        // An existing blog that answers the SAME scope: specific→same style+room; style-only→a style-only
        // blog of that style; room-only→a room-only blog of that room. An untagged keyword is never auto-
        // flagged covered (no loose common-word matching).
        const coveredByFor = (t) => {
          const hasS = !!t.tag.style, hasR = !!t.tag.room;
          if (!hasS && !hasR) return null;
          const kwLc = (t.p && t.p.keyword || '').toLowerCase();
          for (const bt of blogTags) {
            if (isRejected(kwLc, covSigFor(bt.b, bt.idx))) continue; // Mae said this blog does NOT cover it
            if (hasS && hasR) { if (bt.tag.style === t.tag.style && bt.tag.room === t.tag.room) return bt.idx; }
            else if (hasS) { if (bt.tag.style === t.tag.style && !bt.tag.room) return bt.idx; }
            else if (hasR) { if (bt.tag.room === t.tag.room && !bt.tag.style) return bt.idx; }
          }
          return null;
        };

        const aiGroups = [];
        // 1) COVERED = DISTRIBUTE keywords across the existing blogs that share their style/room — max 5 per
        //    blog, never the same blog twice. First the specifics (style+room) across same style+room blogs;
        //    whatever is left over (style-only, room-only, or specifics that didn't fit) then goes to a blog
        //    that shares style OR room. Keywords that still don't fit any blog are left separate (not covered).
        const CAP = 5;
        const coveredAssign = new Map(); // blogIdx -> [tagged]  (≤ CAP each)
        const coveredUsed = new Set();
        const hasSpace = (bi) => (coveredAssign.get(bi) || []).length < CAP;
        const kwRejectsBlog = (t, bt) => isRejected((t.p.keyword || '').toLowerCase(), covSigFor(bt.b, bt.idx));
        const placeIn = (t, blogs) => {
          const bt = blogs.find(b => hasSpace(b.idx) && !kwRejectsBlog(t, b));
          if (!bt) return false;
          if (!coveredAssign.has(bt.idx)) coveredAssign.set(bt.idx, []);
          coveredAssign.get(bt.idx).push(t); coveredUsed.add(t.idx); return true;
        };
        // 4-step cascade (Mae): principal pair → synonym pair → principal single → synonym single. Pairs
        //    are matched first so a strong style+room blog is "used up" before a looser single match can
        //    claim it. Same 5-per-blog cap, never the same blog twice. Untagged keywords are never covered.
        TOPIC_PHASES.forEach(match => {
          tagged.forEach(t => {
            if (coveredUsed.has(t.idx)) return;
            if (!(t.tag.style || t.tag.room)) return;
            placeIn(t, blogTags.filter(bt => match(t, bt)));
          });
        });
        // Emit one covered card per blog.
        coveredAssign.forEach((arr, blogIdx) => {
          aiGroups.push({ members: arr.map(t => t.idx), suggested_primary: arr[0].idx, covered_by: blogIdx, reason: '', sig: covSigFor(existingBlogs[blogIdx - 1], blogIdx) });
        });

        // 2) Group the REMAINING (uncovered) keywords: generals by shared style/room, specifics rolled in.
        //    A keyword is NEVER placed in a bucket it was rejected from (persisted rejections); if every
        //    bucket it could join is rejected, it stays a singleton.
        const remaining = tagged.filter(t => !coveredUsed.has(t.idx));
        const styleGenerals = new Map(); // style -> [tagged]
        const roomGenerals = new Map();  // room  -> [tagged]
        const specificPairs = new Map(); // 'SP:style|room' -> [tagged]
        const specifics = [];
        remaining.forEach(t => {
          const kwLc = t.p.keyword.toLowerCase();
          const hasS = !!t.tag.style, hasR = !!t.tag.room;
          if (hasS && hasR) { specifics.push(t); }
          else if (hasS) { if (!isRejected(kwLc, 'S:' + t.tag.style)) { if (!styleGenerals.has(t.tag.style)) styleGenerals.set(t.tag.style, []); styleGenerals.get(t.tag.style).push(t); } }
          else if (hasR) { if (!isRejected(kwLc, 'R:' + t.tag.room)) { if (!roomGenerals.has(t.tag.room)) roomGenerals.set(t.tag.room, []); roomGenerals.get(t.tag.room).push(t); } }
          // untagged → ungroupable, stays a singleton
        });
        specifics.forEach(t => {
          const kwLc = t.p.keyword.toLowerCase();
          const sSig = 'S:' + t.tag.style, rSig = 'R:' + t.tag.room, pSig = 'SP:' + t.tag.style + '|' + t.tag.room;
          if (styleGenerals.has(t.tag.style) && !isRejected(kwLc, sSig)) styleGenerals.get(t.tag.style).push(t);
          else if (roomGenerals.has(t.tag.room) && !isRejected(kwLc, rSig)) roomGenerals.get(t.tag.room).push(t);
          else if (!isRejected(kwLc, pSig)) { if (!specificPairs.has(pSig)) specificPairs.set(pSig, []); specificPairs.get(pSig).push(t); }
          // else → rejected from every bucket it could join → singleton
        });
        // Keep each merged post small (≤4) WITHOUT dropping anything: a bucket with more than 4 is SPLIT
        // into several groups of ≤4 (sorted by volume), so low-volume "already ranks" keywords still get
        // grouped instead of being thrown back to singles. A lone leftover (chunk of 1) is folded into the
        // previous group (so it's never dropped); a genuinely alone keyword simply stays a single.
        const volOf = (t) => { const m = metricsLc[t.p.keyword.toLowerCase()]; const g = gscLc[t.p.keyword.toLowerCase()]; return (m && m.volume) || t.p.impressions || (g && g.impressions) || 0; };
        const chunk4 = (arr) => {
          const s = arr.slice().sort((a, b) => volOf(b) - volOf(a));
          const out = [];
          for (let i = 0; i < s.length; i += 4) out.push(s.slice(i, i + 4));
          if (out.length >= 2 && out[out.length - 1].length === 1) out[out.length - 2] = out[out.length - 2].concat(out.pop());
          return out;
        };
        const emitGroups = (arr, reason, baseSig) => {
          chunk4(arr).forEach((c, ci) => { if (c.length >= 2) aiGroups.push({ members: c.map(t => t.idx), suggested_primary: c[0].idx, covered_by: null, reason, sig: baseSig + (ci ? ('#' + (ci + 1)) : '') }); });
        };
        styleGenerals.forEach((arr, name) => emitGroups(arr, 'Same style: ' + name, 'S:' + name));
        roomGenerals.forEach((arr, name) => emitGroups(arr, 'Same room: ' + name, 'R:' + name));
        specificPairs.forEach((arr, pSig) => emitGroups(arr, pSig.replace('SP:', '').replace('|', ' + '), pSig));
        const aiProposedCount = aiGroups.length;

        // Persist the deterministic result (replaces the old raw-AI dump) — read this to debug grouping.
        try {
          await writeJsonFile('data/blog-fusion-last-raw.json', {
            at: new Date().toISOString(), poolSize: pool.length, mode: 'deterministic',
            tags: tagged.map(t => ({ keyword: t.p.keyword, style: t.tag.style, room: t.tag.room })),
            groups: aiGroups
          }, 'Fusion: save deterministic grouping for debugging');
        } catch (e) { /* debug file only — never blocks the run */ }

        const newGroups = [];
        const nowGroupedLc = new Set();
        (Array.isArray(aiGroups) ? aiGroups : []).forEach((g, gi) => {
          const memberIdx = Array.isArray(g.members) ? g.members.map(n => parseInt(n, 10)) : [];
          const validMembers = [];
          const seenLc = new Set();
          memberIdx.forEach(n => {
            const p = Number.isInteger(n) && n >= 1 && n <= pool.length ? pool[n - 1] : null;
            if (!p) return;
            const lc = p.keyword.toLowerCase();
            if (!seenLc.has(lc) && !nowGroupedLc.has(lc)) { seenLc.add(lc); validMembers.push(p); }
          });
          // "covered_by" = this group's intent is already answered by an existing (published/scheduled) blog.
          const covIdx = parseInt(g.covered_by, 10);
          const coveredBlog = (Number.isInteger(covIdx) && covIdx >= 1 && covIdx <= existingBlogs.length) ? existingBlogs[covIdx - 1] : null;
          // A plain merge needs 2+ members. A "covered" finding is valid even with a single keyword.
          if (!coveredBlog && validMembers.length < 2) return;
          if (coveredBlog && validMembers.length < 1) return;
          // Attach volume/impressions signals + carry the member's source (towrite / rank) and its ranking URL.
          const withSignals = validMembers.map(v => {
            const met = metricsLc[v.keyword.toLowerCase()];
            const gsc = gscLc[v.keyword.toLowerCase()];
            return { keyword: v.keyword, title: v.title || '', source: v.source || 'towrite', pageUrl: v.pageUrl || null, urlFree: !!v.urlFree, lockedToKeyword: v.lockedToKeyword || null, volume: met ? met.volume : null, difficulty: met ? met.seo_difficulty : null, impressions: (met && met.impressions) || v.impressions || (gsc ? gsc.impressions : null) };
          });
          // Lead keyword priority (Mae): 1st already-ranks + good metrics, 2nd already-ranks, 3rd the rest
          // by metrics. So prefer a ranked member (source 'rank'); among ties use volume > impressions.
          let winner = null, signal = 'ai-choice';
          const metricScore = (s) => (s.volume != null ? s.volume : (s.impressions != null ? s.impressions : 0));
          const rankedMembers = withSignals.filter(s => s.source === 'rank');
          if (rankedMembers.length) {
            winner = rankedMembers.slice().sort((a, b) => (metricScore(b) - metricScore(a)) || ((a.difficulty ?? 99) - (b.difficulty ?? 99)))[0];
            signal = 'ranks';
          } else {
            const withVolume = withSignals.filter(s => s.volume != null);
            if (withVolume.length) {
              winner = withVolume.slice().sort((a, b) => (b.volume - a.volume) || ((a.difficulty ?? 99) - (b.difficulty ?? 99)))[0];
              signal = 'volume';
            } else {
              const withImpr = withSignals.filter(s => s.impressions != null);
              if (withImpr.length) { winner = withImpr.slice().sort((a, b) => b.impressions - a.impressions)[0]; signal = 'impressions'; }
            }
          }
          if (!winner) {
            const spIdx = parseInt(g.suggested_primary, 10);
            const spKw = (Number.isInteger(spIdx) && spIdx >= 1 && spIdx <= pool.length) ? pool[spIdx - 1].keyword.toLowerCase() : null;
            winner = (spKw && withSignals.find(s => s.keyword.toLowerCase() === spKw)) || withSignals[0];
            signal = 'ai-choice';
          }
          const secondary = withSignals.filter(s => s.keyword.toLowerCase() !== winner.keyword.toLowerCase());
          if (!coveredBlog && !secondary.length) return; // a merge with nothing to merge — skip
          withSignals.forEach(s => nowGroupedLc.add(s.keyword.toLowerCase()));
          newGroups.push({
            id: `grp_${Date.now()}_${gi}`,
            bucketSig: g.sig || null,
            type: coveredBlog ? 'covered' : 'merge',
            winnerKeyword: winner.keyword,
            winnerTitle: winner.title,
            winnerSource: winner.source,
            winnerPageUrl: winner.pageUrl,
            winnerUrlFree: winner.urlFree,
            winnerLockedTo: winner.lockedToKeyword,
            reason: String(g.reason || ''),
            signals: signal,
            secondary,
            coveredBlog: coveredBlog ? { id: coveredBlog.id, title: coveredBlog.title, handle: coveredBlog.handle, status: coveredBlog.status, url: coveredBlog.url } : null
          });
        });

        // Cache update: grouped keywords are never re-sent; leftover pool keywords become singletons
        // (retried next run in case a newly-added keyword turns out to match one of them).
        const newGroupedAll = new Set([...groupedSet, ...nowGroupedLc]);
        const leftoverSingletons = pool.filter(p => !nowGroupedLc.has(p.keyword.toLowerCase())).map(p => p.keyword.toLowerCase());
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...new Set(leftoverSingletons)], grouped: [...newGroupedAll] }, `Fusion check: +${nowGroupedLc.size} grouped`);

        if (newGroups.length) {
          const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
          await writeJsonFile('data/blog-fusion-pending.json', [...pending, ...newGroups], `Fusion: +${newGroups.length} pending group(s)`);
        }

        // SINGLES = pool keywords that landed in NO group (not covered, not grouped). They feed the
        // Duplicate check "Singles" sub-tab, where Mae groups them by hand. Ranked ones carry their page
        // so the UI can offer "optimise in MPD". The saved file is replaced each run.
        const singlesOut = tagged.filter(t => !nowGroupedLc.has(t.p.keyword.toLowerCase())).map(t => {
          const lc = t.p.keyword.toLowerCase(); const met = metricsLc[lc]; const gsc = gscLc[lc];
          return { keyword: t.p.keyword, title: t.p.title || '', source: t.p.source || 'towrite', style: t.tag.style, room: t.tag.room, pageUrl: t.p.pageUrl || null, urlFree: !!t.p.urlFree, lockedToKeyword: t.p.lockedToKeyword || null, volume: met ? met.volume : null, difficulty: met ? met.seo_difficulty : null, impressions: (met && met.impressions) || t.p.impressions || (gsc ? gsc.impressions : null), position: gsc ? gsc.position : null };
        });
        try { await writeJsonFile('data/blog-fusion-singles.json', singlesOut, `Fusion: ${singlesOut.length} single(s)`); } catch (e) {}

        const survivedNote = (aiProposedCount && aiProposedCount !== newGroups.length) ? ` (AI proposed ${aiProposedCount}, ${newGroups.length} valid — see data/blog-fusion-last-raw.json if that gap looks wrong)` : '';
        return res.status(200).json({ success: true, newGroups, singles: singlesOut, checkedCount: pool.length, aiProposedCount, message: `Checked ${pool.length} topics — found ${newGroups.length} new group${newGroups.length === 1 ? '' : 's'} + ${singlesOut.length} single${singlesOut.length === 1 ? '' : 's'}.${survivedNote}` });
      }

      // ── ACTION: fusion-manual-group ── Mae ticked several SINGLES and grouped them by hand. Match an
      // existing published/scheduled blog by TITLE ONLY; if one shares the keywords → a 'covered' pending
      // group (add angle); else a 'merge' pending group (new blog). The chosen keywords leave the singles
      // list and are marked grouped so they don't resurface. Apply/remove/add-angle then do the CSV work.
      if (req.body.action === 'fusion-manual-group') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kws = (Array.isArray(req.body.keywords) ? req.body.keywords : []).map(k => String(k || '').trim()).filter(Boolean);
        if (kws.length < 2) return res.status(400).json({ error: 'Pick at least 2 keywords to group.' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const byLc = new Map((Array.isArray(singles) ? singles : []).map(s => [String(s.keyword || '').toLowerCase(), s]));
        const members = kws.map(k => byLc.get(k.toLowerCase())).filter(Boolean);
        if (members.length < 2) return res.status(400).json({ error: 'Those keywords are no longer in the singles list — re-run the check.' });

        // TITLE-only match against LIVE Shopify blogs — SAME 4-step cascade as the automatic check
        // (principal pair → synonym pair → principal single → synonym single).
        let existingBlogs = [];
        try { existingBlogs = await fetchBlogsPubAndSched(); } catch (e) { existingBlogs = []; }
        const memberTags = members.map(m => topicTagBoth(m.keyword + ' ' + (m.title || '')));
        const blogTags = existingBlogs.map((b) => ({ b, ...topicTagBoth(b.title || '') }));
        let matchedBlog = null;
        for (const match of TOPIC_PHASES) {
          for (const mt of memberTags) {
            const hit = blogTags.find(bt => match(mt, bt));
            if (hit) { matchedBlog = hit.b; break; }
          }
          if (matchedBlog) break;
        }

        // Lead keyword priority: already-ranks + metrics first.
        const metricScore = (s) => (s.volume != null ? s.volume : (s.impressions != null ? s.impressions : 0));
        const ordered = members.slice().sort((a, b) => ((b.source === 'rank') - (a.source === 'rank')) || (metricScore(b) - metricScore(a)));
        const winner = ordered[0];
        const secondary = ordered.slice(1).map(s => ({ keyword: s.keyword, title: s.title || '', source: s.source || 'towrite', pageUrl: s.pageUrl || null, urlFree: !!s.urlFree, lockedToKeyword: s.lockedToKeyword || null, volume: s.volume == null ? null : s.volume, difficulty: s.difficulty == null ? null : s.difficulty, impressions: s.impressions == null ? null : s.impressions }));
        const group = {
          id: `grp_${Date.now()}_manual`, bucketSig: null, type: matchedBlog ? 'covered' : 'merge',
          winnerKeyword: winner.keyword, winnerTitle: winner.title || '', winnerSource: winner.source || 'towrite',
          winnerPageUrl: winner.pageUrl || null, winnerUrlFree: !!winner.urlFree, winnerLockedTo: winner.lockedToKeyword || null,
          reason: 'Grouped by hand', signals: 'manual', secondary,
          coveredBlog: matchedBlog ? { id: matchedBlog.id, title: matchedBlog.title, handle: matchedBlog.handle, status: matchedBlog.status, url: matchedBlog.url } : null
        };
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        await writeJsonFile('data/blog-fusion-pending.json', [...pending, group], `Fusion: manual group (${matchedBlog ? 'covered' : 'merge'})`);
        const groupedLc = new Set(members.map(m => m.keyword.toLowerCase()));
        const remaining = (Array.isArray(singles) ? singles : []).filter(s => !groupedLc.has(String(s.keyword || '').toLowerCase()));
        await writeJsonFile('data/blog-fusion-singles.json', remaining, `Fusion: -${members.length} single(s) grouped by hand`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(s => String(s).toLowerCase())); groupedLc.forEach(k => grouped.add(k));
        const singletons = new Set((checked.singletons || []).map(s => String(s).toLowerCase())); groupedLc.forEach(k => singletons.delete(k));
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: mark hand-grouped keywords');
        return res.status(200).json({ success: true, group, matched: !!matchedBlog });
      }

      // ── ACTION: search-blogs-for-group ── Mae types a keyword; return LIVE published/scheduled blogs
      // whose TITLE contains those words (plural + joined/split tolerant). Blogs ALREADY used as a covered
      // target (pending covered groups + already-applied fused groups) are hidden so she never double-adds.
      if (req.body.action === 'search-blogs-for-group') {
        const q = topicNorm(req.body.query || '');
        const qTokens = q.split(' ').filter(Boolean);
        if (!qTokens.length) return res.status(200).json({ success: true, blogs: [] });
        let existingBlogs = [];
        try { existingBlogs = await fetchBlogsPubAndSched(); } catch (e) { existingBlogs = []; }
        const usedHandles = new Set();
        const pend = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        (Array.isArray(pend) ? pend : []).forEach(g => { if (g && g.type === 'covered' && g.coveredBlog) usedHandles.add(String(g.coveredBlog.handle || g.coveredBlog.id || '').toLowerCase()); });
        const fused = await readJsonFileSafe('data/blog-fused-groups.json', {});
        Object.values(fused && typeof fused === 'object' ? fused : {}).forEach(g => { if (g && g.coveredBlog) usedHandles.add(String(g.coveredBlog.handle || g.coveredBlog.id || '').toLowerCase()); });
        const qTag = topicTagBoth(q); // match by room/style cascade too, not only the literal words
        const blogs = existingBlogs
          .filter(b => {
            const bt = topicNorm(b.title).split(' ').filter(Boolean);
            const literal = qTokens.every(w => topicSynHit(bt, w));
            const byTopic = (qTag.tagS.style || qTag.tagS.room) && TOPIC_PHASES.some(m => m(qTag, topicTagBoth(b.title)));
            return literal || byTopic;
          })
          .map(b => ({ id: b.id, title: b.title, handle: b.handle, status: b.status, url: b.url, used: usedHandles.has(String(b.handle || b.id || '').toLowerCase()) }))
          .sort((a, b) => (a.used ? 1 : 0) - (b.used ? 1 : 0)) // available first, already-used last
          .slice(0, 40);
        return res.status(200).json({ success: true, blogs, _blogCount: existingBlogs.length });
      }

      // ── ACTION: fusion-attach-blog ── Mae picked a blog from the search for a grouped (merge) card →
      // turn that pending group into a 'covered' one for the chosen blog (it moves to Already covered).
      if (req.body.action === 'fusion-attach-blog') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const groupId = String(req.body.groupId || '');
        const blog = req.body.blog || null;
        if (!groupId || !blog || !(blog.handle || blog.id)) return res.status(400).json({ error: 'Need a group and a blog.' });
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const arr = Array.isArray(pending) ? pending : [];
        const i = arr.findIndex(g => g && g.id === groupId);
        if (i < 0) return res.status(404).json({ error: 'That group is no longer here — re-run the check.' });
        arr[i] = { ...arr[i], type: 'covered', coveredBlog: { id: blog.id || null, title: blog.title || '', handle: blog.handle || '', status: blog.status || 'published', url: blog.url || '' } };
        await writeJsonFile('data/blog-fusion-pending.json', arr, `Fusion: attached blog to group ${groupId}`);
        return res.status(200).json({ success: true, group: arr[i] });
      }

      // ── ACTION: fusion-suggest-singles-for-group ── singles that fit a grouped (merge) card, by the SAME
      // 4-step room/style cascade used everywhere else. Lets Mae pull leftover singles into an existing group.
      if (req.body.action === 'fusion-suggest-singles-for-group') {
        const groupId = String(req.body.groupId || '');
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const g = (Array.isArray(pending) ? pending : []).find(x => x && x.id === groupId);
        if (!g) return res.status(404).json({ error: 'That group is no longer here — re-run the check.' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const memberKws = [g.winnerKeyword + ' ' + (g.winnerTitle || ''), ...((g.secondary || []).map(s => s.keyword || ''))];
        const memberTags = memberKws.map(topicTagBoth);
        const matches = (Array.isArray(singles) ? singles : []).filter(s => {
          const st = topicTagBoth((s.keyword || '') + ' ' + (s.title || ''));
          return TOPIC_PHASES.some(m => memberTags.some(mt => m(st, mt)));
        });
        return res.status(200).json({ success: true, singles: matches });
      }

      // ── ACTION: fusion-add-single-to-group ── move a single INTO an existing group's secondary list
      // (suggested or found by manual search) and drop it from the singles list.
      if (req.body.action === 'fusion-add-single-to-group') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const groupId = String(req.body.groupId || '');
        const kw = String(req.body.keyword || '').trim();
        if (!groupId || !kw) return res.status(400).json({ error: 'Need a group and a keyword.' });
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const arr = Array.isArray(pending) ? pending : [];
        const gi = arr.findIndex(x => x && x.id === groupId);
        if (gi < 0) return res.status(404).json({ error: 'That group is no longer here — re-run the check.' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const sArr = Array.isArray(singles) ? singles : [];
        const s = sArr.find(x => String(x.keyword || '').toLowerCase() === kw.toLowerCase());
        if (!s) return res.status(404).json({ error: 'That single is no longer in the list — re-run the check.' });
        const sec = (arr[gi].secondary || []).slice();
        if (!sec.some(x => String(x.keyword || '').toLowerCase() === kw.toLowerCase())) {
          sec.push({ keyword: s.keyword, title: s.title || '', source: s.source || 'towrite', pageUrl: s.pageUrl || null, urlFree: !!s.urlFree, lockedToKeyword: s.lockedToKeyword || null, volume: s.volume == null ? null : s.volume, difficulty: s.difficulty == null ? null : s.difficulty, impressions: s.impressions == null ? null : s.impressions });
        }
        arr[gi] = { ...arr[gi], secondary: sec };
        await writeJsonFile('data/blog-fusion-pending.json', arr, `Fusion: +single "${kw}" to group ${groupId}`);
        const remaining = sArr.filter(x => String(x.keyword || '').toLowerCase() !== kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-singles.json', remaining, `Fusion: -single "${kw}" (added to group)`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(x => String(x).toLowerCase())); grouped.add(kw.toLowerCase());
        const singletons = new Set((checked.singletons || []).map(x => String(x).toLowerCase())); singletons.delete(kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: single added to group');
        return res.status(200).json({ success: true, group: arr[gi] });
      }

      // ── ACTION: fusion-single-to-blog ── Mae picks a published/scheduled blog for a SINGLE → make it a
      // 'covered' group for that blog (moves to Already covered, where she adds the angle paragraph).
      if (req.body.action === 'fusion-single-to-blog') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        const blog = req.body.blog || null;
        if (!kw || !blog || !(blog.handle || blog.id)) return res.status(400).json({ error: 'Need a single and a blog.' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const sArr = Array.isArray(singles) ? singles : [];
        const s = sArr.find(x => String(x.keyword || '').toLowerCase() === kw.toLowerCase());
        if (!s) return res.status(404).json({ error: 'That single is no longer in the list — re-run the check.' });
        const group = {
          id: `grp_${Date.now()}_single`, bucketSig: null, type: 'covered',
          winnerKeyword: s.keyword, winnerTitle: s.title || '', winnerSource: s.source || 'towrite',
          winnerPageUrl: s.pageUrl || null, winnerUrlFree: !!s.urlFree, winnerLockedTo: s.lockedToKeyword || null,
          reason: 'Matched to a blog by hand', signals: 'manual', secondary: [],
          coveredBlog: { id: blog.id || null, title: blog.title || '', handle: blog.handle || '', status: blog.status || 'published', url: blog.url || '' }
        };
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        await writeJsonFile('data/blog-fusion-pending.json', [...(Array.isArray(pending) ? pending : []), group], `Fusion: single "${kw}" → covered`);
        const remaining = sArr.filter(x => String(x.keyword || '').toLowerCase() !== kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-singles.json', remaining, `Fusion: -single "${kw}" (matched to blog)`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(x => String(x).toLowerCase())); grouped.add(kw.toLowerCase());
        const singletons = new Set((checked.singletons || []).map(x => String(x).toLowerCase())); singletons.delete(kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: single matched to blog');
        return res.status(200).json({ success: true, group });
      }

      // ════════ DISCOVER TOPICS (Serper) ════════
      // Find room+style gaps, search Serper for the questions people ask, keep only NEW ones (duplicate check),
      // park them in a pool. Claude fills the main keyword (Ubersuggest) → promote to Blog Ideas.
      const DISCOVER_TERMS = ['wall art', 'home decor']; // 2 terms per seed (2 credits each)
      // Topics already IN PROGRESS (not written yet but on their way) — so Discover doesn't re-offer them:
      // To Write / pending / sent / Blog Ideas / any with a month, plus Grouped winners+secondary and Singles.
      const gatherPipelineTexts = async () => {
        const texts = [];
        try {
          const f = await getGitHubFile('data/blog_ideas.csv');
          f.content.split('\n').forEach((l, i) => { if (i === 0) return; const t = l.trim(); if (!t) return; const c = parseCSVLine(t.replace(/\r/g, '')); const st = (c[6] || '').trim().toUpperCase(); const hasMonth = !!(c[9] || '').trim(); if (c[0] && (['TO_WRITE', 'TO_WRITE_PENDING', 'TO_WRITE_SENT', ''].includes(st) || hasMonth)) texts.push((c[0] || '') + ' ' + (c[1] || '')); });
        } catch (e) {}
        try { const pend = await readJsonFileSafe('data/blog-fusion-pending.json', []); (Array.isArray(pend) ? pend : []).forEach(g => { if (g.winnerKeyword) texts.push(g.winnerKeyword + ' ' + (g.winnerTitle || '')); (g.secondary || []).forEach(s => { if (s.keyword) texts.push(s.keyword); }); }); } catch (e) {}
        try { const sing = await readJsonFileSafe('data/blog-fusion-singles.json', []); (Array.isArray(sing) ? sing : []).forEach(s => { if (s.keyword) texts.push((s.keyword || '') + ' ' + (s.title || '')); }); } catch (e) {}
        return texts;
      };

      // ── ACTION: discover-gaps ── per room: general blog count + which styles are covered (written), in the
      // pipeline (being worked on), or already searched.
      if (req.body.action === 'discover-gaps') {
        let blogs = [];
        try { blogs = await fetchBlogsPubAndSched(); } catch (e) { blogs = []; }
        if (!blogs.length) { try { const bi = await getGitHubFile('data/blog-index.json'); const j = JSON.parse(bi.content); blogs = (j.articles || []).map(a => ({ title: a.title })); } catch (e) {} }
        const publishedPairs = new Set(); const roomCount = {};
        blogs.forEach(b => { const { style, room } = topicTag(b.title || '', false); if (room) roomCount[room] = (roomCount[room] || 0) + 1; if (style && room) publishedPairs.add(style + '|' + room); });
        const pipePairs = new Set(); const pipeRoom = new Set();
        (await gatherPipelineTexts()).forEach(t => { const { style, room } = topicTag(t, false); if (room) pipeRoom.add(room); if (style && room) pipePairs.add(style + '|' + room); });
        const searched = await readJsonFileSafe('data/discover-searched.json', []);
        const searchedSet = new Set((Array.isArray(searched) ? searched : []).map(x => String(x).toLowerCase()));
        const styleList = TOPIC_STYLE_DICT.map(e => ({ name: e[0], term: e[1][0], synonyms: e[1].slice(1), isCustom: !BUILTIN_STYLE_NAMES.has(String(e[0]).toLowerCase()) }));
        const rooms = TOPIC_ROOM_DICT.map(e => {
          const room = e[0], roomTerm = e[1][0], roomSyn = e[1].slice(1);
          const styles = styleList.map(s => ({
            style: s.name, term: s.term, synonyms: s.synonyms, isCustom: s.isCustom,
            covered: publishedPairs.has(s.name + '|' + room),
            inPipeline: !publishedPairs.has(s.name + '|' + room) && pipePairs.has(s.name + '|' + room),
            searched: searchedSet.has((s.term + ' ' + roomTerm).toLowerCase())
          }));
          return { room, roomTerm, roomSynonyms: roomSyn, isCustom: !BUILTIN_ROOM_NAMES.has(String(room).toLowerCase()), generalCount: roomCount[room] || 0, generalInPipeline: pipeRoom.has(room), generalSearched: searchedSet.has(roomTerm.toLowerCase()), styles };
        });
        return res.status(200).json({ success: true, rooms, terms: DISCOVER_TERMS });
      }

      // ── ACTIONS: discover-add-room / discover-add-style / discover-remove-room / discover-remove-style ──
      // Mae adds or removes rooms/styles by hand from the Discover tab. Stored on GitHub; merged into the live
      // taxonomy above (so they show in the cards AND are recognised by the duplicate check). Built-in names
      // are protected — they can't be re-added or removed.
      if (req.body.action === 'discover-add-room' || req.body.action === 'discover-add-style') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const isRoom = req.body.action === 'discover-add-room';
        const file = isRoom ? 'data/discover-custom-rooms.json' : 'data/discover-custom-styles.json';
        const builtin = isRoom ? BUILTIN_ROOM_NAMES : BUILTIN_STYLE_NAMES;
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(200).json({ success: false, error: 'Name is required' });
        const nameLc = name.toLowerCase();
        if (builtin.has(nameLc)) return res.status(200).json({ success: false, error: `"${name}" is already a built-in ${isRoom ? 'room' : 'style'}.` });
        const syns = Array.isArray(req.body.synonyms)
          ? req.body.synonyms.map(s => String(s).trim()).filter(Boolean)
          : String(req.body.synonyms || '').split(',').map(s => s.trim()).filter(Boolean);
        let list = await readJsonFileSafe(file, []); if (!Array.isArray(list)) list = [];
        if (list.some(e => String(e.name || '').toLowerCase() === nameLc)) return res.status(200).json({ success: false, error: `"${name}" is already added.` });
        list.push({ name, synonyms: syns, addedAt: new Date().toISOString() });
        await writeJsonFile(file, list, `Discover: add ${isRoom ? 'room' : 'style'} "${name}"`);
        return res.status(200).json({ success: true, list });
      }
      if (req.body.action === 'discover-remove-room' || req.body.action === 'discover-remove-style') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const isRoom = req.body.action === 'discover-remove-room';
        const file = isRoom ? 'data/discover-custom-rooms.json' : 'data/discover-custom-styles.json';
        const name = String(req.body.name || '').trim();
        const nameLc = name.toLowerCase();
        if (!nameLc) return res.status(200).json({ success: false, error: 'Name is required' });
        let list = await readJsonFileSafe(file, []); if (!Array.isArray(list)) list = [];
        const next = list.filter(e => String(e.name || '').toLowerCase() !== nameLc);
        await writeJsonFile(file, next, `Discover: remove ${isRoom ? 'room' : 'style'} "${name}"`);
        return res.status(200).json({ success: true, list: next });
      }

      // ── ACTION: gsc-blog-gaps ── (the improved "Priority from GSC" panel source) a BROAD live pull of the last
      // 12 months of Search Console queries, kept to informational / blog-worthy ones that NO blog already covers,
      // above an editable impressions floor. Each is flagged if a live blog shares its room and/or style (so Mae
      // can tell a fresh angle from cannibalisation). Sorted by searches (impressions), top 300.
      if (req.body.action === 'gsc-blog-gaps' || req.query.action === 'gsc-blog-gaps') {
        const body = req.body || {};
        const minImpr = Math.max(0, parseInt(body.minImpr != null ? body.minImpr : ((req.query && req.query.minImpr) || 20), 10) || 20);
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
        const endD = new Date().toISOString().slice(0, 10);
        const sD = new Date(); sD.setFullYear(sD.getFullYear() - 1); const startD = sD.toISOString().slice(0, 10);
        let rows = [];
        try {
          const gr = await fetch(`${proto}://${host}/api/gsc?action=queries&startDate=${startD}&endDate=${endD}&limit=25000`);
          if (gr.ok) { const gj = await gr.json(); const rr = (gj && gj.data && gj.data.rows) || []; rows = rr.map(r => ({ keyword: String((r.keys && r.keys[0]) || '').trim(), impressions: Math.round(r.impressions || 0), clicks: Math.round(r.clicks || 0), position: Math.round((r.position || 0) * 10) / 10 })); }
        } catch (e) { /* fall through → empty */ }
        if (!rows.length) return res.status(200).json({ success: true, options: [], total: 0, floor: minImpr, note: 'No live GSC data came back.' });
        const BRAND_RE = /about\s*wall\s*art|aboutwallart/i;
        const INFO_RE = /\b(idea|ideas|how|what|why|when|where|which|who|guide|guides|tip|tips|best|top|example|examples|inspiration|inspo|decorate|decorating|decor|design|designs|style|styles|theme|themes|meaning|vs|diy|trend|trends|20\d\d|should|can|make|choose|hang|hanging|arrange|arranging|layout|colour|color|palette)\b/i;
        const PRODUCT_RE = /\b(buy|price|prices|cheap|sale|discount|for sale|near me|shop|store|order|delivery|coupon|voucher|print|prints|poster|posters|canvas|framed|frame|cushion|rug|mug|sticker)\b/i;
        let intentCache = {};
        try { const ic = await readJsonFileSafe('data/gsc-keyword-intent-cache.json', {}); intentCache = ic && typeof ic === 'object' ? ic : {}; } catch (e) {}
        // Registry: EXACT-locked keywords (locked to a page/blog, or a blog source) → filtered out; SIMILAR ones → only flagged.
        // Separate BLOG-locked (same search intent → cannibalises) from OTHER-page-locked (product / money page /
        // collection = different intent → a blog can reuse the term and link to it). Only EXACT BLOG matches are hidden.
        const lockedList = []; const hideSet = new Set();
        try {
          const rc = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/keyword-locker-registry.csv?t=${Date.now()}`);
          if (rc.ok) { const txt = await rc.text(); txt.split('\n').forEach((line, i) => { if (i === 0 || !line.trim()) return; const c = parseCSVLine(line.replace(/\r/g, '')); const kw = (c[0] || '').trim().toLowerCase(); const url = (c[1] || '').trim(); const isLocked = (c[2] || '').trim().toUpperCase() === 'LOCKED'; const src = (c[9] || '').trim(); if (!kw) return; const isBlog = (src === 'Published Blog' || src === 'To_Write_Blog'); if ((isLocked && url) || isBlog) { lockedList.push({ kw, url: url || '', source: src, isBlog }); if (isBlog) hideSet.add(kw); } }); }
        } catch (e) {}
        let dismissed = [];
        try { const df = await getGitHubFile('data/gsc-blog-dismissed.json'); dismissed = (JSON.parse(df.content) || []).map(x => String(x).toLowerCase()); } catch (e) { dismissed = []; }
        const dismSet = new Set(dismissed);
        // Corpus for the mechanical overlap flag: published + scheduled blogs + pipeline (To Write + grouped + singles).
        let existingBlogs = [];
        try { existingBlogs = await fetchBlogsPubAndSched(); } catch (e) { existingBlogs = []; }
        if (!existingBlogs.length) { try { const bi = await getGitHubFile('data/blog-index.json'); const j = JSON.parse(bi.content); existingBlogs = (j.articles || []).map(a => ({ title: a.title })); } catch (e) {} }
        let pipeTexts = []; try { pipeTexts = await gatherPipelineTexts(); } catch (e) { pipeTexts = []; }
        const STOP = new Set(['wall','art','home','decor','prints','print','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you','interior','design','style','room','living','how','what','why','when','does','uk']);
        const wordsOf = s => [...new Set((String(s || '').toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !STOP.has(w)))];
        const corpus = existingBlogs.map(b => { const label = b.title || ''; const t = topicTag(label, false); return { label, style: t.style, room: t.room, words: wordsOf(label), pipeline: false, url: b.url || '' }; })
          .concat((Array.isArray(pipeTexts) ? pipeTexts : []).map(x => { const label = String(x || '').trim(); const t = topicTag(label, false); return { label, style: t.style, room: t.room, words: wordsOf(label), pipeline: true, url: '' }; }));
        // Mechanical flag, strongest first: both axes (cannibalise) → 2+ distinctive shared words (similar topic) → single room/style (new angle).
        const overlapFor = (kw) => {
          const t = topicTag(kw, false); const qS = t.style, qR = t.room; const qw = wordsOf(kw);
          if (qS && qR) { const b = corpus.find(c => c.style === qS && c.room === qR); if (b) return { style: qS, room: qR, type: 'both', title: b.label, pipeline: b.pipeline, url: b.url }; }
          let best = null, bestN = 0; for (const c of corpus) { const n = c.words.filter(w => qw.includes(w)).length; if (n > bestN) { bestN = n; best = c; } }
          if (best && bestN >= 2) return { style: qS, room: qR, type: 'topic', title: best.label, pipeline: best.pipeline, url: best.url, shared: bestN };
          if (qR) { const b = corpus.find(c => c.room === qR); if (b) return { style: qS, room: qR, type: 'room', title: b.label, pipeline: b.pipeline, url: b.url }; }
          if (qS) { const b = corpus.find(c => c.style === qS); if (b) return { style: qS, room: qR, type: 'style', title: b.label, pipeline: b.pipeline, url: b.url }; }
          return { style: qS, room: qR, type: null, title: '' };
        };
        // Flag the locked keyword that matches (prefer exact), carrying WHERE it's locked (blog vs other page) so the UI
        // can tell cannibalisation apart from a reusable term. Exact BLOG matches never reach here (they're hidden).
        const lockedFlagFor = (lc) => {
          let exact = null, sim = null;
          for (const L of lockedList) { if (L.kw === lc) { exact = L; break; } if (!sim && Math.min(lc.length, L.kw.length) >= 5 && (lc.includes(L.kw) || L.kw.includes(lc))) sim = L; }
          const L = exact || sim; if (!L) return null;
          return { keyword: L.kw, url: L.url, source: L.source, isBlog: !!L.isBlog, exact: !!exact };
        };
        const seen = new Set();
        const options = rows
          .filter(r => {
            const kw = r.keyword; const lc = kw.toLowerCase();
            if (!kw || seen.has(lc)) return false;
            if (r.impressions < minImpr) return false;
            if (BRAND_RE.test(kw)) return false;
            if (dismSet.has(lc)) return false;
            if (hideSet.has(lc)) return false; // EXACT keyword locked to a BLOG (same intent) → hidden; other-page / similar ones are only flagged
            const cached = String(intentCache[kw] || intentCache[lc] || '').toLowerCase();
            if (cached === 'product') return false;
            const info = cached === 'blog' || (INFO_RE.test(kw) && !PRODUCT_RE.test(kw));
            if (!info) return false;
            seen.add(lc); return true;
          })
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 300)
          .map(r => { const ov = overlapFor(r.keyword); const lk = lockedFlagFor(r.keyword.toLowerCase()); return { keyword: r.keyword, impressions: r.impressions, clicks: r.clicks, position: r.position, style: ov.style || '', room: ov.room || '', overlap: ov.type ? { type: ov.type, title: ov.title, pipeline: !!ov.pipeline, url: ov.url || '' } : null, locked: lk }; });
        return res.status(200).json({ success: true, options, total: options.length, floor: minImpr });
      }

      // ── ACTION: gsc-ai-check ── reasoned overlap: given queries, ask the AI whether each one already overlaps one
      // of Mae's blogs (written + scheduled + To Write + grouped) in SEARCH INTENT — catching synonyms/paraphrases the
      // mechanical word check misses. Verdict: cannibalise | angle | new, with a one-line reason. Cached per query;
      // the per-row "Ask AI" button sends fresh:true to bypass the cache (for a doubt or after writing something new).
      if (req.body.action === 'gsc-ai-check') {
        const queries = Array.isArray(req.body.queries) ? req.body.queries.map(q => String(q || '').trim()).filter(Boolean) : [];
        const fresh = req.body.fresh === true;
        if (!queries.length) return res.status(200).json({ success: true, results: {} });
        const CACHE = 'data/gsc-topic-overlap-cache.json';
        let cache = {}; try { const c = await readJsonFileSafe(CACHE, {}); cache = (c && typeof c === 'object') ? c : {}; } catch (e) {}
        const results = {}; const todo = [];
        queries.forEach(q => { const k = q.toLowerCase(); if (!fresh && cache[k]) results[q] = cache[k]; else todo.push(q); });
        if (todo.length) {
          let eb = []; try { eb = await fetchBlogsPubAndSched(); } catch (e) {}
          if (!eb.length) { try { const bi = await getGitHubFile('data/blog-index.json'); const j = JSON.parse(bi.content); eb = (j.articles || []).map(a => ({ title: a.title })); } catch (e) {} }
          let pipe = []; try { pipe = await gatherPipelineTexts(); } catch (e) {}
          const corpus = [...new Set(eb.map(b => b.title || '').concat(Array.isArray(pipe) ? pipe : []).map(s => String(s || '').trim()).filter(Boolean))];
          const prompt = `You are an SEO editor for About Wall Art (a UK wall-art & home-decor blog). Here is the FULL list of blog topics I already have — written, scheduled, or planned (To Write / grouped):\n\n${corpus.map(t => '- ' + t).join('\n')}\n\nFor EACH candidate Google search query below, decide whether writing a NEW blog for it would overlap one of my existing topics IN SEARCH INTENT. Reason about meaning and intent, not just shared words — catch synonyms and paraphrases.\n\nCandidate queries:\n${todo.map(q => '- ' + q).join('\n')}\n\nFor each query return an object with:\n- "query": the query verbatim.\n- "verdict": "cannibalise" (same search intent as an existing topic — a new blog would compete), "angle" (related to an existing topic but a genuinely different, non-competing angle worth writing), or "new" (no real overlap).\n- "blog": the existing topic it overlaps, verbatim from my list, or "" if new.\n- "reason": ONE short sentence, max ~15 words.\nReturn ONLY a JSON array, one object per query. No prose, no markdown.`;
          let arr = [];
          try { const raw = await callClaudeText(prompt, 3500); const m = raw.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; } catch (e) { arr = []; }
          const byQ = {}; (Array.isArray(arr) ? arr : []).forEach((o, i) => { if (o && o.query) byQ[String(o.query).toLowerCase()] = o; });
          todo.forEach((q, i) => {
            const o = byQ[q.toLowerCase()] || (Array.isArray(arr) ? arr[i] : null) || {};
            const v = { verdict: ['cannibalise', 'angle', 'new'].includes(String(o.verdict || '').toLowerCase()) ? String(o.verdict).toLowerCase() : 'new', blog: String(o.blog || ''), reason: String(o.reason || '') };
            results[q] = v; cache[q.toLowerCase()] = v;
          });
          try { await writeJsonFile(CACHE, cache, `GSC AI overlap: +${todo.length} checked`); } catch (e) {}
        }
        return res.status(200).json({ success: true, results });
      }

      // ── ACTION: discover-search ── search each seed phrase × each term on Serper, collect the questions,
      // drop ones already covered by a blog / already an idea / already in the pool, save the rest to the pool.
      if (req.body.action === 'discover-search') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        if (!process.env.SERPER_KEY) return res.status(500).json({ error: 'SERPER_KEY not set in Vercel.' });
        const seeds = (Array.isArray(req.body.seeds) ? req.body.seeds : []).map(s => String(s || '').trim()).filter(Boolean);
        if (!seeds.length) return res.status(400).json({ error: 'No seeds selected.' });
        const TERMS = (Array.isArray(req.body.terms) && req.body.terms.length) ? req.body.terms.map(t => String(t).trim()).filter(Boolean) : DISCOVER_TERMS;
        let blogs = []; try { blogs = await fetchBlogsPubAndSched(); } catch (e) { blogs = []; }
        const blogTags = blogs.map(b => ({ title: b.title || '', t: topicTagBoth(b.title || '') }));
        const pipeTags = (await gatherPipelineTexts()).map(x => ({ text: x, t: topicTagBoth(x) })); // in-progress topics too
        const ideaKw = new Set();
        try { const f = await getGitHubFile('data/blog_ideas.csv'); f.content.split('\n').forEach((l, i) => { if (i === 0) return; const c = parseCSVLine(l.replace(/\r/g, '')); if (c[0]) ideaKw.add((c[0] || '').trim().toLowerCase()); }); } catch (e) {}
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        const poolArr = Array.isArray(pool) ? pool : [];
        const poolQ = new Set(poolArr.map(p => String(p.question || '').toLowerCase()));
        const discardedArr = await readJsonFileSafe('data/discover-discarded.json', []);
        const discardedSet = new Set((Array.isArray(discardedArr) ? discardedArr : []).map(x => String(x).toLowerCase()));
        const seenRun = new Set();
        let creditsUsed = 0, creditsRemaining = null, failed = 0;
        // "Maybe already covered" = ONLY when the EXACT style AND the EXACT room (or their synonyms) are BOTH present
        // in another blog/pipeline topic — never a single axis. This is a SUGGESTION, not a filter: every question is
        // returned and Mae decides which to keep. (Do NOT reuse TOPIC_PHASES here — its single-axis matchers over-drop.)
        const bothAxes = (t, b) => (!!(t.tagP.style && t.tagP.room && b.tagP.style === t.tagP.style && b.tagP.room === t.tagP.room))
                                 || (!!(t.tagS.style && t.tagS.room && b.tagS.style === t.tagS.style && b.tagS.room === t.tagS.room));
        const newCandidates = [];
        for (const seed of seeds) {
          for (const term of TERMS) {
            const q = (seed + ' ' + term).trim();
            try {
              const r = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q, gl: 'uk', hl: 'en' }) });
              if (!r.ok) { failed++; continue; }
              const data = await r.json();
              creditsUsed += (typeof data.credits === 'number' ? data.credits : 1);
              if (data.credits_remaining != null) creditsRemaining = data.credits_remaining;
              const qs = [];
              (data.peopleAlsoAsk || []).forEach(p => { if (p && p.question) qs.push(p.question); });
              (data.relatedSearches || []).forEach(rs => { if (rs && rs.query) qs.push(rs.query); });
              qs.forEach(question => {
                const lc = String(question).toLowerCase().trim();
                if (!lc || seenRun.has(lc) || poolQ.has(lc) || ideaKw.has(lc) || discardedSet.has(lc)) return; // skip exact dupes + forever-discarded
                const qt = topicTagBoth(question);
                let maybeCovered = false, coveredReason = '';
                if ((qt.tagS.style && qt.tagS.room) || (qt.tagP.style && qt.tagP.room)) {
                  const bHit = blogTags.find(bt => bothAxes(qt, bt.t));
                  const pHit = !bHit && pipeTags.find(pt => bothAxes(qt, pt.t));
                  if (bHit) { maybeCovered = true; coveredReason = 'may overlap blog: "' + bHit.title + '"'; }
                  else if (pHit) { maybeCovered = true; coveredReason = 'may overlap pipeline: "' + String(pHit.text).trim() + '"'; }
                }
                seenRun.add(lc);
                newCandidates.push({ id: `disc_${Date.now()}_${newCandidates.length}`, question, seed, term, maybeCovered, coveredReason, mainKeyword: '', title: '', status: 'needs_keyword', createdAt: new Date().toISOString() });
              });
            } catch (e) { failed++; }
          }
        }
        // Do NOT auto-save to the pool — the tool only SUGGESTS. Mae ticks which to keep; discover-add-questions saves them.
        const searched = await readJsonFileSafe('data/discover-searched.json', []);
        const sSet = new Set((Array.isArray(searched) ? searched : []).map(x => String(x).toLowerCase()));
        seeds.forEach(s => sSet.add(s.toLowerCase()));
        await writeJsonFile('data/discover-searched.json', [...sSet], `Discover: searched ${seeds.length} seed(s)`);
        const maybeN = newCandidates.filter(c => c.maybeCovered).length;
        return res.status(200).json({ success: true, creditsUsed, creditsRemaining, failed, found: newCandidates.length, maybeCovered: maybeN, candidates: newCandidates });
      }

      // ── ACTION: discover-add-questions ── save the questions Mae ticked (from discover-search) into the pool.
      // The tool only suggests; nothing enters the pool until she picks it here. Skips exact duplicates.
      if (req.body.action === 'discover-add-questions') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const items = Array.isArray(req.body.questions) ? req.body.questions : [];
        if (!items.length) return res.status(200).json({ success: true, added: 0 });
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        const poolArr = Array.isArray(pool) ? pool : [];
        const have = new Set(poolArr.map(p => String(p.question || '').toLowerCase()));
        const toAdd = [];
        items.forEach(it => {
          const question = String((it && it.question) || '').trim();
          const lc = question.toLowerCase();
          if (!question || have.has(lc)) return;
          have.add(lc);
          toAdd.push({ id: `disc_${Date.now()}_${toAdd.length}`, question, seed: String((it && it.seed) || ''), term: String((it && it.term) || ''), mainKeyword: '', title: '', status: 'needs_keyword', createdAt: new Date().toISOString() });
        });
        if (toAdd.length) await writeJsonFile('data/discover-pool.json', [...poolArr, ...toAdd], `Discover: +${toAdd.length} picked topic(s)`);
        return res.status(200).json({ success: true, added: toAdd.length });
      }

      // ── ACTION: discover-discard ── "Discard forever": remember these questions so discover-search never shows
      // them again. Stored as a flat list of lowercased question texts in data/discover-discarded.json.
      if (req.body.action === 'discover-discard') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const items = Array.isArray(req.body.questions) ? req.body.questions : [];
        if (!items.length) return res.status(200).json({ success: true, discarded: 0 });
        const cur = await readJsonFileSafe('data/discover-discarded.json', []);
        const set = new Set((Array.isArray(cur) ? cur : []).map(x => String(x).toLowerCase()));
        let added = 0;
        items.forEach(it => {
          const q = String((it && it.question) || it || '').trim().toLowerCase();
          if (q && !set.has(q)) { set.add(q); added++; }
        });
        if (added) await writeJsonFile('data/discover-discarded.json', [...set], `Discover: discarded ${added} topic(s) forever`);
        return res.status(200).json({ success: true, discarded: added });
      }

      // ── ACTION: discover-compare ── Mae types TWO keywords; return the LIVE blogs (published + scheduled) that
      // relate to BOTH — so she can check by hand whether anything already overlaps the two. Nothing is saved.
      if (req.body.action === 'discover-compare') {
        const kw1 = String(req.body.kw1 || '').trim();
        const kw2 = String(req.body.kw2 || '').trim();
        if (!kw1 || !kw2) return res.status(400).json({ error: 'Type two keywords to compare.' });
        let blogs = []; try { blogs = await fetchBlogsPubAndSched(); } catch (e) { blogs = []; }
        const STOP = new Set(['wall','art','home','decor','prints','print','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you','interior','design','style','room','living','how','what','why','when','does']);
        const words = s => [...new Set((String(s || '').toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !STOP.has(w)))];
        const w1 = words(kw1), w2 = words(kw2);
        const t1 = topicTagBoth(kw1), t2 = topicTagBoth(kw2);
        const bothAxes = (t, b) => (!!(t.tagP.style && t.tagP.room && b.tagP.style === t.tagP.style && b.tagP.room === t.tagP.room))
                                 || (!!(t.tagS.style && t.tagS.room && b.tagS.style === t.tagS.style && b.tagS.room === t.tagS.room));
        const matches = [];
        blogs.forEach(b => {
          const title = b.title || '';
          const hay = (title + ' ' + ((b.tags || []).join(' '))).toLowerCase();
          const bt = topicTagBoth(title);
          const hit1 = w1.some(w => hay.includes(w)) || bothAxes(t1, bt);
          const hit2 = w2.some(w => hay.includes(w)) || bothAxes(t2, bt);
          if (hit1 && hit2) matches.push({ title, handle: b.handle || '' });
        });
        return res.status(200).json({ success: true, kw1, kw2, matches });
      }

      // ── ACTION: discover-group-to-write ── Mae picked the keyword (from Ubersuggest) for a group of discovered
      // topics. Check it isn't LOCKED to another URL; if free, create ONE approved blog in To Write that covers the
      // whole group (the other topics become "also covers"), save its volume/difficulty, and clear them from the pool.
      if (req.body.action === 'discover-group-to-write') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const keyword = String(req.body.keyword || '').trim();
        const title = String(req.body.title || '').trim() || keyword;
        const questions = Array.isArray(req.body.questions) ? req.body.questions.map(q => String((q && q.question) || q || '').trim()).filter(Boolean) : [];
        const volume = (req.body.volume != null && String(req.body.volume).trim() !== '') ? Number(req.body.volume) : null;
        const difficulty = (req.body.difficulty != null && String(req.body.difficulty).trim() !== '') ? Number(req.body.difficulty) : null;
        if (!keyword) return res.status(400).json({ error: 'A chosen keyword is required.' });
        const kwLc = keyword.toLowerCase();

        // 1) LOCKED check — read the registry FRESH (contents API, no CDN lag).
        //    Locked to a BLOG (source Published Blog / To_Write_Blog) = SAME intent → BLOCK (would cannibalise).
        //    Locked to a PRODUCT / other page = DIFFERENT intent → ALLOW, and remember the URL so we link the blog to it.
        let reuseLink = null;
        try {
          const reg = await getGitHubFile('data/keyword-locker-registry.csv');
          const rl = (reg.content || '').split('\n');
          for (let i = 1; i < rl.length; i++) {
            const line = rl[i]; if (!line || !line.trim()) continue;
            const c = parseCSVLine(line.replace(/\r/g, ''));
            const rkw = (c[0] || '').trim().toLowerCase();
            const rurl = (c[1] || '').trim();
            const rlk = (c[2] || '').trim().toUpperCase();
            const rsrc = (c[9] || '').trim();
            if (rkw === kwLc && rlk === 'LOCKED' && rurl && rurl !== 'N/A') {
              const isBlogLock = (rsrc === 'Published Blog' || rsrc === 'To_Write_Blog');
              if (isBlogLock) {
                return res.status(200).json({ success: false, locked: true, lockedUrl: rurl, error: 'That keyword is locked to another BLOG (' + rurl + ') — same intent, it would cannibalise. Pick a different keyword.' });
              }
              reuseLink = { keyword: keyword, url: rurl }; // product / other page → reuse + link
              break;
            }
          }
        } catch (e) { /* if the registry can't be read, don't silently approve a maybe-locked keyword */ return res.status(200).json({ success: false, error: 'Could not read the keyword registry to check locks — try again.' }); }

        // 2) Add (or update) the blog idea row as TO_WRITE.
        const esc = (c) => { const v = String(c == null ? '' : c); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; };
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        let updated = false;
        for (let li = 1; li < lines.length; li++) {
          const t = lines[li].trim(); if (!t) continue;
          const c = parseCSVLine(t.replace(/\r/g, ''));
          if ((c[0] || '').trim().toLowerCase() === kwLc) { while (c.length < 10) c.push(''); c[1] = c[1] || title; c[6] = 'TO_WRITE'; lines[li] = c.map(esc).join(','); updated = true; break; }
        }
        if (!updated) lines.push([keyword, title, '', 'NO CONFLICT', '', '', 'TO_WRITE', '', '', ''].map(esc).join(','));
        await updateGitHubFile('data/blog_ideas.csv', lines.join('\n') + '\n', ideasFile.sha, `Discover group → To Write: ${keyword}`);

        // 3) Mark approved (so it shows in To Write, no second filter).
        try { const ap = await readJsonFileSafe('data/blog-approved.json', []); const set = new Set((Array.isArray(ap) ? ap : []).map(x => String(x).toLowerCase())); set.add(kwLc); await writeJsonFile('data/blog-approved.json', [...set], `Approved: ${keyword}`); } catch (e) {}

        // 4) Save the keyword metrics Mae typed in (so the backlog can rank it and we never re-fetch).
        if (volume != null || difficulty != null) {
          try { const km = await readJsonFileSafe('data/keyword-metrics.json', {}); const map = (km && typeof km === 'object') ? km : {}; map[kwLc] = { ...(map[kwLc] || {}), volume: (volume != null ? volume : (map[kwLc] || {}).volume), difficulty: (difficulty != null ? difficulty : (map[kwLc] || {}).difficulty), source: 'ubersuggest-manual', at: new Date().toISOString() }; await writeJsonFile('data/keyword-metrics.json', map, `Metrics: ${keyword}`); } catch (e) {}
        }

        // 5) The OTHER grouped topics become this blog's "also covers" (used as sections when it's written).
        const secondary = questions.filter(q => q.toLowerCase() !== kwLc).map(q => ({ keyword: q, title: '', source: 'discover' }));
        if (secondary.length) {
          try { const fused = await readJsonFileSafe('data/blog-fused-groups.json', {}); const fmap = (fused && typeof fused === 'object') ? fused : {}; fmap[kwLc] = { winnerKeyword: keyword, winnerTitle: title, secondary, reason: 'Discover — grouped topics', appliedAt: new Date().toISOString() }; await writeJsonFile('data/blog-fused-groups.json', fmap, `Discover group for ${keyword}`); } catch (e) {}
        }

        // 6) Clear the used questions from the pool (if they were parked there).
        try {
          const pool = await readJsonFileSafe('data/discover-pool.json', []);
          const arr = Array.isArray(pool) ? pool : [];
          const qset = new Set(questions.map(q => q.toLowerCase()));
          let touched = false;
          arr.forEach(p => { if (qset.has(String(p.question || '').toLowerCase()) && p.status !== 'added') { p.status = 'added'; touched = true; } });
          if (touched) await writeJsonFile('data/discover-pool.json', arr, `Discover: grouped ${secondary.length + 1} topic(s) into ${keyword}`);
        } catch (e) {}

        // 7) Save the PRODUCT / other-page link target(s) for this blog → data/blog-link-targets.json, keyed by the blog
        //    keyword. When the blog is written, finish-blog adds ONE clean contextual in-body link to the (primary)
        //    target, and publish-blog puts the product(s) in the blog's related-products metafield (custom.blog_products_list).
        //    Merges the main keyword's reuse link (if it was locked to a product) with any grouped secondary queries that
        //    were locked to a product/page (req.body.lockedTargets). Blog-locked targets never reach here.
        let linkedTargets = 0;
        try {
          const incoming = [];
          if (reuseLink && reuseLink.url) incoming.push({ keyword: reuseLink.keyword, url: reuseLink.url });
          (Array.isArray(req.body.lockedTargets) ? req.body.lockedTargets : []).forEach(t => {
            const k = String((t && t.keyword) || '').trim(); const u = String((t && t.url) || '').trim();
            if (k && u) incoming.push({ keyword: k, url: u });
          });
          if (incoming.length) {
            const map = await readJsonFileSafe('data/blog-link-targets.json', {});
            const m = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
            const bucket = (m[kwLc] && Array.isArray(m[kwLc].links)) ? m[kwLc].links : [];
            const seen = new Set(bucket.map(x => String((x && x.url) || '').toLowerCase()));
            incoming.forEach(t => { const key = t.url.toLowerCase(); if (!seen.has(key)) { bucket.push({ keyword: t.keyword, url: t.url }); seen.add(key); linkedTargets++; } });
            m[kwLc] = { blogKeyword: keyword, links: bucket, updatedAt: new Date().toISOString() };
            await writeJsonFile('data/blog-link-targets.json', m, `Blog link targets for ${keyword}`);
          }
        } catch (e) {}

        return res.status(200).json({ success: true, keyword, covers: secondary.length, linkedTargets });
      }

      // ── ACTION: discover-probe ── test one seed: return EVERY question Google brings, with kept/dropped + why.
      // Nothing is saved — this is only for checking whether the filter is right or too strict.
      if (req.body.action === 'discover-probe') {
        if (!process.env.SERPER_KEY) return res.status(500).json({ error: 'SERPER_KEY not set.' });
        const seed = String(req.body.seed || '').trim();
        if (!seed) return res.status(400).json({ error: 'seed required' });
        let blogs = []; try { blogs = await fetchBlogsPubAndSched(); } catch (e) { blogs = []; }
        const blogTags = blogs.map(b => ({ title: b.title, t: topicTagBoth(b.title || '') }));
        const pipeTags = (await gatherPipelineTexts()).map(x => ({ text: x, t: topicTagBoth(x) }));
        const ideaKw = new Set();
        try { const f = await getGitHubFile('data/blog_ideas.csv'); f.content.split('\n').forEach((l, i) => { if (i === 0) return; const c = parseCSVLine(l.replace(/\r/g, '')); if (c[0]) ideaKw.add((c[0] || '').trim().toLowerCase()); }); } catch (e) {}
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        const poolQ = new Set((Array.isArray(pool) ? pool : []).map(p => String(p.question || '').toLowerCase()));
        const out = [];
        for (const term of DISCOVER_TERMS) {
          const q = (seed + ' ' + term).trim();
          let data = {};
          try { const r = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q, gl: 'uk', hl: 'en' }) }); if (r.ok) data = await r.json(); } catch (e) {}
          const qs = [];
          (data.peopleAlsoAsk || []).forEach(p => { if (p && p.question) qs.push(p.question); });
          (data.relatedSearches || []).forEach(rs => { if (rs && rs.query) qs.push(rs.query); });
          qs.forEach(question => {
            const lc = String(question).toLowerCase().trim();
            let kept = true, reason = 'new';
            if (poolQ.has(lc)) { kept = false; reason = 'already in the discovery pool'; }
            else if (ideaKw.has(lc)) { kept = false; reason = 'already one of your ideas'; }
            else {
              const qt = topicTagBoth(question);
              if (qt.tagS.style || qt.tagS.room) {
                const bHit = blogTags.find(bt => TOPIC_PHASES.some(m => m(qt, bt.t)));
                const pHit = !bHit && pipeTags.find(pt => TOPIC_PHASES.some(m => m(qt, pt.t)));
                if (bHit) { kept = false; reason = 'already covered by blog: "' + bHit.title + '"'; }
                else if (pHit) { kept = false; reason = 'already in your pipeline: "' + String(pHit.text).trim() + '"'; }
              }
            }
            out.push({ term, question, kept, reason });
          });
        }
        return res.status(200).json({ success: true, seed, results: out });
      }

      // ── ACTION: mark-idea-towrite ── the Blog Ideas "Mark for Writing" button: persist the row as TO_WRITE
      // AND approve the keyword, so it actually shows in To Write (before, it set TO_WRITE without approving and
      // vanished). Updates the existing row; never duplicates.
      if (req.body.action === 'mark-idea-towrite') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const kwLc = kw.toLowerCase();
        const esc = (c) => { const v = String(c == null ? '' : c); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; };
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        let found = false;
        for (let i = 1; i < lines.length; i++) {
          const t = lines[i].trim(); if (!t) continue;
          const c = parseCSVLine(t.replace(/\r/g, ''));
          if ((c[0] || '').trim().toLowerCase() === kwLc) { while (c.length < 10) c.push(''); c[6] = 'TO_WRITE'; lines[i] = c.map(esc).join(','); found = true; break; }
        }
        if (!found) return res.status(404).json({ error: 'That idea is no longer in the list — reload.' });
        await updateGitHubFile('data/blog_ideas.csv', lines.join('\n'), ideasFile.sha, `Mark for writing: ${kw}`);
        try { const ap = await readJsonFileSafe('data/blog-approved.json', []); const set = new Set((Array.isArray(ap) ? ap : []).map(x => String(x).toLowerCase())); set.add(kwLc); await writeJsonFile('data/blog-approved.json', [...set], `Approved: ${kw}`); } catch (e) {}
        return res.status(200).json({ success: true });
      }

      // ── ACTION: discover-list-pool ── the current discovery pool (candidates needing a keyword / ready / added).
      if (req.body.action === 'discover-list-pool') {
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        return res.status(200).json({ success: true, pool: Array.isArray(pool) ? pool : [] });
      }

      // ── ACTION: discover-set-keyword ── Claude fills the main keyword + title for a pool item (from Ubersuggest).
      if (req.body.action === 'discover-set-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const id = String(req.body.id || '');
        const mainKeyword = String(req.body.mainKeyword || '').trim();
        const title = String(req.body.title || '').trim();
        if (!id || !mainKeyword) return res.status(400).json({ error: 'id and mainKeyword required' });
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        const arr = Array.isArray(pool) ? pool : [];
        const i = arr.findIndex(p => p.id === id);
        if (i < 0) return res.status(404).json({ error: 'pool item not found' });
        arr[i] = { ...arr[i], mainKeyword, title: title || arr[i].title || mainKeyword, volume: req.body.volume != null ? req.body.volume : (arr[i].volume ?? null), difficulty: req.body.difficulty != null ? req.body.difficulty : (arr[i].difficulty ?? null), status: 'ready' };
        await writeJsonFile('data/discover-pool.json', arr, `Discover: keyword for ${id}`);
        return res.status(200).json({ success: true, item: arr[i] });
      }

      // ── ACTION: discover-promote ── Discover already kept only NOT-written combos, so an approved topic goes
      // STRAIGHT TO TO WRITE (no re-triage): set the row TO_WRITE + add the keyword to blog-approved.json so it
      // shows. If a row for that keyword already exists it's updated (no duplicate). The other pool topics from
      // the SAME seed are its angles → they're cleared too.
      if (req.body.action === 'discover-promote') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const id = String(req.body.id || '');
        if (!id) return res.status(400).json({ error: 'id required' });
        const pool = await readJsonFileSafe('data/discover-pool.json', []);
        const arr = Array.isArray(pool) ? pool : [];
        const item = arr.find(p => p.id === id);
        if (!item) return res.status(404).json({ error: 'pool item not found' });
        if (!item.mainKeyword) return res.status(400).json({ error: 'This topic has no main keyword yet.' });
        const kwLc = item.mainKeyword.toLowerCase();
        const esc = (c) => { const v = String(c == null ? '' : c); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; };
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        let updated = false;
        for (let li = 1; li < lines.length; li++) {
          const t = lines[li].trim(); if (!t) continue;
          const c = parseCSVLine(t.replace(/\r/g, ''));
          if ((c[0] || '').trim().toLowerCase() === kwLc) { while (c.length < 10) c.push(''); c[6] = 'TO_WRITE'; lines[li] = c.map(esc).join(','); updated = true; break; }
        }
        if (!updated) lines.push([item.mainKeyword, item.title || item.mainKeyword, '', 'NO CONFLICT', '', '', 'TO_WRITE', '', '', ''].map(esc).join(','));
        await updateGitHubFile('data/blog_ideas.csv', lines.join('\n') + '\n', ideasFile.sha, `Discover → To Write: ${item.mainKeyword}`);
        try { const ap = await readJsonFileSafe('data/blog-approved.json', []); const set = new Set((Array.isArray(ap) ? ap : []).map(x => String(x).toLowerCase())); set.add(kwLc); await writeJsonFile('data/blog-approved.json', [...set], `Approved: ${item.mainKeyword}`); } catch (e) {}
        // The other search results from the SAME seed are the angles of THIS blog — save them so they show as
        // "+ also covers" in To Write and get used as sections when the blog is written (via blog-fused-groups).
        const seedLc = String(item.seed || '').toLowerCase();
        const angleItems = arr.filter(p => seedLc && String(p.seed || '').toLowerCase() === seedLc && p.status !== 'added');
        const angles = angleItems.map(p => ({ keyword: p.question, title: '', source: 'discover' }));
        if (angles.length) {
          try {
            const fused = await readJsonFileSafe('data/blog-fused-groups.json', {});
            fused[kwLc] = { winnerKeyword: item.mainKeyword, winnerTitle: item.title || '', secondary: angles, reason: 'Discover — angles from search', appliedAt: new Date().toISOString() };
            await writeJsonFile('data/blog-fused-groups.json', fused, `Discover angles for ${item.mainKeyword}`);
          } catch (e) {}
        }
        // Now clear this item + its same-seed siblings from the pool (they're attached to the blog now).
        arr.forEach(p => { if (p.id === id || (seedLc && String(p.seed || '').toLowerCase() === seedLc && p.status !== 'added')) p.status = 'added'; });
        await writeJsonFile('data/discover-pool.json', arr, `Discover: promoted ${item.mainKeyword} (+ ${angles.length} angles)`);
        return res.status(200).json({ success: true, angles: angles.length });
      }

      // ── ACTION: delete-blog-row ── remove ONE matching row (keyword [+ title]) straight from blog_ideas.csv.
      // First match only, so a duplicate pair loses exactly one row.
      if (req.body.action === 'delete-blog-row') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim().toLowerCase();
        const title = String(req.body.title || '').trim().toLowerCase();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        let removed = false; const out = [];
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (i === 0 || !t) { out.push(lines[i]); continue; }
          if (!removed) {
            const c = parseCSVLine(t.replace(/\r/g, ''));
            if ((c[0] || '').trim().toLowerCase() === kw && (!title || (c[1] || '').trim().toLowerCase() === title)) { removed = true; continue; }
          }
          out.push(lines[i]);
        }
        if (!removed) return res.status(404).json({ error: 'Row not found — reload and try again.' });
        let txt = out.join('\n'); if (!txt.endsWith('\n')) txt += '\n';
        await updateGitHubFile('data/blog_ideas.csv', txt, ideasFile.sha, `Delete row: ${req.body.keyword}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: gsc-approve-dedup ── approve GSC topics THROUGH the duplicate check: each one is matched
      // against existing blogs — if covered → a 'covered' group (Already covered); if not → a Single for Mae to
      // place. Nothing lands in limbo.
      if (req.body.action === 'gsc-approve-dedup') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kws = (Array.isArray(req.body.keywords) ? req.body.keywords : []).map(k => String(k || '').trim()).filter(Boolean);
        if (!kws.length) return res.status(400).json({ error: 'keywords required' });
        let blogs = []; try { blogs = await fetchBlogsPubAndSched(); } catch (e) { blogs = []; }
        const blogTags = blogs.map(b => ({ b, ...topicTagBoth(b.title || '') }));
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const pArr = Array.isArray(pending) ? pending : [];
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const sArr = Array.isArray(singles) ? singles : [];
        const singHave = new Set(sArr.map(s => String(s.keyword || '').toLowerCase()));
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const groupedSet = new Set((checked.grouped || []).map(x => String(x).toLowerCase()));
        const singletonsSet = new Set((checked.singletons || []).map(x => String(x).toLowerCase()));
        let coveredN = 0, singleN = 0;
        kws.forEach((kw, ix) => {
          const kt = topicTagBoth(kw);
          let matchedBlog = null;
          if (kt.tagS.style || kt.tagS.room) { for (const bt of blogTags) { if (TOPIC_PHASES.some(m => m(kt, bt))) { matchedBlog = bt.b; break; } } }
          const lc = kw.toLowerCase();
          if (matchedBlog) {
            pArr.push({ id: `grp_${Date.now()}_gsc${ix}`, bucketSig: null, type: 'covered', winnerKeyword: kw, winnerTitle: '', winnerSource: 'rank', winnerPageUrl: null, winnerUrlFree: false, winnerLockedTo: null, reason: 'GSC approve — already covered', signals: 'gsc', secondary: [], coveredBlog: { id: matchedBlog.id, title: matchedBlog.title, handle: matchedBlog.handle, status: matchedBlog.status, url: matchedBlog.url } });
            groupedSet.add(lc); singletonsSet.delete(lc); coveredN++;
          } else {
            if (!singHave.has(lc)) { const t = topicTag(kw, false); sArr.push({ keyword: kw, title: '', source: 'rank', style: t.style, room: t.room, pageUrl: null, urlFree: false, lockedToKeyword: null, volume: null, difficulty: null, impressions: null, position: null }); singHave.add(lc); singleN++; }
            singletonsSet.add(lc); groupedSet.delete(lc);
          }
        });
        if (coveredN) await writeJsonFile('data/blog-fusion-pending.json', pArr, `GSC approve: +${coveredN} covered`);
        if (singleN) await writeJsonFile('data/blog-fusion-singles.json', sArr, `GSC approve: +${singleN} single(s)`);
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletonsSet], grouped: [...groupedSet] }, 'GSC approve: mark checked');
        return res.status(200).json({ success: true, covered: coveredN, singles: singleN });
      }

      // ── ACTION: fusion-single-to-write ── a lone SINGLE Mae wants as its own blog. A 'rank' keyword isn't
      // in blog_ideas.csv yet → append a TO_WRITE row + hide it from the performing panel; a 'towrite' one is
      // already there → just drop it from the singles list.
      if (req.body.action === 'fusion-single-to-write') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const s = (Array.isArray(singles) ? singles : []).find(x => String(x.keyword || '').toLowerCase() === kw.toLowerCase());
        if (!s || s.source === 'rank') {
          const esc = (c) => { const v = String(c == null ? '' : c); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; };
          const ideasFile = await getGitHubFile('data/blog_ideas.csv');
          const lines = ideasFile.content.split('\n');
          while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
          const title = (s && s.title) ? s.title : kw;
          lines.push([kw, title, '', 'NO CONFLICT', '', '', 'TO_WRITE', ''].map(esc).join(','));
          await updateGitHubFile('data/blog_ideas.csv', lines.join('\n') + '\n', ideasFile.sha, `To Write: single "${kw}"`);
          try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(x => String(x).toLowerCase())); set.add(kw.toLowerCase()); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Single→To Write: hide ranked keyword'); } catch (e) {}
        }
        const remaining = (Array.isArray(singles) ? singles : []).filter(x => String(x.keyword || '').toLowerCase() !== kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-singles.json', remaining, `Fusion: single "${kw}" → To Write`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(x => String(x).toLowerCase())); grouped.add(kw.toLowerCase());
        const singletons = new Set((checked.singletons || []).map(x => String(x).toLowerCase())); singletons.delete(kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: single to To Write');
        try { const ap = await readJsonFileSafe('data/blog-approved.json', []); const set = new Set((Array.isArray(ap) ? ap : []).map(x => String(x).toLowerCase())); set.add(kw.toLowerCase()); await writeJsonFile('data/blog-approved.json', [...set], `Approved: ${kw}`); } catch (e) {}
        return res.status(200).json({ success: true, keyword: kw });
      }

      // ── ACTION: fusion-drop-single ── remove a single from the list without writing a blog (used after
      // "Optimise that page (MPD)"): drop from singles, mark grouped, and hide it from the performing panel.
      if (req.body.action === 'fusion-drop-single') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        const remaining = (Array.isArray(singles) ? singles : []).filter(x => String(x.keyword || '').toLowerCase() !== kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-singles.json', remaining, `Fusion: drop single "${kw}"`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(x => String(x).toLowerCase())); grouped.add(kw.toLowerCase());
        const singletons = new Set((checked.singletons || []).map(x => String(x).toLowerCase())); singletons.delete(kw.toLowerCase());
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: drop single');
        try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(x => String(x).toLowerCase())); set.add(kw.toLowerCase()); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Drop single: hide ranked keyword'); } catch (e) {}
        return res.status(200).json({ success: true, keyword: kw });
      }

      // ── ACTION: fusion-ignore-single ── Mae doesn't want this single → mark it IGNORED in blog_ideas.csv
      // (it moves to the Ignored tab) and remove it from Singles so it never resurfaces.
      if (req.body.action === 'fusion-ignore-single') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const kw = String(req.body.keyword || '').trim();
        if (!kw) return res.status(400).json({ error: 'keyword required' });
        const kwLc = kw.toLowerCase();
        const escCsv = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const colCount = Math.max(parseCSVLine((lines[0] || '').replace(/\r/g, '')).length, 10);
        let found = false;
        const updated = lines.map((line, i) => {
          if (i === 0) return line;
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if ((cols[0] || '').trim().toLowerCase() === kwLc) { while (cols.length < 10) cols.push(''); cols[6] = 'IGNORED'; found = true; return cols.map(escCsv).join(','); }
          return line;
        });
        if (!found) { const row = new Array(colCount).fill(''); row[0] = kw; row[6] = 'IGNORED'; updated.push(row.map(escCsv).join(',')); }
        await updateGitHubFile('data/blog_ideas.csv', updated.join('\n'), ideasFile.sha, `Ignore single: ${kw}`);
        const singles = await readJsonFileSafe('data/blog-fusion-singles.json', []);
        await writeJsonFile('data/blog-fusion-singles.json', (Array.isArray(singles) ? singles : []).filter(x => String(x.keyword || '').toLowerCase() !== kwLc), `Fusion: ignore single "${kw}"`);
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const grouped = new Set((checked.grouped || []).map(x => String(x).toLowerCase())); grouped.add(kwLc);
        const singletons = new Set((checked.singletons || []).map(x => String(x).toLowerCase())); singletons.delete(kwLc);
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletons], grouped: [...grouped] }, 'Fusion: ignore single');
        try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(x => String(x).toLowerCase())); set.add(kwLc); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Ignore single: hide ranked keyword'); } catch (e) {}
        return res.status(200).json({ success: true, keyword: kw });
      }

      // ── ACTION: apply-fusion-group ── Mae approved a proposed group: secondary keywords' rows go
      // IGNORED (marked FUSED, pointing at the winner); the winner's secondary angles are recorded
      // permanently in blog-fused-groups.json so "Write blog" can cover them as extra H2 sections.
      if (req.body.action === 'apply-fusion-group') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const winnerKeyword = String(req.body.winnerKeyword || '').trim();
        if (!winnerKeyword) return res.status(400).json({ error: 'winnerKeyword required' });
        const winnerLc = winnerKeyword.toLowerCase();
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const idx = pending.findIndex(g => (g.winnerKeyword || '').toLowerCase() === winnerLc);
        if (idx === -1) return res.status(404).json({ error: 'That group is no longer pending (maybe already applied or discarded).' });
        const group = pending[idx];

        const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const secLc = new Set(group.secondary.map(s => s.keyword.toLowerCase()));
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const colCount = Math.max(parseCSVLine((lines[0] || '').replace(/\r/g, '')).length, 10);
        let touched = 0;
        let winnerRowExists = false;
        const updated = lines.map((line, i) => {
          if (i === 0) return line;
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          const kw = (cols[0] || '').trim().toLowerCase();
          if (kw === winnerLc) winnerRowExists = true;
          if (secLc.has(kw)) {
            while (cols.length < 10) cols.push('');
            cols[3] = 'FUSED';               // CANNIBALIZATION
            cols[4] = group.winnerKeyword;   // CONFLICTING KEYWORD -> points at the winner
            cols[6] = 'IGNORED';             // STATUS
            touched++;
            return cols.map(esc).join(',');
          }
          return line;
        });
        // If the winner is a "You already rank" keyword (not in the write list yet), add it as a TO_WRITE
        // row so it becomes the blog that will own this search (same intent as "Use in a blog").
        if (group.winnerSource === 'rank' && !winnerRowExists) {
          const row = new Array(colCount).fill('');
          row[0] = group.winnerKeyword;                        // Keyword
          row[1] = group.winnerTitle || group.winnerKeyword;   // Blog Post Title
          row[6] = 'TO_WRITE';                                 // STATUS
          updated.push(row.map(esc).join(','));
        }
        await updateGitHubFile('data/blog_ideas.csv', updated.join('\n'), ideasFile.sha, `Fuse ${touched} keyword(s) into: ${group.winnerKeyword}`);

        // Any "You already rank" members folded in → hide them from that panel so they don't reappear.
        const rankToHide = [];
        if (group.winnerSource === 'rank') rankToHide.push(group.winnerKeyword.toLowerCase());
        (group.secondary || []).forEach(s => { if (s.source === 'rank') rankToHide.push((s.keyword || '').toLowerCase()); });
        if (rankToHide.length) {
          try {
            const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []);
            const set = new Set((Array.isArray(pd) ? pd : []).map(s => String(s).toLowerCase()));
            rankToHide.forEach(k => set.add(k));
            await writeJsonFile('data/gsc-performing-dismissed.json', [...set], `Fusion: hide ${rankToHide.length} ranked keyword(s) folded into ${group.winnerKeyword}`);
          } catch (e) { /* non-blocking */ }
        }

        const fused = await readJsonFileSafe('data/blog-fused-groups.json', {});
        fused[winnerLc] = { winnerKeyword: group.winnerKeyword, winnerTitle: group.winnerTitle, secondary: group.secondary, reason: group.reason, appliedAt: new Date().toISOString() };
        await writeJsonFile('data/blog-fused-groups.json', fused, `Fusion applied: ${group.winnerKeyword}`);

        pending.splice(idx, 1);
        await writeJsonFile('data/blog-fusion-pending.json', pending, `Fusion applied — removed from pending: ${group.winnerKeyword}`);

        // Approved → the winner is now a real blog to write, so it moves to the To Write tab.
        try { const ap = await readJsonFileSafe('data/blog-approved.json', []); const set = new Set((Array.isArray(ap) ? ap : []).map(x => String(x).toLowerCase())); set.add(winnerLc); await writeJsonFile('data/blog-approved.json', [...set], `Approved: ${group.winnerKeyword}`); } catch (e) {}

        return res.status(200).json({ success: true, winnerKeyword: group.winnerKeyword, winnerTitle: group.winnerTitle, secondary: group.secondary, reason: group.reason, touched });
      }

      // ── ACTION: discard-fusion-group ── Mae said keep them separate — un-group these keywords so a
      // future "Find duplicate topics" run can reconsider them (e.g. paired with a different keyword).
      if (req.body.action === 'discard-fusion-group') {
        const winnerKeyword = String(req.body.winnerKeyword || '').trim();
        if (!winnerKeyword) return res.status(400).json({ error: 'winnerKeyword required' });
        const winnerLc = winnerKeyword.toLowerCase();
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const idx = pending.findIndex(g => (g.winnerKeyword || '').toLowerCase() === winnerLc);
        if (idx === -1) return res.status(200).json({ success: true, note: 'Already gone.' });
        const group = pending[idx];
        pending.splice(idx, 1);
        await writeJsonFile('data/blog-fusion-pending.json', pending, `Fusion discarded: ${group.winnerKeyword}`);

        const memberLc = [group.winnerKeyword.toLowerCase(), ...group.secondary.map(s => s.keyword.toLowerCase())];
        const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
        const groupedSet = new Set((checked.grouped || []).map(s => String(s).toLowerCase()));
        memberLc.forEach(k => groupedSet.delete(k));
        const singletonsSet = new Set((checked.singletons || []).map(s => String(s).toLowerCase()));
        memberLc.forEach(k => singletonsSet.add(k));
        await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletonsSet], grouped: [...groupedSet] }, `Fusion discarded — unlocked: ${group.winnerKeyword}`);

        return res.status(200).json({ success: true });
      }

      // ── ACTION: reject-fusion-keyword ── Mae removes ONE keyword from a pending group (she doesn't think
      // it belongs). That keyword is FREED (moved grouped→singletons) so a future run can place it in a
      // different group. The rest of the group stays. If a merge drops below 2 members it dissolves (its
      // remaining members are freed too); a covered group keeps its blog link even with one member left.
      if (req.body.action === 'reject-fusion-keyword') {
        const winnerKeyword = String(req.body.winnerKeyword || '').trim();
        const rejectKeyword = String(req.body.keyword || '').trim();
        if (!winnerKeyword || !rejectKeyword) return res.status(400).json({ error: 'winnerKeyword and keyword required' });
        const winnerLc = winnerKeyword.toLowerCase();
        const rejectLc = rejectKeyword.toLowerCase();
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const idx = pending.findIndex(g => (g.winnerKeyword || '').toLowerCase() === winnerLc);
        if (idx === -1) return res.status(404).json({ error: 'That group is no longer pending.' });
        const group = pending[idx];
        const previousGroup = JSON.parse(JSON.stringify(group)); // snapshot for the session "put back" undo

        // Record the rejection so a future run never re-forms this same grouping for this keyword. The
        // bucket signature came from find-fusion-groups ('S:'/'R:'/'SP:'/'COV:'). Covered groups fall back
        // to the covering blog's handle/id.
        const sig = group.bucketSig || (group.type === 'covered' && group.coveredBlog ? ('COV:' + (group.coveredBlog.handle || group.coveredBlog.id || '')) : null);
        if (sig) {
          try {
            const rej = await readJsonFileSafe('data/blog-fusion-rejections.json', {});
            const arr = new Set(Array.isArray(rej[rejectLc]) ? rej[rejectLc] : []);
            arr.add(sig);
            rej[rejectLc] = [...arr];
            await writeJsonFile('data/blog-fusion-rejections.json', rej, `Fusion: reject "${rejectKeyword}" from ${sig}`);
          } catch (e) { /* non-blocking — worst case it can regroup next run */ }
        }

        // Rebuild the full member list (winner first) so we can drop one and re-pick a winner.
        const winnerMember = {
          keyword: group.winnerKeyword, title: group.winnerTitle || '', source: group.winnerSource || 'towrite',
          pageUrl: group.winnerPageUrl || null, urlFree: !!group.winnerUrlFree, lockedToKeyword: group.winnerLockedTo || null,
          volume: null, difficulty: null, impressions: null
        };
        const allMembers = [winnerMember, ...(group.secondary || [])];
        const kept = allMembers.filter(m => (m.keyword || '').toLowerCase() !== rejectLc);
        if (kept.length === allMembers.length) return res.status(404).json({ error: 'That keyword is not in this group.' });

        // Free a keyword: move it out of "grouped" and into "singletons" so the next run reconsiders it.
        const free = async (keywordsLc, note) => {
          const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
          const groupedSet = new Set((checked.grouped || []).map(s => String(s).toLowerCase()));
          const singletonsSet = new Set((checked.singletons || []).map(s => String(s).toLowerCase()));
          keywordsLc.forEach(k => { groupedSet.delete(k); singletonsSet.add(k); });
          await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletonsSet], grouped: [...groupedSet] }, note);
        };

        const isCovered = group.type === 'covered' && group.coveredBlog;
        // A merge needs ≥2 members; a covered group is fine with 1 (or even 0 → gone).
        const dissolve = (!isCovered && kept.length < 2) || kept.length < 1;

        // Put the rejected keyword straight back into the Singles list (so Mae can re-group it or send it to a
        // blog right away, without re-running the whole check). If the group dissolves, its kept members go too.
        try {
          const rejectedMember = allMembers.find(m => (m.keyword || '').toLowerCase() === rejectLc) || { keyword: rejectKeyword, title: '', source: 'towrite' };
          const freedMembers = dissolve ? [rejectedMember, ...kept] : [rejectedMember];
          const toSingle = (m) => { const t = topicTag((m.keyword || '') + ' ' + (m.title || ''), false); return { keyword: m.keyword, title: m.title || '', source: m.source || 'towrite', style: t.style, room: t.room, pageUrl: m.pageUrl || null, urlFree: !!m.urlFree, lockedToKeyword: m.lockedToKeyword || null, volume: m.volume == null ? null : m.volume, difficulty: m.difficulty == null ? null : m.difficulty, impressions: m.impressions == null ? null : m.impressions, position: m.position == null ? null : m.position }; };
          const singlesNow = await readJsonFileSafe('data/blog-fusion-singles.json', []);
          const sArr = Array.isArray(singlesNow) ? singlesNow : [];
          const haveLc = new Set(sArr.map(s => String(s.keyword || '').toLowerCase()));
          let added = 0;
          freedMembers.forEach(m => { const lc = (m.keyword || '').toLowerCase(); if (lc && !haveLc.has(lc)) { sArr.push(toSingle(m)); haveLc.add(lc); added++; } });
          if (added) await writeJsonFile('data/blog-fusion-singles.json', sArr, `Fusion: ${added} rejected keyword(s) → Singles`);
        } catch (e) { /* non-blocking — worst case it comes back on the next check run */ }

        if (dissolve) {
          pending.splice(idx, 1);
          await writeJsonFile('data/blog-fusion-pending.json', pending, `Fusion: dissolved group after rejecting "${rejectKeyword}"`);
          await free([rejectLc, ...kept.map(m => (m.keyword || '').toLowerCase())], `Fusion: freed ${kept.length + 1} keyword(s) from a dissolved group`);
          return res.status(200).json({ success: true, removed: true, previousGroup, sig, rejectedKeyword: rejectKeyword });
        }

        // Re-pick the winner among the kept members: highest volume, else highest impressions, else first.
        let winner = kept.slice().filter(m => m.volume != null).sort((a, b) => (b.volume - a.volume) || ((a.difficulty ?? 99) - (b.difficulty ?? 99)))[0];
        if (!winner) winner = kept.slice().filter(m => m.impressions != null).sort((a, b) => b.impressions - a.impressions)[0];
        if (!winner) winner = kept[0];
        const secondary = kept.filter(m => (m.keyword || '').toLowerCase() !== (winner.keyword || '').toLowerCase());

        group.winnerKeyword = winner.keyword;
        group.winnerTitle = winner.title || '';
        group.winnerSource = winner.source || 'towrite';
        group.winnerPageUrl = winner.pageUrl || null;
        group.winnerUrlFree = !!winner.urlFree;
        group.winnerLockedTo = winner.lockedToKeyword || null;
        group.secondary = secondary;
        pending[idx] = group;
        await writeJsonFile('data/blog-fusion-pending.json', pending, `Fusion: rejected "${rejectKeyword}" from ${group.winnerKeyword}`);
        await free([rejectLc], `Fusion: freed "${rejectKeyword}" to rejoin a future group`);

        return res.status(200).json({ success: true, group, previousGroup, sig, rejectedKeyword: rejectKeyword });
      }

      // ── ACTION: restore-fusion-rejection ── the session-only "put back" undo. Re-adds a rejected keyword
      // to its original group (restores the snapshot taken when it was rejected), clears that keyword's
      // rejection record, and re-locks the group's members so the next run won't re-pool them.
      if (req.body.action === 'restore-fusion-rejection') {
        const prev = req.body.previousGroup;
        const rejectKeyword = String(req.body.keyword || '').trim();
        const sig = req.body.sig || null;
        if (!prev || !prev.winnerKeyword) return res.status(400).json({ error: 'previousGroup required' });
        const rejectLc = rejectKeyword.toLowerCase();

        // Members of the restored group (winner + secondary).
        const memberLc = [String(prev.winnerKeyword || '').toLowerCase(), ...((prev.secondary || []).map(s => (s.keyword || '').toLowerCase()))].filter(Boolean);

        // Remove any current pending entry that overlaps these members (the mutated/dissolved version), then
        // put the original group back.
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const overlaps = (g) => {
          const gm = [String(g.winnerKeyword || '').toLowerCase(), ...((g.secondary || []).map(s => (s.keyword || '').toLowerCase()))];
          return gm.some(k => memberLc.includes(k));
        };
        const kept = pending.filter(g => !overlaps(g));
        kept.push(prev);
        await writeJsonFile('data/blog-fusion-pending.json', kept, `Fusion: put "${rejectKeyword}" back into ${prev.winnerKeyword}`);

        // Clear this keyword's rejection of that bucket.
        if (sig) {
          try {
            const rej = await readJsonFileSafe('data/blog-fusion-rejections.json', {});
            if (Array.isArray(rej[rejectLc])) { rej[rejectLc] = rej[rejectLc].filter(s => s !== sig); if (!rej[rejectLc].length) delete rej[rejectLc]; }
            await writeJsonFile('data/blog-fusion-rejections.json', rej, `Fusion: undo reject of "${rejectKeyword}" (${sig})`);
          } catch (e) { /* non-blocking */ }
        }

        // Re-lock all members as grouped (out of singletons) so a run doesn't re-pool them.
        try {
          const checked = await readJsonFileSafe('data/blog-fusion-checked.json', { singletons: [], grouped: [] });
          const groupedSet = new Set((checked.grouped || []).map(s => String(s).toLowerCase()));
          const singletonsSet = new Set((checked.singletons || []).map(s => String(s).toLowerCase()));
          memberLc.forEach(k => { groupedSet.add(k); singletonsSet.delete(k); });
          await writeJsonFile('data/blog-fusion-checked.json', { singletons: [...singletonsSet], grouped: [...groupedSet] }, `Fusion: re-lock ${memberLc.length} member(s) after put-back`);
        } catch (e) { /* non-blocking */ }

        return res.status(200).json({ success: true, group: prev });
      }

      // ── ACTION: remove-covered ── a group is already covered by a published/scheduled blog and Mae
      // chose "Remove" (don't write it). To Write members → IGNORED (COVERED); ranked members → hidden.
      if (req.body.action === 'remove-covered') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const winnerKeyword = String(req.body.winnerKeyword || '').trim();
        if (!winnerKeyword) return res.status(400).json({ error: 'winnerKeyword required' });
        const winnerLc = winnerKeyword.toLowerCase();
        const pending = await readJsonFileSafe('data/blog-fusion-pending.json', []);
        const idx = pending.findIndex(g => (g.winnerKeyword || '').toLowerCase() === winnerLc);
        if (idx === -1) return res.status(404).json({ error: 'That group is no longer pending.' });
        const group = pending[idx];
        const members = [{ keyword: group.winnerKeyword, source: group.winnerSource }, ...(group.secondary || []).map(s => ({ keyword: s.keyword, source: s.source }))];
        const towriteLc = new Set(members.filter(m => m.source !== 'rank').map(m => (m.keyword || '').toLowerCase()));
        const rankLc = members.filter(m => m.source === 'rank').map(m => (m.keyword || '').toLowerCase());
        if (towriteLc.size) {
          const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
          const ideasFile = await getGitHubFile('data/blog_ideas.csv');
          const lines = ideasFile.content.split('\n');
          const updated = lines.map((line, i) => {
            if (i === 0) return line;
            const t = line.trim().replace(/\r/g, ''); if (!t) return line;
            const cols = parseCSVLine(t);
            const kw = (cols[0] || '').trim().toLowerCase();
            if (towriteLc.has(kw)) { while (cols.length < 10) cols.push(''); cols[3] = 'COVERED'; cols[4] = (group.coveredBlog && group.coveredBlog.title) || ''; cols[6] = 'IGNORED'; return cols.map(esc).join(','); }
            return line;
          });
          await updateGitHubFile('data/blog_ideas.csv', updated.join('\n'), ideasFile.sha, `Covered — ignore ${towriteLc.size} topic(s) already in a blog`);
        }
        if (rankLc.length) { try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(s => String(s).toLowerCase())); rankLc.forEach(k => set.add(k)); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Covered — hide ranked keyword(s) already in a blog'); } catch (e) { } }
        pending.splice(idx, 1);
        await writeJsonFile('data/blog-fusion-pending.json', pending, `Covered removed: ${group.winnerKeyword}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: add-angle-preview ── propose a light edit to an EXISTING blog so it naturally includes
      // the keyword(s). Returns before/after for Mae to approve. NOTHING is written to Shopify here.
      if (req.body.action === 'add-angle-preview') {
        let articleId = String(req.body.articleId || '').trim();
        const keywords = Array.isArray(req.body.keywords) ? req.body.keywords.map(k => String(k || '').trim()).filter(Boolean) : [];
        if (!keywords.length) return res.status(400).json({ error: 'keywords required' });
        if (!articleId && req.body.blogUrl) {
          const h = String(req.body.blogUrl).split('?')[0].replace(/\/+$/, '').split('/').pop().toLowerCase();
          try { const q = await shopifyGraphQL(`query($q:String!){ articles(first:1, query:$q){ nodes{ id } } }`, { q: 'handle:' + h }); articleId = (q && q.articles && q.articles.nodes && q.articles.nodes[0] && q.articles.nodes[0].id) || ''; } catch (e) {}
        }
        if (!articleId) return res.status(404).json({ error: 'Could not find that blog.' });
        const data = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { id title handle body } } }`, { id: articleId });
        const art = data && data.node;
        if (!art || art.body == null) return res.status(404).json({ error: 'Could not read that blog.' });
        const body = String(art.body || '');
        const escHtmlA = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const artUrl = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/' + (art.handle || '');

        // GROUP (2+ searches merged into this blog) → add ONE new section that covers the MAIN topic AND
        // naturally works in EVERY grouped search. (The old logic rewrote one paragraph with ONE phrase, so
        // it dropped most of the group and sometimes skipped the main topic — this covers them all.)
        if (keywords.length > 1) {
          const ayCur = new Date().getFullYear(), ayNext = ayCur + 1;
          const mainKw = keywords[0];
          const others = keywords.slice(1);
          const ctx = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500);
          const gPrompt = `You are a UK wall-art & home-decor blog editor for About Wall Art. Add ONE new short section to the blog below.
The section's MAIN topic is "${mainKw}" — the section must clearly be about it, and the phrase "${mainKw}" must appear naturally.
It must ALSO naturally work in EACH of these related searches at least once (keep each one recognisable; light rewording is fine; NO keyword-stuffing): ${others.map(k => '"' + k + '"').join(', ')}.
Rules: warm first-person (I/we), genuinely useful and specific, UK spelling ("colour","decor" no accent), exactly 2 short paragraphs (2-3 sentences each). Do NOT repeat what the blog already says. NEVER use the words "elevate", "delve" or "showcase". AVOID a year unless genuinely necessary; if needed, use ${ayNext}, never an earlier year than ${ayCur}.
Return ONLY compact JSON: {"h2":"short SEO heading about ${mainKw}","paragraphs":["paragraph one","paragraph two"]}.
EXISTING BLOG (for context — do NOT repeat it):
"""${ctx}"""`;
          // The AI occasionally returns malformed JSON — retry up to 3 times before giving up (fixes the
          // intermittent "The AI did not return the section." error).
          let gh2 = '', gParas = [];
          for (let gAttempt = 0; gAttempt < 3 && !gParas.length; gAttempt++) {
            let gRaw = '';
            try { gRaw = await callClaudeText(gPrompt, 1800); } catch (e) { continue; }
            gRaw = gRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            const gm = gRaw.match(/\{[\s\S]*\}/); let go = {}; try { go = gm ? JSON.parse(gm[0]) : {}; } catch (e) { go = {}; }
            gh2 = String(go.h2 || '').trim();
            gParas = Array.isArray(go.paragraphs) ? go.paragraphs.map(p => String(p || '').trim()).filter(Boolean) : (go.paragraph ? [String(go.paragraph).trim()] : []);
          }
          if (!gParas.length) return res.status(500).json({ error: 'The AI did not return the section — please try again.' });
          const sectionHtml = (gh2 ? '<h2>' + escHtmlA(gh2) + '</h2>' : '') + gParas.map(p => '<p>' + escHtmlA(p) + '</p>').join('');
          const gNewBody = body + '\n' + sectionHtml;
          const gPreview = (gh2 ? gh2 + '\n\n' : '') + gParas.join('\n\n');
          return res.status(200).json({ success: true, mode: 'add', articleId, title: art.title, url: artUrl, originalParagraph: '', newParagraph: gPreview, newBody: gNewBody });
        }

        const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        const paras = []; let mm;
        while ((mm = pRe.exec(body)) !== null) { paras.push({ full: mm[0], text: mm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }); }
        const textParas = paras.filter(p => p.text.length > 40);
        const numbered = textParas.map((p, i) => (i + 1) + '. ' + p.text).slice(0, 40).join('\n');
        const kwList = keywords.join('", "');
        const prompt = `You are a UK wall-art & home-decor blog editor for About Wall Art. The blog below should naturally include the search phrase(s): "${kwList}". Pick the ONE existing paragraph that fits best and rewrite it so the exact phrase appears once, naturally — UK spelling ("colour","decor" no accent), same meaning, similar length, NO keyword-stuffing, NEVER the words "elevate/delve/showcase". AVOID a year unless genuinely necessary; if needed, use ${new Date().getFullYear() + 1} (never an earlier year). If NO paragraph fits, instead write ONE new short paragraph (2-3 sentences).
Return ONLY compact JSON: {"mode":"rewrite","index":N,"paragraph":"full rewritten paragraph as PLAIN text"} OR {"mode":"add","h2":"optional short heading","paragraph":"the new paragraph as PLAIN text"}.
PARAGRAPHS (numbered):
${numbered || '(no suitable paragraphs — use mode add)'}`;
        let aiText = ''; try { aiText = await callClaudeText(prompt, 1500); } catch (e) { return res.status(500).json({ error: 'AI failed: ' + e.message }); }
        const raw = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const m = raw.match(/\{[\s\S]*\}/);
        let o = {}; try { o = m ? JSON.parse(m[0]) : {}; } catch (e) { o = {}; }
        const newPara = String(o.paragraph || '').trim();
        if (!newPara) return res.status(500).json({ error: 'The AI did not return a paragraph.' });
        const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let mode = o.mode === 'add' ? 'add' : 'rewrite', originalText = '', newBody;
        if (mode === 'rewrite') {
          const i2 = parseInt(o.index, 10);
          const target = (Number.isInteger(i2) && i2 >= 1 && i2 <= textParas.length) ? textParas[i2 - 1] : null;
          if (target) { originalText = target.text; newBody = body.replace(target.full, '<p>' + escHtml(newPara) + '</p>'); }
          else { mode = 'add'; newBody = body + '\n<p>' + escHtml(newPara) + '</p>'; }
        } else {
          const h2 = String(o.h2 || '').trim();
          newBody = body + (h2 ? ('\n<h2>' + escHtml(h2) + '</h2>') : '') + '\n<p>' + escHtml(newPara) + '</p>';
        }
        return res.status(200).json({ success: true, mode, articleId, title: art.title, url: ('https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/' + (art.handle || '')), originalParagraph: originalText, newParagraph: newPara, newBody });
      }

      // ── ACTION: add-angle-apply ── Mae approved the preview. Backs up the current body, then writes
      // the new body to Shopify with articleUpdate. The folded keyword(s) are hidden from the rank panel.
      if (req.body.action === 'add-angle-apply') {
        const articleId = String(req.body.articleId || '').trim();
        const newBody = typeof req.body.newBody === 'string' ? req.body.newBody : '';
        const keywords = Array.isArray(req.body.keywords) ? req.body.keywords.map(k => String(k || '').trim()).filter(Boolean) : [];
        const rankKeywords = Array.isArray(req.body.rankKeywords) ? req.body.rankKeywords.map(k => String(k || '').trim()).filter(Boolean) : [];
        if (!articleId || !newBody) return res.status(400).json({ error: 'articleId and newBody required' });
        const data = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { id title handle body blog { handle } } } }`, { id: articleId });
        const art = data && data.node;
        if (!art) return res.status(404).json({ error: 'Blog not found.' });
        const backups = await readJsonFileSafe('data/blog-angle-backups.json', {});
        backups[articleId] = { title: art.title, handle: art.handle, originalBody: String(art.body || ''), keywords, at: new Date().toISOString() };
        await writeJsonFile('data/blog-angle-backups.json', backups, `Angle backup: ${art.title}`);
        const up = await shopifyGraphQL(`mutation($id:ID!,$article:ArticleUpdateInput!){ articleUpdate(id:$id, article:$article){ article{ id } userErrors{ field message } } }`, { id: articleId, article: { body: newBody } });
        const ue = (up && up.articleUpdate && up.articleUpdate.userErrors) || [];
        if (ue.length) return res.status(500).json({ error: ue.map(e => e.message).join('; ') });
        if (keywords.length) { try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(s => String(s).toLowerCase())); keywords.forEach(k => set.add(k.toLowerCase())); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Angle added — hide folded keyword(s)'); } catch (e) { } }
        // AUTO-PLACE the internal link on the OLD ranking page (no manual MPD step). BLOG → append a short
        // link paragraph (body backed up, undo-able). PRODUCT → add this blog to custom.linked_blogs (prev
        // value saved). Anything that fails falls back to the MPD "Add the link" queue so it is never lost.
        const blogUrl = String(req.body.blogUrl || '').trim() || ('https://aboutwallart.com/blogs/' + ((art.blog && art.blog.handle) || 'news-articles-home-decor-inspiration') + '/' + art.handle);
        const targetGid = articleId;
        const handleFromUrl = (u) => { try { return String(u || '').split('?')[0].replace(/\/+$/, '').split('/').pop().toLowerCase(); } catch (e) { return ''; } };
        let rankPages = Array.isArray(req.body.rankPages) ? req.body.rankPages : [];
        if (!rankPages.length && rankKeywords.length) rankPages = rankKeywords.map(k => ({ keyword: k, pageUrl: '' }));
        const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'tools.aboutwallart.com');
        const linkedBlogs = [], linkedProducts = [], queued = [];
        const queueInMpd = async (kw) => { try { const r = await fetch(origin + '/api/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim-to-registry', keyword: kw, url: blogUrl, intent: 'INFORMATIONAL' }) }); if (r.ok) queued.push(kw); } catch (e) {} };
        const escLink = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Place ONE in-body contextual link: pick the most relevant paragraph on the ranking page and link a
        // natural phrase (the keyword, or a close variant) to the target blog. Better SEO than a "Related
        // reading" line at the bottom. Returns the new body, or null if no good spot (caller falls back).
        async function placeContextLink(oldBody, kw, url) {
          const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi; const paras = []; let mm;
          while ((mm = pRe.exec(oldBody)) !== null) { paras.push({ full: mm[0], text: mm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }); }
          const textParas = paras.filter(p => p.text.length > 40 && !/<a\b/i.test(p.full)); // skip paragraphs that already have a link
          if (!textParas.length) return null;
          const numbered = textParas.map((p, i) => (i + 1) + '. ' + p.text).slice(0, 40).join('\n');
          const prompt = `You are adding ONE internal link inside a UK home-decor blog. The target page covers the search "${kw}". Pick the ONE paragraph below most relevant to it and rewrite it so a NATURAL phrase that includes "${kw}" (or a close natural variant) becomes the link anchor — it must read naturally, never forced, and there must be exactly ONE link. Keep the paragraph's meaning, length and UK spelling ("colour","decor" no accent). Wrap ONLY the anchor words in <<a>> and <</a>> (do not write any URL). If no paragraph is genuinely relevant, return {"mode":"none"}.
Return ONLY JSON: {"mode":"rewrite","index":N,"paragraph":"full rewritten paragraph as PLAIN text with <<a>>anchor<</a>> around the anchor words"} or {"mode":"none"}.
PARAGRAPHS (numbered):
${numbered}`;
          let raw = ''; try { raw = await callClaudeText(prompt, 1200); } catch (e) { return null; }
          raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, ''); const m = raw.match(/\{[\s\S]*\}/); let o = {}; try { o = m ? JSON.parse(m[0]) : {}; } catch (e) { return null; }
          if (o.mode !== 'rewrite') return null;
          const i2 = parseInt(o.index, 10); const target = (Number.isInteger(i2) && i2 >= 1 && i2 <= textParas.length) ? textParas[i2 - 1] : null;
          if (!target) return null;
          const pt = String(o.paragraph || ''); if (!/<<a>>[\s\S]+<<\/a>>/.test(pt)) return null;
          const htmlPara = '<p>' + escLink(pt).replace(/&lt;&lt;a&gt;&gt;([\s\S]*?)&lt;&lt;\/a&gt;&gt;/, '<a href="' + url + '">$1</a>') + '</p>';
          if (htmlPara.indexOf('<a href=') === -1) return null;
          return oldBody.replace(target.full, htmlPara);
        }
        for (const rp of rankPages) {
          const kw = String(rp && rp.keyword || '').trim(); const pageUrl = String(rp && rp.pageUrl || '').trim();
          if (!kw) continue;
          if (!pageUrl) { await queueInMpd(kw); continue; }
          const handle = handleFromUrl(pageUrl);
          try {
            if (pageUrl.includes('/products/')) {
              const pd = await shopifyGraphQL(`query($q:String!){ products(first:1, query:$q){ nodes{ id metafield(namespace:"custom", key:"linked_blogs"){ value } } } }`, { q: 'handle:' + handle });
              const prod = pd && pd.products && pd.products.nodes && pd.products.nodes[0];
              if (!prod) { await queueInMpd(kw); continue; }
              let list = []; try { list = JSON.parse((prod.metafield && prod.metafield.value) || '[]'); } catch (e) { list = []; }
              if (!Array.isArray(list)) list = [];
              if (!list.includes(targetGid)) {
                try { const lb = await readJsonFileSafe('data/linked-blogs-backups.json', {}); lb[prod.id] = { prev: (prod.metafield && prod.metafield.value) || '[]', at: new Date().toISOString() }; await writeJsonFile('data/linked-blogs-backups.json', lb, 'linked_blogs backup: ' + handle); } catch (e) {}
                const ms = await shopifyGraphQL(`mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{ field message } } }`, { mf: [{ ownerId: prod.id, namespace: 'custom', key: 'linked_blogs', type: 'list.article_reference', value: JSON.stringify([...list, targetGid]) }] });
                const mue = (ms && ms.metafieldsSet && ms.metafieldsSet.userErrors) || [];
                if (mue.length) { await queueInMpd(kw); continue; }
              }
              linkedProducts.push(kw);
            } else if (pageUrl.includes('/blogs/')) {
              const adq = await shopifyGraphQL(`query($q:String!){ articles(first:1, query:$q){ nodes{ id title body } } }`, { q: 'handle:' + handle });
              const old = adq && adq.articles && adq.articles.nodes && adq.articles.nodes[0];
              if (!old) { await queueInMpd(kw); continue; }
              const oldBody = String(old.body || '');
              if (oldBody.includes(blogUrl)) { linkedBlogs.push(kw); continue; }
              try { const bk = await readJsonFileSafe('data/blog-angle-backups.json', {}); if (!bk[old.id]) bk[old.id] = { title: old.title, handle, originalBody: oldBody, keywords: [kw], at: new Date().toISOString() }; await writeJsonFile('data/blog-angle-backups.json', bk, 'Old-page link backup: ' + handle); } catch (e) {}
              // In-body contextual link (keyword as natural anchor). Fall back to a short natural sentence only if no paragraph fits.
              let newOldBody = await placeContextLink(oldBody, kw, blogUrl);
              if (!newOldBody) newOldBody = oldBody + '\n<p>For more on <a href="' + blogUrl + '">' + escLink(kw) + '</a>, see our full guide.</p>';
              const up2 = await shopifyGraphQL(`mutation($id:ID!,$article:ArticleUpdateInput!){ articleUpdate(id:$id, article:$article){ article{ id } userErrors{ field message } } }`, { id: old.id, article: { body: newOldBody } });
              const u2e = (up2 && up2.articleUpdate && up2.articleUpdate.userErrors) || [];
              if (u2e.length) { await queueInMpd(kw); continue; }
              linkedBlogs.push(kw);
            } else { await queueInMpd(kw); }
          } catch (e) { await queueInMpd(kw); }
        }
        return res.status(200).json({ success: true, articleId, title: art.title, linkedBlogs, linkedProducts, queued });
      }

      // ── ACTION: add-angle-undo ── restore a blog's body from the backup taken before the angle edit.
      if (req.body.action === 'add-angle-undo') {
        const articleId = String(req.body.articleId || '').trim();
        if (!articleId) return res.status(400).json({ error: 'articleId required' });
        const backups = await readJsonFileSafe('data/blog-angle-backups.json', {});
        const b = backups[articleId];
        if (!b) return res.status(404).json({ error: 'No backup for that blog.' });
        const up = await shopifyGraphQL(`mutation($id:ID!,$article:ArticleUpdateInput!){ articleUpdate(id:$id, article:$article){ userErrors{ message } } }`, { id: articleId, article: { body: b.originalBody } });
        const ue = (up && up.articleUpdate && up.articleUpdate.userErrors) || [];
        if (ue.length) return res.status(500).json({ error: ue.map(e => e.message).join('; ') });
        delete backups[articleId];
        await writeJsonFile('data/blog-angle-backups.json', backups, `Angle undo: ${b.title || articleId}`);
        if (b.keywords && b.keywords.length) { try { const pd = await readJsonFileSafe('data/gsc-performing-dismissed.json', []); const set = new Set((Array.isArray(pd) ? pd : []).map(s => String(s).toLowerCase())); b.keywords.forEach(k => set.delete(String(k).toLowerCase())); await writeJsonFile('data/gsc-performing-dismissed.json', [...set], 'Angle undo — restore keyword(s)'); } catch (e) { } }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: clean-keywords ── (LIGHT PASS: derive the real keyword only, NO clash check)
      // Input: { titles: ["...", ...] } — one batch (the frontend loops in batches). Saves NOTHING.
      if (req.body.action === 'clean-keywords') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles.map(t => String(t || '').trim()).filter(Boolean) : [];
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        const titlesBlock = titles.map((t, j) => `T${j + 1}. ${t}`).join('\n');
        const prompt = `You are an SEO editor for aboutwallart.com (wall art + home decor).
For EACH blog title below, give the TRUE main keyword a real person types into Google.
CRUCIAL: keep the QUALIFIER that defines the intent — e.g. "gallery wall WITHOUT NAILS", "biophilic design in SMALL SPACES", "wall art FOR KIDS". Never strip it to the head topic, and NEVER just repeat the long title. 2 to 6 words, UK spelling ("colour", "decor" no accent), lowercase.

TITLES:
${titlesBlock}

Return ONLY a JSON array, one object per title in order, exactly:
[{"t":1,"keyword":""}]`;
        const raw = await callClaudeText(prompt, 2000, 'claude-haiku-4-5-20251001');
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const m = cleaned.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('Could not read the keyword result');
        let arr;
        try { arr = JSON.parse(m[0]); }
        catch (e) { throw new Error('Keyword result was not in a readable format'); }
        const results = titles.map((t, j) => {
          const o = arr.find(x => Number(x.t) === j + 1) || arr[j] || {};
          return { title: t, keyword: String(o.keyword || '').trim() };
        });
        return res.status(200).json({ success: true, results });
      }

      // ── ACTION: save-keywords ── (writes ONLY the Keyword column — used by the light pass)
      // Input: { rows: [{ title, keyword }] }. Touches nothing else (no clash/checked columns).
      if (req.body.action === 'save-keywords') {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ error: 'rows array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const byTitle = new Map(rows.filter(r => r.keyword).map(r => [norm(r.title), r]));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (norm(cols[1]) === 'blog post title') return line; // header untouched
          const key = norm(cols[1]);
          const r = byTitle.get(key);
          if (r && !done.has(key)) {
            cols[0] = r.keyword;
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        const out = updated.join('\n');
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Clean keywords (light pass): ${done.size} rows`);
        return res.status(200).json({ success: true, updated: done.size });
      }

      // ── ACTION: competitor-check ── (pre-write brief: SerpAPI top 3 → analyse → brief)
      // Input: { keyword, manualUrls?: [] }. Detects SerpAPI out-of-credits → { outOfCredits:true }.
      if (req.body.action === 'competitor-check') {
        const keyword = String(req.body.keyword || '').trim();
        const manualUrls = Array.isArray(req.body.manualUrls) ? req.body.manualUrls.map(u => String(u || '').trim()).filter(Boolean) : [];
        if (!keyword && !manualUrls.length) return res.status(400).json({ error: 'keyword or manualUrls required' });

        let competitors = [];
        if (manualUrls.length) {
          competitors = manualUrls.slice(0, 3).map((u, i) => ({ position: i + 1, title: '', url: u }));
        } else {
          const SERPAPI_KEY = process.env.SERPAPI_KEY;
          if (!SERPAPI_KEY) return res.status(200).json({ success: false, error: 'SERPAPI_KEY not configured' });
          let data;
          try {
            const r = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`);
            data = await r.json();
          } catch (e) {
            return res.status(200).json({ success: false, error: 'Could not reach SerpAPI: ' + e.message });
          }
          // SerpAPI signals problems in data.error (out of searches/credits). Before dead-ending, try Scrappa.
          let organic = data.error ? [] : (data.organic_results || []);
          if (!organic.length && process.env.SCRAPPA_KEY) {
            // Scrappa's Google search can return a transient 503/429 — retry a few times before giving up.
            for (let attempt = 1; attempt <= 3 && !organic.length; attempt++) {
              try {
                const sr = await fetch(`https://scrappa.co/api/search?query=${encodeURIComponent(keyword)}&gl=gb&hl=en`, { headers: { 'x-api-key': process.env.SCRAPPA_KEY } });
                if (sr.status === 503 || sr.status === 429) {
                  const ra = parseInt(sr.headers.get('retry-after') || '0', 10);
                  const waitMs = Math.min((ra ? ra * 1000 : 1500) * attempt, 5000);
                  console.warn('[Blog competitor] Scrappa HTTP ' + sr.status + ' (transient) — retry ' + attempt + '/3 in ' + waitMs + 'ms');
                  if (attempt < 3) await new Promise(r => setTimeout(r, waitMs));
                  continue;
                }
                const sd = await sr.json();
                // Scrappa returns rows as `url` (not `link`) and array `organic_results` OR `results` — normalise.
                const rows = sd.organic_results || sd.results || [];
                if (Array.isArray(rows) && rows.length) { organic = rows.map(r => ({ link: r.link || r.url, title: r.title || '' })); console.log('[Blog competitor] Scrappa fallback used — ' + organic.length + ' results (attempt ' + attempt + ')'); }
                else { console.error('[Scrappa] no rows. HTTP', sr.status, '— body:', JSON.stringify(sd).slice(0, 300)); break; }
              } catch (e) { console.error('[Scrappa] Error:', e); break; }
            }
          }
          if (!organic.length && data.error) {
            const e = String(data.error).toLowerCase();
            const outOfCredits = e.includes('run out') || e.includes('ran out') || e.includes('exceeded') || e.includes('no searches') || e.includes('out of searches') || e.includes('plan') || e.includes('limit');
            return res.status(200).json({ success: false, outOfCredits, error: data.error });
          }
          const isMine = (u) => /aboutwallart\.com/i.test(u || '');
          competitors = organic.filter(o => o.link && !isMine(o.link)).slice(0, 3).map((o, i) => ({ position: i + 1, title: o.title || '', url: o.link }));
          if (!competitors.length) {
            return res.status(200).json({ success: false, needsManual: true, error: 'No competitors found for this keyword — paste 3 competitor URLs.' });
          }
        }

        // Analyse each competitor page (headings + rough word count). Best-effort — never throws.
        const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const analyzed = [];
        for (const c of competitors) {
          try {
            const pr = await fetch(c.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AWA-Bot/1.0)' } });
            const html = await pr.text();
            const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 3);
            const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 15);
            const body = strip(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
            analyzed.push({ url: c.url, title: c.title, h1, h2, words: body ? body.split(' ').length : 0 });
          } catch (e) {
            analyzed.push({ url: c.url, title: c.title, h1: [], h2: [], words: 0, error: 'could not fetch page' });
          }
        }

        let brief;
        try { brief = await generateCompetitorBrief(keyword || (manualUrls[0] || ''), analyzed); }
        catch (e) { return res.status(200).json({ success: false, error: 'Could not build the brief — ' + e.message, competitors: analyzed }); }
        return res.status(200).json({ success: true, keyword, competitors: analyzed, brief });
      }

      // ── ACTION: save-month ── (tag picked blogs with a month, e.g. "2026-03"). New column MONTH (10th).
      // Input: { titles: [...], month: "YYYY-MM" }. Empty month clears the tag.
      if (req.body.action === 'save-month') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles : [];
        const month = String(req.body.month || '').trim();
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const want = new Set(titles.map(norm));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (norm(cols[1]) === 'blog post title') {
            while (cols.length < 10) cols.push('');
            if (!cols[9]) cols[9] = 'MONTH';
            return cols.map(esc).join(',');
          }
          const key = norm(cols[1]);
          if (want.has(key) && !done.has(key)) {
            while (cols.length < 10) cols.push('');
            cols[9] = month;
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        const out = updated.join('\n');
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Assign month ${month || '(cleared)'}: ${done.size} blogs`);
        return res.status(200).json({ success: true, updated: done.size, month });
      }

      // ── ACTION: save-brief ── (persist a competitor brief per blog so it survives reload + works across days)
      // Input: { title, keyword, brief }. Stored in data/blog-briefs.json keyed by lowercased title.
      if (req.body.action === 'save-brief') {
        const t = String(req.body.title || '').trim();
        const kw = String(req.body.keyword || '').trim();
        const brief = req.body.brief && typeof req.body.brief === 'object' ? req.body.brief : null;
        if (!t) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-briefs.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { keyword: kw, brief, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-briefs.json', JSON.stringify(map, null, 2), sha, `Save competitor brief: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-draft ── (persist a written blog so it survives reload / a reset)
      // Input: { title, draft:{bodyHtml,featuredBase,authority,youtube} }. Stored in data/blog-drafts.json keyed by lowercased title.
      if (req.body.action === 'save-draft') {
        const t = String(req.body.title || '').trim();
        const draft = req.body.draft && typeof req.body.draft === 'object' ? req.body.draft : null;
        if (!t || !draft) return res.status(400).json({ error: 'title and draft required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { ...draft, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-drafts.json', JSON.stringify(map, null, 2), sha, `Save blog draft: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: pick-products ── (Products batch, chunk 1: topic-matched products with ALL images, split About Wall Art vs Collective)
      // Input: { keyword, title }. Output: { success, awa:[{gid,title,vendor,handle,url,sku,images:[url]}], collective:[...] }
      if (req.body.action === 'pick-products') {
        const kw = String(req.body.keyword || '').trim();
        const ti = String(req.body.title || '').trim();
        if (!kw && !ti) return res.status(400).json({ error: 'keyword or title required' });
        const AWA_VENDOR = 'About Wall Art';
        // Every blog topic (room / style / colour / occasion) has a matching collection — and a trend PAGE
        // shares its handle with a collection that holds BOTH the wall-art prints AND the partner items.
        // So take the LAST path segment of each cluster URL as a collection handle (works for /collections/<h> AND /pages/<h>).
        let handles = [];
        try {
          const clusters = await generateClusters(kw || ti, ti || kw);
          const tags = [clusters.primaryCluster, ...(clusters.supporting || [])].filter(Boolean);
          for (const tag of tags) {
            const url = CLUSTER_URLS[tag];
            if (!url) continue;
            const h = url.split('?')[0].replace(/\/$/, '').split('/').pop();
            if (h && !handles.includes(h)) handles.push(h);
          }
        } catch (e) { /* fall back below */ }
        // If she picked a trend collection for this blog, use ONLY that collection so EVERY spot
        // (wall-art AND partner) fills from the one collection she chose — no topic guessing mixed in.
        const chosenColl = String(req.body.collectionHandle || '').trim();
        if (chosenColl) handles = [chosenColl];
        if (!handles.length) handles = ['framed-wall-pictures-for-living-room'];

        const seen = new Set();
        const awa = [], coll = [];
        const toProd = (n) => {
          const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
          const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
          return { gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images };
        };
        const PFIELDS = 'id title vendor handle productType status onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        for (const handle of handles) {
          let data;
          try {
            data = await shopifyGraphQL(
              `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:50){ edges{ node{ ${PFIELDS} } } } } }`,
              { handle }
            );
          } catch (e) { continue; }
          const c = data && data.collectionByHandle;
          if (!c || !c.products) continue;
          for (const e of c.products.edges) {
            const n = e.node;
            if (n.status && n.status !== 'ACTIVE') continue; // only ACTIVE products may be picked
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            const p = toProd(n);
            if (p.vendor === AWA_VENDOR) awa.push(p); else coll.push(p);
          }
        }
        // Guarantee prints: if the topic collection(s) gave no About Wall Art prints, fall back to the
        // Living Room Pictures collection and match prints by title to the blog topic (Mae's rule).
        if (!awa.length) {
          const term = (kw || ti).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)[0] || '';
          try {
            const fb = await shopifyGraphQL(
              `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:60){ edges{ node{ ${PFIELDS} } } } } }`,
              { handle: 'framed-wall-pictures-for-living-room' }
            );
            const fc = fb && fb.collectionByHandle;
            const prints = (fc && fc.products ? fc.products.edges : []).map(e => e.node).filter(n => n.vendor === AWA_VENDOR && (!n.status || n.status === 'ACTIVE'));
            const matched = term ? prints.filter(n => (n.title || '').toLowerCase().includes(term)) : [];
            const use = (matched.length ? matched : prints).slice(0, 8);
            for (const n of use) { if (seen.has(n.id)) continue; seen.add(n.id); awa.push(toProd(n)); }
          } catch (e) { /* best effort */ }
        }
        // Match partner items to the blog's NEEDS: topic collection (done above) → the TYPE needed → highest price.
        // Frontend sends needs: [{ topic, type, keys:[...] }]. We return one product per need, aligned in order.
        const needs = Array.isArray(req.body.needs) ? req.body.needs : [];
        const pool = coll.slice().sort((a, b) => b.price - a.price); // highest price first
        const usedC = new Set();
        let collectiveByNeed;
        if (needs.length) {
          collectiveByNeed = needs.map(nd => {
            const keys = Array.isArray(nd.keys) ? nd.keys.map(k => String(k).toLowerCase()).filter(Boolean) : [];
            let p = null;
            if (keys.length) p = pool.find(x => !usedC.has(x.gid) && keys.some(k => ((x.productType || '') + ' ' + (x.title || '')).toLowerCase().includes(k)));
            if (!p && !keys.length) p = pool.find(x => !usedC.has(x.gid)); // "choose freely" → best remaining
            if (p) usedC.add(p.gid);
            return p || null; // no match for this type → null (frontend shows "add by SKU"), never a wrong type
          });
        } else {
          // no needs sent — a few varied highest-price items as a fallback
          const byType = {};
          for (const p of coll) { const t = p.productType || 'Other'; if (!byType[t] || p.price > byType[t].price) byType[t] = p; }
          collectiveByNeed = Object.values(byType).sort((a, b) => b.price - a.price).slice(0, 4);
        }
        // collectivePool = every partner (non-wall-art) product in the collection, so the tool page can
        // show a "choose from this collection" browse under each partner spot (with pictures).
        return res.status(200).json({ success: true, awa: awa.slice(0, 40), collective: collectiveByNeed, collectivePool: coll.slice(0, 60) });
      }

      // ── ACTION: search-wall-art ── (Pick freely: search the WHOLE About Wall Art print range by a word)
      // Input: { term }. Output: { success, products:[{gid,title,vendor,handle,url,sku,images:[url]}] }
      if (req.body.action === 'search-wall-art') {
        const term = String(req.body.term || '').trim().replace(/["\\]/g, '');
        const AWA_VENDOR = 'About Wall Art';
        const PFIELDS = 'id title vendor handle productType status onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        const q = "status:active vendor:'About Wall Art'" + (term ? ' ' + term : '');
        const out = [];
        try {
          const data = await shopifyGraphQL(
            `query($q:String!){ products(first:40, query:$q){ edges{ node{ ${PFIELDS} } } } }`,
            { q }
          );
          const edges = (data && data.products && data.products.edges) || [];
          for (const e of edges) {
            const n = e.node;
            if (n.vendor !== AWA_VENDOR) continue;
            if (n.status && n.status !== 'ACTIVE') continue;
            const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
            const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
            out.push({ gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images });
          }
        } catch (e) { return res.status(200).json({ success: false, error: 'Search failed — try another word.' }); }
        return res.status(200).json({ success: true, products: out });
      }

      // ── ACTION: lookup-product ── (Add a product by its print-files SKU, or by product name)
      // Input: { sku }. Output: { success, product:{gid,title,vendor,handle,url,sku,images:[url]} }
      if (req.body.action === 'lookup-product') {
        const q = String(req.body.sku || '').trim();
        if (!q) return res.status(400).json({ error: 'sku required' });
        const PFIELDS = 'id title vendor handle productType onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        const toProduct = (n) => {
          const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
          const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
          return { gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images };
        };
        const ql = q.toLowerCase();
        // 1) EXACT print-files SKU only. Fetch a few (the search can prefix-match, e.g. LIVLND1 → LIVLND10)
        //    then keep ONLY the one whose SKU equals what was typed.
        try {
          const d = await shopifyGraphQL(`query($q:String!){ products(first:20, query:$q){ edges{ node{ ${PFIELDS} } } } }`, { q: 'metafield:custom.sku_for_print_files:' + q });
          const nodes = (d.products && d.products.edges || []).map(e => e.node);
          const exact = nodes.find(n => ((n.sku && n.sku.value) || '').toLowerCase() === ql);
          if (exact) return res.status(200).json({ success: true, product: toProduct(exact) });
        } catch (e) { /* try name next */ }
        // 2) name search — only accept a result whose TITLE actually contains what was typed (no unrelated hits).
        try {
          const d = await shopifyGraphQL(`query($q:String!){ products(first:10, query:$q){ edges{ node{ ${PFIELDS} } } } }`, { q: 'title:*' + q.replace(/[*"()]/g, ' ').trim() + '*' });
          const nodes = (d.products && d.products.edges || []).map(e => e.node);
          const hit = nodes.find(n => (n.title || '').toLowerCase().includes(ql));
          if (hit) return res.status(200).json({ success: true, product: toProduct(hit) });
        } catch (e) { /* not found */ }
        return res.status(200).json({ success: false, error: 'No exact match for "' + q + '". Check the print-files SKU, or paste the full product name.' });
      }

      // ── ACTION: product-image ── (Copy image: fetch a Shopify image and return it as base64 for the clipboard)
      // Input: { url }. Output: { ok, dataBase64, mime }
      if (req.body.action === 'product-image') {
        const url = String(req.body.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'valid image url required' });
        try {
          const ir = await fetch(url);
          if (!ir.ok) return res.status(200).json({ ok: false, error: 'image fetch failed: ' + ir.status });
          const mime = ir.headers.get('content-type') || 'image/jpeg';
          const dataBase64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
          return res.status(200).json({ ok: true, mime, dataBase64 });
        } catch (e) {
          return res.status(200).json({ ok: false, error: e.message });
        }
      }

      // ── ACTION: save-products ── (persist the product picks per blog so they survive reload / a reset — no re-fetch, no AI)
      // Input: { title, data }. Stored in data/blog-products.json keyed by lowercased title.
      if (req.body.action === 'save-products') {
        const t = String(req.body.title || '').trim();
        const data = req.body.data && typeof req.body.data === 'object' ? req.body.data : null;
        if (!t || !data) return res.status(400).json({ error: 'title and data required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-products.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { ...data, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-products.json', JSON.stringify(map, null, 2), sha, `Save blog product picks: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: style-bible ── reads Mae's uploaded style photo + her short quiz and writes the rich
      // STYLE BIBLE that leads every image prompt for this blog. Vision call. Nothing is saved server-side
      // here — the tool keeps the bible on the draft and the photo in the browser.
      // Input: { image (base64, no data: prefix), mediaType, quiz:{busy,arch,light,white,extra}, collectiveTitles:[], avoid:[] }
      // Output: { success, bible }
      if (req.body.action === 'style-bible') {
        const imageB64 = String(req.body.image || '').replace(/^data:[^;]+;base64,/, '').trim();
        const mediaType = String(req.body.mediaType || 'image/jpeg');
        const quiz = (req.body.quiz && typeof req.body.quiz === 'object') ? req.body.quiz : {};
        const collectiveTitles = Array.isArray(req.body.collectiveTitles) ? req.body.collectiveTitles.filter(Boolean) : [];
        const avoid = Array.isArray(req.body.avoid) ? req.body.avoid.filter(Boolean) : [];
        if (!imageB64) return res.status(400).json({ error: 'A style photo is required.' });

        const pick = (v) => (v && String(v).trim() && !/^skip$/i.test(v)) ? String(v).trim() : '';
        const overrideLines = [];
        if (pick(quiz.busy))  overrideLines.push(`How busy the decor should be: ${pick(quiz.busy)}`);
        if (pick(quiz.arch))  overrideLines.push(`Building / architecture style: ${pick(quiz.arch)}`);
        if (pick(quiz.light)) overrideLines.push(`Lighting mood: ${pick(quiz.light)}`);
        if (pick(quiz.white)) overrideLines.push(`Light colour / white balance: ${pick(quiz.white)}`);
        if (pick(quiz.extra)) overrideLines.push(`Extra style notes from me: ${pick(quiz.extra)}`);
        const overrides = overrideLines.length ? overrideLines.join('\n') : '(none — take everything from the photo)';
        const avoidExtra = avoid.length ? avoid.join(', ') : '';

        const biblePrompt = `You are an interior-design art director. Look at the attached room photo and write a STYLE BIBLE that will guide AI-generated lifestyle images for a home-decor blog. The bible describes the STYLE ONLY — it must apply to ANY room (bedroom, hallway, dining, nursery…), never just the room in the photo.

Write it in EXACTLY this shape, each line starting with the label and a dash, plain text (no markdown, no ** **):

Style name: <2-4 word name for this look>
- Palette: <wall colours, wood tones, main and accent colours — be specific about warmth/coolness>
- Furniture: <general direction + materials/finishes; do NOT lock to exact pieces — say "vary the actual pieces from image to image">
- Lighting: <fixture styles + the light quality>
- Plants: <the greenery direction, or "none" if the look has none>
- Wall decor: <what goes on walls — shelves, mirrors, sconces, woven panels — and always include "NO framed prints as default (the shop's wall art is added separately as product photos)">
- Ceramics/objects: <vases, vessels, decorative objects>
- Textiles: <rugs, cushions, throws, linens and their textures>
- Mood: <2-4 words of overall feeling>
- White balance: <one plain sentence, e.g. "Neutral white balance — clean true whites, no yellow or warm cast">
- No: <comma-separated avoid list: things that would break this style${avoidExtra ? `; ALWAYS include these personal dislikes: ${avoidExtra}` : ''}>

RULES:
- Describe the LOOK, not exact furniture pieces — being too specific makes every image rebuild the same room. Set palette + materials + finishes + a general furniture direction, and say to vary the actual pieces per image.
- Room-agnostic: never tie it to the room in the photo; add "vary the pieces to suit each room".
- Keep each line to one rich sentence or a tight comma list.

MY QUIZ ANSWERS (these OVERRIDE the photo where given; where blank, read it from the photo):
${overrides}

After the bible lines, add these two blocks exactly:

Quiz notes: ${overrideLines.length ? overrideLines.map(l => l.replace(/^.*?: /, '')).join(' · ') : 'none'}
${collectiveTitles.length ? `Featured products on this blog:\n${collectiveTitles.map(t => '- ' + t).join('\n')}` : 'Featured products on this blog: (none listed)'}

Output ONLY the bible text, nothing before or after.`;

        try {
          const bible = await callClaudeVision(biblePrompt, imageB64, mediaType, 1600);
          if (!bible) return res.status(200).json({ success: false, error: 'Could not read the photo — try a clearer room photo.' });
          return res.status(200).json({ success: true, bible });
        } catch (e) {
          return res.status(200).json({ success: false, error: e.message });
        }
      }

      // ── ACTION: section-shows ── reads the finished blog body and returns, per H2 image, a short SHOW
      // (what the image must illustrate — NO scene description) + a style flag, so the tool can wrap each
      // with the style bible + people rules. The blog-writer is NOT touched; this only reads its output.
      // Input: { title }  Output: { success, shows:[{filename, section, kind, ratio, show, flag}] }
      if (req.body.action === 'section-shows') {
        const ssT = String(req.body.title || '').trim();
        if (!ssT) return res.status(400).json({ error: 'title required' });
        // Prefer the blog body the tool just sent (it has any un-saved edits); fall back to the saved draft.
        let draft = (req.body.draft && typeof req.body.draft === 'object' && req.body.draft.bodyHtml) ? req.body.draft : null;
        if (!draft) {
          let draftsMap = {};
          try { const f = await getGitHubFile('data/blog-drafts.json'); draftsMap = JSON.parse(f.content || '{}'); } catch (e) { draftsMap = {}; }
          draft = draftsMap[ssT.toLowerCase()] || null;
        }
        if (!draft || !draft.bodyHtml) return res.status(200).json({ success: false, error: 'Write and save the blog first.' });

        // Pull each [[IMG|slug|ratio|kind|prompt]] with the H2 it sits under.
        const body = String(draft.bodyHtml);
        const re = /<h2[^>]*>([\s\S]*?)<\/h2>|\[\[IMG\|([^|]*)\|([^|]*)\|([^|]*)\|([\s\S]*?)\]\]/g;
        let m, sec = ''; const markers = [];
        while ((m = re.exec(body)) !== null) {
          if (m[1] !== undefined) sec = m[1].replace(/<[^>]+>/g, '').trim();
          else markers.push({ filename: (m[2] || '').trim(), ratio: (m[3] || '').trim() || '3:2', kind: (m[4] || '').trim() || 'photo', section: sec, prompt: (m[5] || '').trim() });
        }
        if (!markers.length) return res.status(200).json({ success: true, shows: [] });

        const listTxt = markers.map((im, i) => `${i + 1}. SECTION: "${im.section}" [${im.kind}] — original note: ${im.prompt.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
        const showPrompt = `You are planning images for a home-decor blog on aboutwallart.com. For each numbered section below, write a short SHOW line — ONE or TWO sentences describing WHAT the image must illustrate to prove that section's point (the action / subject / what the reader should understand). Do NOT describe the room, colours, furniture, or styling — a separate style bible handles all of that. Just say what to SHOW.

Also set a FLAG for each, deciding how the style bible applies:
- FOLLOW  → a normal styled room photo (default for almost everything).
- BREAK   → the image must deliberately show a decorating MISTAKE or a plain/contrasting look that goes AGAINST the style (only when the section is literally about what NOT to do).
- USE:<style name>  → the section is about a SPECIFIC different named interior style (e.g. a "styles you can try" section with Coastal / Industrial / Japandi): put that style's name here so the image uses that style instead of the bible.
- WALLART  → the section's main subject IS wall art / prints / artwork: the image should be built around a specific piece of the shop's wall art.
- INFOGRAPHIC → keep for genuine comparisons/steps/stats only (white background, black text, no people).

Sections:
${listTxt}

Return ONLY a JSON array, one object per section IN ORDER, each: {"show":"...","flag":"FOLLOW|BREAK|USE:<style>|WALLART|INFOGRAPHIC"}. Nothing else.`;

        try {
          const raw = await callClaudeText(showPrompt, 2000);
          const jsonStr = (raw.match(/\[[\s\S]*\]/) || [raw])[0];
          let arr = [];
          try { arr = JSON.parse(jsonStr); } catch (e) { arr = []; }
          const shows = markers.map((im, i) => {
            const a = arr[i] || {};
            let flag = String(a.flag || '').trim() || (im.kind === 'infographic' ? 'INFOGRAPHIC' : 'FOLLOW');
            // never override a genuine infographic marker back to a photo
            if (im.kind === 'infographic' && !/^INFOGRAPHIC/i.test(flag)) flag = 'INFOGRAPHIC';
            return { filename: im.filename, section: im.section, kind: im.kind, ratio: im.ratio, show: String(a.show || im.section || '').trim(), flag };
          });
          return res.status(200).json({ success: true, shows });
        } catch (e) {
          // Fallback: no AI — hand back the sections with their own notes as the SHOW so the tool still works.
          const shows = markers.map(im => ({ filename: im.filename, section: im.section, kind: im.kind, ratio: im.ratio, show: im.section, flag: im.kind === 'infographic' ? 'INFOGRAPHIC' : 'FOLLOW' }));
          return res.status(200).json({ success: true, shows });
        }
      }

      // ── ACTION: finish-blog ── (Batch B: fetch the saved images from Shopify Files, drop the scene photos + the 6
      // product blocks into the blog body, and save the finished body so the Publish step can use it.)
      // Input: { title, keyword }. Output: { success, report:[{ok,label,fix}], finishedBody, featuredUrl }.
      if (req.body.action === 'finish-blog') {
        const fbT = String(req.body.title || '').trim();
        const fbKwIn = String(req.body.keyword || '').trim();
        if (!fbT) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

        // 1) load the draft (the blog body) + the saved product picks
        let draftsMap = {}, draftsSha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); draftsMap = JSON.parse(f.content || '{}'); draftsSha = f.sha; } catch (e) { draftsMap = {}; }
        const draft = draftsMap[fbT.toLowerCase()];
        if (!draft || !draft.bodyHtml) return res.status(200).json({ success: false, error: 'No written blog found for "' + fbT + '". Write the blog first (step 2).' });
        // Unique per-blog tag so a reused image name never grabs an OLD blog's image. Empty for older blogs
        // (their images were saved with plain names), so those keep working exactly as before.
        const blogCode = await stableBlogCode(fbKwIn || draft.keyword || '', draft.blogCode);
        const codeSuf = blogCode ? '-' + blogCode : '';
        let prodMap = {};
        try { const f = await getGitHubFile('data/blog-products.json'); prodMap = JSON.parse(f.content || '{}'); } catch (e) { prodMap = {}; }
        const prods = prodMap[fbT.toLowerCase()] || { awa: [], needs: [], collective: [], extra: [], selected: {}, chosen: {} };
        prods.selected = prods.selected || {}; prods.chosen = prods.chosen || {};

        const fbKw = fbKwIn || prods.keyword || '';
        const report = [];
        const escF = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // the plain name inside a Shopify file URL (lowercased, no extension, no ?v= version)
        const urlName = (u) => { try { const seg = (u || '').split('/files/').pop() || ''; return decodeURIComponent(seg.split('?')[0].replace(/\.[a-z0-9]+$/i, '')).toLowerCase(); } catch (e) { return ''; } };
        // Find a saved image by name. The Files search is fuzzy (word-based), so we ALWAYS filter for the real match.
        // exact=false → the file name must EQUAL the wanted name; prefix=true → it must START WITH it (used for the
        // featured image, so everything after "-option" is ignored).
        async function findImage(name, prefix) {
          const want = String(name || '').toLowerCase();
          if (!want) return null;
          let data;
          try { data = await shopifyGraphQL(`query($q:String!){ files(first:40, query:$q){ edges{ node{ __typename ... on MediaImage { image{ url } } } } } }`, { q: 'filename:' + want }); }
          catch (e) { return null; }
          const nodes = (data && data.files && data.files.edges || []).map(e => e.node).filter(n => n && n.image && n.image.url);
          const hit = nodes.find(n => { const nm = urlName(n.image.url); return prefix ? (nm.indexOf(want) === 0) : (nm === want); });
          return hit ? hit.image.url : null;
        }

        // Same TYPE map the picker uses (to place any add-by-SKU extras into the best free spot).
        const SVR_TYPES = [
          { re: /plant|greenery|fern|succulent|tree|foliage|palm|monstera/, keys: ['plant','fern','succulent','tree','foliage','palm','greenery'] },
          { re: /\bpot\b|planter/, keys: ['pot','planter'] },
          { re: /lamp|light|pendant|sconce|lantern/, keys: ['lamp','light','pendant','sconce','lantern'] },
          { re: /chair|stool|\bseat|sofa|armchair|bench|ottoman/, keys: ['chair','sofa','bench','stool','armchair','ottoman'] },
          { re: /table|desk|console|sideboard|nightstand|bedside/, keys: ['table','desk','console','sideboard'] },
          { re: /\brug\b|carpet/, keys: ['rug','carpet'] },
          { re: /basket|storage|box/, keys: ['basket','storage'] },
          { re: /mirror/, keys: ['mirror'] },
          { re: /vase|vessel/, keys: ['vase','vessel'] },
          { re: /shelf|shelving|ladder/, keys: ['shelf','shelving','ladder'] },
          { re: /cushion|pillow|throw|blanket|textile|linen/, keys: ['cushion','pillow','throw','blanket'] },
          { re: /clock/, keys: ['clock'] },
          { re: /candle/, keys: ['candle'] }
        ];
        const topicKeys = (topic) => { const s = (topic || '').toLowerCase(); for (const t of SVR_TYPES) if (t.re.test(s)) return t.keys; return []; };
        const extraFitsSpot = (topic, p) => { const keys = topicKeys(topic); if (!keys.length) return true; const hay = ((p.productType || '') + ' ' + (p.title || '')).toLowerCase(); return keys.some(k => hay.includes(k)); };
        const slugSku = (p) => String(p.sku || p.handle || 'product').toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-');

        // Build one product block: About Wall Art → the static lifestyle photo saved in Files;
        // Collective (any other vendor) → a LIVE block that hides itself if the product ever goes unavailable.
        // Same block your published blogs use: a centred, full-width image that links to the product,
        // with a black "Shop Here" button under it. Wall art = the saved lifestyle photo; Collective = the
        // product's chosen photo (and it quietly hides itself if that product ever goes unavailable).
        async function productBlock(p) {
          const isAwa = (p.vendor === 'About Wall Art');
          let imgUrl = '';
          if (isAwa) {
            const name = slugSku(p) + codeSuf + '-lifestyle';
            imgUrl = await findImage(name, false);
            if (!imgUrl) return { ok: false, label: 'Wall art photo not found: ' + name, fix: 'Make the lifestyle photo for "' + p.title + '" and save it in Shopify named "' + name + '", then press again.' };
          } else {
            imgUrl = (prods.chosen && prods.chosen[p.gid]) || (p.images && p.images[0]) || '';
            if (!imgUrl) return { ok: false, label: 'No image chosen for: ' + p.title, fix: 'Open “Pick products”, choose an image for "' + p.title + '", save, then press again.' };
            imgUrl = imgUrl + (imgUrl.indexOf('?') >= 0 ? '&' : '?') + 'width=1024';
          }
          const url = p.url || ('https://aboutwallart.com/products/' + (p.handle || ''));
          const alt = altMap['prod:' + p.gid] || ((fbKw ? fbKw + ' — ' : '') + p.title + (isAwa ? ' styled in a room' : ''));
          const inner =
            '<a rel="noopener" href="' + escF(url) + '" target="_blank"><img style="max-width: 1024px; width: 100%; height: auto;" alt="' + escF(alt) + '" src="' + escF(imgUrl) + '"></a>' +
            '<br>' +
            '<a style="display: inline-block; margin-top: 15px; padding: 12px 30px; background-color: #000; color: #fff; text-decoration: none; border-radius: 4px;" rel="noopener" href="' + escF(url) + '" target="_blank">SHOP HERE</a>';
          if (isAwa) {
            return { ok: true, label: 'Wall art product placed: ' + p.title, html: '<div style="text-align: center; margin: 30px 0;">' + inner + '</div>' };
          }
          const handle = p.handle || '';
          const html =
            '<div class="awa-partner" data-handle="' + escF(handle) + '" style="text-align: center; margin: 30px 0;">' + inner + '</div>' +
            '<script>(function(){var s=document.currentScript,el=s&&s.previousElementSibling;if(!el)return;var h=' + JSON.stringify(handle) + ';fetch("/products/"+h+".js").then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(p){if(p&&p.available===false)el.style.display="none";}).catch(function(){el.style.display="none";});})();<\/script>';
          return { ok: true, label: 'Collective product placed (live · auto-hides): ' + p.title, html };
        }

        // Always start from the ORIGINAL body (markers intact) so this step can be run again safely.
        let body = String(draft.bodyHtml);
        // Missing-images gate: if an image (cover or body) isn't generated yet, STOP and ask Mae (Generate /
        // Cancel) instead of finishing with a dead placeholder. dropMissingImages = she chose "cancel those".
        const dropMissingImages = req.body.dropMissingImages === true;
        const missingImages = [];

        // ---- ALT TEXT — real descriptions of what's in each image, with the keyword woven in naturally ----
        // One small AI pass writes every image's alt at once. If the AI is unavailable (e.g. out of credits),
        // we fall back to a readable name + keyword so a blog can still be finished.
        let altMap = {};
        const rawReadable = (fname) => String(fname || '').trim()
          .replace(/\.[a-z0-9]+$/i, '')                 // drop any file extension
          .replace(/-(featured|option)s?(-\d+)?$/i, '') // drop trailing role words + number
          .replace(/-\d+$/, '')                         // drop any remaining trailing number
          .replace(/[-_]+/g, ' ')                       // hyphens/underscores → spaces
          .replace(/\s+/g, ' ').trim();
        const readableAlt = (fname) => (fbKw ? fbKw + ' — ' : '') + (rawReadable(fname) || fbT);

        // ---- FEATURED — one image, ignore everything after "-option" ----
        const featuredBase = draft.featuredBase || '';
        let featuredUrl = '';
        if (featuredBase) {
          featuredUrl = await findImage(featuredBase + codeSuf + '-featured', true);
          if (!featuredUrl) {
            report.push({ ok: false, label: 'Featured image not found', fix: 'Save your favourite featured photo in Shopify with a name starting "' + featuredBase + codeSuf + '-featured-option", then press again.' });
            missingImages.push({ type: 'featured', section: 'Featured (cover) image', name: featuredBase + codeSuf + '-featured-option', prompt: draft.heroPrompt || '' });
          }
        } else {
          report.push({ ok: false, label: 'This blog has no featured name yet', fix: 'Re-write the blog (step 2) so it has a featured name, then press again.' });
        }

        // ---- SCENE PHOTOS — each [[IMG|name|ratio|kind|prompt]]; keep each photo's own written description for its alt ----
        const imgRe = /<h2[^>]*>([\s\S]*?)<\/h2>|\[\[IMG\|([^|]*)\|([^|]*)\|([^|]*)\|([\s\S]*?)\]\]/g;
        let mm, curSec = '';
        const sceneMarkers = [];
        while ((mm = imgRe.exec(body)) !== null) {
          if (mm[1] !== undefined) curSec = mm[1].replace(/<[^>]+>/g, '').trim();
          else sceneMarkers.push({ full: mm[0], filename: (mm[2] || '').trim(), section: curSec, prompt: (mm[5] || '').trim() });
        }

        // Gather every product that will appear (unique) so its alt can describe the actual product.
        const _seenP = new Set(); const selProducts = [];
        [].concat(prods.prints || [], prods.awa || [], prods.collective || [], prods.extra || []).forEach(p => {
          if (p && p.gid && prods.selected && prods.selected[p.gid] && !_seenP.has(p.gid)) { _seenP.add(p.gid); selProducts.push(p); }
        });

        // One AI pass → a real, unique, SEO-natural alt for every image (featured + scenes + products).
        async function writeAltTexts() {
          try {
            const items = [];
            items.push({ id: 'featured', hint: 'Main featured photo. Shows: ' + (rawReadable(featuredBase) || fbT) });
            sceneMarkers.forEach(s => { const shows = (s.prompt && s.prompt.length > 4) ? s.prompt : (s.section || rawReadable(s.filename)); items.push({ id: 'scene:' + s.filename, hint: 'Scene photo. Shows: ' + shows }); });
            selProducts.forEach(p => { items.push({ id: 'prod:' + p.gid, hint: 'Product photo of "' + (p.title || '') + '"' + (p.productType ? ' (' + p.productType + ')' : '') }); });
            if (!items.length) return {};
            const listTxt = items.map(it => it.id + ' :: ' + it.hint.replace(/\s+/g, ' ').slice(0, 400)).join('\n');
            const prompt = `You are writing image ALT TEXT for a home-decor blog on aboutwallart.com. Use UK spelling ("colour", "decor").
Blog title: "${fbT}". Main keyword: "${fbKw}".

Write ONE alt line for EACH image id below. Each alt MUST:
- DESCRIBE what the image actually shows, concretely, for a blind reader (the room, objects, colours, or the product). 8 to 16 words.
- Read like natural English. Never begin with "image of" or "photo of".
- Include the keyword "${fbKw}" (or a close natural variation) ONLY on the few images where it genuinely fits — do NOT put it on every image, and never stuff it. Most alts should simply describe the image.
- Be different from every other alt.

Images (id :: what it shows):
${listTxt}

Return ONLY a JSON object mapping each id to its alt line, and nothing else.`;
            const raw = await callClaudeText(prompt, 2000, 'claude-haiku-4-5-20251001');
            const jsonStr = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
            const map = JSON.parse(jsonStr);
            const clean = {};
            Object.keys(map).forEach(k => { if (typeof map[k] === 'string' && map[k].trim()) clean[k] = map[k].trim().replace(/\s+/g, ' '); });
            return clean;
          } catch (e) { return {}; }
        }
        altMap = await writeAltTexts();

        const featuredAlt = altMap['featured'] || readableAlt(featuredBase);
        if (featuredBase && featuredUrl) report.push({ ok: true, label: 'Featured image found — "' + featuredAlt + '"' });

        let sceneOk = 0;
        for (const im of sceneMarkers) {
          const alt = altMap['scene:' + im.filename] || readableAlt(im.filename);
          const lookup = im.filename + codeSuf;
          const url = await findImage(lookup, false);
          if (url) {
            body = body.split(im.full).join('<div style="text-align: center; margin: 20px 0;"><img style="max-width: 1024px; width: 100%; height: auto;" alt="' + escF(alt) + '" src="' + escF(url) + '"></div>');
            sceneOk++;
          } else {
            report.push({ ok: false, label: 'Photo not saved yet: ' + lookup, fix: 'Save that image in Shopify with the exact name "' + lookup + '", then press again.' });
            missingImages.push({ type: 'scene', section: im.section || '', name: lookup, prompt: im.prompt || '' });
            if (dropMissingImages) body = body.split(im.full).join(''); // she cancelled this image → drop the dead placeholder
          }
        }
        if (sceneOk) report.push({ ok: true, label: sceneOk + ' scene photo' + (sceneOk === 1 ? '' : 's') + ' placed with alt text' });

        // ---- PRODUCT BLOCKS — the [[PRODUCT|topic]] spots, in order ----
        // Rebuild the picker's alignment: print-type spots ← the chosen prints; the other spots ← the aligned
        // Collective items (one per need). Any add-by-SKU extras fill the best free spot, else go at the end.
        const printRe = /wall art|\bprint|artwork|poster|picture|painting/i;
        const prodMarkers = body.match(/\[\[PRODUCT\|[^\]]*\]\]/g) || [];
        const spots = prodMarkers.map(mk => ({ full: mk, topic: mk.slice(10, -2).trim() }));
        spots.forEach(sp => { sp.kind = printRe.test(sp.topic) ? 'print' : 'need'; sp.product = null; });
        // Prints: prefer the per-spot picks (prods.prints); for any spot without one, fall back to the
        // pool — the auto About Wall Art prints PLUS any About Wall Art print she added by SKU (extras).
        const printsAligned = Array.isArray(prods.prints) ? prods.prints : null;
        const printPool = [
          ...(prods.awa || []).filter(p => p && prods.selected[p.gid]),
          ...(prods.extra || []).filter(p => p && prods.selected[p.gid] && p.vendor === 'About Wall Art')
        ];
        const collAligned = prods.collective || [];
        let pi = 0, ni = 0;
        spots.forEach(sp => {
          if (sp.kind === 'print') {
            let pp = (printsAligned && printsAligned[pi] && prods.selected[printsAligned[pi].gid]) ? printsAligned[pi] : null;
            if (!pp) pp = printPool[pi] || null;
            pi++;
            sp.product = (pp && prods.selected[pp.gid]) ? pp : null;
          } else { const cp = collAligned[ni++]; sp.product = (cp && prods.selected[cp.gid]) ? cp : null; }
        });
        // extras → first fill any EMPTY spot they fit; the rest go into the best-matching H2 below
        const extrasSel = (prods.extra || []).filter(p => p && prods.selected[p.gid]);
        extrasSel.forEach(ex => { const spot = spots.find(sp => !sp.product && extraFitsSpot(sp.topic, ex)); if (spot) spot.product = ex; });

        // place the in-body [[PRODUCT]] spots first
        for (const sp of spots) {
          if (!sp.product) { report.push({ ok: false, label: 'No product chosen for a spot: ' + sp.topic, fix: 'Open “Pick products”, choose an item for “' + sp.topic + '”, save, then press again.' }); continue; }
          const r = await productBlock(sp.product);
          report.push({ ok: r.ok, label: r.label, fix: r.fix });
          if (r.ok) body = body.split(sp.full).join(r.html); // leave the marker if it failed, so a re-run can fix it
        }

        // anything selected but NOT placed in a spot → drop into the H2 section it fits best (closest if none). Never at the end.
        const placedGids = new Set(spots.filter(s => s.product).map(s => s.product.gid));
        const leftovers = [];
        printPool.forEach(p => { if (p && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        (Array.isArray(prods.prints) ? prods.prints : []).forEach(p => { if (p && prods.selected[p.gid] && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        collAligned.forEach(p => { if (p && prods.selected[p.gid] && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        extrasSel.forEach(p => { if (p && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });

        const productTermsFor = (p) => {
          const keys = [];
          const hay = ((p.productType || '') + ' ' + (p.title || '')).toLowerCase();
          for (const t of SVR_TYPES) if (t.re.test(hay)) keys.push(...t.keys);
          (p.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).forEach(w => keys.push(w));
          return [...new Set(keys)];
        };
        // Insert a block at the end of the H2 section whose heading/text best fits the product; ties/none → closest (first-highest).
        const insertIntoBestH2 = (html, block, p) => {
          const parts = html.split(/(?=<h2)/); // parts[0] = intro; each later part begins with an <h2>
          if (parts.length < 2) return html + '\n' + block;
          // never insert into or after the video (WATCH) section — the video is the last visual piece
          let videoI = parts.length;
          for (let i = 1; i < parts.length; i++) { if (/youtube\.com\/embed|watch:/i.test(parts[i])) { videoI = i; break; } }
          const terms = productTermsFor(p);
          let bestI = 1, bestScore = -1;
          for (let i = 1; i < videoI; i++) {
            const hm = parts[i].match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
            const head = hm ? hm[1].replace(/<[^>]+>/g, '').toLowerCase() : '';
            const secText = parts[i].replace(/<[^>]+>/g, ' ').toLowerCase();
            let score = 0;
            for (const t of terms) { if (head.includes(t)) score += 3; else if (secText.includes(t)) score += 1; }
            if (score > bestScore) { bestScore = score; bestI = i; }
          }
          if (bestI >= videoI) bestI = Math.max(1, videoI - 1); // safety: stay before the video
          parts[bestI] = parts[bestI] + '\n' + block;
          return parts.join('');
        };

        for (const p of leftovers) {
          const r = await productBlock(p);
          report.push({ ok: r.ok, label: (r.ok ? 'Placed in best-matching section: ' + p.title : r.label), fix: r.fix });
          if (r.ok) body = insertIntoBestH2(body, r.html, p);
        }

        // ---- REUSED-KEYWORD LINK — if this blog reused a keyword locked to a PRODUCT / other page, add ONE clean
        //      contextual in-body link to it (passes SEO to that page). Safe: the AI only picks a paragraph and a
        //      verbatim phrase to turn into the anchor — we build the <a> ourselves. No fit → no link (no-op).
        //      Body is rebuilt from bodyHtml each run, so this never corrupts the source; re-running is safe.
        try {
          const ltMap = await readJsonFileSafe('data/blog-link-targets.json', {});
          const ltEntry = (ltMap && typeof ltMap === 'object') ? ltMap[(fbKw || '').toLowerCase()] : null;
          const primary = (ltEntry && Array.isArray(ltEntry.links) && ltEntry.links[0]) ? ltEntry.links[0] : null;
          const linkUrl = primary && String(primary.url || '').trim();
          if (linkUrl) {
            // Collect candidate paragraphs that have no existing link and enough text.
            const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi; const cands = []; let pm;
            while ((pm = pRe.exec(body)) !== null) {
              const inner = pm[1]; const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (text.length > 60 && !/<a\b/i.test(inner)) cands.push({ full: pm[0], inner, text });
            }
            if (cands.length) {
              const numbered = cands.map((c, i) => (i + 1) + '. ' + c.text).slice(0, 30).join('\n');
              const prompt = `You are a UK wall-art blog editor for About Wall Art. One of the paragraphs below should link to this product page: ${linkUrl}
Pick the ONE paragraph where a link to that product reads most naturally and helpfully. Return the paragraph number and an "anchor" = a SHORT phrase (2 to 5 words) copied EXACTLY (verbatim, same case) from that paragraph, which will become the clickable link text. The anchor must be natural link text (describe wall art / the room / the style), never a whole sentence and never generic words like "click here". If NO paragraph is a genuinely natural fit, return skip.
Return ONLY compact JSON: {"index":N,"anchor":"exact phrase from that paragraph"} OR {"skip":true}.
PARAGRAPHS (numbered):
${numbered}`;
              let raw = ''; try { raw = await callClaudeText(prompt, 400); } catch (e) { raw = ''; }
              const mm = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
              let o = {}; try { o = mm ? JSON.parse(mm[0]) : {}; } catch (e) { o = {}; }
              const idx = parseInt(o.index, 10); const anchor = String(o.anchor || '').trim();
              const target = (!o.skip && Number.isInteger(idx) && idx >= 1 && idx <= cands.length) ? cands[idx - 1] : null;
              if (target && anchor && target.inner.indexOf(anchor) !== -1) {
                const aTag = '<a href="' + linkUrl + '">' + anchor + '</a>';
                const newInner = target.inner.replace(anchor, aTag); // first occurrence only
                const newFull = target.full.replace(target.inner, newInner);
                body = body.replace(target.full, newFull);
                report.push({ ok: true, label: 'Added a contextual link to the reused product page' });
              } else {
                report.push({ ok: true, label: 'Reused product page: no natural in-body link spot — added to related products only' });
              }
            }
          }
        } catch (e) { /* linking is best-effort — never block finishing the blog */ }

        // ---- MISSING-IMAGES GATE — never finish (or later publish) with a dead placeholder ----
        // If any image is still missing and she hasn't chosen to drop them, STOP here and return the list so the
        // tool can ask her: Generate (she gets the prompt + exact save-name) or Cancel. Nothing is saved.
        if (missingImages.length && !dropMissingImages) {
          return res.status(200).json({ success: false, needsImageDecision: true, title: fbT, missingImages, report });
        }
        // She cancelled the missing ones → make sure no leftover [[IMG|...]] placeholder survives into the body.
        if (dropMissingImages) body = body.replace(/\[\[IMG\|[^\]]*\]\]/g, '').replace(/\n{3,}/g, '\n\n');

        // ---- SAVE the finished body next to the draft (bodyHtml stays untouched so this can be re-run) ----
        draftsMap[fbT.toLowerCase()] = { ...draft, finishedBody: body, featuredUrl, featuredAlt, finished: true, finishedAt: new Date().toISOString() };
        try { await updateGitHubFile('data/blog-drafts.json', JSON.stringify(draftsMap, null, 2), draftsSha, `Finish blog body: ${fbT}`); }
        catch (e) { return res.status(200).json({ success: false, error: 'Built the blog but could not save it: ' + e.message, report }); }
        report.push({ ok: true, label: 'Finished blog saved — ready for the Publish step' });
        return res.status(200).json({ success: true, report, finishedBody: body, featuredUrl });
      }

      // ── ACTION: publish-blog ── (STAGE 3: create + schedule the finished blog on Shopify, fill every
      // metafield / tag / SEO field, register it in the blog index, add the auto-link rule + reciprocal
      // links from the related older blogs, prepare the Google reindex, mark it done + clear the month.)
      // Input: { title, keyword }. Output: { success, report:[{ok,label,fix,copy}], articleUrl, adminUrl, gscUrl, month, monthCleared, monthLeft }.
      if (req.body.action === 'publish-blog') {
        const pbTitle = String(req.body.title || '').trim();
        const pbKwIn  = String(req.body.keyword || '').trim();
        if (!pbTitle) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

        const report = [];
        const NEWS_BLOG_GID = 'gid://shopify/Blog/93572858142';
        const ORIGIN = 'https://aboutwallart.com';
        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const norm = (s) => String(s || '').trim().toLowerCase();
        const curYear = new Date().getFullYear();
        const nextYear = curYear + 1;

        // 1) load the finished blog + the saved product picks
        let draftsMap = {}, draftsSha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); draftsMap = JSON.parse(f.content || '{}'); draftsSha = f.sha; } catch (e) { draftsMap = {}; }
        const draft = draftsMap[pbTitle.toLowerCase()];
        if (!draft) return res.status(200).json({ success: false, error: 'No blog found for "' + pbTitle + '". Write + finish it first.' });
        if (!draft.finished || !draft.finishedBody) return res.status(200).json({ success: false, error: 'This blog is not finished yet — do step 5 (Images saved — fetch & finish) first.' });
        if (draft.publishedArticleId) return res.status(200).json({ success: false, alreadyDone: true, error: 'This blog is already on Shopify (published ' + (draft.publishedAt || '') + '). Delete it there first if you want to publish it again.', articleUrl: draft.publishedHandle ? (ORIGIN + '/blogs/news-articles-home-decor-inspiration/' + draft.publishedHandle) : '' });

        let prodMap = {};
        try { const f = await getGitHubFile('data/blog-products.json'); prodMap = JSON.parse(f.content || '{}'); } catch (e) { prodMap = {}; }
        const prods = prodMap[pbTitle.toLowerCase()] || { awa: [], collective: [], extra: [], selected: {} };
        prods.selected = prods.selected || {};

        const keyword = pbKwIn || prods.keyword || draft.keyword || '';
        let body = String(draft.finishedBody);

        // ---- MISSING-CONTENT GATE (runs FIRST, before any costly SEO/AI calls) ----
        // Never publish with a dead [[IMG|...]] image or [[PRODUCT|topic]] product placeholder. If any marker is
        // still unresolved and Mae hasn't chosen to drop them, STOP and return the list so the tool asks her:
        // fix them (generate the image / pick a product then re-finish) or Cancel (drop them, publish clean).
        const dropMissingImages = req.body.dropMissingImages === true;
        const pbBlogCode = await stableBlogCode(keyword, draft.blogCode);
        const pbCodeSuf = pbBlogCode ? '-' + pbBlogCode : '';
        {
          const missingImages = [];
          const imgReP = /\[\[IMG\|([^|]*)\|([^|]*)\|([^|]*)\|([\s\S]*?)\]\]/g;
          let mp;
          while ((mp = imgReP.exec(body)) !== null) missingImages.push({ type: 'scene', section: '', name: (mp[1] || '').trim() + pbCodeSuf, prompt: (mp[4] || '').trim() });
          const prodReP = /\[\[PRODUCT\|([^\]]*)\]\]/g;
          while ((mp = prodReP.exec(body)) !== null) missingImages.push({ type: 'product', section: (mp[1] || '').trim(), name: '', prompt: '' });
          if (missingImages.length && !dropMissingImages) {
            return res.status(200).json({ success: false, needsImageDecision: true, title: pbTitle, missingImages, report });
          }
          if (dropMissingImages) body = body.replace(/\[\[IMG\|[\s\S]*?\]\]/g, '').replace(/\[\[PRODUCT\|[^\]]*\]\]/g, '').replace(/\n{3,}/g, '\n\n');
        }

        const bodyText = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
        let handle = slugify(pbTitle).slice(0, 110) || slugify(keyword);
        const featuredUrl = draft.featuredUrl || '';
        const featuredAlt = draft.featuredAlt || ((keyword ? keyword + ' — ' : '') + pbTitle);
        const brief = (draft.brief && typeof draft.brief === 'object') ? draft.brief : {};
        const faqCount = Math.max(3, Math.min(5, parseInt(brief.faqCount) || 4));

        // ---- 2) SEO boxes + snippets (ONE AI call, strict JSON, formats copied from the live blogs) ----
        let boxes = {};
        try {
          const seoPrompt = `You are writing the SEO metafields for a NEW About Wall Art blog. UK spelling. Always "decor", never "décor".
Blog title: "${pbTitle}"
Main keyword: "${keyword}"
Blog text (for context): """${bodyText}"""

YEARS — CRITICAL: AVOID using a year in ANY field below unless genuinely necessary (prefer no year). If one is truly needed, use ${nextYear}; only use ${curYear} if strictly factually required, and NEVER an earlier year such as ${curYear - 1}.

Return ONE valid JSON object, no code fences, exactly these keys:
{
"blogTitle": "A compelling, click-worthy H1 blog title for a real reader — specific and benefit- or curiosity-driven, Title Case, UK spelling, includes the topic naturally, 40 to 70 characters, NO year unless genuinely useful. NOT the bare keyword, NOT clickbait, NOT ALL CAPS.",
"seoTitle": "SEO page title, 60 characters or fewer, includes the keyword naturally",
"metaDescription": "Google meta description, 155 characters or fewer, keyword near the start, one or two clean sentences. NO shipping line. No quotes.",
"excerpt": "2 to 3 sentence plain-text summary, no HTML, keyword once, warm and specific",
"relatedQuestions": "HTML only: <h2>People Also Ask About [topic]</h2> then 3 or 4 <p><strong>Question?</strong> Short answer.</p>. Use only h2, p and strong. No ul, li, br or div.",
"summaryBlock": "HTML only: <h2>Summary: [Topic]</h2> then 5 to 7 <p><strong>Label:</strong> point.</p>. Use only h2, p and strong.",
"comparisonSnippet": "ALWAYS find the most genuine, useful comparison angle for THIS topic (two or more real options / materials / styles / approaches relevant to it, e.g. real plants vs artificial vs botanical art for dark rooms) and write it as HTML: <h2>...</h2><p><strong>...:</strong> ...</p>. Return an empty string ONLY if there is truly no sensible comparison at all.",
"peopleAlsoAsk": "PLAIN TEXT in this EXACT shape: first line 'Frequently Asked Questions About [Topic]', then a blank line, then ${faqCount} pairs, each pair being '**Q: the question?**' on one line and 'A: the answer.' on the next line, with a blank line between pairs. No HTML.",
"completeTheLook": "short single-line heading, e.g. 'Complete Your Bedroom Look'",
"homeDecorTrendsTitle": "short single-line SEO heading for a trends section about this topic",
"isHowTo": true or false (true ONLY if this blog is a genuine step-by-step how-to),
"howToName": "if isHowTo a short how-to name, else empty string",
"howToDescription": "if isHowTo one sentence, else empty string",
"howToSteps": "if isHowTo an array of 3 to 6 real steps from the blog as {\\"name\\":\\"...\\",\\"text\\":\\"...\\"}, else an empty array"
}
Return only the JSON.`;
          let raw = await callClaudeText(seoPrompt, 2600, 'claude-haiku-4-5-20251001');
          raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          const m = raw.match(/\{[\s\S]*\}/);
          boxes = m ? JSON.parse(m[0]) : {};
        } catch (e) { boxes = {}; report.push({ ok: false, label: 'Could not auto-write the SEO boxes', fix: 'Press Publish again. The blog still gets created either way — you can add the boxes by hand.' }); }

        // Clean any HTML entities (e.g. a cheaper engine may write "&amp;" instead of "&") in these plain-text fields.
        const deEnt = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
        const seoTitle = deEnt(boxes.seoTitle || pbTitle).slice(0, 70);
        const metaDescription = deEnt(boxes.metaDescription || '').slice(0, 160);
        const excerpt = deEnt(boxes.excerpt || '');

        // ---- Article title: if the saved title is just the raw keyword (all lowercase, or equal to the keyword),
        //      swap it for the click-worthy one the SEO pass wrote. A title that is already proper (has capitals)
        //      is kept untouched. pbTitle stays the key for drafts/CSV lookups; only Shopify gets the nice title. ----
        const rawTitleLike = norm(pbTitle) === norm(keyword) || !/[A-Z]/.test(pbTitle);
        const blogTitleGen = deEnt(draft.h1Title || boxes.blogTitle || '').trim(); // prefer the H1 Mae already saw at the write step
        const articleTitle = (rawTitleLike && blogTitleGen) ? blogTitleGen : pbTitle;
        if (articleTitle !== pbTitle) { handle = slugify(articleTitle).slice(0, 110) || slugify(keyword); report.push({ ok: true, label: 'Title made click-worthy: "' + articleTitle + '"' }); }
        // How-To schema — Money Page Doctor's exact format (JSON-LD in a script tag), only for real how-tos
        let howToSchema = '';
        if (boxes.isHowTo && Array.isArray(boxes.howToSteps) && boxes.howToSteps.length) {
          const obj = { '@context': 'https://schema.org', '@type': 'HowTo', name: String(boxes.howToName || pbTitle), description: String(boxes.howToDescription || ''), step: boxes.howToSteps.map(s => ({ '@type': 'HowToStep', name: String(s.name || ''), text: String(s.text || '') })) };
          howToSchema = '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>';
        }

        // ---- 3) Tags (reuse the existing tag-maker) ----
        let tags = [];
        try { const c = await generateClusters(keyword, pbTitle); tags = [c.primaryCluster, c.intentTag, ...(c.supporting || [])].filter(Boolean); }
        catch (e) { report.push({ ok: false, label: 'Could not auto-pick the tags', fix: 'The blog still publishes — add tags by hand, or press Publish again.' }); }

        // ---- 4) Internal-link boxes (same logic as Money Page Doctor) ----
        const LINK_STOP = new Set(['art','wall','decor','home','print','prints','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you','trend','trends','interior','design','style','room','living']);
        let linkedCollections = [], linkedTrends = [], linkedBlogs = [], relatedBlogObjs = [];
        try {
          const hayWords = new Set(((keyword + ' ' + tags.slice(0, 6).join(' ') + ' ' + pbTitle).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !LINK_STOP.has(w)));
          const q = keyword.replace(/["\\]/g, ' ').trim();
          if (q && hayWords.size) {
            const d = await shopifyGraphQL(`{ collections(first:30, query:${JSON.stringify(q)}){ edges{ node{ id title handle } } } }`);
            const nodes = (d && d.collections ? d.collections.edges.map(e => e.node) : []);
            linkedCollections = nodes.map(n => { const cw = (n.title || '').toLowerCase().match(/[a-z]+/g) || []; let sc = 0; cw.forEach(w => { if (hayWords.has(w)) sc++; }); return { gid: n.id, sc }; }).filter(c => c.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3).map(c => c.gid);
          }
        } catch (e) {}
        // Fallback: if the keyword search found no collections, use the topic's own cluster collections (tags → CLUSTER_URLS).
        if (!linkedCollections.length) {
          try {
            const handles = [];
            for (const tag of tags) { const u = CLUSTER_URLS[tag]; if (!u || !/\/collections\//.test(u)) continue; const h = u.split('?')[0].replace(/\/$/, '').split('/').pop(); if (h && !handles.includes(h)) handles.push(h); }
            for (const h of handles.slice(0, 3)) {
              const cd = await shopifyGraphQL(`query($h:String!){ collectionByHandle(handle:$h){ id } }`, { h });
              const cgid = cd && cd.collectionByHandle && cd.collectionByHandle.id;
              if (cgid && !linkedCollections.includes(cgid)) linkedCollections.push(cgid);
            }
          } catch (e) {}
        }
        try {
          const hay = (keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase();
          const d = await shopifyGraphQL(`{ pages(first:100){ edges{ node{ id title handle } } } }`);
          const pages = (d && d.pages ? d.pages.edges.map(e => e.node) : []).filter(p => /trend/i.test(p.title || ''));
          linkedTrends = pages.map(p => { const ws = (p.title || '').toLowerCase().match(/[a-z]+/g) || []; let sc = 0; ws.forEach(w => { if (w.length > 3 && !LINK_STOP.has(w) && hay.includes(w)) sc++; }); return { gid: p.id, sc }; }).filter(t => t.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 2).map(t => t.gid);
        } catch (e) {}
        try {
          const hay = new Set(((keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !LINK_STOP.has(w)));
          // Related blogs are chosen from LIVE Shopify (NEVER a saved list that may still name deleted blogs —
          // that is what made Shopify reject the whole publish). One pass gets every live article
          // (id/title/handle/tags) AND the inbound-link count per blog (to spread link equity: fewest first).
          const live = []; const inbound = {};
          let cursor = null, pg = 0;
          while (pg < 8) { pg++;
            const q = await shopifyGraphQL(`query($c:String){ articles(first:250, after:$c, query:"blog_id:93572858142"){ pageInfo{ hasNextPage endCursor } edges{ node{ id title handle tags metafield(namespace:"custom", key:"linked_blogs"){ value } } } } }`, { c: cursor });
            const conn = q && q.articles; if (!conn) break;
            for (const e of conn.edges) {
              const n = e.node; if (!n || !n.id) continue;
              live.push({ gid: n.id, title: n.title || '', handle: n.handle || '', tags: n.tags || [] });
              let v = []; try { v = JSON.parse((n.metafield && n.metafield.value) || '[]'); } catch (e2) {}
              (Array.isArray(v) ? v : []).forEach(g => { inbound[g] = (inbound[g] || 0) + 1; });
            }
            if (!conn.pageInfo.hasNextPage) break; cursor = conn.pageInfo.endCursor;
          }
          const candidates = live.filter(a => a.gid && norm(a.handle) !== norm(handle) && norm(a.title) !== norm(pbTitle))
            .map(a => { const ws = ((a.title || '') + ' ' + (a.tags || []).join(' ')).toLowerCase().match(/[a-z]+/g) || []; let sc = 0; const seen = new Set(); ws.forEach(w => { if (hay.has(w) && !seen.has(w)) { sc++; seen.add(w); } }); return { gid: a.gid, handle: a.handle, sc, inb: inbound[a.gid] || 0 }; })
            .filter(a => a.sc > 0);
          // topic-relevant only, then among them prefer the ones with the FEWEST inbound links (spread evenly).
          candidates.sort((a, b) => (a.inb - b.inb) || (b.sc - a.sc));
          relatedBlogObjs = candidates.slice(0, 3);
          linkedBlogs = relatedBlogObjs.map(a => a.gid);
        } catch (e) {}

        // ---- 5) Shoppable gallery — match by meaning, blank if no clear fit (never a default) ----
        let galleryId = '', bestGallery = null, galleriesList = [];
        const galleryProductGids = (g, exclude) => {
          const ex = new Set(exclude || []);
          const items = ((g && g.images) || [])
            .map(im => ({ gid: im.productId ? ('gid://shopify/Product/' + im.productId) : '', price: parseFloat(im.productPrice) || 0 }))
            .filter(x => x.gid && !ex.has(x.gid))
            .sort((a, b) => b.price - a.price);
          const seen = new Set(), out = [];
          for (const x of items) { if (!seen.has(x.gid)) { seen.add(x.gid); out.push(x.gid); } }
          return out.slice(0, 2); // 2 priciest = the Collective / partner items in the gallery
        };
        try {
          const gf = await getGitHubFile('data/galleries.json');
          const gsRaw = JSON.parse(gf.content || '[]');
          const arr = Array.isArray(gsRaw) ? gsRaw : (gsRaw.galleries || []);
          galleriesList = arr.filter(g => g && g.id != null && (!g.status || g.status === 'active')).map(g => ({ id: g.id, title: g.title || String(g.id) }));
          const hay = (keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase();
          let best = null, bestSc = 0;
          for (const g of arr) {
            if (!g || (g.status && g.status !== 'active') || g.id == null) continue;
            const words = ((g.title || '') + ' ' + (g.description || '')).toLowerCase().match(/[a-z]+/g) || [];
            let sc = 0; const seen = new Set();
            words.forEach(w => { if (w.length > 3 && !LINK_STOP.has(w) && hay.includes(w) && !seen.has(w)) { sc++; seen.add(w); } });
            if (sc > bestSc) { bestSc = sc; best = g; }
          }
          if (best && bestSc >= 1) { galleryId = String(best.id); bestGallery = best; } // one clear style word is enough
        } catch (e) {}

        // ---- 6) blog_products_list — 2 About Wall Art (priciest) + 2 from the matched gallery's collection
        //      (priciest = the Collective / partner items). No gallery yet → just the 2 About Wall Art; when she
        //      picks a gallery from the report, its 2 get added (set-blog-gallery). Separate from the body products.
        const awaGids = (prods.awa || []).filter(p => p && p.gid).sort((a, b) => (b.price || 0) - (a.price || 0)).map(p => p.gid).slice(0, 2);
        const galleryGids = bestGallery ? galleryProductGids(bestGallery, awaGids) : [];
        // Reused-keyword product(s): if this blog reused a keyword locked to a PRODUCT, add that product to the
        // related-products list (resolve its /products/<handle> URL → product GID). Put it FIRST so the 4-item cap
        // never drops it. Non-product URLs (pages/collections) are skipped here — the in-body link already covers them.
        let reusedGids = [];
        try {
          const ltMap = await readJsonFileSafe('data/blog-link-targets.json', {});
          const ltEntry = (ltMap && typeof ltMap === 'object') ? ltMap[(keyword || '').toLowerCase()] : null;
          const links = (ltEntry && Array.isArray(ltEntry.links)) ? ltEntry.links : [];
          for (const lk of links) {
            const mh = String((lk && lk.url) || '').match(/\/products\/([^\/?#]+)/i);
            if (!mh) continue;
            const handle = decodeURIComponent(mh[1]).toLowerCase();
            try { const d = await shopifyGraphQL(`query($q:String!){ products(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); const g = d && d.products && d.products.edges[0] && d.products.edges[0].node && d.products.edges[0].node.id; if (g && !reusedGids.includes(g)) reusedGids.push(g); } catch (e) {}
          }
        } catch (e) {}
        const productGids = [...reusedGids, ...awaGids, ...galleryGids].filter((g, i, a) => g && a.indexOf(g) === i).slice(0, 4);

        // ---- 7) Schedule — the first free day; today → 19:00 UK, any future day → 10:00 UK, EVERY OTHER DAY (1 on, 1 off) ----
        function londonOffsetMin(date) { const u = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })); const l = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/London' })); return Math.round((l - u) / 60000); }
        function ukIso(y, m0, d, hour) { const g = new Date(Date.UTC(y, m0, d, hour, 0, 0)); const off = londonOffsetMin(g); return new Date(g.getTime() - off * 60000).toISOString(); }
        let publishIso, scheduledToday = false;
        try {
          const d = await shopifyGraphQL(`{ articles(first:5, query:"blog_id:93572858142", sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ publishedAt } } } }`);
          const dates = (d && d.articles ? d.articles.edges : []).map(e => e.node.publishedAt).filter(Boolean).map(s => new Date(s));
          // ALSO read the blog list file — it includes hidden/scheduled blogs that Shopify's date-sorted query leaves out,
          // so scheduled-but-not-yet-live blogs no longer get ignored (which used to stack every new blog on the same day).
          try {
            const idxF = await getGitHubFile('data/blog-index.json');
            const idxJson = JSON.parse(idxF.content || '{}');
            (idxJson.articles || []).forEach(a => { if (a.publishedAt) dates.push(new Date(a.publishedAt)); });
          } catch (eIdx) {}
          const last = dates.length ? new Date(Math.max(...dates.map(x => x.getTime()))) : null;
          const nowUk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
          const todayMid = Date.UTC(nowUk.getFullYear(), nowUk.getMonth(), nowUk.getDate());
          let candMid = todayMid;
          if (last) { const lu = new Date(last.toLocaleString('en-US', { timeZone: 'Europe/London' })); const lNext = Date.UTC(lu.getFullYear(), lu.getMonth(), lu.getDate()) + 2 * 86400000; if (lNext > candMid) candMid = lNext; }  // +2 days = every other day (1 on, 1 off)
          scheduledToday = candMid === todayMid;
          const cd = new Date(candMid);
          publishIso = ukIso(cd.getUTCFullYear(), cd.getUTCMonth(), cd.getUTCDate(), scheduledToday ? 19 : 10);
        } catch (e) {
          const nowUk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
          scheduledToday = true;
          publishIso = ukIso(nowUk.getFullYear(), nowUk.getMonth(), nowUk.getDate(), 19);
        }

        // Safety net: strip any leftover [[IMG|...]] or [[PRODUCT|...]] placeholder so a dead marker can never
        // reach Shopify (the gate above already stops this; this is a final belt-and-braces for any edge case).
        body = body.replace(/\[\[IMG\|[\s\S]*?\]\]/g, '').replace(/\[\[PRODUCT\|[^\]]*\]\]/g, '').replace(/\n{3,}/g, '\n\n');

        // ---- 8) Create the blog on Shopify (Hidden until its date, right template + author) ----
        const mf = [];
        const addMf = (ns, key, type, value) => { if (value === '' || value == null) return; mf.push({ namespace: ns, key, type, value: String(value) }); };
        const addRef = (key, type, gids) => { if (gids && gids.length) mf.push({ namespace: 'custom', key, type, value: JSON.stringify(gids) }); };
        addMf('global', 'title_tag', 'single_line_text_field', seoTitle);
        addMf('global', 'description_tag', 'single_line_text_field', metaDescription);
        addMf('custom', 'ai_related_questions', 'multi_line_text_field', boxes.relatedQuestions || '');
        addMf('custom', 'ai_summary_block', 'multi_line_text_field', boxes.summaryBlock || '');
        addMf('custom', 'ai_comparison_snippet', 'multi_line_text_field', boxes.comparisonSnippet || '');
        addMf('custom', 'people_also_ask_new', 'multi_line_text_field', boxes.peopleAlsoAsk || '');
        addMf('custom', 'ai_how_to_schema_markup', 'multi_line_text_field', howToSchema);
        addMf('custom', 'complete_the_look', 'single_line_text_field', boxes.completeTheLook || '');
        addMf('custom', 'home_decor_trends_title', 'single_line_text_field', boxes.homeDecorTrendsTitle || '');
        addMf('custom', 'shoppable_gallery_new', 'number_integer', galleryId);
        addRef('linked_collections', 'list.collection_reference', linkedCollections);
        addRef('linked_blogs', 'list.article_reference', linkedBlogs);
        addRef('linked_trends', 'list.page_reference', linkedTrends);
        addRef('blog_products_list', 'list.product_reference', productGids);

        const articleInput = {
          blogId: NEWS_BLOG_GID,
          title: articleTitle,
          handle,
          body,
          summary: excerpt || undefined,
          author: { name: 'Mae Osz' },
          // Scheduling: give the future publish date and DON'T flag it published-now.
          // Shopify rejects isPublished:true together with a future publishDate; false + a future
          // date = scheduled (hidden until then, auto-publishes on the date).
          isPublished: false,
          publishDate: publishIso,
          templateSuffix: 'full-metafields-blog-post',
          tags,
          metafields: mf
        };
        if (featuredUrl) articleInput.image = { url: featuredUrl, altText: featuredAlt };

        async function tryCreate(input) {
          const d = await shopifyGraphQL(`mutation($article:ArticleCreateInput!){ articleCreate(article:$article){ article{ id handle } userErrors{ field message } } }`, { article: input });
          const ac = d && d.articleCreate;
          if (ac && ac.article) return { article: ac.article };
          return { error: (ac && ac.userErrors && ac.userErrors[0] && ac.userErrors[0].message) || 'unknown error' };
        }
        let created = null, createErr = '';
        try {
          let r = await tryCreate(articleInput);
          if (r.error && /handle/i.test(r.error)) { articleInput.handle = handle + '-' + Date.now().toString().slice(-4); r = await tryCreate(articleInput); }
          if (r.article) created = r.article; else createErr = r.error;
        } catch (e) { createErr = e.message; }

        if (!created) {
          report.unshift({ ok: false, label: 'Could not create the blog on Shopify: ' + createErr, fix: 'Nothing was published. Fix the message above, then press Publish again.' });
          return res.status(200).json({ success: false, report, error: createErr });
        }
        const finalHandle = created.handle || handle;
        const articleGid = created.id;
        const articleUrl = ORIGIN + '/blogs/news-articles-home-decor-inspiration/' + finalHandle;
        const adminId = (articleGid || '').split('/').pop();
        const storeHandle = (process.env.SHOPIFY_STORE_DOMAIN || '').split('.')[0] || 'aboutwallart';
        const whenTxt = new Date(publishIso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

        report.unshift({ ok: true, label: 'Blog created on Shopify — scheduled for ' + whenTxt + ' (UK), hidden until then' });
        report.push({ ok: true, label: mf.length + ' template boxes + SEO fields filled' });
        report.push({ ok: (tags.length > 0), label: tags.length ? ('Tags: ' + tags.join(', ')) : 'No tags set', fix: tags.length ? undefined : 'Add tags by hand in Shopify.' });
        report.push({ ok: !!featuredUrl, label: featuredUrl ? 'Featured image + alt set' : 'No featured image set', fix: featuredUrl ? undefined : 'Set the featured image on the blog in Shopify.' });
        if (boxes.peopleAlsoAsk) report.push({ ok: true, label: faqCount + ' People-Also-Ask questions + FAQ schema' });
        report.push({ ok: true, label: howToSchema ? 'How-To step schema added — glance it renders on this first how-to' : 'Not a how-to blog — step schema skipped (correct)' });
        if (galleryId) report.push({ ok: true, label: 'Shoppable gallery matched (#' + galleryId + ')' });
        report.push({ ok: true, label: 'Internal links — collections: ' + linkedCollections.length + ', trends: ' + linkedTrends.length + ', related blogs: ' + linkedBlogs.length });
        report.push({ ok: true, label: 'Product list — ' + productGids.length + ' product' + (productGids.length === 1 ? '' : 's') });

        // ---- 9) Register into the blog index ----
        try {
          const f = await getGitHubFile('data/blog-index.json');
          const idx = JSON.parse(f.content || '{}');
          idx.articles = Array.isArray(idx.articles) ? idx.articles : [];
          if (!idx.articles.some(a => norm(a.handle) === norm(finalHandle))) {
            idx.articles.unshift({ gid: articleGid, handle: finalHandle, title: articleTitle, tags, blogHandle: 'news-articles-home-decor-inspiration', publishedAt: publishIso });
            idx.count = idx.articles.length; idx.updatedAt = new Date().toISOString();
            await updateGitHubFile('data/blog-index.json', JSON.stringify(idx, null, 2), f.sha, 'Register new blog: ' + pbTitle);
          }
          report.push({ ok: true, label: 'Added to your blog list (so other blogs can link to it)' });
        } catch (e) { report.push({ ok: false, label: 'Could not add it to your blog list', fix: 'Run "Rebuild blog index" later — it will be picked up then.' }); }

        // ---- 10) Auto-link rule ----
        if (keyword) {
          try {
            const f = await getGitHubFile('data/autolink-rules.json');
            const rules = JSON.parse(f.content || '[]');
            if (!rules.some(r => norm(r.keyword) === norm(keyword))) {
              const maxId = rules.reduce((mx, r) => Math.max(mx, parseInt(r.id) || 0), 0);
              rules.unshift({ id: maxId + 1, keyword, url: '/blogs/news-articles-home-decor-inspiration/' + finalHandle, linksAdded: 0, verified: 'ok' });
              await updateGitHubFile('data/autolink-rules.json', JSON.stringify(rules, null, 2), f.sha, 'Auto-link rule for new blog: ' + keyword);
              report.push({ ok: true, label: 'Auto-link rule added ("' + keyword + '" → this blog)' });
            } else { report.push({ ok: true, label: 'Auto-link rule already existed for "' + keyword + '"' }); }
          } catch (e) { report.push({ ok: false, label: 'Could not add the auto-link rule', fix: 'Add it by hand in Auto-Link.', copy: keyword + ' → /blogs/news-articles-home-decor-inspiration/' + finalHandle }); }
        }

        // ---- 10b) Lock the keyword in the registry so it can't be reused for other content ----
        if (keyword) {
          try {
            const reg = await getGitHubFile('data/keyword-locker-registry.csv');
            const rlines = reg.content.split('\n').map(l => l.replace(/\r/g, ''));
            const csvQ = (s) => { s = String(s == null ? '' : s); return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const kwLow = keyword.toLowerCase();
            const already = rlines.some(line => { if (!line.trim()) return false; const c = parseCSVLine(line); const locked = (c[2] || '').toUpperCase(); const st = (c[3] || '').toUpperCase(); const ac = (c[4] || '').toUpperCase(); return (c[0] || '').toLowerCase() === kwLow && locked === 'LOCKED' && st === 'DONE' && (ac === 'TO_OPTIMIZE' || ac === 'OPTIMIZED'); });
            if (already) { report.push({ ok: true, label: 'Keyword already locked in the registry ("' + keyword + '")' }); }
            else {
              const row = `${csvQ(keyword)},${csvQ(articleUrl)},LOCKED,DONE,OPTIMIZED,N/A,N/A,N/A,N/A,Blog published,Informational,`;
              const updated = rlines.join('\n').replace(/\n+$/, '') + '\n' + row + '\n';
              await updateGitHubFile('data/keyword-locker-registry.csv', updated, reg.sha, 'Lock blog keyword: ' + keyword);
              report.push({ ok: true, label: 'Keyword locked in the registry ("' + keyword + '") — won\'t be reused for other content' });
            }
          } catch (e) { report.push({ ok: false, label: 'Could not lock the keyword in the registry', fix: 'Lock it by hand in the Keyword Locker.', copy: keyword + ' → ' + articleUrl }); }
        }

        // ---- 11) Reciprocal links — add THIS blog to the related older blogs' "You may also read" box ----
        if (relatedBlogObjs.length) {
          let done = 0;
          for (const rb of relatedBlogObjs) {
            try {
              const qd = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { metafield(namespace:"custom", key:"linked_blogs"){ value } } } }`, { id: rb.gid });
              let cur = [];
              try { cur = JSON.parse((qd && qd.node && qd.node.metafield && qd.node.metafield.value) || '[]'); } catch (e2) { cur = []; }
              if (!Array.isArray(cur)) cur = [];
              if (!cur.includes(articleGid)) {
                cur.push(articleGid);
                const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [{ ownerId: rb.gid, namespace: 'custom', key: 'linked_blogs', type: 'list.article_reference', value: JSON.stringify(cur) }] });
                if (!(sd && sd.metafieldsSet && sd.metafieldsSet.userErrors && sd.metafieldsSet.userErrors.length)) done++;
              } else { done++; }
            } catch (e) {}
          }
          report.push({ ok: done > 0, label: done + ' older blog' + (done === 1 ? '' : 's') + ' now link back to this one (helps it get found)', fix: done ? undefined : 'None added — not critical.' });
        }

        // ---- 12) Mark it done in your list + clear the month when it is empty ----
        let month = '', monthCleared = false, monthLeft = 0;
        try {
          const f = await getGitHubFile('data/blog_ideas.csv');
          const lines = f.content.split('\n');
          const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
          const out = lines.map(line => {
            const trimmed = line.trim().replace(/\r/g, '');
            if (!trimmed) return line;
            const cols = parseCSVLine(trimmed);
            if (norm(cols[1]) === 'blog post title') return line;
            if (norm(cols[1]) === norm(pbTitle)) {
              while (cols.length < 10) cols.push('');
              month = cols[9] || '';
              cols[5] = 'PUBLISHED';
              // Keep the month tag (do NOT clear it) so a published blog stays visible in "Month in progress" until
              // Mae explicitly marks it done. It only leaves that tab via its own "Mark as done" (data/blog-done.json).
              return cols.map(esc).join(',');
            }
            return line;
          });
          if (month) {
            for (const line of out) { const t = line.trim().replace(/\r/g, ''); if (!t) continue; const cols = parseCSVLine(t); if (norm(cols[1]) === 'blog post title') continue; if ((cols[9] || '') === month) monthLeft++; }
            monthCleared = monthLeft === 0;
          }
          await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, 'Blog published: ' + pbTitle);
          report.push({ ok: true, label: month ? (monthCleared ? 'Marked done — that whole month is now sent 🎉' : ('Marked done in your list (' + monthLeft + ' left this month)')) : 'Marked done in your list' });
        } catch (e) { report.push({ ok: false, label: 'Could not update your blog list', fix: 'Mark it done by hand later.' }); }

        // ---- 13) Remember it is published (so it is not published twice) ----
        try {
          draftsMap[pbTitle.toLowerCase()] = { ...draft, published: true, publishedArticleId: articleGid, publishedHandle: finalHandle, publishedAt: publishIso };
          await updateGitHubFile('data/blog-drafts.json', JSON.stringify(draftsMap, null, 2), draftsSha, 'Mark blog published: ' + pbTitle);
        } catch (e) {}

        // ---- 14) Google reindex link (manual click, as Money Page Doctor does) ----
        const gscUrl = 'https://search.google.com/search-console/inspect?resource_id=' + encodeURIComponent('sc-domain:aboutwallart.com') + '&id=' + encodeURIComponent(articleUrl);
        report.push({ ok: true, label: 'Ready for Google — use the "Request indexing" button below' });

        // Any fillable box that came out EMPTY → an "add it yourself" row (never a dead end).
        const fillable = [
          { key: 'ai_comparison_snippet', type: 'multi_line_text_field', kind: 'text', label: 'AI Comparison Snippet', has: !!boxes.comparisonSnippet },
          { key: 'ai_summary_block', type: 'multi_line_text_field', kind: 'text', label: 'AI Summary Block', has: !!boxes.summaryBlock },
          { key: 'ai_related_questions', type: 'multi_line_text_field', kind: 'text', label: 'AI Related Questions', has: !!boxes.relatedQuestions },
          { key: 'people_also_ask_new', type: 'multi_line_text_field', kind: 'text', label: 'People Also Ask', has: !!boxes.peopleAlsoAsk },
          { key: 'complete_the_look', type: 'single_line_text_field', kind: 'line', label: 'Complete the Look title', has: !!boxes.completeTheLook },
          { key: 'home_decor_trends_title', type: 'single_line_text_field', kind: 'line', label: 'Home Decor Trends title', has: !!boxes.homeDecorTrendsTitle },
          { key: 'shoppable_gallery_new', type: 'number_integer', kind: 'gallery', label: 'Shoppable Gallery — pick one (it also adds its 2 products to the Product List)', has: !!galleryId },
          { key: 'linked_collections', type: 'list.collection_reference', kind: 'urls', label: 'Linked Collections (paste collection URLs, one per line)', has: linkedCollections.length > 0 },
          { key: 'linked_trends', type: 'list.page_reference', kind: 'urls', label: 'Linked Trends (paste trend-page URLs, one per line)', has: linkedTrends.length > 0 },
          { key: 'linked_blogs', type: 'list.article_reference', kind: 'urls', label: 'Linked Blogs (paste blog URLs, one per line)', has: linkedBlogs.length > 0 },
          { key: 'blog_products_list', type: 'list.product_reference', kind: 'urls', label: 'Product List (paste product URLs, one per line)', has: productGids.length > 0 }
        ];
        for (const fb of fillable) { if (!fb.has) report.push({ ok: false, label: fb.label + ' — empty', add: { key: fb.key, type: fb.type, kind: fb.kind, label: fb.label } }); }

        return res.status(200).json({ success: true, report, articleGid, articleUrl, adminUrl: adminId ? ('https://admin.shopify.com/store/' + storeHandle + '/content/articles/' + adminId) : '', gscUrl, galleries: galleriesList, month, monthCleared, monthLeft });
      }

      // ── ACTION: set-blog-metafield ── (Publish report: "add it yourself" — push ONE metafield onto the
      // just-created blog. Text/number = as typed; link = a URL; reference lists = pasted URLs/handles resolved to GIDs.)
      // Input: { articleGid, key, type, value }. Output: { success, error? }.
      if (req.body.action === 'set-blog-metafield') {
        const gid = String(req.body.articleGid || '').trim();
        const key = String(req.body.key || '').trim();
        const type = String(req.body.type || '').trim();
        let value = req.body.value;
        if (!gid || !key || !type) return res.status(400).json({ error: 'articleGid, key and type are required' });
        try {
          if (type.startsWith('list.')) {
            const raw = String(value == null ? '' : value).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            const gids = [];
            for (const item of raw) {
              const handle = item.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '').split('/').pop();
              if (!handle) continue;
              let g = null;
              if (type === 'list.collection_reference') { const d = await shopifyGraphQL(`query($h:String!){ collectionByHandle(handle:$h){ id } }`, { h: handle }); g = d && d.collectionByHandle && d.collectionByHandle.id; }
              else if (type === 'list.page_reference') { const d = await shopifyGraphQL(`query($q:String!){ pages(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.pages && d.pages.edges[0] && d.pages.edges[0].node.id; }
              else if (type === 'list.article_reference') { const d = await shopifyGraphQL(`query($q:String!){ articles(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.articles && d.articles.edges[0] && d.articles.edges[0].node.id; }
              else if (type === 'list.product_reference') { const d = await shopifyGraphQL(`query($q:String!){ products(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.products && d.products.edges[0] && d.products.edges[0].node.id; }
              if (g && !gids.includes(g)) gids.push(g);
            }
            if (!gids.length) return res.status(200).json({ success: false, error: 'Could not find any of those on your store — paste the full page/collection/product URLs, one per line.' });
            value = JSON.stringify(gids);
          } else if (type === 'link') {
            value = JSON.stringify({ url: String(value == null ? '' : value).trim(), text: null });
          } else if (type === 'number_integer') {
            const n = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
            if (isNaN(n)) return res.status(200).json({ success: false, error: 'That is not a number.' });
            value = String(n);
          } else {
            value = String(value == null ? '' : value);
          }
          const ns = (key === 'title_tag' || key === 'description_tag') ? 'global' : 'custom';
          const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [{ ownerId: gid, namespace: ns, key, type, value }] });
          const errs = sd && sd.metafieldsSet && sd.metafieldsSet.userErrors;
          if (errs && errs.length) return res.status(200).json({ success: false, error: errs[0].message });
          return res.status(200).json({ success: true });
        } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
      }

      // ── ACTION: set-blog-gallery ── (Publish report: pick a Shoppable Gallery by name → set it AND add its
      // 2 priciest products (the Collective / partner items) to the Product List, keeping the 2 About Wall Art.)
      // Input: { articleGid, galleryId }. Output: { success, products, added }.
      if (req.body.action === 'set-blog-gallery') {
        const gid = String(req.body.articleGid || '').trim();
        const galId = String(req.body.galleryId || '').trim();
        if (!gid || !galId) return res.status(400).json({ error: 'articleGid and galleryId required' });
        try {
          const gf = await getGitHubFile('data/galleries.json');
          const gsRaw = JSON.parse(gf.content || '[]');
          const arr = Array.isArray(gsRaw) ? gsRaw : (gsRaw.galleries || []);
          const g = arr.find(x => x && String(x.id) === galId);
          if (!g) return res.status(200).json({ success: false, error: 'That gallery was not found.' });
          const galProds = ((g.images) || [])
            .map(im => ({ gid: im.productId ? ('gid://shopify/Product/' + im.productId) : '', price: parseFloat(im.productPrice) || 0 }))
            .filter(x => x.gid).sort((a, b) => b.price - a.price);
          const seen = new Set(), gg = [];
          for (const x of galProds) { if (!seen.has(x.gid)) { seen.add(x.gid); gg.push(x.gid); } }
          const galleryGids = gg.slice(0, 2);
          // keep the article's current Product List (the 2 About Wall Art), add the gallery's 2
          let current = [];
          try { const q = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { metafield(namespace:"custom", key:"blog_products_list"){ value } } } }`, { id: gid }); current = JSON.parse((q && q.node && q.node.metafield && q.node.metafield.value) || '[]'); } catch (e) { current = []; }
          if (!Array.isArray(current)) current = [];
          const merged = [], mseen = new Set();
          [...current, ...galleryGids].forEach(x => { if (x && !mseen.has(x)) { mseen.add(x); merged.push(x); } });
          const finalList = merged.slice(0, 4);
          const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [
            { ownerId: gid, namespace: 'custom', key: 'shoppable_gallery_new', type: 'number_integer', value: String(parseInt(galId, 10)) },
            { ownerId: gid, namespace: 'custom', key: 'blog_products_list', type: 'list.product_reference', value: JSON.stringify(finalList) }
          ] });
          const errs = sd && sd.metafieldsSet && sd.metafieldsSet.userErrors;
          if (errs && errs.length) return res.status(200).json({ success: false, error: errs[0].message });
          return res.status(200).json({ success: true, products: finalList.length, added: galleryGids.length });
        } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
      }

      // ── ACTION: write-blog-sources ── (Stage 2 STEP 1: find real authority link + video + trend links)
      // Split from the body write so neither step runs long enough to time out, and the screen can show real progress.
      // Input: { keyword, title }. Output: { success, featuredBase, authority, youtube, trendsHtml }
      if (req.body.action === 'write-blog-sources') {
        const wbKeyword = String(req.body.keyword || '').trim();
        const wbTitle   = String(req.body.title || '').trim();
        if (!wbKeyword || !wbTitle) return res.status(400).json({ error: 'keyword and title required' });
        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const featuredBase = slugify(wbTitle).slice(0, 60) || slugify(wbKeyword);
        let sources = { authorityTitle: '', authorityUrl: '', youtubeTitle: '', youtubeLink: '' };
        try { sources = await generateContentSources(wbKeyword, wbTitle); } catch (e) { /* leave blank; body still writes */ }
        let trendsHtml = '';
        try { const vi = await generateVisualInspiration(wbKeyword, wbTitle, ''); trendsHtml = (vi && vi.html) || ''; } catch (e) { /* optional */ }
        return res.status(200).json({
          success: true,
          featuredBase,
          authority: { title: sources.authorityTitle, url: sources.authorityUrl },
          youtube: { title: sources.youtubeTitle, link: sources.youtubeLink },
          trendsHtml
        });
      }

      // ── ACTION: write-blog-body ── (Stage 2 STEP 2: write the full body using the sources from step 1)
      // Input: { keyword, title, brief?, authority?, youtube?, trendsHtml? }
      // Output: { success, bodyHtml (with [[IMG|...]] + [[PRODUCT|...]] markers), featuredBase, authority, youtube }
      if (req.body.action === 'write-blog-body' || req.body.action === 'write-blog') {
        const wbKeyword = String(req.body.keyword || '').trim();
        const wbTitle   = String(req.body.title || '').trim();
        const brief     = req.body.brief && typeof req.body.brief === 'object' ? req.body.brief : {};
        if (!wbKeyword || !wbTitle) return res.status(400).json({ error: 'keyword and title required' });

        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const featuredBase = slugify(wbTitle).slice(0, 60) || slugify(wbKeyword);

        // Sources come from step 1 if provided; otherwise fetch them here (keeps the old one-shot path working).
        let sources = {
          authorityTitle: (req.body.authority && req.body.authority.title) || '',
          authorityUrl:   (req.body.authority && req.body.authority.url) || '',
          youtubeTitle:   (req.body.youtube && req.body.youtube.title) || '',
          youtubeLink:    (req.body.youtube && req.body.youtube.link) || ''
        };
        let trendsHtml = String(req.body.trendsHtml || '');
        if (!sources.authorityUrl && !sources.youtubeLink && req.body.authority === undefined) {
          try { sources = await generateContentSources(wbKeyword, wbTitle); } catch (e) { /* leave blank */ }
        }
        if (!trendsHtml) {
          try { const vi = await generateVisualInspiration(wbKeyword, wbTitle, ''); trendsHtml = (vi && vi.html) || ''; } catch (e) { /* optional */ }
        }

        // The competitor number is the whole-page target; the theme adds ~500 words below the body
        // (FAQ + summary + related), so the BODY targets that minus 500 — but never under 1,000.
        const competitorTarget = Math.min(2500, parseInt(brief.wordTarget, 10) || 2200); // hard cap 2500 words
        const wordTarget = Math.max(1000, competitorTarget - 500);
        const mustCover = Array.isArray(brief.mustCover) ? brief.mustCover.filter(Boolean) : [];
        const gaps = Array.isArray(brief.gaps) ? brief.gaps.filter(Boolean) : [];
        const angle = String(brief.angle || '').trim();
        // This blog may FUSE several near-duplicate searches into one post (see find-fusion-groups) —
        // each secondary keyword must get covered as its own H2 so the merged post still wins all of them.
        const secondaryAngles = Array.isArray(req.body.secondaryAngles)
          ? req.body.secondaryAngles.map(s => (s && s.keyword) ? String(s.keyword) : String(s || '')).filter(Boolean)
          : [];

        const BANNED = 'Delve, Spearheading, Embarking, Embark, Compelling, Empowering, Encompassing, Comprehensively, Effectively, Beacon, Dive, Showcasing, Remarked, Aligns, Surpassing, Tragically, Impacting, Prioritize, Prioritizing, Sparking, Standout, Hindering, Advancements, Aiding, Fostering, Multifaceted, Revolutionary, Testament, Elevate, journey. Banned phrases: "in the ever-evolving world of", "at the forefront of", "in summary", "in conclusion", "in essence", "it\'s important to note", "emerges as a beacon", "dive into", "study aims to explore", "plays a significant role in shaping", "explores themes", "gain valuable insights".';

        const authorityLine = sources.authorityUrl
          ? `A real authority article was found — use it once, as a natural in-body link next to the fact it supports, inside the More-About section: <a href="${sources.authorityUrl}" target="_blank" rel="noopener">${(sources.authorityTitle || 'this guide').replace(/"/g, '')}</a>. Do NOT invent any other external link.`
          : `No authority article was found — write the More-About section WITHOUT an external link (do not invent one).`;
        const watchLine = sources.youtubeLink
          ? `A real YouTube video was found. Write the WATCH section as: <p><strong>WATCH:</strong> <a href="${sources.youtubeLink}" target="_blank" rel="noopener">${(sources.youtubeTitle || 'watch the video').replace(/"/g, '')}</a></p> then on the next line put the marker [[VIDEO|${sources.youtubeLink}]] where the video embed should go.`
          : `No video was found — SKIP the WATCH section entirely (do not invent a video).`;

        const curYear = new Date().getFullYear();
        const nextYear = curYear + 1;

        // ── AlsoAsked tree (optional) ── Mae can drop an AlsoAsked CSV export before writing. It carries a
        //    People-Also-Ask question tree where the hierarchy lives in "tier 1 position" / "tier 2 position"
        //    (tier1 = branch; tier1>0 + tier2=0 = the branch's parent question; tier2>0 = its sub-questions).
        //    We use ONLY the questions + structure (answers are blank/locked on the free plan). Parsed here so a
        //    multi-line quoted CSV never breaks. Fed to the writer as section structure — irrelevant PAA drift ignored.
        function parseCsvRecords(text) {
          const rows = []; let row = [], field = '', inQ = false;
          const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inQ) {
              if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else { inQ = false; } }
              else field += ch;
            } else if (ch === '"') { inQ = true; }
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else field += ch;
          }
          if (field.length || row.length) { row.push(field); rows.push(row); }
          return rows;
        }
        function buildAlsoAskedOutline(csv) {
          const rows = parseCsvRecords(csv);
          if (rows.length < 2) return '';
          const header = rows[0].map(h => String(h || '').trim().toLowerCase());
          const qi = header.indexOf('question'), t1i = header.indexOf('tier 1 position'), t2i = header.indexOf('tier 2 position');
          if (qi === -1 || t1i === -1 || t2i === -1) return '';
          const branches = {};
          for (let r = 1; r < rows.length; r++) {
            const rec = rows[r]; if (!rec || !rec.length) continue;
            const q = String(rec[qi] || '').trim(); if (!q) continue;
            const t1 = parseInt(rec[t1i], 10), t2 = parseInt(rec[t2i], 10);
            if (!Number.isInteger(t1) || t1 <= 0) continue; // skip the seed row (tier1=0)
            if (!branches[t1]) branches[t1] = { parent: '', children: [] };
            if (t2 === 0) branches[t1].parent = q;
            else if (Number.isInteger(t2)) branches[t1].children.push(q);
          }
          const lines = [];
          Object.keys(branches).map(n => parseInt(n, 10)).sort((a, b) => a - b).forEach(k => {
            const b = branches[k]; const parent = b.parent || b.children[0] || ''; if (!parent) return;
            const seen = new Set([parent.toLowerCase()]);
            const kids = b.children.filter(c => { const lc = c.toLowerCase(); if (seen.has(lc)) return false; seen.add(lc); return true; });
            lines.push('- ' + parent + (kids.length ? '\n' + kids.map(c => '   · ' + c).join('\n') : ''));
          });
          return lines.join('\n');
        }
        let alsoAskedBlock = '';
        try {
          if (req.body.alsoAskedCsv) {
            const outline = buildAlsoAskedOutline(String(req.body.alsoAskedCsv));
            if (outline) alsoAskedBlock = `
RESEARCH QUESTION TREE (from AlsoAsked / Google "People Also Ask") — use this to SHAPE the blog. Turn the branches that genuinely FIT this blog into H2 sections, and make sure the blog naturally answers the relevant sub-questions within those sections. This is raw People-Also-Ask data, so some questions are OFF-TOPIC for wall art / this blog (unrelated feng-shui, house-price or sleep questions, etc.) — IGNORE anything that does not fit; never force an irrelevant question in. Do NOT keyword-stuff; cover naturally in Mae's voice.
${outline}
`;
          }
        } catch (e) { alsoAskedBlock = ''; }

        const bodyPrompt = `You are Mae Osz, a friendly UK home-decor advisor writing a blog for aboutwallart.com (wall art + home decor). Write the FULL blog body as clean HTML.

YEARS — CRITICAL: AVOID putting a year anywhere unless it is genuinely necessary — most of the time the blog reads better with no year at all, so leave it out. When a year is truly needed, use ${nextYear} (we are near the end of ${curYear}); only use ${curYear} if it is strictly factually required, and NEVER an earlier year such as ${curYear - 1}.

BLOG TITLE (use as the reader's main question): "${wbTitle}"
MAIN KEYWORD: "${wbKeyword}"
${angle ? `WINNING ANGLE: ${angle}` : ''}
TARGET LENGTH: at least ${wordTarget} words IN THE BODY (this already leaves ~500 words for the FAQ/summary/related sections that render below the body). Match or beat this — never write less.
${mustCover.length ? `MUST COVER these topics as H2 sections: ${mustCover.join('; ')}.` : ''}
${gaps.length ? `WIN ON these gaps the top pages miss (add as extra H2 sections): ${gaps.join('; ')}.` : ''}
${secondaryAngles.length ? `FUSED SEARCH TERMS — this post merges several near-duplicate searches into ONE blog so they stop competing with each other: cover EACH of these as its own H2 section, using its exact phrase naturally in that section's heading and text (no keyword-stuffing): ${secondaryAngles.map(s => `"${s}"`).join('; ')}.` : ''}
${alsoAskedBlock}
VOICE (this is what makes it sound human, not AI):
- First person (I / we), a warm, friendly personal decorator advisor talking directly to the reader — like a friend who styles homes for a living.
- Write with real PERSONALITY. In several sections, include a short personal anecdote or a real problem-and-fix — "I once helped a client whose...", "the mistake I always see is...", "here's what happened when I tried...". You MAY invent these anecdotes naturally (a client, a room, a mistake) — keep them realistic and grounded. NEVER invent hard facts, brands, prices, stats or URLs.
- Talk TO the reader — ask the odd genuine question, acknowledge how they feel.
- Keep paragraphs SHORT: 2 to 4 sentences maximum. Break long explanations into several short paragraphs so it never becomes a wall of text.
- UK spelling always. "decor" with NO accent, everywhere.
- Grounded and practical, NEVER poetic or brochure-like. Write the way you'd actually talk.
- The main keyword MUST appear in the first sentence, and naturally in 1-2 headings — do NOT stuff it.
- BANNED words/phrases (never use any of these): ${BANNED}

EXACT ORDER (follow precisely):
1. Bold first paragraph that directly answers the main question. Wrap it in <p><strong>...</strong></p>.
2. Author bio, italic, on its own line: <p><em>By Mae Osz | Interior Design Consultant &amp; Home Decor Expert with 12+ years of experience.</em></p>
3. Hook — a relatable question ("Have you ever..."), its own paragraph. In it link the words wall art to the Google Business Profile: <a href="https://share.google/RKuQBBwmgZBHOL1VQ" target="_blank" rel="noopener">wall art</a>.
4. Quick Answer box — EXACTLY this grey box, no border, no rounded corners: <div style="background:#ededed;padding:16px 20px;margin:24px 0;"><strong>Quick answer:</strong> 2-3 sentence direct answer.</div>
5. Intro paragraph — context + a plain definition. In it, link unique wall art to <a href="https://aboutwallart.com/pages/unique-wall-art">/pages/unique-wall-art</a> and unique home decor to <a href="https://aboutwallart.com/pages/home-decor-items">/pages/home-decor-items</a> (use those exact URLs; invent no others).
6. Contents — a bold line (NOT a heading) exactly: <p><strong>List of Contents</strong></p> then a <ul> listing every H2 below.
7. The MAIN body sections — one <h2> per topic from MUST COVER, plus the GAPS as their own sections. EVERY H2 section (main and gap sections alike), in this order:
   a. <h2> heading (SEO-friendly, keyword/topic based).
   b. A direct 2-3 sentence answer paragraph.
   c. An image marker on its own line — EVERY section gets one, EXACT shape: [[IMG|filename-slug|3:2|photo|FULL PROMPT]] where FULL PROMPT is the complete image instruction YOU write for this section (see IMAGE RULES). Set kind to "photo" or "infographic" per the IMAGE RULES.
   d. Either an <h3> + a <ul> of practical bullets, OR a comparison <table>.
   e. In several sections (not all), a short personal anecdote paragraph (invented but realistic — a client, a room, a fix).
   f. A callout in EXACTLY this grey box (no border, no rounded corners): <div style="background:#ededed;padding:16px 20px;margin:24px 0;"><strong>Pro Tip:</strong> ...</div> or the same box with <strong>Real Example:</strong>.
8. Product markers — place AT LEAST 7 markers total across the whole blog, in the most product-relevant sections (NOT one in every section). Each on its own line: [[PRODUCT|the specific thing this section is about]]. AT LEAST 4 of these MUST be WALL ART markers — word each of those with "wall art", "prints", "wall pictures" or "artwork" so it is clearly wall art (e.g. [[PRODUCT|coastal wall art prints for the living room]]). The other markers are for non-art decor items (a lamp, a rug, a plant, etc.).
9. Visual-Inspiration section — an <h2> with an SEO-usable heading (about styles/looks, NOT just "Visual Inspiration"), a short intro line, then the marker [[TRENDS]] on its own line.
10. More-About section — an <h2> with an SEO-usable heading (NOT just "More About"), a bold lead sentence, then the supporting paragraph. ${authorityLine}
11. WATCH section. ${watchLine}
12. A closing section — an <h2> heading, a short warm wrap-up that speaks directly to the reader, and END with a genuine question to the reader to keep them engaged (a friendly question, NOT a salesy call to action). Do NOT use the words "in conclusion" or "in summary".

HARD RULES:
- Do NOT write any FAQ / "People Also Ask" / "Frequently Asked Questions" section — questions live elsewhere.
- Do NOT write a "Key Takeaways" section.
- The WATCH / video section is the LAST visual piece of the blog: do NOT place any image markers [[IMG|...]] or product markers [[PRODUCT|...]] in it or anywhere after it. Only the short closing text comes after the video.
- EVERY H2 body section gets its own [[IMG|...]] marker (see IMAGE RULES). Include at least ONE <table>.
- Place AT LEAST 7 [[PRODUCT|...]] markers total: AT LEAST 4 must be WALL ART (worded with "wall art"/"prints"/"artwork" so they are recognised as wall art), plus at least 3 for other decor items (Collective) — the actual products are chosen later.
- Keep every paragraph to 2-4 sentences.
- Use ONLY the exact links given above. Never invent a URL, product, price or fact (anecdotes are the only thing you may invent).
- Output ONLY the blog body HTML (start at the first <p>). No <html>, <head>, <body>, no markdown fences, no commentary.

IMAGE RULES — YOU write the full prompt for every image; the generator only draws exactly what you write:
- Marker shape: [[IMG|filename-slug|3:2|photo|FULL PROMPT]] (filename = short SEO slug; ratio 3:2 for body images; kind "photo" or "infographic").
- PHOTO (the default) — the FULL PROMPT begins: "Photoreal editorial interior photography, full bleed, calm muted palette, Scandi-minimal / Japandi styling unless this section is about another interior style. Natural soft light, no text, logos or watermarks. Do NOT add framed wall art, prints or pictures on the walls (the store's real wall art is shown separately through product images). Other wall decor is welcome and encouraged — shelves, macramé hangings, wall lighting/sconces, mirrors, hanging plants — style the walls naturally and lived-in." THEN describe the EXACT scene for THIS section (the specific room, decor, objects, colours, action named in the text — plants, materials, lighting, furniture, etc.). THEN the people: include a person in EVERY photo, in a natural candid pose, appropriate to the context — a couple (a man and a woman) for bedroom/romantic, a child or baby with a parent for nursery/kids, friends for entertaining, a family including older relatives for festive, a person actively holding/comparing swatches for a colour or material section; otherwise one person. Vary ethnicity genuinely across the blog (a real mix, not always white). Do NOT depict gay, lesbian or transgender couples. The ONLY exception where people are optional is a pure materials/textures close-up (a still-life with no people is fine there).
- INFOGRAPHIC — use kind "infographic" ONLY when the section is genuinely a COMPARISON, before/after, proportion, measurement, steps, or a stats/checklist. NEVER for a plain tip list or a room scene. When it is, the FULL PROMPT must be: "Clean minimal educational infographic, plain WHITE background, photoreal, all text solid BLACK. A short centred title near the top, then a clear VISUAL comparison (two labelled photos side by side, or simple labelled icons/steps), minimal words, generous white space, nothing near the edges. No people, no watermarks." THEN name the exact comparison/steps to show.
- Aim for about 3 infographics WHERE THEY GENUINELY FIT; if fewer sections truly suit one, that is fine — never mislabel a room scene as an infographic.

HERO IMAGE — at the VERY END, after the closing paragraph, output ONE line exactly: [[HERO|FULL PROMPT]] — one strong square featured scene for this blog (the reader's main situation/room, editorial look as above, NO framed wall art but other wall decor welcome, the keyword idea reflected in the setting). DESCRIBE THE ROOM/SCENE ONLY — do NOT put a specific person in it, and do NOT say how many people; leave the person completely open (the 5 featured options each add a different person). This is the ONLY place you describe the hero; it becomes 5 variations later.

TITLE — also at the VERY END, output ONE line exactly: [[TITLE|the blog's H1]] where the H1 is a compelling, click-worthy blog title for a real reader: specific and benefit- or curiosity-driven, Title Case, UK spelling, includes the topic naturally, 40-70 characters, NO year unless genuinely useful, NOT the bare keyword, NOT clickbait, NOT ALL CAPS, no quotes. This is the blog's real H1 title.`;

        // Bigger ceiling so a long body (every section imaged, a table, 6 products) always finishes.
        let bodyHtml = await callClaudeText(bodyPrompt, 16000);
        bodyHtml = bodyHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        // Pull the hero (featured) image prompt out of the body — it's not part of the body.
        let heroPrompt = '';
        bodyHtml = bodyHtml.replace(/\[\[HERO\|([\s\S]*?)\]\]/, (m, p) => { heroPrompt = (p || '').trim(); return ''; }).trim();
        // Pull the H1 title the SAME write call produced (one call — no extra AI request): shown on the card + reused at publish.
        let h1Title = '';
        bodyHtml = bodyHtml.replace(/\[\[TITLE\|([\s\S]*?)\]\]/, (m, p) => { h1Title = (p || '').trim().replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' '); return ''; }).trim();
        // Inject the real trend links into the Visual-Inspiration marker.
        if (trendsHtml) bodyHtml = bodyHtml.replace(/\[\[TRENDS\]\]/g, trendsHtml);
        else bodyHtml = bodyHtml.replace(/\[\[TRENDS\]\]/g, '');
        // Turn a [[VIDEO|url]] marker into a full-bleed responsive embed.
        bodyHtml = bodyHtml.replace(/\[\[VIDEO\|(https?:\/\/[^\]]+)\]\]/g, (m, u) => {
          const idm = String(u).match(/[?&]v=([^&]+)/) || String(u).match(/youtu\.be\/([^?&]+)/);
          const id = idm ? idm[1] : '';
          return id ? `<div style="position:relative;width:100%;padding-bottom:56.25%;margin:16px 0;"><iframe src="https://www.youtube.com/embed/${id}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe></div>` : '';
        });

        const blogCode = await stableBlogCode(wbKeyword, null); // permanent code for this blog's images
        return res.status(200).json({
          success: true,
          bodyHtml,
          featuredBase,
          heroPrompt,
          blogCode,
          h1Title,
          authority: { title: sources.authorityTitle, url: sources.authorityUrl },
          youtube: { title: sources.youtubeTitle, link: sources.youtubeLink }
        });
      }

      // ── ACTION: get-blog-code ── the permanent per-blog image code (data/blog-codes.json). Used by the image-prompts
      // step so a blog's images are ALWAYS named with the same code the finish/publish steps look them up by.
      if (req.body.action === 'get-blog-code') {
        const code = await stableBlogCode(String(req.body.keyword || ''), String(req.body.fallback || ''));
        return res.status(200).json({ success: true, code });
      }

      const { keyword, url, title, perspective, galleryCode, collectionUrl, writeToSheet } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const newRow = `${csvField(keyword)},${csvField(url || 'N/A')},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,To_Write_Blog,${detectIntent(url || 'N/A')},`;
      const updatedRegistry = registry.content.trimEnd() + '\n' + newRow + '\n';
      await updateGitHubFile('data/keyword-locker-registry.csv', updatedRegistry, registry.sha, `Add to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'TO_WRITE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as TO_WRITE: ${keyword}`);

      let sheetsResult = null;
      if (writeToSheet) {
        try {
          sheetsResult = await appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl);
        } catch (sheetsError) {
          console.error('Google Sheets append failed (non-fatal):', sheetsError.message);
          sheetsResult = { error: sheetsError.message };
        }
      }

      return res.status(200).json({ success: true, keyword, url, sheetsResult });
    }

    // ============================================
    // PATCH
    // ============================================
    if (req.method === 'PATCH') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'KEYWORD_CHANGE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as KEYWORD_CHANGE: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    // ============================================
    // DELETE
    // ============================================
    if (req.method === 'DELETE') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const registryLines = registry.content.split('\n');
      const filteredRegistry = registryLines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        const cols = parseCSVLine(trimmed);
        return !(cols[0] === keyword && cols[9] === 'To_Write_Blog');
      }).join('\n');
      await updateGitHubFile('data/keyword-locker-registry.csv', filteredRegistry, registry.sha, `Undo to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = '';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Clear status: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
