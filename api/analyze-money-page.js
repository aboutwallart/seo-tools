// Money Page Optimizer Backend API
// Handles SerpAPI, PageSpeed, web scraping, and Claude analysis

// analyze-money-page.js — v51.5
// v51.5 (Aug 2, 2026): M4 — (1) How-To schema fix. A contradictory rule ("NEVER return HowTo
//                        schema for a blog") meant custom.ai_how_to_schema_markup was NEVER written
//                        on any blog. Removed the ban; the "How-To Schema" aiItem is now generated
//                        ONLY when the blog TITLE contains "how to" (prompt-gated + server-side strip
//                        as a safety net), and pushed to its own metafield. (2) Template metafields
//                        (More About text/url, Home decor trends title, Complete the look title, +
//                        AI snippets) are now generated on EVERY blog template — the templateChecks
//                        block was gated to ne-blog-posts/guest-post only, so other templates got none.
// v51.4 (June 29, 2026): MANUAL COMPETITORS fallback. If the request includes manualCompetitors[]
//                        (URLs), SerpAPI is skipped and the analysis runs on those. If SerpAPI is
//                        called and returns 0 competitors, respond { needsManual:true } (200) so the
//                        tool can ask for the 3 URLs instead of dead-ending. Covers SerpAPI hiccups
//                        AND the monthly search limit.
// v51.3 (June 29, 2026): BATCH 4 (products). Preserve existing internal links on a description
//                        rewrite: capture the current body's internal links, set each anchor by the
//                        chain (registry locked keyword for that URL → Link Whisperer auto-link
//                        keyword → existing anchor), tell the rewrite to keep them, and REPORT any the
//                        rewrite dropped (preservedLinksMissing) so interlinking is never silently
//                        lost. Helpers: extractInternalLinks / loadRegistryByUrl / loadAutolinkByUrl.
// v51.2 (June 29, 2026): BATCH 3 fixes. (#3) drop an outbound "Links to Add" item when keyword
//                        over-use already handles that exact sentence (over-use wins). (#4) never flag
//                        the contents-list heading (List of Contents/Contents/Index) in h2Sections —
//                        the Table of Contents block owns it. (#9) the updated contents list keeps
//                        ONLY real section titles (drops leaked sentences / "More About" lines). (#5)
//                        max_tokens 12000→20000 so long blogs stop truncating into invalid JSON.
// v51.1 (June 29, 2026): BATCH 3 support — loser-page links and related-blog links now also carry the
//                        target page's shopifyId/type/blogId (targetId/targetType/targetBlogId) so the
//                        inbound-link PUSH can edit that page directly via shopify-files push-edits.
// v51.0 (June 29, 2026): BATCH 2 (blog tidy-ups + quality checks). (1) Never flag a video/WATCH
//                        section for rename or removal. (2) De-dup: drop an H2 rename when keyword
//                        over-use already handles that exact text (over-use wins). (3) Updated
//                        Table of Contents no longer lists the contents heading itself as a bullet.
//                        (4) Buzzword check now uses her EXACT banned-words list. (5) British-English
//                        check switched to curated map + a safe -ize/-ise pattern with exceptions;
//                        removed the false flags while→whilst, among→amongst and the risky vocab
//                        swaps fall/shade/pillow. (Author bio: unchanged, per her decision.)
// v50.1 (June 29, 2026): FACTS-ONLY find/replace + schema guard (Batch 1, Part B). (1) Every
//                        "find this exact text" item (keyword over-use + H2 rename/remove) is now
//                        checked against the REAL page (live headings + body blocks + metafield
//                        text): snapped to the closest real line, or DROPPED if it isn't really on
//                        the page — so the merchant is never sent to find invented text. (2) Schema
//                        / Q&A prompts can no longer fabricate specifics (price, size, material,
//                        GSM, counts, ratings, dates, guarantees) unless the fact is in the real
//                        page data. (See buildPageHaystack / matchRealLine.)
// v50.0 (June 29, 2026): FACTS-ONLY link guard (Batch 1, Part A). Internal links can no longer be
//                        invented. (1) Loser links: kept ONLY when the URL is a real registry loser
//                        page; none in registry → none shown. (2) Outbound links: kept ONLY when they
//                        point at a real tag-related blog (the relatedBlogs list) — validated on the
//                        actual pasted href; the AI can no longer pick a collection/product/page.
//                        (3) Related-blog "paste after this line" rebuilt from each source blog's REAL
//                        body so it is always findable. Blog prompt tightened to match.
// v49.9 (June 29, 2026): updatedTableOfContents now generates BY DEFAULT whenever H2s are renamed/
//                        added/removed — no longer gated on detecting a "List/Table of Contents"
//                        heading (blogs whose contents list is called "Index" etc. were being
//                        skipped). She decides whether to paste it.
// v49.8 (June 28, 2026): Missing Buttons detection FIX. Old promos wrap the image AND the CTA text
//                        ("Show me this product!" / "Click here to see this product!") inside ONE
//                        product link with NO styled button — v49.7 mistook that CTA text for a real
//                        button and skipped them. Now a "proper button" = an anchor STYLED with a
//                        background colour (the black box); any product-image promo without one is
//                        flagged. Catches all old text-link promos + image-only promos.
// v49.7 (June 28, 2026): PROMO FIXER — Step 1 (find & show, read-only). (1) Dead Products: the
//                        inactive-product scan now also returns the dead product's own image
//                        (featuredImage) so the tool can show its thumbnail. (2) NEW Missing Buttons
//                        detection (findMissingButtonPromos): finds product-image promos that have NO
//                        "Shop Here" button, plus plain-text CTA phrases with no link (handle unknown
//                        → user identifies). Skips handles already flagged as dead (no overlap).
//                        Returned as response.missingButtons (blogs + collections). No store writes.
// v49.6 (June 28, 2026): EXACT placement everywhere. Loser pages ("Internal Links to Add") and a
//                        blog's own outbound links (internalLinksToAdd) now get a real findAnchor —
//                        the tool reads each target page's live body (loser bodies are already
//                        fetched for the admin link) and returns the EXACT existing line to paste
//                        after + the real section heading. No more vague "roughly where". Applies to
//                        all page types (blogs, products, pages, collections). Helpers: pickBodyAnchor.
// v49.5 (June 27, 2026): (1) "Free UK shipping!" meta append is now PRODUCTS-ONLY (was all types).
//                        (2) relatedBlogLinks gains "findAnchor" — the EXACT existing line to search for
//                        (paste-after / replace target) so the new step-by-step link cards can give a
//                        copy-and-find string. (loserPageLinks have no body fetched, so no exact line there.)
// v49.4 (June 27, 2026): PRODUCTS — if the description already uses the optimised template, the AI now
//                        JUDGES whether it is well-optimised and, if so, returns descriptionAlreadyOptimised
//                        (no rewrite). If no template, it ALWAYS rewrites. Over-use is dropped only when a
//                        rewrite IS returned (body replaced), so the rewrite and the over-use check can
//                        never contradict each other again.
// v49.3 (June 27, 2026): BATCH B — (1) "Free UK shipping!" auto-appended to every suggestedMeta
//                        (meta budget tightened 155→135 so it always fits). (2) Concrete placement
//                        now ALSO returned as structured placementSection + placementWhere on
//                        internalLinksToAdd / relatedBlogLinks / loserPageLinks (so the merchant sees
//                        section + paragraph at a glance). (3) Blogs with a List of Contents get a
//                        deterministic updatedTableOfContents (final H2 titles after renames/adds/removes).
// v49.2 (June 24, 2026): SPEED — the 3 competitors are now analysed IN PARALLEL (Promise.all)
//                        instead of one-after-another, to stop big pages hitting the 60s serverless
//                        timeout (was causing HTTP 504). SAME competitors, SAME depth, SAME output —
//                        only faster. Also set explicit maxDuration:60 (Hobby cap, matches blogs.js).
// v49.1 (June 24, 2026): BLOG QUALITY CHECKS — deterministic scanBlogQuality() (no AI) for articles.
//                        Scans body + excerpt + all metafields and returns blogQuality:{ britishEnglish,
//                        buzzwords, brandedLinks, authorBio }. List-only (merchant find/replaces) — the
//                        tool never auto-edits. Article fetch now also pulls summary_html (the excerpt).
// v49.0 (June 22, 2026): NE-BLOG-POSTS fixes — never put "People Also Ask" H2 in h2Sections / never
//                        rename it (it's the people_also_ask_new metafield); don't flag more_about_/
//                        people_also_ask_new/home_decor_trends_title/complete_the_look in over-use.
// v48.9 (June 22, 2026): NE-BLOG-POSTS template branch — PAA metafield now starts with the
//                        "Frequently Asked Questions About [Topic]" title line; templateChecks
//                        gains more_about_text (→ more_about_new_only_text + more_about_),
//                        more_about_url (→ more_about_new link, reuse/fetch authority),
//                        home_decor_trends_title, complete_the_look_title; authority folded into
//                        More About (no inline body link); "Feeling inspired" never flagged.
// v48.8 (June 22, 2026): PRODUCTS voice — intro was too poetic/formal (user: "no friend talks like
//                        this"); the styling sections were spot-on. Prompt now forces the INTRO into
//                        the same grounded, practical, chatty voice as "How to Style", bans poetic/
//                        abstract/brochure phrasing (with concrete anti-examples), and swaps the gold-
//                        standard example to that plain-spoken styling voice.
// v48.7 (June 22, 2026): PRODUCTS voice restore — the v48.6 trim made descriptions read flat/AI;
//                        product prompt now leads with WARMTH (first-person advisor, personal
//                        touches, a question), demotes the "tight/skimmable" pressure, and embeds
//                        the user-approved sample as a gold-standard TONE example. Duplicate-content
//                        fix kept (options still excluded from the body).
// v48.6 (June 22, 2026): PRODUCTS duplicate-content fix — product description no longer repeats the
//                        frames/perspex/canvas/papers/sizes/mounts/personalisation block (that now
//                        lives in a shared THEME section). The tool writes ONLY unique-per-product
//                        content (intro + What's Included + How to Style + What to Consider).
//                        ⚠️ Requires the theme options section to be live first.
// v48.5 (June 22, 2026): Indexability check — extractSEOData now reads the page's robots meta
//                        (noindex) and canonical, returns yourPage.indexability {noindex,
//                        canonical, canonicalMismatch, ok} so the frontend can show a green/red
//                        banner (don't optimise a page Google is told to ignore).
// v48.4 (June 22, 2026): PRODUCTS PR2 — product prompt now returns loserPageLinks + relatedBlogLinks
//                        (data sections + rules); getRelatedBlogLinks runs for products; heading
//                        keyword rule added (exact keyword in AT MOST 2 headings, variations elsewhere).
//                        Frontend enables Linked References + Image SEO for products (no rename-image
//                        field for products).
// v48.3 (June 22, 2026): PRODUCTS readability — product description restructured: skimmable short
//                        paragraphs, sizes as a bullet list, "What's Included" heading now includes
//                        the product title, dropped the "N prints" bullet, last bullet is "Choose
//                        between framed and unframed options".
// v48.2 (June 22, 2026): FIX — product analysis was failing JSON.parse (long description HTML had
//                        raw line breaks / double-quoted attrs → fell back to raw text, no blocks).
//                        Parser now repairs raw control chars before parse; product prompt forces
//                        single-quoted HTML attributes + one-line strings + no code fences.
// v48.1 (June 22, 2026): PRODUCTS PR1 — new buildProductAnalysisPrompt (shopifyType 'product'):
//                        full description REWRITE in locked AboutWallArt voice/structure (variant-
//                        aware, never invents facts) + 3 rich-text H2 snippets (comparison_snippet,
//                        how_to_block, comparison_table) + over-use + competitor badges + no-stuffing/
//                        cannibalisation. Product fetch now pulls options/type/tags/metafields/image.
// v48.0 (June 22, 2026): FIX — getRelatedBlogLinks now also runs for pages (was returning []
//                        for shopifyType 'page', so related-blog links never appeared on pages).
// v47.9 (June 22, 2026): PAGES P3 (reuse blocks) — page prompt now also returns loserPageLinks
//                        (weaker pages linking INTO this page) and relatedBlogLinks (older blogs
//                        linking INTO this page), with their data sections + rules. Linked
//                        References + Image SEO enabled for pages on the frontend.
// v47.8 (June 22, 2026): PAGES P3 (part) — server now builds the THREE question fields from the
//                        Q&A set: related_questions (rich_text H3+list), people_also_ask_this
//                        (rich_text bold-paragraph), people_also_ask (multi_line plain). Page
//                        prompt returns browseTheCollection; page fetch resolves the inner
//                        collection (custom.related_collection) → st.browseTargetGid so the
//                        heading can be pushed to THAT collection's browse_the_collection.
// v47.7 (June 22, 2026): PAGES P2 (page-only fields) — page prompt now also returns faqIntro
//                        (rich_text), seoBodyBlock (single_line one-liner), unsureWhereToStart
//                        (single_line) and bodyAddition (h2 body section). Server-side builds
//                        faqSchemaJson (FAQPage, SAME questions as the Q&A set) + pageSchemaJson
//                        (CollectionPage) so the JSON is always valid. Push handled by existing
//                        engine (rich_text / single_line / json all supported for pages).
// v47.6 (June 22, 2026): PAGES P1 (backbone) — new buildPageAnalysisPrompt routed on
//                        shopifyType === 'page'; returns SEO copy fields, Comparison Snippet
//                        (rich_text H3) + Comparison Table (single_line one-liner), a single
//                        questionSet (fills the 3 page question fields in P3), keyword over-use
//                        + competitor-driven badges, NO-stuffing/NO-cannibalisation rules. Page
//                        fetch now also pulls ALL metafields for the over-use check.
// v47.5 (June 22, 2026): COLLECTION fixes — competitorDriven flag now MUST be set true for
//                        competitor-gap recommendations (badges show reliably); added an explicit
//                        NO-CANNIBALISATION rule + made the NO-STUFFING rule prominent; added
//                        "Visit the Content Hub"/"Content Hub" to the never-flag shared-section list.
// v47.4 (June 21, 2026): COLLECTIONS cleanup — collection prompt no longer returns
//                        pageSchema or brandBlock (theme renders both site-wide), and the
//                        brand/About section is now in the never-flag list (no remove/rename).
// v47.3 (June 21, 2026): COLLECTIONS C3 — reuse blocks enabled for collections:
//                        Linked References (getLinkedReferences + self-exclude in collections),
//                        related-blog links INTO the collection (relatedBlogs section added to
//                        the collection prompt; pickRelatedBlogs works without tags via title),
//                        inactive-product links, and collection featured image for Image SEO.
// v47.2 (June 21, 2026): COLLECTIONS C2 — collection prompt now also returns "add" H2
//                        sections (destined for the seo_text_links_ rich-text field) and a
//                        browseTheCollection SEO heading. FAQ schema pushed to faq_schema.
// v47.1 (June 21, 2026): COLLECTIONS C1 — dedicated buildCollectionAnalysisPrompt
//                        (competitor-driven + over-use + the 3 AI snippets in their exact
//                        collection-metafield formats, each carrying its target metafieldKey).
//                        Collection fetch now also pulls all metafields for the over-use check.
// v47.0 (June 21, 2026): Blog item #5 — Linked reference metafields. New getLinkedReferences
//                        returns linkedBlogs (reuse related-blog picks → Article GIDs),
//                        linkedCollections (top 3 by keyword/tag/title overlap → Collection
//                        GIDs) and linkedTrends (up to 2 matching "...TREND" pages → Page
//                        GIDs). Added to the response as linkedReferences; pushed via
//                        shopify-files push-metafields (reference-list support).
// v46.9 (June 21, 2026): PERF — related-blog matching now reads the cached blog index
//                        (data/blog-index.json, PUBLISHED blogs only) instead of fetching
//                        the whole blog list live every run; falls back to the live fetch
//                        if the index is missing. Matching now also weighs TITLE words
//                        (secondary signal; tags still lead). Only the chosen 3 blog bodies
//                        are still pulled live.
// v46.8 (June 20, 2026): Item 4 — over-use fixes that live in a metafield now carry
//                        metafieldKey so the frontend can push the corrected value
//                        directly (rich-text fields keep their links via patch-leading).
// v46.7 (June 20, 2026): Inactive-product replacements —
// v46.7 (June 20, 2026): Inactive-product replacements — for each inactive product link,
//                        suggest up to 3 ACTIVE replacements (same product type, closest
//                        style by tag overlap), each with title + product URL + first image
//                        URL. (Block always shown on the frontend, even when clean.)
// v46.6 (June 20, 2026): (a) CONCRETE placement — related blogs now include a section
//                        outline so the link placement names the exact section + paragraph
//                        position (also applies to internalLinksToAdd). (b) Item 2 —
//                        inactive-product-link check: scans the blog body for product links
//                        and flags any that are draft/archived/removed (inactiveProducts).
// v46.5 (June 20, 2026): Item 6 — related-blog internal links.
// v46.5 (June 20, 2026): Item 6 — related-blog internal links. Picks 3 related OLDER blogs
//                        by shared TAGS (rare/specific tags weighted via IDF, broad ones
//                        down-weighted; older preferred = already crawled). Anchor MUST be
//                        this page's main keyword; replace if present in the source blog,
//                        else a new CTA. Returns relatedBlogLinks (+ direct admin link to
//                        each source blog). Registry loserPageLinks still shown alongside.
// v46.4 (June 20, 2026): Competitor-driven analysis —
// v46.4 (June 20, 2026): Competitor-driven analysis — feeds FULL competitor data (pos 1-3:
//                        title/meta/H1/H2/H3) and drives every add/replace/REMOVE from the
//                        comparison; each h2Section/aiItem/internalLink carries
//                        competitorDriven flag; h2Sections gains a "remove" action (body
//                        content hurting SEO). H2 CASE fix (content headings natural case,
//                        never forced caps). Item 7 old-template checks (SHOP HERE button,
//                        YouTube embed, authority source) via templateChecks.
// v46.3 (June 20, 2026): AI snippets — generate ALL that genuinely fit, not just one:
//                        Related Questions + Summary Block always; Comparison Snippet only
//                        with a real comparison; How-To Schema only for true step-by-step
//                        posts (as JSON-LD, never on non-how-to content). Each in its exact
//                        push-ready format.
// v46.2 (June 20, 2026): Parsing fix — read the AI answer reliably by slicing from the
//                        first "{" to the last "}" (handles ```json fences / stray text
//                        that previously made the whole results page dump raw JSON with no
//                        blocks/buttons). Raised max_tokens 7000→12000 as insurance.
// v46.1 (June 20, 2026): Step 1 fixes — (a) H2 CAPS rule: never suggest caps→sentence-case,
//                        always output H2 text in UPPERCASE (theme uses all-caps H2s);
//                        (b) new internalLinksToAdd field: concrete outbound internal links
//                        (anchor + url + exact paragraph, replace-or-new) instead of vague
//                        otherActions instructions.
// v46.0 (June 20, 2026): Blog keyword over-use check — pulls ALL article metafields +
//                        full body + every live-page heading (incl. theme/custom-Liquid
//                        sections), then returns keywordOveruse findings (exact current
//                        text + reword-to-X or remove, per spot). Excludes global/shared
//                        theme chrome. "Add" sections now must respect existing content
//                        (no duplicates, no keyword-padding) before suggesting more.
// v45.9 (June 20, 2026): Blog quick fixes — (1) new firstParagraph field: an optimised
//                        opening body paragraph that directly addresses the keyword's
//                        question (copy-only, pasted manually); (2) blogs no longer
//                        generate image filename/alt otherActions (Image SEO handles them);
//                        (5) KEYWORD USAGE rule added to stop exact-keyword over-optimisation.
// v45.8 (June 18, 2026): Internal-link admin links — each loser page now resolves to a
//                        DIRECT Shopify admin URL (opens the actual post/product, not a search).
// v45.7 (June 18, 2026): Batch 4 — blog prompt now returns (1) replacementText for each
//                        "change" H2 (clean text to paste), (2) peopleAlsoAsk in two forms
//                        (body HTML + plain-text metafield), and (3) aiItems in the exact
//                        snippet-metafield HTML format.
// v45.6 (June 18, 2026): Image list now also includes the blog's MAIN (featured) image,
//                        flagged isMain, alongside the in-body images.
// v45.5 (June 18, 2026): Blog body images — extracts the images used in the blog body
//                        (src, current alt, filename) and returns them for the on-demand
//                        image SEO feature. No extra Claude cost here.
// v45.4 (June 18, 2026): Blog body HTML output — new ("add") blog sections are returned
//                        as complete paste-ready HTML (h2 + p, full anchors, no stray text).
// v45.3 (June 18, 2026): Blog Quick Answer — blog analysis returns a ready-to-paste
//                        grey Quick Answer box (exact structure, British English).
// v45.2 (June 18, 2026): Blog-specific analysis — blogs use a dedicated prompt that
//                        drops Page/FAQ/Brand schema (theme handles them) and never
//                        flags the "More about" external authority link for removal.
// v45.1 (June 18, 2026): Blog template detection — reads the article's theme template
//                        suffix (e.g. ne-blog-posts) and passes it through for display.
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const PAGESPEED_KEY = process.env.GOOGLE_API_KEY;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const STORE_HANDLE = (SHOPIFY_DOMAIN || '').replace(/\.myshopify\.com$/i, '') || 'aboutwallart';

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pageUrl, keyword } = req.body;

    if (!pageUrl || !keyword) {
      return res.status(400).json({ error: 'Missing pageUrl or keyword' });
    }

    const startTime = Date.now();
    console.log(`[Money Page] Analyzing: ${pageUrl} for keyword: "${keyword}"`);

    // Step 1: competitors. Use MANUAL competitor URLs if the merchant supplied them (SerpAPI down or
    // monthly limit reached); otherwise look them up via SerpAPI.
    const manualCompetitors = Array.isArray(req.body.manualCompetitors)
      ? req.body.manualCompetitors.map(u => String(u || '').trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 3)
      : [];
    let searchResults;
    if (manualCompetitors.length) {
      searchResults = { userPosition: null, competitors: manualCompetitors.map((url, i) => ({ position: i + 1, title: '', url })) };
      console.log(`[Money Page] Using ${manualCompetitors.length} MANUAL competitor URL(s) — SerpAPI skipped`);
    } else {
      console.log('[Money Page] Step 1: Finding competitors... (~10 sec)');
      searchResults = await findCompetitors(keyword, pageUrl);
      console.log(`[Money Page] ✓ User position: ${searchResults.userPosition || 'Not in top 10'} | Found ${searchResults.competitors.length} competitors (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      // SerpAPI returned nothing → don't dead-end. Tell the frontend to ask for manual URLs.
      if (searchResults.competitors.length === 0) {
        return res.status(200).json({ needsManual: true, error: 'SerpAPI returned no competitors (a hiccup or your monthly limit). Paste the top 3 competitor URLs to run the analysis.' });
      }
    }

    // Step 2: Analyze your page
    console.log('[Money Page] Step 2: Analyzing your page... (~15 sec)');
    const [yourPageData, shopifyContent] = await Promise.all([
      analyzePage(pageUrl, keyword, true),
      fetchShopifyContent(pageUrl)
    ]);
    if (shopifyContent) {
      yourPageData.shopifyId       = shopifyContent.shopifyId;
      yourPageData.shopifyBlogId   = shopifyContent.shopifyBlogId || null;
      yourPageData.shopifyType     = shopifyContent.shopifyType;
      yourPageData.shopifySeoTitle = shopifyContent.seoTitle;
      yourPageData.shopifySeoDesc  = shopifyContent.seoDescription;
      yourPageData.shopifyBodyHtml = shopifyContent.bodyHtml;
      yourPageData.shopifyExcerpt  = shopifyContent.excerpt || '';
      yourPageData.templateSuffix  = shopifyContent.templateSuffix || '';
      yourPageData.metafields      = shopifyContent.metafields || [];
      yourPageData.tags            = shopifyContent.tags || [];
      yourPageData.productOptions  = shopifyContent.productOptions || [];
      yourPageData.productType     = shopifyContent.productType || '';
      // Keep the FULL live-page headings (whole rendered page, incl. theme/custom-Liquid
      // sections) for the keyword over-use check, BEFORE the body-only override below.
      yourPageData.liveHeadings = { h1: [...yourPageData.h1], h2: [...yourPageData.h2], h3: [...yourPageData.h3] };
      // Prefer Shopify SEO fields over scraped values when available
      if (shopifyContent.seoTitle)       yourPageData.title           = shopifyContent.seoTitle;
      if (shopifyContent.seoDescription) yourPageData.metaDescription = shopifyContent.seoDescription;
      // Re-extract H2s from clean Shopify body HTML — removes theme noise and Liquid variables
      if (shopifyContent.bodyHtml) {
        const cleanH2s = (shopifyContent.bodyHtml.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [])
          .map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim())
          .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);
        if (cleanH2s.length > 0) yourPageData.h2 = cleanH2s;
      }
      // Filter any remaining Liquid variables from scraped H2s
      yourPageData.h2 = yourPageData.h2.filter(h => !h.includes('{{') && !h.includes('}}'));
      console.log(`[Money Page] ✓ Shopify: ${shopifyContent.shopifyType} ID ${shopifyContent.shopifyId}`);
    } else {
      // Even without Shopify, filter Liquid variables from scraped H2s
      yourPageData.h2 = yourPageData.h2.filter(h => !h.includes('{{') && !h.includes('}}'));
      console.warn('[Money Page] Shopify content unavailable — using scraped data');
    }
    console.log(`[Money Page] ✓ Your page analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 3: Analyze competitors
    console.log('[Money Page] Step 3: Analyzing 3 competitors IN PARALLEL... (~15 sec)');
    const _topCompetitors = searchResults.competitors.slice(0, 3);
    // Analyse all 3 at once instead of one-after-another — same competitors, same depth,
    // same results — just faster, so big pages stay under the serverless timeout. map()
    // preserves order, so competitorData stays in position order after filtering nulls.
    const _competitorResults = await Promise.all(
      _topCompetitors.map(async (comp) => {
        console.log(`[Money Page]   - Analyzing position ${comp.position}: ${comp.url}`);
        const data = await analyzePage(comp.url, keyword);
        return data ? { position: comp.position, ...data } : null;
      })
    );
    const competitorData = _competitorResults.filter(Boolean);
    console.log(`[Money Page] ✓ All competitors analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 4: Analyze content gaps
    console.log('[Money Page] Step 4: Analyzing content gaps...');
    const contentGaps = analyzeContentGaps(yourPageData, competitorData);
    console.log(`[Money Page] ✓ Found ${contentGaps.missingH2s.length} missing H2s, ${contentGaps.missingAIOptimization.length} missing AI elements`);

    // Step 4.5: Fetch loser pages that should link TO this winner page
    const loserPages = await getLosersForPage(pageUrl);
    console.log(`[Money Page] Found ${loserPages.length} loser pages for internal linking`);

    // Step 4.6: related OLDER blogs to link FROM into this page (baseline of 3, by tags)
    const relatedBlogs = await getRelatedBlogLinks(yourPageData, keyword);
    console.log(`[Money Page] Found ${relatedBlogs.length} related older blogs for internal linking`);

    // Step 4.7: scan blog/collection body for inactive product links
    let pageOrigin = ''; try { pageOrigin = new URL(pageUrl).origin; } catch { pageOrigin = ''; }
    const _scanInactive = yourPageData.shopifyType === 'article' || (yourPageData.shopifyType || '').includes('collection');
    const inactiveProducts = _scanInactive
      ? await findInactiveProductLinks(yourPageData.shopifyBodyHtml, pageOrigin) : [];
    console.log(`[Money Page] Found ${inactiveProducts.length} inactive product links`);

    // Step 4.75: Missing Buttons (read-only, deterministic) — product images without a Shop Here
    // button + plain-text CTAs with no link. Skips handles already flagged as inactive/dead.
    const missingButtons = _scanInactive
      ? findMissingButtonPromos(yourPageData.shopifyBodyHtml, pageOrigin, inactiveProducts.map(p => p.handle))
      : [];
    console.log(`[Money Page] Found ${missingButtons.length} missing-button promos`);

    // Step 4.8: linked-reference metafields (blogs) — Linked Blogs / Collections / Trends
    const linkedReferences = await getLinkedReferences(yourPageData, keyword);
    console.log(`[Money Page] Linked refs — blogs:${linkedReferences.linkedBlogs.length} collections:${linkedReferences.linkedCollections.length} trends:${linkedReferences.linkedTrends.length}`);

    // Step 4.9: deterministic Blog Quality Checks (blogs only — no AI)
    const blogQuality = yourPageData.shopifyType === 'article'
      ? scanBlogQuality(yourPageData) : null;
    if (blogQuality) {
      console.log(`[Money Page] Blog Quality — UK:${blogQuality.britishEnglish.length} buzz:${blogQuality.buzzwords.length} links:${blogQuality.brandedLinks.length} bio:${blogQuality.authorBio ? 'needed' : 'ok'}`);
    }

    // Step 4.95: PRODUCTS — capture existing internal links so the rewrite preserves them. Anchor
    // per chain: registry locked keyword for that URL → Link Whisperer auto-link keyword → existing
    // anchor. Reported back if the rewrite drops any (never silently lose interlinking).
    if (yourPageData.shopifyType === 'product') {
      try {
        const links = extractInternalLinks(yourPageData.shopifyBodyHtml || '');
        if (links.length) {
          const [regByUrl, autoByUrl] = await Promise.all([loadRegistryByUrl(), loadAutolinkByUrl()]);
          yourPageData.preserveLinks = links.map(l => {
            const k = _normInternal(l.url);
            return { url: l.url, anchor: regByUrl.get(k) || autoByUrl.get(k) || l.anchor };
          });
          console.log(`[Money Page] Product: ${yourPageData.preserveLinks.length} existing internal links to preserve`);
        }
      } catch (e) { console.warn('[preserveLinks]', e.message); }
    }

    // Step 5: Get Claude analysis
    console.log('[Money Page] Step 5: Getting AI recommendations... (~20 sec)');
    const analysis = await getClaudeAnalysis(yourPageData, competitorData, keyword, searchResults.userPosition, contentGaps, loserPages, relatedBlogs);
    console.log(`[Money Page] ✓ AI analysis complete! Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Append the standard shipping CTA to the meta description — PRODUCTS ONLY. Kept out of the
    // prompt so it is guaranteed present; the meta budget was tightened to 135 chars so it always fits.
    if (yourPageData.shopifyType === 'product' && analysis?.structured && analysis.structured.suggestedMeta) {
      let _m = String(analysis.structured.suggestedMeta).trim();
      if (!/free uk shipping/i.test(_m)) {
        _m = _m.replace(/[\s.!?]+$/, '');               // drop any trailing punctuation/space first
        analysis.structured.suggestedMeta = `${_m}. Free UK shipping!`;
      }
    }

    // Build a deterministic "updated Table of Contents" for blogs that HAVE a List of Contents.
    // When H2s are renamed / added / removed, this is the full final H2 list (in order) ready to
    // paste — so the merchant's contents list never goes stale. No AI: built from the body + h2Sections.
    if (yourPageData.shopifyType === 'article' && analysis?.structured) {
      try {
        const _body = yourPageData.shopifyBodyHtml || '';
        // Generate the contents list BY DEFAULT whenever H2s change — no matter what the blog's
        // contents list is called (Index, Contents, List of Contents…) or whether it has one.
        // It's only shown when there ARE H2 changes (_changed below); she decides whether to use it.
        const _hasToc = true;
        if (_hasToc) {
          // current H2 titles in document order
          const _h2s = [];
          const _re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
          let _mm;
          while ((_mm = _re.exec(_body)) !== null) {
            const _t = _mm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
            // Exclude the contents heading itself — it's the title, not a bullet in the list.
            if (_t && !/^(list of contents|table of contents|contents|index|in this article|on this page|jump to|quick links)$/i.test(_t)) _h2s.push(_t);
          }
          const _norm = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
          const _changes = Array.isArray(analysis.structured.h2Sections) ? analysis.structured.h2Sections : [];
          let _toc = _h2s.slice();
          // apply renames + removes against the current list
          for (const _c of _changes) {
            if (!_c || _c.action === 'add') continue;
            const _idx = _toc.findIndex(h => _norm(h) === _norm(_c.heading));
            if (_idx === -1) continue;
            if (_c.action === 'remove') _toc.splice(_idx, 1);
            else if (_c.replacementText && _c.replacementText.trim()) _toc[_idx] = _c.replacementText.trim();
          }
          // append any brand-new sections
          for (const _c of _changes) {
            if (_c && _c.action === 'add' && _c.heading && _c.heading.trim()) _toc.push(_c.heading.trim());
          }
          // Keep ONLY real section titles — drop anything that leaked in as a full sentence
          // (e.g. a "More About" authority line) or the contents label itself.
          _toc = _toc.filter(t => {
            const x = (t || '').trim();
            if (!x) return false;
            if (/^(list of contents|table of contents|contents|index)$/i.test(x)) return false;
            if (/[.!?]$/.test(x)) return false;            // sentences end in punctuation; headings don't
            if (x.split(/\s+/).length > 12) return false;  // too long to be a heading
            return true;
          });
          const _changed = _changes.some(c => c && (c.action === 'add' || c.action === 'remove' || (c.action !== 'add' && c.replacementText && c.replacementText.trim())));
          if (_toc.length && _changed) analysis.structured.updatedTableOfContents = _toc;
        }
      } catch (e) { /* non-fatal — ToC is a nicety */ }
    }

    // M4: How-To schema belongs ONLY on blogs whose TITLE contains "how to". Belt-and-braces —
    // strip any How-To Schema aiItem the AI returned for a blog whose title is not a "how to".
    if (yourPageData.shopifyType === 'article' && analysis?.structured && Array.isArray(analysis.structured.aiItems)) {
      const _blogTitle = ((shopifyContent && shopifyContent.shopifyTitle) || yourPageData.title || '').toLowerCase();
      if (!/how\s*to/.test(_blogTitle)) {
        analysis.structured.aiItems = analysis.structured.aiItems.filter(it => !/how.?to/i.test((it && it.element) || ''));
      }
    }

    // Products: the keyword over-use check only makes sense when the body is KEPT. If a full
    // rewrite is returned, the old body is replaced — so its over-use findings are moot. Drop them
    // (when the description is "already optimised" there is no rewrite, so over-use stays and edits
    // the body you are keeping — coherent, like blogs/collections/pages).
    if (yourPageData.shopifyType === 'product' && analysis?.structured) {
      const _pst = analysis.structured;
      if (_pst.productDescription && String(_pst.productDescription).trim()) _pst.keywordOveruse = null;
      // Report any existing internal link the rewrite did NOT carry over (so she re-adds it).
      if (Array.isArray(yourPageData.preserveLinks) && _pst.productDescription && String(_pst.productDescription).trim()) {
        const dl = String(_pst.productDescription).toLowerCase();
        _pst.preservedLinksMissing = yourPageData.preserveLinks.filter(l => {
          const k = _normInternal(l.url);
          return !(k && (dl.includes(k) || dl.includes(String(l.url).toLowerCase())));
        });
      }
    }

    // ── FACTS-ONLY: verify find/replace items against the REAL page (v50.1) ──────
    // "Find this text" items (keyword over-use + H2 rename/remove) must point at text that truly
    // exists. Snap each to the closest real line; drop anything that isn't really on the page so the
    // merchant is never sent to find invented text.
    if (analysis?.structured) {
      const st = analysis.structured;
      const pageLines = buildPageHaystack(yourPageData);
      if (st.keywordOveruse && Array.isArray(st.keywordOveruse.findings)) {
        st.keywordOveruse.findings = st.keywordOveruse.findings.filter(f => {
          if (!f || !f.currentText) return false;
          const real = matchRealLine(f.currentText, pageLines);
          if (real) { f.currentText = real; return true; }
          return false;                                     // not on the page → invented → drop
        });
        if (!st.keywordOveruse.findings.length) st.keywordOveruse.isOverstuffed = false;
      }
      // Texts already handled by keyword over-use → an H2 rename for the same text is a duplicate.
      const overuseTexts = new Set();
      if (st.keywordOveruse && Array.isArray(st.keywordOveruse.findings)) {
        st.keywordOveruse.findings.forEach(f => { const n = _normTxt(f.currentText); if (n) overuseTexts.add(n); });
      }
      if (Array.isArray(st.h2Sections)) {
        st.h2Sections = st.h2Sections.filter(h => {
          if (!h || h.action === 'add') return true;        // "add" has no current text to find
          if (!h.heading) return false;
          // Never flag a video/WATCH section for rename OR removal — a WATCH H2 is fine SEO.
          if (/\b(watch|youtube|video)\b/i.test(h.heading)) return false;
          // The contents list is owned by the Updated Table of Contents block — never also flag it here.
          if (/^\s*(list of contents|table of contents|contents|index)\s*$/i.test(h.heading)) return false;
          const real = matchRealLine(h.heading, pageLines);
          if (!real) return false;                          // rename/remove of text not on page → drop
          h.heading = real;
          // De-dup: keyword over-use wins — drop an H2 rename for text it already handles.
          if (h.action !== 'remove' && overuseTexts.has(_normTxt(h.heading))) return false;
          return true;
        });
      }
      // De-dup across blocks: if keyword over-use already handles a sentence, drop the outbound
      // "Links to Add From This Article" item that targets the SAME sentence (over-use wins).
      if (Array.isArray(st.internalLinksToAdd)) {
        st.internalLinksToAdd = st.internalLinksToAdd.filter(l => {
          const t = _normTxt(l && l.existingText || '');
          return !(t && overuseTexts.has(t));
        });
      }
    }

    // Pages (P2): build guaranteed-valid JSON for the FAQ schema (SAME questions as the
    // Q&A set) and the Page schema — server-side so the JSON is always valid and matches.
    if (yourPageData.shopifyType === 'page' && analysis?.structured) {
      const st = analysis.structured;
      const qs = Array.isArray(st.questionSet) ? st.questionSet.filter(q => q && q.question && q.answer) : [];
      if (qs.length) {
        st.faqSchemaJson = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: qs.map(q => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } }))
        });
      }
      const cleanUrl = (yourPageData.url || pageUrl || '').split('?')[0];
      st.pageSchemaJson = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: st.suggestedTitle || yourPageData.title || '',
        description: st.suggestedMeta || yourPageData.metaDescription || '',
        url: cleanUrl,
        provider: { '@type': 'Organization', name: 'AboutWallArt', url: 'https://aboutwallart.com' }
      });

      // Build the THREE question/FAQ fields from the SAME Q&A set, each in its own format.
      if (qs.length) {
        const topic = (keyword || '').replace(/\b\w/g, c => c.toUpperCase());
        st.relatedQuestionsHtml = `<h3>People Also Ask About ${topic}</h3><ul>${qs.map(q => `<li><strong>${q.question}</strong> — ${q.answer}</li>`).join('')}</ul>`;
        st.peopleAlsoAskThisHtml = `<p><strong>Frequently Asked Questions About ${topic}</strong></p>${qs.map((q, i) => `<p><strong>${i + 1}. ${q.question}</strong></p><p>${q.answer}</p>`).join('')}`;
        st.peopleAlsoAskText = qs.map(q => q.answer).join(' ');
      }

      // Browse the Collection push target — the collection living INSIDE this page.
      if (shopifyContent && shopifyContent.relatedCollectionGid) {
        st.browseTargetGid = shopifyContent.relatedCollectionGid;
      }
    }

    // ── FACTS-ONLY LINK GUARD (v50.0) ───────────────────────────────────────
    // Internal links may ONLY point at REAL pages, never an address the AI made up.
    //   (1) Loser links   → must be a real registry loser page (getLosersForPage).
    //   (2) Outbound links → must be a real tag-related blog (the relatedBlogs list).
    // Anything else is dropped before it can ever be shown or pushed.
    const normUrl = u => String(u || '').toLowerCase().trim()
      .replace(/^https?:\/\/www\./, 'https://').replace(/\/+$/, '').split(/[?#]/)[0];

    // (1) Loser links: keep ONLY URLs sourced from the registry. None in registry → none shown.
    if (analysis?.structured?.loserPageLinks?.length > 0) {
      const validLoserUrls = new Set(loserPages.map(l => normUrl(l.loserUrl)));
      analysis.structured.loserPageLinks = analysis.structured.loserPageLinks
        .filter(link => link.loserUrl && validLoserUrls.has(normUrl(link.loserUrl)));
    }
    // Resolve a DIRECT Shopify admin URL + exact paste line for each (surviving) loser page.
    if (analysis?.structured?.loserPageLinks?.length > 0) {
      await Promise.all(analysis.structured.loserPageLinks.map(async (link) => {
        try {
          const c = await fetchShopifyContent(link.loserUrl);
          link.adminUrl = buildLoserAdminUrl(c);
          // Target page IDs → let the inbound-link push edit THIS loser page directly (reuses push-edits).
          if (c) { link.targetId = c.shopifyId; link.targetType = c.shopifyType; link.targetBlogId = c.shopifyBlogId || null; }
          // EXACT placement: read the loser page's real body → exact line to paste after + real section.
          const lp = loserPages.find(x => normUrl(x.loserUrl) === normUrl(link.loserUrl)) || {};
          const a = pickBodyAnchor(c && c.bodyHtml, lp.loserKeyword || link.placementSection || keyword);
          if (a) {
            link.findAnchor = a.findAnchor;
            link.placementSection = a.section || link.placementSection || '';
            link.placementWhere = 'right after this line';
          }
        } catch { link.adminUrl = null; }
      }));
    }

    // (2) Outbound links: keep ONLY links that point at a real tag-related blog. Validate the
    //     ACTUAL pasted href (read from newText), not just the url field, so nothing invented slips by.
    if (analysis?.structured?.internalLinksToAdd?.length > 0) {
      const validOutUrls = new Set((relatedBlogs || []).map(b => normUrl(b.url)));
      analysis.structured.internalLinksToAdd = analysis.structured.internalLinksToAdd.filter(link => {
        const hrefMatch = String(link.newText || '').match(/href=["']([^"']+)["']/i);
        const pasted = hrefMatch ? hrefMatch[1] : link.url;
        return pasted && validOutUrls.has(normUrl(pasted));
      });
    }
    // EXACT placement for a blog's OWN outbound links (internalLinksToAdd → pasted into THIS body).
    if (analysis?.structured?.internalLinksToAdd?.length > 0) {
      const myBody = yourPageData.shopifyBodyHtml || '';
      analysis.structured.internalLinksToAdd.forEach((link) => {
        const isReplace = String(link.mode || '').toLowerCase() === 'replace';
        if (isReplace && link.existingText) {
          link.findAnchor = exactLineFrom(link.existingText);          // the line being replaced IS the exact line
        } else {
          const a = pickBodyAnchor(myBody, link.anchorText || link.placementSection || keyword);
          if (a) {
            link.findAnchor = a.findAnchor;
            link.placementSection = a.section || link.placementSection || '';
            link.placementWhere = 'right after this line';
          }
        }
      });
    }

    // (3) Related-blog links: admin URL + rebuild the "paste after this line" from the source blog's
    //     REAL body (the AI's findAnchor can be approximate → make it always findable).
    if (analysis?.structured?.relatedBlogLinks?.length > 0) {
      await Promise.all(analysis.structured.relatedBlogLinks.map(async (link) => {
        try {
          const c = await fetchShopifyContent(link.sourceUrl);
          link.adminUrl = buildLoserAdminUrl(c);
          // Target page IDs → let the inbound-link push edit THIS source blog directly (reuses push-edits).
          if (c) { link.targetId = c.shopifyId; link.targetType = c.shopifyType; link.targetBlogId = c.shopifyBlogId || null; }
          const real = realLineForKeyword(c && c.bodyHtml, keyword);
          if (real) {
            link.findAnchor = real.findAnchor;
            link.placementSection = real.section || link.placementSection || '';
            link.placementWhere = real.where;
          }
        } catch { link.adminUrl = null; }
      }));
    }

    // Return results
    return res.status(200).json({
      userPosition: searchResults.userPosition,
      yourPage: yourPageData,
      competitors: competitorData,
      contentGaps: contentGaps,
      analysis: analysis,
      blogQuality: blogQuality,
      inactiveProducts: inactiveProducts,
      missingButtons: missingButtons,
      linkedReferences: linkedReferences,
      bodyImages: buildImageList(shopifyContent),
      shopify: shopifyContent ? {
        id:      shopifyContent.shopifyId,
        blogId:  shopifyContent.shopifyBlogId || null,
        type:    shopifyContent.shopifyType,
        title:   shopifyContent.seoTitle,
        meta:    shopifyContent.seoDescription
      } : null
    });

  } catch (error) {
    console.error('[Money Page] Error:', error.message);
    console.error('[Money Page] Stack:', error.stack);
    
    // Return a user-friendly error
    return res.status(500).json({ 
      error: error.message || 'Analysis failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Find top competitors using SerpAPI and check user's position
async function findCompetitors(keyword, userUrl) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    let organicResults = data.organic_results || [];
    // Fallback: if SerpAPI is out of credits / returns nothing, try Scrappa (same organic_results shape).
    if (!organicResults.length && process.env.SCRAPPA_KEY) {
      try {
        const sr = await fetch(`https://scrappa.co/api/search?query=${encodeURIComponent(keyword)}&gl=gb&hl=en`, { headers: { 'x-api-key': process.env.SCRAPPA_KEY } });
        const sd = await sr.json();
        if (Array.isArray(sd.organic_results) && sd.organic_results.length) {
          organicResults = sd.organic_results;
          console.log(`[Scrappa] fallback used — ${organicResults.length} results`);
        }
      } catch (e) { console.error('[Scrappa] Error:', e); }
    }
    
    // Normalize URLs for comparison
    const normalizeUrl = (url) => {
      return url.toLowerCase()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '');
    };
    
    const normalizedUserUrl = normalizeUrl(userUrl);
    let userPosition = null;
    const competitors = [];

    organicResults.forEach((result, index) => {
      const position = index + 1;
      const resultUrl = result.link;
      const normalizedResultUrl = normalizeUrl(resultUrl);

      // Check if this is the user's page
      if (normalizedResultUrl === normalizedUserUrl || normalizedResultUrl.startsWith(normalizedUserUrl)) {
        userPosition = position;
        console.log(`[SerpAPI] Found user's page at position ${position}`);
      }

      // Collect top 3 that aren't the user's page
      if (position <= 3 && normalizedResultUrl !== normalizedUserUrl) {
        competitors.push({
          position: position,
          title: result.title,
          url: resultUrl
        });
      }
    });

    // If user is in top 3, get position 4 to have 3 competitors
    if (userPosition && userPosition <= 3 && competitors.length < 3) {
      for (let i = 3; i < organicResults.length && competitors.length < 3; i++) {
        const result = organicResults[i];
        const normalizedResultUrl = normalizeUrl(result.link);
        if (normalizedResultUrl !== normalizedUserUrl) {
          competitors.push({
            position: i + 1,
            title: result.title,
            url: result.link
          });
        }
      }
    }

    console.log(`[SerpAPI] Found ${competitors.length} competitors. User position: ${userPosition || 'Not in top 10'}`);
    
    return {
      userPosition: userPosition,
      competitors: competitors.slice(0, 3)
    };

  } catch (error) {
    console.error('[SerpAPI] Error:', error);
    return { userPosition: null, competitors: [] };
  }
}

// Analyze a single page
async function analyzePage(url, keyword, fetchPageSpeed = false) {
  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const html = await response.text();

    // Extract SEO data
    const seoData = extractSEOData(html, url, keyword);

    // Get PageSpeed scores if requested (only for user's page)
    if (fetchPageSpeed) {
      console.log('[PageSpeed] Fetching mobile and desktop scores...');
      const [mobile, desktop] = await Promise.all([
        getPageSpeedScore(url, 'mobile'),
        getPageSpeedScore(url, 'desktop')
      ]);
      
      return {
        ...seoData,
        speedMobile: mobile,
        speedDesktop: desktop
      };
    }

    // NO PageSpeed for competitors - saves time
    return {
      ...seoData,
      speedMobile: 'N/A',
      speedDesktop: 'N/A'
    };

  } catch (error) {
    console.error(`[Analyze] Error analyzing ${url}:`, error);
    return null;
  }
}

// Extract SEO data from HTML
function extractSEOData(html, url, keyword) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const metaDescription = metaMatch ? metaMatch[1].trim() : '';

  // Extract H1
  const h1Matches = html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [];
  const h1 = h1Matches.map(m => m.replace(/<\/?h1[^>]*>/gi, '').trim());

  // Extract H2 — filter Liquid template variables from Shopify themes
  const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
  const h2 = h2Matches
    .map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim())
    .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);

  // Extract H3 — same filter
  const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];
  const h3 = h3Matches
    .map(m => m.replace(/<\/?h3[^>]*>/gi, '').trim())
    .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);

  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Word count
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Keyword count and density
  const keywordLower = keyword.toLowerCase();
  const textLower = text.toLowerCase();
  const keywordOccurrences = (textLower.match(new RegExp(keywordLower, 'g')) || []).length;
  const keywordDensity = wordCount > 0 ? ((keywordOccurrences / wordCount) * 100).toFixed(2) : 0;

  // Count links
  const internalLinks = (html.match(/<a[^>]*href=["'][^"']*["'][^>]*>/gi) || []).length;
  const externalLinks = (html.match(/<a[^>]*href=["']https?:\/\/[^"']*["'][^>]*>/gi) || []).length;

  // Count images
  const images = (html.match(/<img[^>]*>/gi) || []).length;

  // Detect AI Optimization Elements
  const aiOptimization = {
    hasBrandBlock: false,
    hasComparisonSnippet: false,
    hasFAQSchema: false,
    hasProductSchema: false,
    hasReviewSchema: false,
    hasBreadcrumbSchema: false,
    hasHowToSchema: false,
    hasTables: false,
    hasLists: false,
    hasRelatedQuestions: false,
    hasAuthor: false,
    hasDates: false,
    hasSummary: false
  };

  // Detect page type from URL
  const urlLower = url.toLowerCase();
  const isBlog = urlLower.includes('/blogs/') || urlLower.includes('/blog/') || urlLower.includes('/articles/');

  // Check for brand/about block with authority signals
  if (/about us|who we are|our story|why choose|founded|established|based in|uk.?based|leading|trusted|since \d{4}|guarantee/gi.test(textLower)) {
    aiOptimization.hasBrandBlock = true;
  }

  // Check for comparison/definition snippets
  if (/what is|what are|vs\s|versus|compared to|difference between|types of|kinds of/gi.test(textLower)) {
    aiOptimization.hasComparisonSnippet = true;
  }

  // Check for FAQ schema
  if (html.includes('FAQPage') || html.includes('"@type":"Question"')) {
    aiOptimization.hasFAQSchema = true;
  }

  // Check for Product schema
  if (html.includes('"@type":"Product"')) {
    aiOptimization.hasProductSchema = true;
  }

  // Check for Review/Rating schema
  if (html.includes('AggregateRating') || html.includes('"@type":"Review"')) {
    aiOptimization.hasReviewSchema = true;
  }

  // Check for Breadcrumb schema
  if (html.includes('BreadcrumbList')) {
    aiOptimization.hasBreadcrumbSchema = true;
  }

  // Check for How-To schema
  if (html.includes('"@type":"HowTo"')) {
    aiOptimization.hasHowToSchema = true;
  }

  // Check for tables
  if (/<table/i.test(html)) {
    aiOptimization.hasTables = true;
  }

  // Check for lists with 3+ items
  const ulMatches = html.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi) || [];
  const olMatches = html.match(/<ol[^>]*>[\s\S]*?<\/ol>/gi) || [];
  const allLists = [...ulMatches, ...olMatches];
  
  for (const list of allLists) {
    const liCount = (list.match(/<li/gi) || []).length;
    if (liCount >= 3) {
      aiOptimization.hasLists = true;
      break;
    }
  }

  // Check for Related Questions section
  if (/people also ask|related questions|you might also like|frequently asked|common questions/gi.test(textLower)) {
    aiOptimization.hasRelatedQuestions = true;
  }

  // Blog-specific checks
  if (isBlog) {
    // Check for author credentials
    if (/written by|author:|by\s+[A-Z][a-z]+\s+[A-Z][a-z]+|posted by/gi.test(text)) {
      aiOptimization.hasAuthor = true;
    }

    // Check for publish/update dates
    if (/published|updated|last modified|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december\s+\d{1,2},?\s+\d{4}/gi.test(text)) {
      aiOptimization.hasDates = true;
    }

    // Check for summary/TL;DR
    if (/tl;?dr|summary|key takeaways|in this article|table of contents/gi.test(textLower)) {
      aiOptimization.hasSummary = true;
    }
  }

  // Calculate AI Visibility Score
  const aiScore = calculateAIScore(aiOptimization, isBlog);

  // ── Indexability check ──────────────────────────────────────────────────────
  // Read the page's own hidden instructions to Google: a robots "noindex" (Google
  // won't list the page) and the canonical (if it points elsewhere, Google ranks
  // that other URL instead). Optimising a page that fails either is wasted effort.
  let noindex = false;
  const robotsMetas = html.match(/<meta[^>]+name=["']robots["'][^>]*>/gi) || [];
  for (const tag of robotsMetas) { if (/noindex/i.test(tag)) noindex = true; }
  const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const canonical = canonMatch ? canonMatch[1].trim() : '';
  const normalise = u => (u || '').split('#')[0].split('?')[0].replace(/\/$/, '').toLowerCase();
  const canonicalMismatch = !!canonical && normalise(canonical) !== normalise(url);
  const indexability = { noindex, canonical, canonicalMismatch, ok: !noindex && !canonicalMismatch };

  return {
    url,
    title,
    metaDescription,
    h1,
    h2,
    h3,
    wordCount,
    keywordOccurrences,
    keywordDensity: parseFloat(keywordDensity),
    internalLinks,
    externalLinks,
    images,
    aiOptimization,
    isBlog,
    aiScore,
    indexability
  };
}

// Build a DIRECT Shopify admin URL for a loser page from its resolved Shopify content.
// Products/collections live at the top level; blog posts and pages live under /content.
function buildLoserAdminUrl(c) {
  if (!c || !c.shopifyId) return null;
  const base = `https://admin.shopify.com/store/${STORE_HANDLE}`;
  if (c.shopifyType === 'product') return `${base}/products/${c.shopifyId}`;
  if (c.shopifyType && c.shopifyType.includes('collection')) return `${base}/collections/${c.shopifyId}`;
  if (c.shopifyType === 'page') return `${base}/content/pages/${c.shopifyId}`;
  if (c.shopifyType === 'article') return `${base}/content/articles/${c.shopifyId}`;
  return null;
}

// Build the full image list for a blog: the MAIN (featured) image first (flagged
// isMain), then the in-body images, deduplicated by src. No Claude cost.
function buildImageList(shopifyContent) {
  if (!shopifyContent) return [];
  let images = shopifyContent.bodyHtml ? extractBodyImages(shopifyContent.bodyHtml) : [];
  const mainSrc = shopifyContent.mainImage;
  if (mainSrc && /^https?:\/\//i.test(mainSrc)) {
    images = images.filter(i => i.src !== mainSrc);
    images.unshift({
      src: mainSrc,
      alt: shopifyContent.mainImageAlt || '',
      filename: mainSrc.split('/').pop().split('?')[0],
      isMain: true
    });
  }
  return images;
}

// ── BLOG QUALITY CHECKS (deterministic, no AI) ──────────────────────────────
// US → UK spelling map. Output only the pairs actually present. Match \bword\b
// case-insensitive; the merchant decides during manual find/replace. "decor"
// intentionally stays WITHOUT an accent — not in this map.
const US_TO_UK = {
  // -our
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring',
  favorite: 'favourite', favorites: 'favourites', favorited: 'favourited',
  favor: 'favour', favors: 'favours', favored: 'favoured',
  honor: 'honour', honored: 'honoured',
  neighbor: 'neighbour', neighbors: 'neighbours', neighborhood: 'neighbourhood',
  behavior: 'behaviour', behaviors: 'behaviours',
  glamor: 'glamour', humor: 'humour', humored: 'humoured',
  labor: 'labour', labors: 'labours', vigor: 'vigour',
  flavor: 'flavour', flavors: 'flavours', flavored: 'flavoured',
  odor: 'odour', odors: 'odours', rumor: 'rumour', rumors: 'rumours',
  splendor: 'splendour', endeavor: 'endeavour', endeavors: 'endeavours',
  harbor: 'harbour', armor: 'armour', candor: 'candour',
  // -re
  center: 'centre', centers: 'centres', centered: 'centred',
  meter: 'metre', meters: 'metres', theater: 'theatre', theaters: 'theatres',
  fiber: 'fibre', fibers: 'fibres', liter: 'litre', liters: 'litres',
  somber: 'sombre', luster: 'lustre', specter: 'spectre', caliber: 'calibre',
  // -ise / -isation
  organize: 'organise', organized: 'organised', organizing: 'organising', organization: 'organisation', organizations: 'organisations',
  realize: 'realise', realized: 'realised', realizing: 'realising',
  minimize: 'minimise', minimized: 'minimised', minimizing: 'minimising',
  maximize: 'maximise', maximized: 'maximised', maximizing: 'maximising',
  recognize: 'recognise', recognized: 'recognised', recognizing: 'recognising',
  analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing',
  emphasize: 'emphasise', emphasized: 'emphasised', emphasizing: 'emphasising',
  customize: 'customise', customized: 'customised', customizing: 'customising',
  harmonize: 'harmonise', harmonized: 'harmonised',
  visualize: 'visualise', visualized: 'visualised', visualizing: 'visualising',
  utilize: 'utilise', utilized: 'utilised', utilizing: 'utilising',
  prioritize: 'prioritise', prioritized: 'prioritised', prioritizing: 'prioritising',
  accessorize: 'accessorise', accessorized: 'accessorised', accessorizing: 'accessorising',
  modernize: 'modernise', modernized: 'modernised', modernizing: 'modernising',
  personalize: 'personalise', personalized: 'personalised', personalizing: 'personalising',
  specialize: 'specialise', specialized: 'specialised', specializing: 'specialising',
  finalize: 'finalise', finalized: 'finalised', finalizing: 'finalising',
  normalize: 'normalise', normalized: 'normalised',
  optimize: 'optimise', optimized: 'optimised', optimizing: 'optimising', optimization: 'optimisation',
  characterize: 'characterise', characterized: 'characterised',
  categorize: 'categorise', categorized: 'categorised', categorizing: 'categorising',
  summarize: 'summarise', summarized: 'summarised', summarizing: 'summarising',
  stabilize: 'stabilise', stabilized: 'stabilised',
  neutralize: 'neutralise', neutralized: 'neutralised',
  symbolize: 'symbolise', symbolized: 'symbolised',
  synchronize: 'synchronise', synchronized: 'synchronised',
  authorize: 'authorise', authorized: 'authorised',
  capitalize: 'capitalise', capitalized: 'capitalised', capitalizing: 'capitalising',
  criticize: 'criticise', criticized: 'criticised', criticizing: 'criticising',
  // -ogue
  catalog: 'catalogue', catalogs: 'catalogues', dialog: 'dialogue', analog: 'analogue', monolog: 'monologue',
  // -ce
  defense: 'defence', offense: 'offence', pretense: 'pretence',
  // doubled / dropped l
  jewelry: 'jewellery', skillful: 'skilful', fulfill: 'fulfil', fulfilled: 'fulfilled',
  enroll: 'enrol', instill: 'instil',
  traveling: 'travelling', traveled: 'travelled', labeling: 'labelling', labeled: 'labelled',
  modeling: 'modelling', paneling: 'panelling', canceling: 'cancelling', canceled: 'cancelled',
  leveling: 'levelling', counseling: 'counselling',
  // misc + decor-vocabulary (NOTE: while/among are valid UK English — NOT flagged; fall/shade/pillow
  // removed too as they are legit words, not spelling errors)
  cozy: 'cosy', gray: 'grey',
  drapes: 'curtains', closet: 'wardrobe', couch: 'sofa',
  countertop: 'worktop', baseboard: 'skirting board', comforter: 'duvet'
};

// AI-buzzword words/phrases to flag — her EXACT banned list (memory reference_banned_words).
// fix = 'remove or rephrase' for all; it is a list-only check (she find/replaces by hand).
const BUZZWORDS = [
  'delve', 'dive', 'dive into', 'spearheading', 'embarking', 'compelling', 'empowering',
  'encompassing', 'comprehensively', 'effectively', 'beacon', 'emerges as a beacon',
  'multifaceted', 'revolutionary', 'testament', 'showcasing', 'remarked', 'aligns',
  'surpassing', 'tragically', 'impacting', 'prioritize', 'prioritizing', 'sparking',
  'standout', 'hindering', 'advancements', 'aiding', 'fostering', 'indicating potential',
  'providing insights', 'gain valuable insights', 'shared insights', 'highlighting the need',
  'highlights importance', 'highlights importance considering', 'making it challenging',
  'emphasizing importance', 'emphasizing need', 'emphasized importance', 'aims to enhance',
  'explores themes', 'struggles faced', 'facing criticism', 'secured win', 'secure win',
  'potentially leading', 'showing promising results', 'notable figures', 'notable works include',
  'consider factors like', 'address issues like', 'expressed excitement', 'study aims to explore',
  'study sheds light', 'study introduce', 'research needed to understand',
  'play a significant role in shaping', 'plays a significant role in shaping',
  'crucial role in shaping', 'media plays a significant role', 'ensure long term success',
  'make a positive impact on the world', "today's fast paced world", "today's digital age",
  'in the ever-evolving world of', 'at the forefront of', 'in summary', 'in conclusion',
  'in essence', "it's important to note"
].map(phrase => ({ phrase, fix: 'remove or rephrase' }));

// Branded links to offer (only when the body doesn't already contain that URL).
const BRANDED_LINKS = [
  { anchor: 'wall art',          url: 'https://share.google/RKuQBBwmgZBHOL1VQ',            title: 'Wall Art' },
  { anchor: 'unique wall art',   url: 'https://aboutwallart.com/pages/unique-wall-art',    title: 'Unique Wall Art' },
  { anchor: 'unique home decor', url: 'https://aboutwallart.com/pages/home-decor-items',   title: 'Unique Home Decor' }
];

const AUTHOR_BIO_SNIPPET = 'By Mae Osz | Interior Design Consultant & Home Decor Expert with 12+ years of experience.';

// British-English: legit words that must NEVER be flagged as US spelling (guards the -ize pattern
// and any future rule). The -size family is handled by a regex rule in the scan itself.
const SPELLING_EXCEPTIONS = new Set(['doctor', 'mirror', 'decor', 'error']);

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function htmlToText(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

// Deterministic blog quality scan over body + excerpt + every text metafield.
// Returns list-only findings — the merchant uses the editor search bar to fix them.
function scanBlogQuality(yourPage) {
  const bodyHtml = yourPage.shopifyBodyHtml || '';
  const excerptHtml = yourPage.shopifyExcerpt || '';
  const metaText = (yourPage.metafields || []).map(m => m.text || '').join(' ');
  // Combined plain text (body + excerpt + metafields) for word/phrase matching.
  const text = `${htmlToText(bodyHtml)} ${htmlToText(excerptHtml)} ${metaText}`;
  const lower = text.toLowerCase();

  // 1. British English — curated map + a safe -ize/-ise pattern, with exceptions.
  const britishEnglish = [];
  const seenUk = new Set();
  const flagUk = (found, suggestion) => {
    const k = String(found).toLowerCase();
    if (!k || seenUk.has(k) || SPELLING_EXCEPTIONS.has(k)) return;
    seenUk.add(k); britishEnglish.push({ found: k, suggestion });
  };
  for (const [us, uk] of Object.entries(US_TO_UK)) {
    if (new RegExp(`\\b${escapeRegExp(us)}\\b`, 'i').test(text)) flagUk(us, uk);
  }
  // Pattern: any word ending -ize/-ized/-izing/-ization(s) → the UK -ise form. Skips the -size
  // family (size/resize/oversize…) so legit words are never flagged.
  const _ize = /\b([a-z]{3,})(ize|izes|ized|izing|ization|izations)\b/gi;
  const _suf = { ize: 'ise', izes: 'ises', ized: 'ised', izing: 'ising', ization: 'isation', izations: 'isations' };
  let _zm;
  while ((_zm = _ize.exec(text.toLowerCase())) !== null) {
    const word = _zm[0];
    if (/siz(e|es|ed|ing)$/.test(word)) continue;
    flagUk(word, _zm[1] + _suf[_zm[2]]);
  }

  // 2. AI buzzwords — list with suggested fix.
  const buzzwords = [];
  for (const b of BUZZWORDS) {
    const re = new RegExp(`\\b${escapeRegExp(b.phrase)}\\b`, 'i');
    if (re.test(lower)) buzzwords.push({ found: b.phrase, fix: b.fix });
  }

  // 3. Branded links — offer a ready <a> snippet only if the body lacks that URL.
  const brandedLinks = [];
  for (const l of BRANDED_LINKS) {
    if (bodyHtml.includes(l.url)) continue;
    const snippet = `<a href="${l.url}" title="${l.title}" target="_blank" rel="noopener">${l.anchor}</a>`;
    brandedLinks.push({ anchor: l.anchor, url: l.url, snippet });
  }

  // 4. Author bio — offer the snippet only if the body lacks the byline.
  const hasBio = /mae\s+osz/i.test(text) || /interior\s+design\s+consultant/i.test(text);
  const authorBio = hasBio ? null : { snippet: AUTHOR_BIO_SNIPPET };

  return { britishEnglish, buzzwords, brandedLinks, authorBio };
}

// Extract the images used in a blog body: src, current alt text, and filename.
// Deduplicated by src. No Claude cost — this just reads the HTML.
function extractBodyImages(bodyHtml) {
  const tags = bodyHtml.match(/<img[^>]+>/gi) || [];
  const seen = new Set();
  const images = [];
  for (const tag of tags) {
    const src = (tag.match(/src=["']([^"']+)["']/i) || [])[1] || '';
    if (!src || seen.has(src)) continue;
    // Only images we can actually fetch and look at (absolute http/https URLs)
    if (!/^https?:\/\//i.test(src)) continue;
    seen.add(src);
    const alt = (tag.match(/alt=["']([^"']*)["']/i) || [])[1] || '';
    const filename = src.split('/').pop().split('?')[0];
    images.push({ src, alt, filename });
  }
  return images;
}

// Analyze content gaps between user's page and competitors
function analyzeContentGaps(yourPage, competitors) {
  if (!competitors || competitors.length === 0) {
    return { missingH2s: [], missingAIOptimization: [] };
  }

  // 1. Find missing H2 sections
  const yourH2s = yourPage.h2.map(h => h.toLowerCase());
  const competitorH2s = {};
  
  competitors.forEach(comp => {
    comp.h2.forEach(h2 => {
      const h2Lower = h2.toLowerCase();
      if (!competitorH2s[h2Lower]) {
        competitorH2s[h2Lower] = { text: h2, count: 0 };
      }
      competitorH2s[h2Lower].count++;
    });
  });

  const missingH2s = Object.values(competitorH2s)
    .filter(h2 => h2.count >= 2 && !yourH2s.some(userH2 => userH2.includes(h2.text.toLowerCase().substring(0, 20))))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 2. Find ALL missing AI optimization elements (ignore competitors)
  const missingAIOptimization = [];
  
  // Core AI elements (always check)
  if (!yourPage.aiOptimization.hasFAQSchema) {
    missingAIOptimization.push({
      element: 'FAQ Schema',
      priority: 'high',
      instruction: 'Use Kickstart to generate FAQ schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasBrandBlock) {
    missingAIOptimization.push({
      element: 'Brand/Authority Block',
      priority: 'high',
      instruction: 'Add full brand block with trust signals'
    });
  }
  
  if (!yourPage.aiOptimization.hasComparisonSnippet) {
    missingAIOptimization.push({
      element: 'Comparison/Definition Snippet',
      priority: 'medium',
      instruction: 'Add "What is [keyword]" paragraph'
    });
  }
  
  if (!yourPage.aiOptimization.hasProductSchema) {
    missingAIOptimization.push({
      element: 'Product Schema',
      priority: 'high',
      instruction: 'Add Product JSON-LD schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasReviewSchema) {
    missingAIOptimization.push({
      element: 'Review/Rating Schema',
      priority: 'medium',
      instruction: 'Add AggregateRating schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasBreadcrumbSchema) {
    missingAIOptimization.push({
      element: 'Breadcrumb Schema',
      priority: 'low',
      instruction: 'Add BreadcrumbList schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasHowToSchema) {
    missingAIOptimization.push({
      element: 'How-To Schema',
      priority: 'low',
      instruction: 'Add HowTo schema if applicable'
    });
  }
  
  if (!yourPage.aiOptimization.hasTables) {
    missingAIOptimization.push({
      element: 'Tables',
      priority: 'medium',
      instruction: 'Add comparison/data tables'
    });
  }
  
  if (!yourPage.aiOptimization.hasLists) {
    missingAIOptimization.push({
      element: 'Lists (3+ items)',
      priority: 'medium',
      instruction: 'Add bullet point or numbered lists'
    });
  }
  
  if (!yourPage.aiOptimization.hasRelatedQuestions) {
    missingAIOptimization.push({
      element: 'Related Questions Section',
      priority: 'high',
      instruction: 'Add "People also ask" or "Related questions" section'
    });
  }
  
  // Blog-specific elements
  if (yourPage.isBlog) {
    if (!yourPage.aiOptimization.hasAuthor) {
      missingAIOptimization.push({
        element: 'Author/Expert Credentials',
        priority: 'medium',
        instruction: 'Add author byline with credentials'
      });
    }
    
    if (!yourPage.aiOptimization.hasDates) {
      missingAIOptimization.push({
        element: 'Publish/Update Dates',
        priority: 'high',
        instruction: 'Add visible publish/update dates'
      });
    }
    
    if (!yourPage.aiOptimization.hasSummary) {
      missingAIOptimization.push({
        element: 'Quick Answer/Summary',
        priority: 'high',
        instruction: 'Add TL;DR or summary at top'
      });
    }
  }

  return {
    missingH2s,
    missingAIOptimization
  };
}

// Calculate AI Visibility Score (1-10)
function calculateAIScore(aiOptimization, isBlog) {
  let score = 0;
  
  // Core elements (1 point each)
  if (aiOptimization.hasFAQSchema) score += 1;
  if (aiOptimization.hasBrandBlock) score += 1;
  if (aiOptimization.hasComparisonSnippet) score += 1;
  if (aiOptimization.hasProductSchema) score += 1;
  if (aiOptimization.hasReviewSchema) score += 1;
  if (aiOptimization.hasRelatedQuestions) score += 1;
  
  // Supporting elements (0.5 points each)
  if (aiOptimization.hasBreadcrumbSchema) score += 0.5;
  if (aiOptimization.hasHowToSchema) score += 0.5;
  if (aiOptimization.hasTables) score += 0.5;
  if (aiOptimization.hasLists) score += 0.5;
  
  // Blog-specific elements (0.5 points each)
  if (isBlog) {
    if (aiOptimization.hasAuthor) score += 0.5;
    if (aiOptimization.hasDates) score += 0.5;
    if (aiOptimization.hasSummary) score += 0.5;
  }
  
  return Math.min(10, score); // Cap at 10
}

// Get PageSpeed score
async function getPageSpeedScore(url, strategy) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PAGESPEED_KEY}&strategy=${strategy}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    const score = data.lighthouseResult?.categories?.performance?.score;
    return score ? Math.round(score * 100) : 'N/A';

  } catch (error) {
    console.error(`[PageSpeed] Error for ${url}:`, error);
    return 'N/A';
  }
}

// Fetch loser pages that should link TO the winner page
// ── PRODUCTS: preserve existing internal links on a description rewrite (Batch 4) ───────────
const _normInternal = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?aboutwallart\.com/, '').replace(/[?#].*$/, '').replace(/\/$/, '').trim();
// Pull internal (AboutWallArt) links out of a body: [{url, anchor}], de-duped by URL.
function extractInternalLinks(html) {
  const out = [], seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html || ''))) {
    const url = m[1];
    if (!/aboutwallart\.com|^\/(products|collections|pages|blogs)\//i.test(url)) continue;   // internal only
    const anchor = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const key = _normInternal(url);
    if (!key || seen.has(key)) continue; seen.add(key);
    out.push({ url, anchor });
  }
  return out;
}
// url(normalised) → locked keyword, from the registry CSV.
async function loadRegistryByUrl() {
  const map = new Map();
  try {
    const res = await fetch('https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/keyword-locker-registry.csv');
    if (!res.ok) return map;
    const lines = (await res.text()).trim().split('\n');
    const headerIdx = lines.findIndex(l => l.includes('Page URL') && l.includes('Keyword'));
    if (headerIdx === -1) return map;
    const headers = lines[headerIdx].split(',').map(h => h.trim());
    const urlIdx = headers.indexOf('Page URL'), kwIdx = headers.indexOf('Keyword');
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const url = cols[urlIdx]?.trim(), kw = cols[kwIdx]?.trim();
      if (url && kw) { const k = _normInternal(url); if (k && !map.has(k)) map.set(k, kw); }
    }
  } catch { /* registry optional */ }
  return map;
}
// url(normalised) → Link Whisperer auto-link keyword, from autolink-rules.json.
async function loadAutolinkByUrl() {
  const map = new Map();
  try {
    const res = await fetch('https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/autolink-rules.json');
    if (!res.ok) return map;
    const rules = JSON.parse(await res.text());
    for (const r of (Array.isArray(rules) ? rules : [])) {
      if (r && r.url && r.keyword) { const k = _normInternal(r.url); if (k && !map.has(k)) map.set(k, r.keyword); }
    }
  } catch { /* rules optional */ }
  return map;
}

async function getLosersForPage(winnerUrl) {
  try {
    const res = await fetch('https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/keyword-locker-registry.csv');
    if (!res.ok) return [];
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    let headerIdx = lines.findIndex(l => l.includes('Page URL') && l.includes('Keyword'));
    if (headerIdx === -1) return [];
    const headers = lines[headerIdx].split(',').map(h => h.trim());
    const urlIdx = headers.indexOf('Page URL');
    const kwIdx  = headers.indexOf('Keyword');
    const actIdx = headers.indexOf('Action');
    const winIdx = 5; // WinnerURL column (col 5 in INTERNAL_LINK rows)
    const normalized = winnerUrl.toLowerCase().trim().replace(/\/$/, '');
    const losers = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= winIdx) continue;
      const action     = cols[actIdx]?.trim().toUpperCase();
      const loserUrl   = cols[urlIdx]?.trim();
      const loserKw    = cols[kwIdx]?.trim();
      const winnerCol  = cols[winIdx]?.trim().toLowerCase().replace(/\/$/, '');
      if (action === 'INTERNAL_LINK' && winnerCol === normalized && loserUrl?.startsWith('http')) {
        const pt = loserUrl.includes('/products/') ? 'product'
          : loserUrl.includes('/collections/') ? 'collection'
          : loserUrl.includes('/blogs/') ? 'blog' : 'page';
        losers.push({ loserUrl, loserKeyword: loserKw, pageType: pt });
      }
    }
    return losers;
  } catch (err) {
    console.error('[Losers]', err.message);
    return [];
  }
}

// ── EXACT-PLACEMENT HELPERS ─────────────────────────────────────────────────
// Read a real page body and hand back the EXACT existing line a link should be pasted after,
// plus the real section heading it sits under — so the merchant never has to guess. Used for
// loser pages ("Internal Links to Add") and a blog's own outbound links (internalLinksToAdd).
function parseSectionsFromBody(body) {
  const parts = (body || '').match(/<(h2|h3|p|li)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const sections = [{ heading: '', paras: [] }];
  for (const tag of parts) {
    const text = tag.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^<h[23]/i.test(tag)) sections.push({ heading: text, paras: [] });
    else if (text.split(/\s+/).length >= 4) sections[sections.length - 1].paras.push(text);
  }
  return sections.filter(s => s.heading || s.paras.length);
}
// First ~14 words of a line — long enough to be unique, short enough to paste into a Find box.
function exactLineFrom(text) {
  const clean = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(/\s+/);
  return words.length > 14 ? words.slice(0, 14).join(' ') + '…' : clean;
}
// Choose the best section + exact line in `body` to anchor a link, biased toward a topic hint.
// Returns { section, findAnchor } or null if the body has no usable paragraphs.
function pickBodyAnchor(body, hint) {
  const sections = parseSectionsFromBody(body).filter(s => s.paras.length);
  if (!sections.length) return null;
  const hintWords = String(hint || '').toLowerCase().match(/[a-z]{3,}/g) || [];
  let best = null, bestScore = -1;
  for (const s of sections) {
    const hw = new Set(s.heading.toLowerCase().match(/[a-z]{3,}/g) || []);
    let score = 0; hintWords.forEach(w => { if (hw.has(w)) score++; });
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best || bestScore <= 0) best = sections[sections.length - 1];   // no topic match → last section
  const para = best.paras[best.paras.length - 1];                      // link sits after that section's content
  return { section: best.heading || '', findAnchor: exactLineFrom(para) };
}
// Find the REAL line in a source blog to anchor a keyword link: prefer the actual sentence that
// already contains the keyword (mode=replace lands exactly there); else the best section's last line.
function realLineForKeyword(body, keyword) {
  const kw = String(keyword || '').toLowerCase().trim();
  const sections = parseSectionsFromBody(body).filter(s => s.paras.length);
  if (!sections.length) return null;
  if (kw) {
    for (const s of sections) {
      for (const p of s.paras) {
        if (p.toLowerCase().includes(kw)) {
          return { findAnchor: exactLineFrom(p), section: s.heading || '', where: 'this line (it already mentions the keyword)' };
        }
      }
    }
  }
  const a = pickBodyAnchor(body, keyword);
  return a ? { findAnchor: a.findAnchor, section: a.section, where: 'right after this line' } : null;
}

// ── FACTS-ONLY find/replace verification (v50.1) ────────────────────────────
// Build the list of REAL text lines on a page (live headings + body blocks + metafield text)
// so any "find this exact text" suggestion can be checked against what is actually there.
function buildPageHaystack(yp) {
  const lines = [];
  const lh = (yp && yp.liveHeadings) || { h1: yp && yp.h1, h2: yp && yp.h2, h3: yp && yp.h3 };
  [...(lh.h1 || []), ...(lh.h2 || []), ...(lh.h3 || [])].forEach(h => { if (h) lines.push(String(h)); });
  if (yp && yp.shopifyBodyHtml) {
    (yp.shopifyBodyHtml.match(/<(h2|h3|h4|p|li)[^>]*>[\s\S]*?<\/\1>/gi) || []).forEach(t => {
      const x = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (x) lines.push(x);
    });
  }
  ((yp && yp.metafields) || []).forEach(m => {
    if (m && m.text) String(m.text).split(/\n+/).forEach(x => { const t = x.trim(); if (t) lines.push(t); });
  });
  return lines;
}
function _normTxt(s) {
  return String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Match a claimed "current text" to a real page line. Returns the REAL line (verbatim) when it
// exists or closely matches (≥70% of the claim's words); else null (treat as invented → drop).
function matchRealLine(claim, lines) {
  const c = _normTxt(claim);
  if (!c) return null;
  const cn = lines.map(l => ({ raw: l, n: _normTxt(l) })).filter(l => l.n);
  // Prefer the FULLEST related line, so a short claim (e.g. just "minimalism") expands to the whole
  // sentence/paragraph it lives in, and a sentence claim never collapses onto a one-word heading.
  let best = null, bestWords = -1;
  for (const l of cn) {
    const lw = l.n.split(' ').length;
    // related if: identical, the line contains the claim, OR the claim contains a SUBSTANTIAL line (≥4 words)
    const related = (l.n === c) || (l.n.includes(c) && c.length >= 6) || (c.includes(l.n) && lw >= 4);
    if (related && lw > bestWords) { best = l.raw; bestWords = lw; }
  }
  if (best) return best;
  const cw = new Set(c.split(' ').filter(w => w.length > 2));
  if (!cw.size) return null;
  let fb = null, fbScore = 0;
  for (const l of cn) {
    const ls = new Set(l.n.split(' ').filter(w => w.length > 2));
    if (!ls.size) continue;
    let hit = 0; cw.forEach(w => { if (ls.has(w)) hit++; });
    const score = hit / cw.size;
    if (score > fbScore) { fbScore = score; fb = l.raw; }
  }
  return fbScore >= 0.7 ? fb : null;
}

// Get Claude analysis
async function getClaudeAnalysis(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found');

  const prompt = buildAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps, loserPages, relatedBlogs);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 20000,   // raised from 12000 — long blogs (6k+ words) were truncating → invalid JSON
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Claude API error');
    if (!data.content?.[0]?.text) throw new Error('Invalid Claude API response structure');

    const raw = data.content[0].text.trim();
    console.log('[Claude] Response length:', raw.length, 'chars');

    // Try to parse as structured JSON.
    // The model sometimes wraps the JSON in ```json fences or adds a stray line of
    // text before/after it. Rather than relying on fence-stripping alone, isolate the
    // actual object by slicing from the FIRST "{" to the LAST "}" — this reads
    // reliably no matter how the answer is wrapped.
    try {
      let jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace  = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (firstErr) {
        // Common failure on long HTML values (e.g. the product description rewrite): raw line
        // breaks / tabs sit INSIDE a string, which JSON.parse rejects. Structural whitespace is
        // optional in JSON, so collapsing raw control chars to spaces is safe and recovers it.
        const repaired = jsonStr.replace(/[\r\n\t]/g, ' ');
        parsed = JSON.parse(repaired);
        console.log('[Claude] ✓ Structured JSON parsed after control-char repair');
      }
      console.log('[Claude] ✓ Structured JSON parsed successfully');
      return { structured: parsed };
    } catch (parseErr) {
      console.warn('[Claude] JSON parse failed, falling back to markdown:', parseErr.message);
      return { markdown: raw };
    }

  } catch (error) {
    console.error('[Claude] Error:', error.message);
    throw error;
  }
}

// Build the blog-specific structured JSON prompt for Claude
// Blogs differ from products/collections: the theme already renders Page Schema,
// FAQ Schema and the Brand Block, so this prompt NEVER returns those. It also
// protects the "More about" external authority link from removal.
function buildBlogAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  const isOldTemplate = /ne-blog-posts|guest-post-template/i.test(yourPage.templateSuffix || '');
  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;
  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const currentDesc = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
    : '';

  // ── EXISTING PAGE CONTENT for the keyword over-use check ──────────────────
  // Full body text (not just the opening), all headings from the live rendered
  // page (incl. theme/custom-Liquid sections), and every text metafield.
  const lh = yourPage.liveHeadings || { h1: yourPage.h1, h2: yourPage.h2, h3: yourPage.h3 };
  const existingHeadings = [
    ...(lh.h1 || []).map(h => `H1: ${h}`),
    ...(lh.h2 || []).map(h => `H2: ${h}`),
    ...(lh.h3 || []).map(h => `H3: ${h}`)
  ].join('\n') || 'None found';
  const existingBodyText = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000)
    : '';
  const existingMetafields = (yourPage.metafields || []).length > 0
    ? yourPage.metafields.map(m => `[${m.key}] ${m.text}`).join('\n')
    : 'None';

  const missingH2s = contentGaps?.missingH2s?.length > 0
    ? contentGaps.missingH2s.map(h => `"${h.text}"`).join(', ') : 'None';
  // Blogs: drop schema/brand gaps — the theme handles those
  const blogMissingAI = (contentGaps?.missingAIOptimization || [])
    .filter(a => !/schema|brand/i.test(a.element));
  const missingAI = blogMissingAI.length > 0
    ? blogMissingAI.map(a => `${a.element} [${a.priority}]`).join(', ') : 'None';

  return `You are an expert SEO specialist optimising a BLOG ARTICLE for AboutWallArt (UK wall art and home decor store). Return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Page type: blog article
- Current title: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- Current H2s: ${yourPage.h2.slice(0, 12).join(' | ') || 'None'}
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})
- Keyword density: ${yourPage.keywordDensity}% (competitor avg: ${avgCompKeywordDensity}%)
${currentDesc ? `- Current body opening: ${currentDesc}` : ''}

EXISTING PAGE CONTENT (use this for the keywordOveruse check AND to avoid suggesting content that already exists):
ALL HEADINGS ON THE PAGE (live, includes theme/custom-Liquid sections):
${existingHeadings}

FULL BODY TEXT:
${existingBodyText || 'None'}

METAFIELD CONTENT:
${existingMetafields}

COMPETITORS — the pages outranking you (positions 1-3). Your job is to make THIS page beat them. Compare your FULL page against each:
${competitors.map(c => `--- Position ${c.position}: ${c.url}
  Title: ${c.title || 'N/A'}
  Meta: ${c.metaDescription || 'N/A'}
  H1: ${(c.h1||[]).join(' | ') || 'N/A'}
  H2s: ${(c.h2||[]).join(' | ') || 'N/A'}
  H3s: ${(c.h3||[]).join(' | ') || 'N/A'}
  Word count: ${c.wordCount} | Keyword density: ${c.keywordDensity}%`).join('\n')}

CONTENT GAPS (mechanical hints only — do your own richer comparison from the competitor data above):
- Missing H2 sections: ${missingH2s}
- Missing content elements: ${missingAI}

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title, max 60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description, max 135 chars, keyword included, ends with a benefit or CTA, UK spelling. Do NOT mention shipping — 'Free UK shipping!' is appended automatically.",
  "suggestedDescription": "2-3 sentences for the blog EXCERPT field (the short summary, NOT the body). Uses the keyword or a close variation once, written naturally. AboutWallArt brand voice. UK spelling. No HTML tags.",
  "firstParagraph": "The optimised opening paragraph for the blog BODY (plain text, no HTML). It directly addresses the question behind \\"${keyword}\\" — raise the question and begin answering it in a natural, engaging way. 2-4 sentences. Uses the main keyword once, naturally. British English. Must NOT duplicate the quickAnswer wording.",
  "quickAnswer": "<div style=\\"background:#f9f9f9;padding:16px 20px;margin-bottom:24px;\\"><strong>Quick Answer:</strong> [2-3 sentence direct factual answer in British English]</div>",
  "keywordOveruse": {
    "isOverstuffed": true,
    "summary": "One plain-English sentence — e.g. 'You use \\"${keyword}\\" 12 times; about 5 are unnatural repetition that should be reworded or removed.'",
    "findings": [
      {
        "location": "H2 | H3 | paragraph | metafield: <key> — say where it lives so the merchant can find it",
        "metafieldKey": "if this finding is IN a metafield, the exact key in namespace.key form (e.g. custom.more_about_) copied from the METAFIELD CONTENT list above; otherwise empty string",
        "currentText": "the ONE shortest exact sentence (or heading) that contains the over-use, copied verbatim — NEVER a whole paragraph, only the single sentence with the repeated keyword",
        "recommendation": "reword OR remove",
        "suggestedText": "if reword: that SAME single sentence rewritten — keep the identical wording, same start and same end, changing ONLY the few over-used words to a related/secondary term (so a diff shows just the changed words). It must be the same sentence as currentText, not a shorter fragment. If remove: empty string.",
        "reason": "one short sentence on why this is over-use"
      }
    ]
  },
  "h2Sections": [
    {
      "action": "change",
      "heading": "Exact current H2 text as it appears on the page",
      "reason": "One sentence: why this H2 needs attention",
      "exactAction": "Precise instruction — e.g. 'Rename to [new text] and keep as H2' / 'Remove the H2 tag but keep the text as a regular paragraph'",
      "replacementText": "ONLY the exact final text to paste — no quotes, no instructions. For a rename: the new heading text. For a 'More about' rewrite: the new intro sentence. Leave empty if the action has no text to paste (e.g. just removing a tag).",
      "competitorDriven": false
    },
    {
      "action": "add",
      "heading": "New H2 heading text (plain text, no tags)",
      "content": "Complete paste-ready HTML for this new body section: an <h2> with the heading followed by one or more <p> paragraphs (each its own <p>). UK spelling. See the BLOG BODY HTML rule below for the exact format.",
      "competitorDriven": true
    },
    {
      "action": "remove",
      "heading": "Exact current H2 / section text to remove",
      "reason": "Why this section HURTS SEO (thin, off-topic, duplicate, keyword-diluting, or proven unnecessary vs competitors). Body content only — NEVER a global theme section.",
      "competitorDriven": false
    }
  ],
  "aiItems": [
    {
      "element": "Related Questions",
      "priority": "high",
      "content": "<h2>Related Questions About [topic]</h2><p><strong>Question?</strong> — direct answer</p><p><strong>Question?</strong> — direct answer</p>",
      "competitorDriven": false
    },
    {
      "element": "Summary Block",
      "priority": "high",
      "content": "<h2>Summary: [topic]</h2><p><strong>Label:</strong> point</p><p><strong>Label:</strong> point</p>"
    },
    {
      "element": "Comparison Snippet",
      "priority": "medium",
      "content": "<h2>[Comparison title]</h2><p>intro</p><p><strong>Option A:</strong> ...</p><p><strong>Option B:</strong> ...</p>"
    },
    {
      "element": "How-To Schema",
      "priority": "medium",
      "content": "<script type=\\"application/ld+json\\">{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"HowTo\\",\\"name\\":\\"...\\",\\"step\\":[{\\"@type\\":\\"HowToStep\\",\\"name\\":\\"...\\",\\"text\\":\\"...\\"}]}</script>"
    }
  ],
  "peopleAlsoAsk": {
    "html": "<h2>Frequently Asked Questions About ${keyword}</h2><p><strong>Question 1?</strong> Direct answer.</p><p><strong>Question 2?</strong> Direct answer.</p><p><strong>Question 3?</strong> Direct answer.</p>",
    "metafield": "Frequently Asked Questions About [Topic]\\n\\n**Q: Question 1?**\\nA: Direct answer. 2-3 supporting sentences.\\n\\n**Q: Question 2?**\\nA: Direct answer. 2-3 supporting sentences.\\n\\n**Q: Question 3?**\\nA: Direct answer. 2-3 supporting sentences."
  },
  "urlAnalysis": {
    "currentSlug": "exact-current-url-slug",
    "slugMatchesKeyword": "exact|similar|different",
    "currentTitle": "Current page title",
    "titleMatchesKeyword": "exact|similar|different",
    "changeTitle": true,
    "suggestedTitle": "New title using exact keyword — leave blank if no change needed",
    "changeSlug": false,
    "suggestedSlug": "new-slug-if-change-safe — leave blank if no change needed",
    "slugChangeWarning": "Only change slug if this page has 0 or near-0 clicks. If changed, set up a 301 redirect from the old URL to the new URL.",
    "notes": "One sentence summary of what needs doing and why"
  },
  "otherActions": [
    {
      "priority": "high",
      "action": "A genuine NON-image task only (the Image SEO tool handles all images; internal links go in internalLinksToAdd). Leave this array EMPTY if there is none. One sentence max."
    }
  ],
  "internalLinksToAdd": [
    {
      "anchorText": "the exact anchor text to use (describes the destination blog; do NOT use this article's own main keyword as the anchor)",
      "url": "the EXACT url of ONE of the RELATED OLDER BLOGS listed below — this article links OUT to that blog. Use ONLY a url from that list; NEVER a collection, product, page, or any url not on the list, and NEVER invent one.",
      "mode": "replace OR new",
      "existingText": "if mode=replace: the EXACT sentence/paragraph already in the body to swap out. If mode=new: empty string.",
      "newText": "the EXACT paste-ready paragraph WITH the link already embedded as <a href=\\"[url]\\" title=\\"[title]\\" target=\\"_blank\\" rel=\\"noopener\\">[anchorText]</a>. For mode=replace this is existingText rewritten with the link; for mode=new a short natural new sentence/paragraph containing the link.",
      "placement": "exactly where it goes — name the paragraph or section (shown outside the copy box)",
      "placementSection": "ONLY the exact section heading where this goes (the H2/H3 text, nothing else)",
      "placementWhere": "ONLY the position within that section, e.g. 'after paragraph 2' or 'after the paragraph starting \\"When choosing…\\"'",
      "competitorDriven": false
    }
  ],
  "loserPageLinks": [
    {
      "loserUrl": "exact URL of the loser page",
      "loserPageType": "product|collection|blog|page",
      "suggestedSentence": "One natural sentence with <a href='[winnerUrl]'>[relevant anchor text]</a> that sounds like editorial content — unique per loser page, never a template",
      "placement": "Specific placement guidance — be specific, not 'at the end'",
      "placementSection": "the section heading where this goes, if known (else empty string)",
      "placementWhere": "the position within that section, e.g. 'after paragraph 2' (else empty string)"
    }
  ]${relatedBlogs.length > 0 ? `,
  "relatedBlogLinks": [
    {
      "sourceUrl": "EXACT url of the related blog this link comes FROM (copy from the RELATED OLDER BLOGS list)",
      "sourceTitle": "that blog's title",
      "mode": "replace OR new",
      "existingText": "if that blog already contains the keyword (present: YES): the exact sentence to swap out. Otherwise empty.",
      "newText": "paste-ready text with THIS page's main keyword wrapped as the anchor: <a href=\\"${yourPage.url}\\" title=\\"...\\" target=\\"_blank\\" rel=\\"noopener\\">${keyword}</a>. For replace: the existing sentence rewritten with the link. For new: a short natural sentence/CTA using the keyword as the anchor.",
      "placement": "where in that source blog to add it (shown outside the copy box)",
      "placementSection": "ONLY the exact section heading in that source blog (the H2/H3 text, nothing else)",
      "placementWhere": "ONLY the position within that section, e.g. 'after paragraph 2'",
      "findAnchor": "the EXACT existing line in that source blog to SEARCH FOR — for mode=replace it is the line being replaced (same as existingText); for mode=new it is the existing sentence the new text is pasted AFTER. Copy it verbatim from that blog's OUTLINE so the merchant can paste it into their editor's find box and land on the exact spot. Keep it to ONE sentence."
    }
  ]` : ''},
  "templateChecks": [
    {
      "type": "more_about_text",
      "instruction": "Intro sentence for the 'More About' section (goes to metafields, NOT the body).",
      "content": "ONE clean reader-focused sentence, MAXIMUM 30 words, describing what the reader will find at the linked authority source. No link, no HTML. Banned words: delve, explore, comprehensive, wealth of, dive into, invaluable, a range of, further insight."
    },
    {
      "type": "more_about_url",
      "instruction": "Authority source URL for the 'More About' section link.",
      "content": "A single full URL to a reputable, NON-competing authority source about this topic. If the body/metafields already contain a good authority link, reuse that exact URL; otherwise provide a fresh reputable one. URL only — no anchor, no HTML."
    },
    {
      "type": "home_decor_trends_title",
      "instruction": "New SEO title for the 'Home decor trends' section (goes to its metafield; the rest of that block is general and stays).",
      "content": "ONLY the heading text (plain text, no tags), keyword or close variation, natural case."
    },
    {
      "type": "complete_the_look_title",
      "instruction": "New SEO title for the 'Complete the look' section (goes to its metafield; the rest stays).",
      "content": "ONLY the heading text (plain text, no tags), natural case."
    },
    {
      "type": "shop_here",
      "instruction": "Where/why to use the SHOP HERE button (e.g. replace a plain 'Click here'/'Shop Now' link).",
      "content": "the EXACT SHOP HERE button HTML — see the OLD-TEMPLATE CHECKS rule, or empty string if not needed"
    },
    {
      "type": "youtube",
      "instruction": "Whether a relevant video exists / should be embedded and where.",
      "content": "the EXACT full-width YouTube embed HTML — or empty string if no suitable video"
    }
  ]
}
${loserPages.length > 0 ? `
LOSER PAGES THAT SHOULD LINK TO THIS PAGE:
${loserPages.map(l => `- ${l.loserUrl} (${l.pageType}, keyword: "${l.loserKeyword}")`).join('\n')}
` : ''}
${relatedBlogs.length > 0 ? `
RELATED OLDER BLOGS TO LINK FROM (add one link from EACH into this page; anchor MUST be the main keyword "${keyword}"). Each blog's OUTLINE is given (## = H2 section, # = H3, ¶N = paragraph N within the current section) — use it to give a CONCRETE placement:
${relatedBlogs.map(b => `--- ${b.url} | "${b.title}" | keyword present: ${b.keywordPresent ? 'YES' : 'no'}${b.keywordPresent && b.sentence ? ` | sentence: "${b.sentence}"` : ''}
OUTLINE:
${b.outline || '(no outline available)'}`).join('\n')}
` : ''}

RULES:
- COMPETITOR-DRIVEN ANALYSIS (the backbone of this whole audit): your goal is to make THIS page OUTRANK positions 1-3. Compare the full page against the competitor data above and silently answer: (1) what topics/questions/sections do they cover that this page is missing? (2) what would a customer want answered BEFORE buying that this page doesn't answer? (3) what makes their pages feel more complete or trustworthy? Then let those answers DRIVE your recommendations — what to ADD, REPLACE and REMOVE. Do NOT add a separate "how to outrank" section; instead fold the competitive reasoning into the normal outputs (h2Sections, aiItems, internalLinksToAdd, keywordOveruse, etc.). Still cover ALL standard SEO so nothing needed to rank is missed. Work ONLY from the competitor data provided above — NEVER invent competitor content you cannot see.
- competitorDriven flag: on EVERY h2Sections item, aiItem and internalLinksToAdd item, include a boolean "competitorDriven" — true if the recommendation comes from the competitor comparison (e.g. a gap they cover that you don't, or a move that beats them), false if it is general SEO best practice. When true, the "reason"/"exactAction" must name the competitive rationale (e.g. "all 3 competitors cover X; this page doesn't").
- This is a BLOG. The theme already renders Page Schema, FAQ Schema and the Brand Block. NEVER suggest, mention, or return Page/FAQ/Article/Product/Review/Breadcrumb schema or a brand/about block, and do not include pageSchema, faqSchema or brandBlock fields at all. The ONE exception is the "How-To Schema" aiItem: it is written to its OWN separate metafield (custom.ai_how_to_schema_markup), not to the body, so it IS allowed — but ONLY when this blog's title contains the words "how to" (see the aiItems rules below).
- KEYWORD USAGE (no stuffing): use the EXACT main keyword "${keyword}" only where it matters most — the title, the first paragraph, and at most one or two headings. Everywhere else (meta, excerpt, body paragraphs, FAQ answers, snippets) write naturally for the reader using secondary keywords, natural variations and related terms. NEVER repeat the exact keyword over and over — Google does not reward exact-match repetition and treats stuffing as spam.
- keywordOveruse: examine ALL of "EXISTING PAGE CONTENT" above (every heading, the full body text, and every metafield) and decide whether "${keyword}" is over-used. Over-use = the EXACT keyword repeated where a related/secondary term would read better, near-duplicate keyword-stuffed headings, or sentences that add no value beyond repeating the keyword. For EACH over-used spot return: where it lives (so the merchant can find it), the EXACT current text, recommendation "reword" (with the rewritten suggestedText using a related/secondary term) OR "remove" (suggestedText empty) when deleting it is the better SEO move. Give the precise replacement words — never a vague instruction.
  - EXCLUDE GLOBAL/SHARED SECTIONS: NEVER report anything from site-wide navigation, menus, breadcrumbs, footer, cookie/consent notices, search, account, newsletter sign-up, "related posts", "recently viewed", or any section that is identical across every page and cannot be edited on this single page. The merchant only wants spots they can actually change on THIS page (its body, its metafields, its own page-specific sections). If a heading looks like shared theme chrome, leave it out entirely.
  - A single, natural use of the keyword is FINE — only flag genuine over-use, not every mention. If the page is not over-stuffed, return "isOverstuffed": false with an empty "findings" array.
- suggestedTitle: max 60 chars (hard limit), keyword near start.
- suggestedMeta: max 135 chars (hard limit), include the keyword once, main benefit, CTA.
- suggestedDescription: this is the blog EXCERPT — plain text only, no HTML, 2-3 sentences, UK spelling. Use the keyword or a close variation once, written naturally. It is NEVER added to the body.
- firstParagraph: the blog's opening BODY paragraph (plain text, no HTML, 2-4 sentences, British English). It must directly address the question behind "${keyword}" — raise the question and start answering it in a natural, engaging way. Use the main keyword ONCE only, naturally. Do NOT duplicate the quickAnswer wording. The merchant copies this and pastes it manually as the first paragraph of the blog.
- quickAnswer: return the EXACT HTML structure shown — do not change any tags or styles, and never add borders, colour lines, wrapper divs or extra tags. Replace ONLY the bracketed text with a direct, factual 2-3 sentence answer to the search intent of "${keyword}", written in British English. The whole value must be one single <div> exactly as shown. It is placed in the body after the second intro paragraph (before any List of Contents, Key Takeaways, or first H2).
- "MORE ABOUT" H2 RULE: If any H2 is "More about ..." (or similar) and contains an external authority link, NEVER flag it for removal or deletion. Keep the H2 and the external link exactly as they are. Use action "change" with exactAction that says to keep the heading and link, and replace ONLY the intro sentence with a single clean sentence of MAXIMUM 30 words describing what the reader will find at the linked source. Put that exact rewritten sentence inside exactAction. Banned words you must NOT use anywhere in that sentence: delve, explore, comprehensive, wealth of, dive into, invaluable, a range of, further insight.
- h2Sections: use action "change" (rename/retag, with reason + exactAction + replacementText), action "add" (new section, with content), or action "remove" (a body section/heading that HURTS SEO — thin, off-topic, duplicate, keyword-diluting, or proven unnecessary vs competitors — with a reason; body content ONLY, never a global theme section). Include "competitorDriven" on every item.
- H2 CASE: H2 headings inside the blog BODY are CONTENT headings. Write every rename and every new heading in natural, readable case (sentence case or title case) — exactly as it should read. NEVER force body headings to ALL-CAPS, and NEVER suggest a rename whose only change is letter-casing or give "make it all-caps / sentence case" as a reason. (The all-caps look is a theme CSS style applied to theme sections only — it must NOT be baked into content headings.)
- BEFORE suggesting any "add" section: check the EXISTING PAGE CONTENT above. NEVER suggest adding a section, heading or topic the page already covers (even if a competitor has it) — only add content that fills a genuine gap. Never suggest an addition whose main purpose is to repeat "${keyword}". Fixing over-use (keywordOveruse) and removing redundancy come first; new content is only for real gaps.
- replacementText (on "change" items): return ONLY the exact final text the merchant should paste — no surrounding quotes, no "Rename to", no "Why", no instructions. For a rename it is the new heading text; for the "More about" rewrite it is the new intro sentence. If there is genuinely nothing to paste (e.g. the action is only to remove a tag), return an empty string.
- BLOG BODY HTML: the "content" of every "add" section is destined for the blog body and MUST be complete, paste-ready HTML for the Shopify HTML editor. Rules: use <h2> for the section heading only (NEVER <strong> or <h3> as the title); the content must START with that <h2>; every paragraph in its own <p> tag; all links as <a href="..." title="..." target="_blank" rel="noopener">anchor text</a> (always include title, target and rel); NO plain text outside HTML tags; do NOT use <ul>, <li>, <br> or <div> unless the section genuinely needs a list; NO blank lines between tags; NO inline styles or classes. Each "add" paragraph should read naturally — use the keyword or a related/secondary term only where it genuinely fits, never forced or repeated — and may include 1-2 internal links to relevant AboutWallArt collections using the full anchor format above.
- peopleAlsoAsk: write 3-5 real questions people search about "${keyword}" with direct, helpful answers. Return BOTH forms:
  - "html": clean HTML for the blog body — a single <h2>Frequently Asked Questions About [topic]</h2> followed by one <p> per question where the question is wrapped in <strong> and the answer follows in the same <p>. NEVER add schema markup (no itemscope, no itemtype). No <ul>/<li>/<br>/<div>, no blank lines, no inline styles.
  - "metafield": plain text only (no HTML) for the people_also_ask_new metafield. The FIRST line MUST be "Frequently Asked Questions About [Topic]" (replace [Topic] with the article's real topic — a custom Liquid turns this first line into the H2 title), then a blank line, then each question as "**Q: ...?**" on its own line, the answer as "A: ..." on the next line (2-3 supporting sentences), with a blank line between pairs.
  - The two forms must contain the same questions but NEVER be combined.
- aiItems — WHICH to generate (only what genuinely fits this blog; do NOT force a poor fit):
  - "Related Questions" — ALWAYS generate. 4-6 real questions.
  - "Summary Block" — ALWAYS generate. The key takeaways.
  - "Comparison Snippet" — ONLY if the topic has a genuine comparison (e.g. X vs Y, odd vs even). If there is nothing real to compare, OMIT it entirely.
  - "How-To Schema" — generate ONLY if this blog's TITLE contains the words "how to" (e.g. "How to Hang Wall Art"). The current blog title is: "${yourPage.title || ''}". If that title does NOT contain "how to", OMIT this item entirely — never add HowTo schema to a non-how-to blog (it breaks Google's structured-data rules). When the title IS a "how to", ALWAYS generate it. Use the EXACT element name "How-To Schema".
- SNIPPET METAFIELD HTML (the HTML aiItems — Related Questions, Summary Block, Comparison Snippet): each "content" is pasted directly into its Shopify metafield. Format: <h2> for the section title only (never <strong> or <h3> as the title); a <p> starts immediately after the <h2> with NO blank line; every item of content in its own <p>; <strong> only for bold labels INSIDE a <p>; for Related Questions each <p> is <strong>Question?</strong> followed by " — " and the answer; for Summary Block each <p> starts with <strong>Label:</strong>; NEVER use <ul>, <li>, <br>, <div> or wrapper tags; NO blank lines between tags; NO inline styles or classes.
- HOW-TO SCHEMA (the "How-To Schema" aiItem ONLY): its "content" is NOT HTML — it is a single line of valid JSON-LD wrapped in <script type="application/ld+json"> ... </script>, a schema.org HowTo object with "name", "description" and a "step" array of HowToStep objects ("name" + "text"). No markdown, no code fences, no extra text — just the <script> tag with the JSON inside.
- urlAnalysis: title changes are always safe (no redirect). Only recommend a slug change if the page has very few or zero clicks; if so, set slugChangeWarning.
- otherActions: NEVER include image filename or alt-text tasks — the Image SEO tool handles all blog images separately. NEVER include internal-link tasks — those go in internalLinksToAdd. Return an EMPTY array unless there is a genuine NON-image, NON-link action. NEVER include page speed, image compression, Core Web Vitals, canonical/OG/Twitter tags, meta robots, keyword density targets, schema, or anything already covered by h2Sections or aiItems. One sentence per action max.
- internalLinksToAdd: outbound links FROM this article (NOT in otherActions). The destination MUST be one of the RELATED OLDER BLOGS listed below — link out ONLY to those real tag-related blogs, NEVER to a collection, product, page, or any URL not on that list, and NEVER invent a URL. Give 1-2 links max, each to a DIFFERENT related blog. Put the chosen blog's exact URL in "url" and embed that SAME url in newText's <a href>. Output paste-ready text with the link ALREADY embedded (full <a href title target rel> format). PREFER mode "replace" — find a natural existing sentence in THIS article's body and return it in existingText plus the rewritten version with the link in newText. Only use mode "new" when there is no natural existing spot; then newText is a short new sentence. The anchor text must describe the destination blog and must NOT be a keyword owned by another page (no cannibalisation) and must NOT be this article's own main keyword. If no related blogs are listed below, return an empty array.
- WORD COUNT: never say "reduce word count to X" or "increase keyword density to X%" generically. If specific bloated content must go, name the EXACT paragraph opening words and why; otherwise do not mention word count or density at all.
- loserPageLinks: ONLY include if loser pages are provided above. Unique natural sentence per loser page with a real HTML anchor to this page, plus a specific placement. If none provided, omit this field entirely.
- relatedBlogLinks: for EACH blog in "RELATED OLDER BLOGS TO LINK FROM", produce one link FROM that blog INTO this page. The anchor text MUST be this page's exact main keyword "${keyword}" (NEVER a variation). If "keyword present: YES", use mode "replace" and wrap the keyword in that blog's given sentence as the link. If not present, use mode "new" with a short natural sentence/CTA that uses "${keyword}" as the anchor. The link URL is always ${yourPage.url}. One item per related blog. If no related blogs are listed above, omit this field entirely.
- PLACEMENT MUST BE CONCRETE (relatedBlogLinks AND internalLinksToAdd): never say "after the first major section" or other vague guidance. Use the blog's OUTLINE to name the EXACT spot — the section heading plus the exact position, e.g. "In the section 'How To Find Your Perfect Home Decor Styles', between paragraph 1 and paragraph 2" or "Immediately after the paragraph that starts 'When choosing…'". The merchant must be able to find the spot without thinking. ALSO fill the two structured fields on every such item: placementSection = the exact section heading ALONE (no other words), placementWhere = the position within it ALONE (e.g. "after paragraph 2"). These are shown as their own scannable lines, so keep each to just the heading / just the position. For relatedBlogLinks ALSO fill findAnchor = the EXACT existing line (verbatim from that blog's outline) to search for — the line being replaced (mode=replace) or the line the new text goes AFTER (mode=new) — so the merchant can find/replace it instantly.
- TEMPLATE METAFIELD FIELDS (these sections are built from METAFIELDS on EVERY blog, whatever template it uses — the templateChecks field IS required, and the items below must NOT be duplicated in h2Sections):
  - more_about_text + more_about_url: the "More About" section is rendered from metafields. Provide the intro sentence (more_about_text, ≤30 words) AND the authority URL (more_about_url). Do NOT also add an inline authority link in the body, and do NOT put "More about" in h2Sections — it is handled here.
  - home_decor_trends_title: only the NEW heading text for the "Home decor trends" section (its title is a metafield). The rest of that block is general — do not touch it, and do not put it in h2Sections.
  - complete_the_look_title: only the NEW heading text for the "Complete the look" section (its title is a metafield). The rest stays; do not put it in h2Sections.
  - shop_here: if the body has plain "Click here"/"Shop Now"/"Buy now" product links, replace them with this EXACT button (fill [PRODUCT URL] and [PRODUCT TITLE]); also wrap the product image in the product URL. content MUST be exactly: <p style="text-align: center;"><a href="[PRODUCT URL]" title="[PRODUCT TITLE]" rel="noopener" target="_blank" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; letter-spacing: 1px;">SHOP HERE</a></p>
  - youtube: if a relevant video should be embedded, content MUST be exactly (fill [YOUTUBE URL], [VIDEO TITLE], [EMBED URL]): <p>WATCH: <a href="[YOUTUBE URL]" title="[VIDEO TITLE]" rel="noopener" target="_blank">[VIDEO TITLE]</a></p><iframe width="100%" height="415" src="[EMBED URL]" title="[VIDEO TITLE]" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>. If no suitable video, content is "".
  - "Feeling inspired" is a shared general section linking to the main money pages — NEVER flag it (not in h2Sections, not in keywordOveruse, no changes).
  - The "People Also Ask" / FAQ section is built from the people_also_ask_new metafield (handled above) — NEVER put it in h2Sections and NEVER suggest renaming a "People Also Ask…" body H2. Do not flag more_about_, people_also_ask_new, home_decor_trends_title or complete_the_look in keywordOveruse either — they are managed by templateChecks.
- Return ONLY the JSON object — no other text`;
}

// Build the structured JSON prompt for Claude
function buildAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  // Blogs get a dedicated, blog-specific prompt
  if (yourPage.shopifyType === 'article') {
    return buildBlogAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps, loserPages, relatedBlogs);
  }
  // Collections get a dedicated collection prompt (competitor-driven + over-use + the
  // three AI snippets in their exact collection-metafield formats).
  if (yourPage.shopifyType && yourPage.shopifyType.includes('collection')) {
    return buildCollectionAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps, loserPages, relatedBlogs);
  }
  // Pages get a dedicated page prompt (competitor-driven + over-use + the page snippet
  // fields in their exact page-metafield formats).
  if (yourPage.shopifyType === 'page') {
    return buildPageAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps, loserPages, relatedBlogs);
  }
  // Products get a dedicated product prompt — full description rewrite (locked voice/structure)
  // + 3 rich-text H2 snippets + over-use + competitor badges.
  if (yourPage.shopifyType === 'product') {
    return buildProductAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps, loserPages, relatedBlogs);
  }

  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;
  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const pageTypeLabel = yourPage.shopifyType === 'product' ? 'product page'
    : yourPage.shopifyType?.includes('collection') ? 'collection page'
    : yourPage.shopifyType === 'article' ? 'blog article'
    : yourPage.shopifyType === 'page' ? 'landing page' : 'page';

  const schemaType = yourPage.shopifyType === 'product' ? 'Product'
    : yourPage.shopifyType?.includes('collection') ? 'CollectionPage'
    : yourPage.shopifyType === 'article' ? 'Article' : 'WebPage';

  const currentDesc = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
    : '';

  const missingH2s = contentGaps?.missingH2s?.length > 0
    ? contentGaps.missingH2s.map(h => `"${h.text}"`).join(', ') : 'None';
  const missingAI = contentGaps?.missingAIOptimization?.length > 0
    ? contentGaps.missingAIOptimization.map(a => `${a.element} [${a.priority}]`).join(', ') : 'None';

  return `You are an expert SEO specialist. Analyse this ${pageTypeLabel} and return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Page type: ${pageTypeLabel}
- Current title: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- Current H2s: ${yourPage.h2.slice(0, 10).join(' | ') || 'None'}
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})
- Keyword density: ${yourPage.keywordDensity}% (competitor avg: ${avgCompKeywordDensity}%)
- Mobile speed: ${yourPage.speedMobile}
${currentDesc ? `- Current description: ${currentDesc}` : ''}

COMPETITORS:
${competitors.map(c => `Position ${c.position}: ${c.wordCount} words, ${c.keywordDensity}% density, H2s: ${c.h2.slice(0, 5).join(' | ') || 'none'}`).join('\n')}

CONTENT GAPS:
- Missing H2 sections: ${missingH2s}
- Missing AI elements: ${missingAI}
- AI Visibility Score: ${yourPage.aiScore}/10

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title, max 60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description, max 135 chars, keyword included, ends with a benefit or CTA, UK spelling. Do NOT mention shipping — 'Free UK shipping!' is appended automatically.",
  "suggestedDescription": "2-3 sentences for the Shopify description field. Keyword-rich. AboutWallArt brand voice. UK spelling. No HTML tags.",
  "pageSchema": {
    "@context": "https://schema.org",
    "@type": "${schemaType}",
    "name": "page name",
    "description": "page description",
    "url": "${yourPage.url}"
  },
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Write a real question people search about ${keyword}",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Write a helpful complete answer"
        }
      }
    ]
  },
  "brandBlock": "<h2>About AboutWallArt</h2><p>Founded in 2020, we're the UK's leading specialist in wall art and home decor. As a trusted, UK-based company, we design and produce our own unique wall art items in-house. Rated 4.8/5 stars from over 500+ verified customer reviews, we offer free fast UK delivery, international shipping, secure checkout, and back every purchase with our hassle-free 14-day return policy.</p>",
  "h2Sections": [
    {
      "action": "change",
      "heading": "Exact current H2 text as it appears on the page",
      "reason": "One sentence: why this H2 needs attention (e.g. not keyword-relevant, wrong hierarchy, theme noise, duplicates content)",
      "exactAction": "Precise instruction — one of: 'Rename to [new text] and keep as H2' / 'Remove the H2 tag but keep the text as a regular paragraph' / 'Delete this entire section — it is auto-generated by the theme and cannot be edited in page content'"
    },
    {
      "action": "add",
      "heading": "New H2 heading text",
      "content": "Full 2-3 sentence paragraph for this section. Complete sentences. UK spelling."
    }
  ],
  "aiItems": [
    {
      "element": "Comparison Snippet",
      "priority": "high",
      "content": "Full copy-paste ready paragraph starting with 'What is ${keyword}?'"
    }
  ],
  "urlAnalysis": {
    "currentSlug": "exact-current-url-slug",
    "slugMatchesKeyword": "exact|similar|different",
    "currentTitle": "Current page title",
    "titleMatchesKeyword": "exact|similar|different",
    "changeTitle": true,
    "suggestedTitle": "New product/page title using exact keyword — leave blank if no change needed",
    "changeSlug": false,
    "suggestedSlug": "new-slug-if-change-safe — leave blank if no change needed",
    "slugChangeWarning": "Only change slug if this page has 0 or near-0 clicks. If changed, set up a 301 redirect from the old URL to the new URL.",
    "notes": "One sentence summary of what needs doing and why"
  },
  "otherActions": [
    {
      "priority": "high",
      "action": "Specific actionable instruction — image filename/alt text only. One sentence max."
    }
  ],
  "loserPageLinks": [
    {
      "loserUrl": "exact URL of the loser page",
      "loserPageType": "product|collection|blog|page",
      "suggestedSentence": "One natural sentence with <a href='[winnerUrl]'>[relevant anchor text]</a> that sounds like editorial content — unique per loser page, never a template",
      "placement": "Specific placement guidance e.g. 'After the main product description' or 'Within the styling advice section' — be specific, not 'at the end'"
    }
  ]
}
${loserPages.length > 0 ? `
LOSER PAGES THAT SHOULD LINK TO THIS PAGE:
${loserPages.map(l => `- ${l.loserUrl} (${l.pageType}, keyword: "${l.loserKeyword}")`).join('\n')}
` : ''}

RULES:
- suggestedTitle: max 60 chars (hard limit — audit flags above this), keyword near start, include brand or USP
- suggestedMeta: max 135 chars (hard limit — also used as OG description, stricter threshold), keyword, main benefit, CTA
- suggestedDescription: plain text only, no HTML, 2-3 sentences, keyword-rich, UK spelling
- pageSchema: write complete valid schema appropriate for the page type — for collections include numberOfItems, for articles include author/datePublished. NEVER fabricate a price or offer: only include offers/price if a real price is given in the page data above, otherwise omit them. NEVER suggest product-level schema for individual items within a collection page — that belongs on each product page separately and should NOT appear here.
- faqSchema: write 6-8 real questions people search about "${keyword}" with full helpful answers. Answers must stay general and accurate — NEVER state a specific price, size, material, weight/GSM, product count, star rating, date or guarantee unless that exact fact already appears in the page data provided above.
- brandBlock: use EXACTLY the text shown — do not change it. The brand block already includes star ratings and review count — never add a separate star rating suggestion anywhere else.
- h2Sections: for EVERY H2 that needs attention use action "change" with reason + exactAction; for new H2s use action "add" with content. Never use action "delete" — always specify rename, retag, or delete with exact instruction and reason. NEVER flag these theme sections for removal or modification: "Trending Now", "Recently Viewed Products", "Recently Viewed", "New Arrivals", "Customers Are Saying", or any auto-generated review/browsing/merchandising widget.
- h2Sections add content: for each "add" H2, write a full 2-3 sentence paragraph that naturally includes the target keyword and 1-2 variants. Include 1-2 internal links as actual HTML <a href="https://aboutwallart.com/collections/[relevant]">[anchor text]</a> tags within the paragraph text — do NOT add internal links as a separate otherAction.
- If the page contains a marketing/lead capture/email subscription section: NEVER suggest deleting it. Instead write a keyword-optimised rewrite of that section's text as a separate "add" h2Section or aiItem — provide the full replacement text ready to copy-paste.
- aiItems: include a "priority" field (high/medium/low) for each item; write complete copy-paste ready HTML content. Do NOT include FAQ Schema in aiItems — it is already fully provided in the faqSchema field. Do NOT include Product Schema suggestions for collection pages in aiItems.
- urlAnalysis: compare the URL slug and page title to the target keyword. Only recommend slug change if the page has very few or zero clicks (check the click data provided). Title changes are always safe — no redirect needed. If recommending a slug change, always set slugChangeWarning with the redirect instruction.
- otherActions: ONLY include image filename/alt text optimisation tasks. NEVER include: page speed, image compression, lazy loading, WebP conversion, Core Web Vitals, LCP, CLS, TBT, canonical tags, Open Graph tags, Twitter Card tags, meta robots, keyword density percentage targets, aggregate star ratings, review count displays, schema suggestions, or anything already covered by h2Sections or aiItems. One sentence per action max.
- WORD COUNT: Never say "reduce word count to X words" or "increase keyword density to X%" generically. If specific bloated content must go, name the EXACT paragraph opening words and why. If you cannot identify specific content to cut, do not mention word count or keyword density at all.
- loserPageLinks: ONLY include if loser pages are provided above. For each loser page write a unique natural sentence (never a template) that fits that specific page's topic and keyword. Include an actual HTML anchor tag linking to the winner page. Suggest a specific placement that makes sense for that page's content — not always "at the end". If no loser pages provided, omit this field entirely.
- Return ONLY the JSON object — no other text`;
}

// Build the COLLECTION-specific structured JSON prompt. Mirrors the blog prompt's
// competitor-driven analysis + keyword over-use check, but outputs the three AI snippets
// in their EXACT collection-metafield formats (each carries its target metafieldKey) and
// keeps Page/FAQ schema + brand block (collections need them, unlike blogs).
function buildCollectionAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;
  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const currentDesc = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
    : '';

  const lh = yourPage.liveHeadings || { h1: yourPage.h1, h2: yourPage.h2, h3: yourPage.h3 };
  const existingHeadings = [
    ...(lh.h1 || []).map(h => `H1: ${h}`),
    ...(lh.h2 || []).map(h => `H2: ${h}`),
    ...(lh.h3 || []).map(h => `H3: ${h}`)
  ].join('\n') || 'None found';
  const existingBodyText = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000)
    : '';
  const existingMetafields = (yourPage.metafields || []).length > 0
    ? yourPage.metafields.map(m => `[${m.key}] ${m.text}`).join('\n')
    : 'None';

  const missingH2s = contentGaps?.missingH2s?.length > 0
    ? contentGaps.missingH2s.map(h => `"${h.text}"`).join(', ') : 'None';
  const missingAI = (contentGaps?.missingAIOptimization || []).length > 0
    ? contentGaps.missingAIOptimization.map(a => `${a.element} [${a.priority}]`).join(', ') : 'None';

  return `You are an expert SEO specialist optimising a COLLECTION PAGE for AboutWallArt (UK wall art and home decor store). Return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Page type: collection page
- Current title: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- Current H2s: ${yourPage.h2.slice(0, 12).join(' | ') || 'None'}
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})
- Keyword density: ${yourPage.keywordDensity}% (competitor avg: ${avgCompKeywordDensity}%)
${currentDesc ? `- Current description: ${currentDesc}` : ''}

EXISTING PAGE CONTENT (use this for the keywordOveruse check AND to avoid suggesting content that already exists):
ALL HEADINGS ON THE PAGE (live, includes theme/custom-Liquid sections):
${existingHeadings}

FULL BODY TEXT:
${existingBodyText || 'None'}

METAFIELD CONTENT:
${existingMetafields}

COMPETITORS — the pages outranking you (positions 1-3). Your job is to make THIS page beat them. Compare your FULL page against each:
${competitors.map(c => `--- Position ${c.position}: ${c.url}
  Title: ${c.title || 'N/A'}
  Meta: ${c.metaDescription || 'N/A'}
  H1: ${(c.h1||[]).join(' | ') || 'N/A'}
  H2s: ${(c.h2||[]).join(' | ') || 'N/A'}
  H3s: ${(c.h3||[]).join(' | ') || 'N/A'}
  Word count: ${c.wordCount} | Keyword density: ${c.keywordDensity}%`).join('\n')}

CONTENT GAPS (mechanical hints only — do your own richer comparison from the competitor data above):
- Missing H2 sections: ${missingH2s}
- Missing content elements: ${missingAI}

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title, max 60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description, max 135 chars, keyword included, ends with a benefit or CTA, UK spelling. Do NOT mention shipping — 'Free UK shipping!' is appended automatically.",
  "suggestedDescription": "2-3 sentences for the collection description field. Keyword-rich, AboutWallArt brand voice, UK spelling, no HTML tags.",
  "browseTheCollection": "An SEO-worthy on-page heading built around the main keyword (shown above the product grid). NOT generic, NEVER starts with 'Shop'. Max ~70 chars. e.g. for 'black and white wall art' → 'Black and White Wall Art for Modern Living Rooms'.",
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "A real question people search about ${keyword}", "acceptedAnswer": { "@type": "Answer", "text": "A helpful complete answer" } }
    ]
  },
  "keywordOveruse": {
    "isOverstuffed": true,
    "summary": "One plain-English sentence about over-use of \\"${keyword}\\".",
    "findings": [
      {
        "location": "H2 | H3 | paragraph | metafield: <key> — where it lives",
        "metafieldKey": "",
        "currentText": "the ONE shortest exact sentence (or heading) that contains the over-use, copied verbatim — NEVER a whole paragraph",
        "recommendation": "reword OR remove",
        "suggestedText": "if reword: that SAME single sentence rewritten — same start and end, changing ONLY the few over-used words to a related/secondary term (so a diff shows just the changed words), not a shorter fragment. If remove: empty string.",
        "reason": "one short sentence on why this is over-use"
      }
    ]
  },
  "h2Sections": [
    {
      "action": "change",
      "heading": "Exact current H2 text as it appears on the page",
      "reason": "One sentence: why this H2 needs attention",
      "exactAction": "Precise instruction — e.g. 'Rename to [new text] and keep as H2' / 'Remove the H2 tag but keep the text as a regular paragraph'",
      "replacementText": "ONLY the exact final text to paste — no quotes, no instructions. Empty if nothing to paste.",
      "competitorDriven": false
    },
    {
      "action": "remove",
      "heading": "Exact current H2 / section text to remove",
      "reason": "Why this section HURTS SEO (thin, off-topic, duplicate, keyword-diluting, or proven unnecessary vs competitors). Body content only — NEVER a global theme section.",
      "competitorDriven": false
    },
    {
      "action": "add",
      "heading": "New H2 section heading (plain text, no tags)",
      "content": "Complete paste-ready HTML for a NEW SEO content section destined for the collection's SEO Text (with links) field: an <h2> heading followed by one or more <p> paragraphs. Include 1-2 inline internal links to other relevant AboutWallArt collections or pages as <a href=\\"https://aboutwallart.com/collections/[handle]\\">anchor text</a>. UK spelling. No <br>, no inline styles, no wrapper divs.",
      "competitorDriven": true
    }
  ],
  "aiItems": [
    {
      "element": "Comparison Snippet",
      "metafieldKey": "comparison_snippet",
      "priority": "high",
      "content": "<p><strong style=\\"text-transform: uppercase; display: block; margin-bottom: 0.75rem;\\">What is ${keyword}?</strong></p><p>[a complete, standalone 3-5 sentence answer; first sentence answers the question fully]</p>",
      "competitorDriven": false
    },
    {
      "element": "Comparison Table",
      "metafieldKey": "comparison_table",
      "priority": "medium",
      "content": "<h2>[comparison heading]</h2><table><thead><tr><th>Col1</th><th>Col2</th><th>Col3</th><th>Col4</th></tr></thead><tbody><tr><td>…</td><td>…</td><td>…</td><td>…</td></tr></tbody></table>",
      "competitorDriven": false
    },
    {
      "element": "People Also Ask",
      "metafieldKey": "people_also_ask",
      "priority": "high",
      "content": "<h2>People Also Ask About [Topic]</h2><ul><li><strong>Question?</strong> answer</li><li><strong>Question?</strong> answer</li></ul>",
      "competitorDriven": false
    }
  ],
  "urlAnalysis": {
    "currentSlug": "exact-current-url-slug",
    "slugMatchesKeyword": "exact|similar|different",
    "currentTitle": "Current page title",
    "titleMatchesKeyword": "exact|similar|different",
    "changeTitle": true,
    "suggestedTitle": "New title using exact keyword — leave blank if no change needed",
    "changeSlug": false,
    "suggestedSlug": "new-slug-if-change-safe — leave blank if no change needed",
    "slugChangeWarning": "Only change slug if this page has 0 or near-0 clicks. If changed, set up a 301 redirect from the old URL to the new URL.",
    "notes": "One sentence summary"
  },
  "otherActions": [],
  "loserPageLinks": [
    {
      "loserUrl": "exact URL of the loser page",
      "loserPageType": "product|collection|blog|page",
      "suggestedSentence": "One natural sentence with <a href='[winnerUrl]'>[relevant anchor text]</a> — unique per loser page, never a template",
      "placement": "Specific placement guidance — be specific, not 'at the end'"
    }
  ]${relatedBlogs.length > 0 ? `,
  "relatedBlogLinks": [
    {
      "sourceUrl": "EXACT url of the related blog this link comes FROM (copy from the RELATED OLDER BLOGS list)",
      "sourceTitle": "that blog's title",
      "mode": "replace OR new",
      "existingText": "if that blog already contains the keyword (present: YES): the exact sentence to swap out. Otherwise empty.",
      "newText": "paste-ready text with THIS collection's main keyword wrapped as the anchor: <a href=\\"${yourPage.url}\\" title=\\"...\\" target=\\"_blank\\" rel=\\"noopener\\">${keyword}</a>. For replace: the existing sentence rewritten with the link. For new: a short natural sentence/CTA using the keyword as the anchor.",
      "placement": "where in that source blog to add it (shown outside the copy box)"
    }
  ]` : ''}
}
${loserPages.length > 0 ? `
LOSER PAGES THAT SHOULD LINK TO THIS PAGE:
${loserPages.map(l => `- ${l.loserUrl} (${l.pageType}, keyword: "${l.loserKeyword}")`).join('\n')}
` : ''}
${relatedBlogs.length > 0 ? `
RELATED OLDER BLOGS TO LINK FROM (add one link from EACH into this collection; anchor MUST be the main keyword "${keyword}"). Each blog's OUTLINE is given (## = H2 section, # = H3, ¶N = paragraph N within the current section) — use it to give a CONCRETE placement:
${relatedBlogs.map(b => `--- ${b.url} | "${b.title}" | keyword present: ${b.keywordPresent ? 'YES' : 'no'}${b.keywordPresent && b.sentence ? ` | sentence: "${b.sentence}"` : ''}
OUTLINE:
${b.outline || '(no outline available)'}`).join('\n')}
` : ''}

RULES:
- COMPETITOR-DRIVEN ANALYSIS (the backbone of this audit): your goal is to make THIS collection OUTRANK positions 1-3. Compare the full page against the competitor data above and silently answer: (1) what topics/buying questions do they cover that this page is missing? (2) what would a shopper want answered BEFORE buying that this page doesn't answer? (3) what makes their pages feel more complete or trustworthy? Let those answers DRIVE your recommendations (h2Sections, aiItems, keywordOveruse). Work ONLY from the competitor data provided — NEVER invent competitor content you cannot see.
- competitorDriven flag: on EVERY h2Sections item and aiItem include a boolean "competitorDriven". Set it TRUE whenever the recommendation fills a gap one or more competitors cover, beats something they do, or matches content/depth they have and this page lacks — you MUST mark these true, do not default everything to false. Set it false ONLY for pure general SEO best practice unrelated to the competitor data. When true, the "reason" MUST name the competitive rationale (e.g. "all 3 competitors cover X; this page doesn't").
- keywordOveruse: examine ALL of "EXISTING PAGE CONTENT" (every heading, the full body, every metafield) and decide whether "${keyword}" is over-used. For each over-used spot return where it lives, the EXACT current text, recommendation "reword" (with suggestedText using a related/secondary term) or "remove" (suggestedText empty). Always set "metafieldKey" to an empty string here. EXCLUDE global/shared theme chrome (nav, menus, breadcrumbs, footer, cookie notices, search, account, newsletter, "related"/"recently viewed"). A single natural use is FINE — only flag genuine over-use. If not over-stuffed, return "isOverstuffed": false with an empty findings array.
- suggestedTitle: max 60 chars (hard limit), keyword near start. suggestedMeta: max 135 chars (hard limit), keyword once, benefit, CTA. suggestedDescription: plain text, no HTML, 2-3 sentences, UK spelling.
- faqSchema: 6-8 real questions about "${keyword}" with full helpful answers. Answers must stay general and accurate — NEVER state a specific price, size, material, weight/GSM, product count, star rating, date or guarantee unless that exact fact already appears in the page data provided above. Do NOT return pageSchema or brandBlock — the theme already renders the collection page schema and the brand/About block site-wide.
- browseTheCollection: a single SEO-worthy heading built around "${keyword}", shown on the page above the products. It must read naturally as a heading, include the keyword (or a close variation) and a useful qualifier, be at most ~70 characters, NEVER be a generic phrase like "Browse the Collection", and NEVER start with the word "Shop".
- h2Sections: use action "change" (rename/retag a current H2, with reason + exactAction + replacementText), action "remove" (a body section that HURTS SEO — body content ONLY, never a global theme section), or action "add" (a NEW SEO content section — its "content" is paste-ready HTML, an <h2> heading + <p> paragraphs with 1-2 inline internal links, destined for the collection's SEO Text (with links) field). Add a section ONLY for a genuine content gap (check EXISTING PAGE CONTENT first — never duplicate a topic already covered, never add just to repeat "${keyword}"). NEVER flag these shared/theme sections for removal OR rename (they are site-wide, identical on every collection, and cannot be customised per collection): the brand/About section (e.g. "About Wall Art", "About AboutWallArt", "Why choose us"), "Visit the Content Hub", "Content Hub", "Trending Now", "Recently Viewed", "New Arrivals", "Customers Are Saying", or any auto-generated review/browsing/merchandising widget. Leave all of these out of h2Sections entirely. Include competitorDriven on every item.
- ⚠️ KEYWORD USAGE — NO STUFFING (critical): use the EXACT keyword "${keyword}" only where it matters most — the title, the first line, and at most one or two headings. EVERYWHERE else (meta, description, body paragraphs, FAQ answers, snippets, the comparison table) write naturally for the reader using secondary terms, natural variations and related phrases. NEVER repeat the exact keyword over and over — Google does not reward exact-match repetition and treats stuffing as spam. If a suggestion would push the exact keyword in more than the spots above, rewrite it with a variation instead.
- ⚠️ NO CANNIBALISATION (critical): this collection must NOT compete with another AboutWallArt page for the same keyword. Do NOT target a keyword that is clearly owned by a different collection, product, blog or page; do NOT recommend internal-link anchors that use another page's main keyword; and any anchor text in "add" sections or relatedBlogLinks must describe the destination, never duplicate a keyword another page already ranks for. When in doubt, use a more specific long-tail variation unique to THIS collection.
- aiItems — generate the three collection snippets in their EXACT formats below. Generate "People Also Ask" ALWAYS (4-6 real questions). Generate "Comparison Snippet" ALWAYS (a "What is ${keyword}?" definition). Generate "Comparison Table" ONLY if there is a genuine comparison to make (styles, sizes, materials) — otherwise OMIT it.
  - Comparison Snippet ("comparison_snippet") EXACT format: <p><strong style="text-transform: uppercase; display: block; margin-bottom: 0.75rem;">[QUESTION]</strong></p><p>[answer paragraph]</p> — no other tags, no <h2>.
  - Comparison Table ("comparison_table") EXACT format: a single <h2>heading</h2> then a <table> with <thead> and <tbody>, MAX 4 columns and 6 rows, NO inline styles.
  - People Also Ask ("people_also_ask") EXACT format: <h2>People Also Ask About [Topic]</h2> then a single <ul> with 4-6 <li>, each <li> = <strong>Question?</strong> followed by a space and the answer. NO schema markup, no inline styles, no <br>.
  - Keep each item's "metafieldKey" EXACTLY as shown (comparison_snippet / comparison_table / people_also_ask).
- urlAnalysis: title changes are always safe (no redirect). Only recommend a slug change if the page has very few or zero clicks.
- otherActions: return an EMPTY array (image and internal-link tasks are handled by other tools).
- loserPageLinks: ONLY include if loser pages are provided above; unique natural sentence per loser page with a real HTML anchor to this page and a specific placement. If none provided, omit this field entirely.
- relatedBlogLinks: for EACH blog in "RELATED OLDER BLOGS TO LINK FROM", produce one link FROM that blog INTO this collection. The anchor text MUST be this collection's exact main keyword "${keyword}". If "keyword present: YES", use mode "replace" and wrap the keyword in that blog's given sentence as the link. If not present, use mode "new" with a short natural sentence/CTA using "${keyword}" as the anchor. The link URL is always ${yourPage.url}. One item per related blog. Use each blog's OUTLINE to give a CONCRETE placement (name the section + exact paragraph position, never vague). If no related blogs are listed above, omit this field entirely.
- Return ONLY the JSON object — no other text`;
}

// ── PAGE analysis prompt (shopifyType === 'page') ──────────────────────────────
// Pages reuse ~80% of the collection logic but write to PAGE metafield keys with
// their own formats. P1 = backbone: SEO copy fields, Comparison Snippet (rich_text),
// Comparison Table (single_line one-liner), the THREE question/FAQ fields (all filled
// from one Q&A set), over-use check + competitor-driven badges.
function buildPageAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;
  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const currentDesc = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
    : '';

  const lh = yourPage.liveHeadings || { h1: yourPage.h1, h2: yourPage.h2, h3: yourPage.h3 };
  const existingHeadings = [
    ...(lh.h1 || []).map(h => `H1: ${h}`),
    ...(lh.h2 || []).map(h => `H2: ${h}`),
    ...(lh.h3 || []).map(h => `H3: ${h}`)
  ].join('\n') || 'None found';
  const existingBodyText = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000)
    : '';
  const existingMetafields = (yourPage.metafields || []).length > 0
    ? yourPage.metafields.map(m => `[${m.key}] ${m.text}`).join('\n')
    : 'None';

  const missingH2s = contentGaps?.missingH2s?.length > 0
    ? contentGaps.missingH2s.map(h => `"${h.text}"`).join(', ') : 'None';
  const missingAI = (contentGaps?.missingAIOptimization || []).length > 0
    ? contentGaps.missingAIOptimization.map(a => `${a.element} [${a.priority}]`).join(', ') : 'None';

  return `You are an expert SEO specialist optimising a CONTENT PAGE (a Shopify "page", e.g. an interior-design ideas / inspiration landing page) for AboutWallArt (UK wall art and home decor store). Return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Page type: content/landing page
- Current title: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- Current H2s: ${yourPage.h2.slice(0, 12).join(' | ') || 'None'}
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})
- Keyword density: ${yourPage.keywordDensity}% (competitor avg: ${avgCompKeywordDensity}%)
${currentDesc ? `- Current description: ${currentDesc}` : ''}

EXISTING PAGE CONTENT (use this for the keywordOveruse check AND to avoid suggesting content that already exists):
ALL HEADINGS ON THE PAGE (live, includes theme/custom-Liquid sections):
${existingHeadings}

FULL BODY TEXT:
${existingBodyText || 'None'}

METAFIELD CONTENT:
${existingMetafields}

COMPETITORS — the pages outranking you (positions 1-3). Your job is to make THIS page beat them. Compare your FULL page against each:
${competitors.map(c => `--- Position ${c.position}: ${c.url}
  Title: ${c.title || 'N/A'}
  Meta: ${c.metaDescription || 'N/A'}
  H1: ${(c.h1||[]).join(' | ') || 'N/A'}
  H2s: ${(c.h2||[]).join(' | ') || 'N/A'}
  H3s: ${(c.h3||[]).join(' | ') || 'N/A'}
  Word count: ${c.wordCount} | Keyword density: ${c.keywordDensity}%`).join('\n')}

CONTENT GAPS (mechanical hints only — do your own richer comparison from the competitor data above):
- Missing H2 sections: ${missingH2s}
- Missing content elements: ${missingAI}

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title, max 60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description, max 135 chars, keyword included, ends with a benefit or CTA, UK spelling. Do NOT mention shipping — 'Free UK shipping!' is appended automatically.",
  "suggestedDescription": "2-3 sentences for the page description field. Keyword-rich, AboutWallArt brand voice, UK spelling, no HTML tags.",
  "keywordOveruse": {
    "isOverstuffed": true,
    "summary": "One plain-English sentence about over-use of \\"${keyword}\\".",
    "findings": [
      {
        "location": "H2 | H3 | paragraph | metafield: <key> — where it lives",
        "metafieldKey": "",
        "currentText": "the ONE shortest exact sentence (or heading) that contains the over-use, copied verbatim — NEVER a whole paragraph",
        "recommendation": "reword OR remove",
        "suggestedText": "if reword: that SAME single sentence rewritten — same start and end, changing ONLY the few over-used words to a related/secondary term (so a diff shows just the changed words), not a shorter fragment. If remove: empty string.",
        "reason": "one short sentence on why this is over-use"
      }
    ]
  },
  "questionSet": [
    { "question": "A real question people search about ${keyword}?", "answer": "A complete, helpful one-sentence answer." }
  ],
  "aiItems": [
    {
      "element": "Comparison Snippet",
      "metafieldKey": "comparison_snippet",
      "format": "richtext_snippet",
      "priority": "high",
      "content": "<h3>What is ${keyword}?</h3><p>[a complete, standalone 3-5 sentence answer; the FIRST sentence answers the question fully on its own]</p>",
      "competitorDriven": false
    },
    {
      "element": "Comparison Table",
      "metafieldKey": "comparison_table",
      "format": "singleline_html",
      "priority": "medium",
      "content": "<h3>[comparison heading]</h3><table><thead><tr><th>Col1</th><th>Col2</th><th>Col3</th><th>Col4</th></tr></thead><tbody><tr><td>…</td><td>…</td><td>…</td><td>…</td></tr></tbody></table>",
      "competitorDriven": false
    }
  ],
  "faqIntro": "<h3>Frequently Asked Questions About [Topic]</h3><p>[a 1-2 sentence intro to the FAQ section — natural, helpful, NO links, NO list]</p>",
  "seoBodyBlock": "<h3>[a descriptive SEO heading]</h3><p>[one rich paragraph, 3-5 sentences, that naturally works in 1-2 internal links to relevant AboutWallArt collections or pages as <a href=\\"https://aboutwallart.com/collections/[handle]\\" target=\\"_blank\\" rel=\\"noopener\\">anchor text</a>]</p>",
  "unsureWhereToStart": "A plain-text helper title built around the main keyword, e.g. 'How to Start Decorating Your Home in Transitional Style'. No HTML, max ~70 chars.",
  "bodyAddition": {
    "heading": "New H2 section heading for the page body (plain text, no tags)",
    "content": "<h2>[heading]</h2><p>[1-2 paragraphs of genuinely new on-page content; weave in 1-2 internal links as full-URL <a href=\\"https://aboutwallart.com/...\\" target=\\"_blank\\" rel=\\"noopener\\">anchor</a>]</p>"
  },
  "browseTheCollection": "An SEO-worthy on-page heading built around the main keyword, shown above the product grid of the collection that lives INSIDE this page. NOT generic, NEVER starts with 'Shop'. Max ~70 chars. e.g. for 'transitional interior design' → 'Transitional Interior Design Ideas for Every Room'.",
  "urlAnalysis": {
    "currentSlug": "exact-current-url-slug",
    "slugMatchesKeyword": "exact|similar|different",
    "currentTitle": "Current page title",
    "titleMatchesKeyword": "exact|similar|different",
    "changeTitle": true,
    "suggestedTitle": "New title using exact keyword — leave blank if no change needed",
    "changeSlug": false,
    "suggestedSlug": "new-slug-if-change-safe — leave blank if no change needed",
    "slugChangeWarning": "Only change slug if this page has 0 or near-0 clicks. If changed, set up a 301 redirect from the old URL to the new URL.",
    "notes": "One sentence summary"
  },
  "otherActions": [],
  "loserPageLinks": [
    {
      "loserUrl": "exact URL of the loser page",
      "loserPageType": "product|collection|blog|page",
      "suggestedSentence": "One natural sentence with <a href='[thisPageUrl]'>[relevant anchor text]</a> — unique per loser page, never a template",
      "placement": "Specific placement guidance — be specific, not 'at the end'"
    }
  ]${relatedBlogs.length > 0 ? `,
  "relatedBlogLinks": [
    {
      "sourceUrl": "EXACT url of the related blog this link comes FROM (copy from the RELATED OLDER BLOGS list)",
      "sourceTitle": "that blog's title",
      "mode": "replace OR new",
      "existingText": "if that blog already contains the keyword (present: YES): the exact sentence to swap out. Otherwise empty.",
      "newText": "paste-ready text with THIS page's main keyword wrapped as the anchor: <a href=\\"${yourPage.url}\\" title=\\"...\\" target=\\"_blank\\" rel=\\"noopener\\">${keyword}</a>. For replace: the existing sentence rewritten with the link. For new: a short natural sentence/CTA using the keyword as the anchor.",
      "placement": "where in that source blog to add it (shown outside the copy box)"
    }
  ]` : ''}
}
${loserPages.length > 0 ? `
LOSER PAGES THAT SHOULD LINK TO THIS PAGE:
${loserPages.map(l => `- ${l.loserUrl} (${l.pageType}, keyword: "${l.loserKeyword}")`).join('\n')}
` : ''}
${relatedBlogs.length > 0 ? `
RELATED OLDER BLOGS TO LINK FROM (add one link from EACH into this page; anchor MUST be the main keyword "${keyword}"). Each blog's OUTLINE is given (## = H2 section, # = H3, ¶N = paragraph N within the current section) — use it to give a CONCRETE placement:
${relatedBlogs.map(b => `--- ${b.url} | "${b.title}" | keyword present: ${b.keywordPresent ? 'YES' : 'no'}${b.keywordPresent && b.sentence ? ` | sentence: "${b.sentence}"` : ''}
OUTLINE:
${b.outline || '(no outline available)'}`).join('\n')}
` : ''}

RULES:
- COMPETITOR-DRIVEN ANALYSIS (the backbone of this audit): your goal is to make THIS page OUTRANK positions 1-3. Compare the full page against the competitor data above and silently answer: (1) what topics/buying questions do they cover that this page is missing? (2) what would a visitor want answered that this page doesn't answer? (3) what makes their pages feel more complete or trustworthy? Let those answers DRIVE your recommendations (aiItems, questionSet, keywordOveruse). Work ONLY from the competitor data provided — NEVER invent competitor content you cannot see.
- competitorDriven flag: on EVERY aiItem include a boolean "competitorDriven". Set it TRUE whenever the recommendation fills a gap one or more competitors cover, beats something they do, or matches content/depth they have and this page lacks — you MUST mark these true, do not default everything to false. Set it false ONLY for pure general SEO best practice unrelated to the competitor data. When true, the reason/content rationale MUST name the competitive angle.
- keywordOveruse: examine ALL of "EXISTING PAGE CONTENT" (every heading, the full body, every metafield) and decide whether "${keyword}" is over-used. For each over-used spot return where it lives, the EXACT current text, recommendation "reword" (with suggestedText using a related/secondary term) or "remove" (suggestedText empty). Always set "metafieldKey" to an empty string here. EXCLUDE global/shared theme chrome (nav, menus, breadcrumbs, footer, cookie notices, search, account, newsletter, "related"/"recently viewed"). A single natural use is FINE — only flag genuine over-use. If not over-stuffed, return "isOverstuffed": false with an empty findings array.
- suggestedTitle: max 60 chars (hard limit), keyword near start. suggestedMeta: max 135 chars (hard limit), keyword once, benefit, CTA. suggestedDescription: plain text, no HTML, 2-3 sentences, UK spelling.
- questionSet: 4-6 real "People Also Ask"-style questions about "${keyword}" with full, helpful one-sentence answers. Answers must stay general and accurate — NEVER state a specific price, size, material, weight/GSM, product count, star rating, date or guarantee unless that exact fact already appears in the page data provided above. This SINGLE set is reused to fill three different page fields, so make each question genuinely useful and self-contained. The first word of each question should vary (not all "What…").
- aiItems — generate the page snippets in their EXACT formats below:
  - Comparison Snippet ("comparison_snippet", richtext_snippet) EXACT format: <h3>[the question]</h3><p>[answer paragraph, 3-5 sentences, first sentence is a standalone answer]</p> — H3 only, no other tags. ALWAYS generate this (a "What is ${keyword}?" style definition).
  - Comparison Table ("comparison_table", singleline_html) EXACT format: a single <h3>heading</h3> then a <table> with <thead> and <tbody>, MAX 4 columns and 6 rows, NO inline styles, NO <br>. Generate ONLY if there is a genuine comparison to make (styles, rooms, materials) — otherwise OMIT this item entirely.
  - Keep each item's "metafieldKey" and "format" EXACTLY as shown.
- faqIntro: a short FAQ section intro — an <h3> heading reading "Frequently Asked Questions About [Topic]" (replace [Topic] with the page's real topic, NOT the raw keyword if that reads awkwardly) followed by ONE <p> of 1-2 sentences. NO links, NO list, NO other tags. This is rich text.
- seoBodyBlock: ONE <h3> heading then ONE <p> paragraph (3-5 sentences) that naturally includes 1-2 internal links as full-URL anchors with target="_blank" rel="noopener". This becomes a single-line HTML field, so output it as ONE unbroken line — no line breaks, no <br>, no inline styles, no wrapper divs.
- unsureWhereToStart: a single plain-text helper title built around the main keyword (no HTML, max ~70 chars), e.g. "How to Start Decorating Your Home in Transitional Style".
- browseTheCollection: a single SEO-worthy heading built around "${keyword}" for the collection that sits inside this page (above its product grid). It must read naturally as a heading, include the keyword (or a close variation) plus a useful qualifier, be at most ~70 characters, NEVER be a generic phrase like "Browse the Collection", and NEVER start with "Shop".
- bodyAddition: ONE genuinely new content section for the PAGE BODY — an <h2> heading + 1-2 <p> paragraphs, weaving in 1-2 internal links as full-URL anchors with target="_blank" rel="noopener". Only add a section for a real content gap (check EXISTING PAGE CONTENT first — never duplicate a topic already covered). No inline styles, no wrapper divs. If the page is already complete and a new body section would be padding, return bodyAddition as null.
- ⚠️ KEYWORD USAGE — NO STUFFING (critical): use the EXACT keyword "${keyword}" only where it matters most — the title, the first line, and at most one or two headings. EVERYWHERE else write naturally for the reader using secondary terms, natural variations and related phrases. NEVER repeat the exact keyword over and over — Google treats stuffing as spam.
- ⚠️ NO CANNIBALISATION (critical): this page must NOT compete with another AboutWallArt page for the same keyword. Do NOT target a keyword clearly owned by a different page, collection, product or blog; any anchor text must describe the destination, never duplicate a keyword another page already ranks for. When in doubt, use a more specific long-tail variation unique to THIS page.
- urlAnalysis: title changes are always safe (no redirect). Only recommend a slug change if the page has very few or zero clicks.
- otherActions: return an EMPTY array (image and schema tasks are handled by other tools/batches).
- loserPageLinks: ONLY include if loser pages are provided above; unique natural sentence per loser page with a real HTML anchor to this page and a specific placement. If none provided, omit this field entirely.
- relatedBlogLinks: for EACH blog in "RELATED OLDER BLOGS TO LINK FROM", produce one link FROM that blog INTO this page. The anchor text MUST be this page's exact main keyword "${keyword}". If "keyword present: YES", use mode "replace" and wrap the keyword in that blog's given sentence as the link. If not present, use mode "new" with a short natural sentence/CTA using "${keyword}" as the anchor. The link URL is always ${yourPage.url}. One item per related blog. Use each blog's OUTLINE to give a CONCRETE placement (name the section + exact paragraph position, never vague). If no related blogs are listed above, omit this field entirely.
- Return ONLY the JSON object — no other text`;
}

// ── PRODUCT analysis prompt (shopifyType === 'product') ────────────────────────
// Products get a FULL description rewrite (locked AboutWallArt voice + structure) plus 3
// rich-text H2 snippet metafields. FAQ/PAA/Page schema are NOT generated (theme handles them).
function buildProductAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null, loserPages = [], relatedBlogs = []) {
  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const existingBodyText = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/\s+/g, ' ').trim().substring(0, 4000)
    : '';
  // Does the CURRENT description already use the new optimised template? Signature = the two
  // stable headings the template always produces. Old/unoptimised descriptions never have these.
  const _tplBody = yourPage.shopifyBodyHtml || '';
  const usesNewTemplate = /<h3[^>]*>[^<]*what'?s\s+included/i.test(_tplBody) && /<h2[^>]*>[^<]*how\s+to\s+style/i.test(_tplBody);
  const existingMetafields = (yourPage.metafields || []).length > 0
    ? yourPage.metafields.map(m => `[${m.key}] ${m.text}`).join('\n')
    : 'None';
  const variantInfo = (yourPage.productOptions || []).length > 0
    ? yourPage.productOptions.map(o => `${o.name}: ${(o.values || []).join(', ')}`).join('\n')
    : 'None found';

  return `You are an expert SEO copywriter optimising a PRODUCT PAGE for AboutWallArt (UK wall art and home decor store). Return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Product title: ${yourPage.shopifyTitle || yourPage.title || 'MISSING'}
- Product type: ${yourPage.productType || 'wall art'}
- Current title tag: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})

THIS PRODUCT'S LIVE VARIANT OPTIONS (use the REAL sizes/frames/papers from here — NEVER invent options this product doesn't have):
${variantInfo}

THE PRODUCT'S CURRENT DESCRIPTION (your ONLY source for facts about the artwork — how many prints in the set, the style, the room, the colours, the subject. NEVER invent or change these):
${existingBodyText || 'None'}

METAFIELD CONTENT (for the over-use check):
${existingMetafields}

COMPETITORS — the pages outranking you (positions 1-3). Make THIS product beat them:
${competitors.map(c => `--- Position ${c.position}: ${c.url}
  Title: ${c.title || 'N/A'}
  H2s: ${(c.h2||[]).join(' | ') || 'N/A'}
  Word count: ${c.wordCount}`).join('\n')}

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title tag, max 60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description, max 135 chars, keyword included, ends with a benefit or CTA, UK spelling. Do NOT mention shipping — 'Free UK shipping!' is appended automatically.",
  "descriptionAlreadyOptimised": false,
  "descriptionOptimisedReason": "",
  "productDescription": "The FULL rewritten product description as ONE HTML string (the body). Follow the EXACT structure + voice rules below. MAY be an empty string ONLY when descriptionAlreadyOptimised is true — see DESCRIPTION DECISION below.",
  "keywordOveruse": {
    "isOverstuffed": true,
    "summary": "One plain-English sentence about over-use of \\"${keyword}\\".",
    "findings": [
      { "location": "where it lives", "metafieldKey": "", "currentText": "the ONE shortest exact sentence containing the over-use, verbatim — never a whole paragraph", "recommendation": "reword OR remove", "suggestedText": "the SAME sentence reworded — same start and end, only the few over-used words changed (not a fragment); empty if remove", "reason": "one short sentence" }
    ]
  },
  "aiItems": [
    {
      "element": "Comparison Snippet",
      "metafieldKey": "comparison_snippet",
      "format": "richtext_snippet",
      "priority": "high",
      "content": "<h2>What is/are ${keyword}?</h2><p>[complete, standalone 3-5 sentence answer; first sentence answers fully]</p>",
      "competitorDriven": false
    },
    {
      "element": "How-To Block",
      "metafieldKey": "how_to_block",
      "format": "richtext_snippet",
      "priority": "medium",
      "content": "<h2>[how-to title about ${keyword}]</h2><p><strong>1. Step title:</strong> step description</p><p><strong>2. Step title:</strong> step description</p>",
      "competitorDriven": false
    },
    {
      "element": "Comparison Table",
      "metafieldKey": "comparison_table",
      "format": "richtext_snippet",
      "priority": "medium",
      "content": "<h2>[comparison title]</h2><p><strong>Feature —</strong> Option A. Option B.</p><p><strong>Feature —</strong> Option A. Option B.</p>",
      "competitorDriven": false
    }
  ],
  "urlAnalysis": {
    "currentSlug": "exact-current-url-slug",
    "slugMatchesKeyword": "exact|similar|different",
    "changeSlug": false,
    "suggestedSlug": "new-slug-if-change-safe — leave blank if no change needed",
    "slugChangeWarning": "Only change slug if this product has 0 or near-0 clicks; if changed, add a 301 redirect.",
    "notes": "One sentence summary"
  },
  "otherActions": [],
  "loserPageLinks": [
    {
      "loserUrl": "exact URL of the loser page",
      "loserPageType": "product|collection|blog|page",
      "suggestedSentence": "One natural sentence with <a href='[thisProductUrl]'>[relevant anchor text]</a> — unique per loser page, never a template",
      "placement": "Specific placement guidance"
    }
  ]${relatedBlogs.length > 0 ? `,
  "relatedBlogLinks": [
    {
      "sourceUrl": "EXACT url of the related blog this link comes FROM (copy from the RELATED OLDER BLOGS list)",
      "sourceTitle": "that blog's title",
      "mode": "replace OR new",
      "existingText": "if that blog already contains the keyword (present: YES): the exact sentence to swap out. Otherwise empty.",
      "newText": "paste-ready text with THIS product's main keyword as the anchor: <a href='${yourPage.url}' title='...' target='_blank' rel='noopener'>${keyword}</a>. For replace: the existing sentence rewritten with the link. For new: a short natural sentence/CTA using the keyword as the anchor.",
      "placement": "where in that source blog to add it"
    }
  ]` : ''}
}
${loserPages.length > 0 ? `
LOSER PAGES THAT SHOULD LINK TO THIS PRODUCT:
${loserPages.map(l => `- ${l.loserUrl} (${l.pageType}, keyword: "${l.loserKeyword}")`).join('\n')}
` : ''}
${relatedBlogs.length > 0 ? `
RELATED OLDER BLOGS TO LINK FROM (add one link from EACH into this product; anchor MUST be the main keyword "${keyword}"). Each blog's OUTLINE is given (## = H2, # = H3, ¶N = paragraph N) — use it for a CONCRETE placement:
${relatedBlogs.map(b => `--- ${b.url} | "${b.title}" | keyword present: ${b.keywordPresent ? 'YES' : 'no'}${b.keywordPresent && b.sentence ? ` | sentence: "${b.sentence}"` : ''}
OUTLINE:
${b.outline || '(no outline available)'}`).join('\n')}
` : ''}

═══ ⚠️ JSON SAFETY (critical — the response MUST parse as JSON) ═══
- Output RAW JSON only — NO markdown code fences (no \`\`\`json).
- In productDescription AND every aiItems "content", use SINGLE QUOTES for ALL HTML attributes (e.g. <a href='https://...' target='_blank' rel='noopener'>), NEVER double quotes.
- Keep every string value on ONE line — do NOT put raw line breaks, tabs, or unescaped double-quote characters inside any string value.

═══ DESCRIPTION DECISION (do this FIRST, before writing anything) ═══
${usesNewTemplate
  ? `This product's CURRENT description ALREADY uses the optimised template (it has the "What's Included" and "How to Style" sections). You MUST judge whether it is GENUINELY well-optimised: the keyword "${keyword}" is used correctly and SPARINGLY (title + at most 1-2 headings, never repeated/stuffed), it covers the topics and angles the top-3 competitors cover, it follows the AboutWallArt voice, it includes at least one relevant internal link, and it states the artwork's real facts.
- If it IS already well-optimised: set "descriptionAlreadyOptimised": true, put a ONE-sentence plain reason in "descriptionOptimisedReason", and set "productDescription" to an EMPTY string. Do NOT rewrite something that is already good.
- If the template is there but it is WEAK (keyword stuffed, thin vs competitors, missing internal link, off-voice): set "descriptionAlreadyOptimised": false and return the FULL improved rewrite in "productDescription".`
  : `This product's current description does NOT use the optimised template. Set "descriptionAlreadyOptimised": false and ALWAYS return the FULL competitor-driven rewrite in "productDescription" following the structure + voice rules below. Do not assess the old description — replace it.`}

═══ PRODUCT DESCRIPTION — STRUCTURE (build "productDescription" as ONE HTML string, in THIS order) ═══
Write it WARM and HUMAN — like a friendly home-decor advisor talking to ONE person, never a spec sheet. Paragraphs stay readable (2-4 flowing sentences), but personality, warmth and flow matter MORE than brevity — do not make it clipped or robotic. It must feel hand-written.
IMPORTANT: do NOT describe frames, perspex, canvas, paper types, sizes, mounts, or personalisation in the description — that information lives in a SHARED THEME SECTION on the page and must NOT be repeated here (repeating it across every product creates duplicate content). Write ONLY content unique to THIS artwork.
1. INTRO: 2 short paragraphs, NO heading (do NOT repeat the product title as a heading). Open the FIRST sentence with an inspiring verb (Imagine, Picture, Discover, Fall in love, Refresh, Bring — vary it) AND include the exact keyword "${keyword}". CRITICAL: write the intro in the SAME down-to-earth, practical, chatty voice as the "How to Style" section below — like talking to a friend, plain and real. Describe the actual artwork and room in concrete, everyday words (colours, where it goes, how it looks on the wall). Speak as 'I'/'we' and you can add a light question, but keep it grounded. Use ONLY facts from the current description — never invent.
   ❌ DO NOT write poetic, abstract or literary lines — they read formal and AI. BANNED intro style (never write anything like these): "a kind of stillness", "hard to put into words", "refined without being cold", "serene without being dull", "quietly [X] in spirit", "feel your shoulders drop". If a sentence sounds like a poem or a luxury brand brochure, rewrite it the way you'd actually say it to a friend.
2. <h3>What's Included with ${yourPage.shopifyTitle || 'this set'}</h3> (the heading MUST include the product title) then a short <ul>. Do NOT make the first bullet a "N prints" line. Cover only product-specific receivables and quality (real facts only, e.g. made in the UK with fade-resistant pigment inks; indoor use). Do NOT list frames/papers/sizes/mounts here (they're in the theme section). The LAST bullet MUST read exactly: <li>Choose between framed and unframed options</li>.
3. <h2>How to Style ${keyword} ...</h2> (this H2 MAY carry the exact keyword) then one WARM, first-person paragraph ("I'd hang…", a real styling tip, maybe a light question) with ONE internal link to a relevant collection/page (full URL, target='_blank' rel='noopener').
4. <h2>[a "what to consider when choosing" heading — a NATURAL VARIATION, NOT the exact keyword]</h2> then one WARM, first-person paragraph advising on choosing for THIS artwork's style and colours.
(Reminder: the EXACT keyword belongs in at most two headings total — keep it for the How-to-Style H2 and the Comparison Snippet; vary the rest.)

═══ VOICE (mandatory — this is the MOST important part; getting it flat = failure) ═══
- First person (I / we) — a warm, friendly UK home-decor advisor talking to ONE person. Conversational, inspiring, genuinely human, with personal touches and a light question or two. Active voice. Vary sentence length. UK spelling throughout. If it reads like AI or a dry spec sheet, it has FAILED — rewrite it warmer.
- GOLD-STANDARD VOICE (match this grounded, friendly, practical tone for the WHOLE description, including the intro — copy the VOICE, not the content): "Picture this set of three prints above your sofa — soft greys with warm gold running through them, calm but never boring. I love how they pull a living room together without shouting for attention. I'd hang all three in a row at eye level with an even gap between each one; because the palette is neutral, they pair brilliantly with warm white or sage walls. If your sofa's in a light linen, they'll feel like they were made for the space."
- That is the target: plain, warm, specific, like a friend who styles homes. AVOID anything that sounds poetic, abstract, literary, or like a luxury brochure — that is the #1 thing to get right.
- NOT salesy and NOT robotic. Warm but not padded — when in doubt, choose plain-spoken warmth over fancy phrasing.
- The customer SELECTS options to receive frames/canvas/mounts — never say "I add" frames/mounts.
- Use ONLY facts present in the current description + the variant list. NEVER invent the set size, style, room, colours, or any option this product doesn't have.
- BANNED WORDS (never use): Delve, Spearheading, Embarking, Compelling, Empowering, Encompassing, Comprehensively, Effectively, Beacon, Dive, Showcasing, Remarked, Aligns, Surpassing, Tragically, Impacting, Prioritize, Sparking, Standout, Hindering, Advancements, Aiding, Fostering, Multifaceted, Revolutionary, Testament, Elevate.
- BANNED PHRASES: "in the ever-evolving world of", "at the forefront of", "in summary", "in conclusion", "in essence", "it's important to note", "emerges as a beacon", "dive into".

═══ OTHER RULES ═══
- suggestedTitle: max 60 chars, keyword near start. suggestedMeta: max 135 chars, keyword once, benefit, CTA. (Copy-only — not pushed.)
- aiItems — generate all three rich-text snippets in the EXACT H2 formats shown (heading level 2). how_to_block and comparison_table use bold-labelled paragraphs (rich text cannot hold real tables). Keep "metafieldKey" and "format" EXACTLY as shown. competitorDriven: true when a snippet fills a competitor gap, else false.
- keywordOveruse: examine the current description + metafields; flag genuine over-use of "${keyword}" only (exclude shared theme chrome). If clean, isOverstuffed:false with an empty findings array.
- ⚠️ HEADINGS & KEYWORD (SEO balance): put the EXACT keyword "${keyword}" in AT MOST TWO headings across the WHOLE description + snippets (e.g. the "How to Style" H2 and the Comparison Snippet H2). For ALL other H2/H3 headings, write a NATURAL VARIATION or related phrasing (still topical and useful) — do NOT repeat the exact keyword in every heading; that is stuffing and hurts ranking.
- ⚠️ NO STUFFING: exact keyword only in the title, first line, and at most one or two headings; everywhere else use natural variations.
- ⚠️ NO CANNIBALISATION: don't target a keyword owned by another AboutWallArt page; anchors describe the destination, never another page's keyword.
- Do NOT generate FAQ Schema, People Also Ask, or Page Schema (the theme handles those). Do NOT flag shared global product theme sections ("OUR FRAMES", "Here's Why You'll Love It", "LIGHT UP YOUR ART!", reviews, lead-capture) for per-product rename.
- loserPageLinks: ONLY include if loser pages are provided above; unique natural sentence per loser page with a real HTML anchor to this product and a specific placement. If none provided, omit the field entirely.
- relatedBlogLinks: for EACH blog in "RELATED OLDER BLOGS TO LINK FROM", produce one link FROM that blog INTO this product; anchor MUST be this product's exact keyword "${keyword}"; mode "replace" if keyword present (rewrite the given sentence with the link), else "new"; link URL is always ${yourPage.url}; concrete placement from the OUTLINE. If none listed, omit the field entirely.
- otherActions: return an EMPTY array.${(yourPage.preserveLinks && yourPage.preserveLinks.length) ? `
- ⚠️ PRESERVE EXISTING INTERNAL LINKS (MANDATORY): the current description links to the pages below. Your rewrite MUST keep a link to EACH destination URL, worked naturally into the new copy, using the given anchor text (or a close natural variation) and the EXACT URL. Do NOT invent new destinations and do NOT drop any of these:
${yourPage.preserveLinks.map(l => `  • ${l.url}  (anchor: "${l.anchor}")`).join('\n')}` : ''}
- Return ONLY the JSON object — no other text`;
}

// Fetch real content from Shopify API
async function fetchShopifyContent(pageUrl) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    console.warn('[Shopify] Missing credentials');
    return null;
  }

  const headers = { 'X-Shopify-Access-Token': SHOPIFY_TOKEN };
  const base = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01`;
  const path = pageUrl
    .replace(/^https?:\/\/(www\.)?aboutwallart\.com/, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

  try {
    // ── Product ──────────────────────────────────────────────────────────────
    const productMatch = path.match(/^\/products\/([^/?]+)/);
    if (productMatch) {
      const handle = productMatch[1];
      const r = await fetch(`${base}/products.json?handle=${handle}&fields=id,title,body_html,options,product_type,tags,image`, { headers });
      const d = await r.json();
      const p = d.products?.[0];
      if (!p) return null;
      const [meta, allMeta] = await Promise.all([
        fetchShopifyMetafields(base, `products/${p.id}`, headers),
        fetchAllMetafields(base, `products/${p.id}`, headers)
      ]);
      // Variant options (Frame / Size / Paper) feed the description rewrite — read live, never guess.
      const productOptions = (p.options || []).map(o => ({ name: o.name, values: o.values || [] }));
      return { shopifyId: p.id, shopifyType: 'product', shopifyTitle: p.title, seoTitle: meta.title || p.title, seoDescription: meta.desc || '', bodyHtml: p.body_html || '', metafields: allMeta, productOptions, productType: p.product_type || '', tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [], mainImage: p.image?.src || '', mainImageAlt: p.image?.alt || '' };
    }

    // ── Collection ───────────────────────────────────────────────────────────
    const collectionMatch = path.match(/^\/collections\/([^/?]+)/);
    if (collectionMatch) {
      const handle = collectionMatch[1];
      for (const type of ['custom_collections', 'smart_collections']) {
        const r = await fetch(`${base}/${type}.json?handle=${handle}&fields=id,title,body_html,image`, { headers });
        const d = await r.json();
        const col = d[type]?.[0];
        if (col) {
          const colResourcePath = `${type}/${col.id}`;
          const [meta, allMeta] = await Promise.all([
            fetchShopifyMetafields(base, colResourcePath, headers),
            fetchAllMetafields(base, colResourcePath, headers)
          ]);
          return { shopifyId: col.id, shopifyType: type === 'custom_collections' ? 'custom_collection' : 'smart_collection', shopifyTitle: col.title, seoTitle: meta.title || col.title, seoDescription: meta.desc || '', bodyHtml: col.body_html || '', metafields: allMeta, mainImage: col.image?.src || '', mainImageAlt: col.image?.alt || '' };
        }
      }
      return null;
    }

    // ── Page ─────────────────────────────────────────────────────────────────
    const pageMatch = path.match(/^\/pages\/([^/?]+)/);
    if (pageMatch) {
      const handle = pageMatch[1];
      const r = await fetch(`${base}/pages.json?handle=${handle}&fields=id,title,body_html`, { headers });
      const d = await r.json();
      const pg = d.pages?.[0];
      if (!pg) return null;
      const pageResourcePath = `pages/${pg.id}`;
      const [meta, allMeta] = await Promise.all([
        fetchShopifyMetafields(base, pageResourcePath, headers),
        fetchAllMetafields(base, pageResourcePath, headers)
      ]);
      // Resolve the collection that lives INSIDE this page (custom.related_collection) — its
      // GID is the push target for Browse the Collection. fetchAllMetafields drops references,
      // so read the raw metafields here to find it.
      let relatedCollectionGid = '';
      try {
        const rawR = await fetch(`${base}/${pageResourcePath}/metafields.json?namespace=custom`, { headers });
        const rawD = await rawR.json();
        const rc = (rawD.metafields || []).find(m => m.key === 'related_collection' && /Collection/.test(m.value || ''));
        if (rc) relatedCollectionGid = rc.value;
      } catch { /* leave empty */ }
      return { shopifyId: pg.id, shopifyType: 'page', shopifyTitle: pg.title, seoTitle: meta.title || pg.title, seoDescription: meta.desc || '', bodyHtml: pg.body_html || '', metafields: allMeta, mainImage: pg.image?.src || '', mainImageAlt: pg.image?.alt || '', relatedCollectionGid };
    }

    // ── Blog article ─────────────────────────────────────────────────────────
    const blogMatch = path.match(/^\/blogs\/([^/?]+)\/([^/?]+)/);
    if (blogMatch) {
      const [, blogHandle, articleHandle] = blogMatch;
      const br = await fetch(`${base}/blogs.json?fields=id,handle`, { headers });
      const bd = await br.json();
      const blog = bd.blogs?.find(b => b.handle === blogHandle);
      if (!blog) return null;
      const ar = await fetch(`${base}/blogs/${blog.id}/articles.json?handle=${articleHandle}&fields=id,title,body_html,summary_html,template_suffix,image,tags`, { headers });
      const ad = await ar.json();
      const article = ad.articles?.[0];
      if (!article) return null;
      const articleResourcePath = `blogs/${blog.id}/articles/${article.id}`;
      const [meta, allMeta] = await Promise.all([
        fetchShopifyMetafields(base, articleResourcePath, headers),
        fetchAllMetafields(base, articleResourcePath, headers)
      ]);
      return { shopifyId: article.id, shopifyBlogId: blog.id, shopifyType: 'article', shopifyTitle: article.title, seoTitle: meta.title || article.title, seoDescription: meta.desc || '', bodyHtml: article.body_html || '', excerpt: article.summary_html || '', templateSuffix: article.template_suffix || '', mainImage: article.image?.src || '', mainImageAlt: article.image?.alt || '', metafields: allMeta, tags: article.tags ? article.tags.split(',').map(t => t.trim()).filter(Boolean) : [] };
    }

    return null;
  } catch (err) {
    console.error('[Shopify] Error:', err.message);
    return null;
  }
}

// Fetch global SEO metafields (title_tag + description_tag) for a Shopify resource
async function fetchShopifyMetafields(base, resourcePath, headers) {
  try {
    const r = await fetch(`${base}/${resourcePath}/metafields.json?namespace=global`, { headers });
    const d = await r.json();
    const fields = d.metafields || [];
    return {
      title: fields.find(m => m.key === 'title_tag')?.value || '',
      desc:  fields.find(m => m.key === 'description_tag')?.value || ''
    };
  } catch {
    return { title: '', desc: '' };
  }
}

// Fetch ALL metafields for a resource (every namespace), keeping only text-bearing
// values. Used by the keyword over-use check so it can see content the merchant has
// stored in metafields (snippets, custom sections), not just the body.
async function fetchAllMetafields(base, resourcePath, headers) {
  try {
    const r = await fetch(`${base}/${resourcePath}/metafields.json`, { headers });
    const d = await r.json();
    const fields = d.metafields || [];
    return fields
      .filter(m => {
        // Keep text-bearing types only; skip files, references, JSON blobs, numbers, dates.
        const t = (m.type || '').toLowerCase();
        const isText = t.includes('string') || t.includes('text') || t.includes('html') || t.includes('rich_text');
        return isText && typeof m.value === 'string' && m.value.trim().length > 0;
      })
      .map(m => ({
        key: `${m.namespace}.${m.key}`,
        // Strip HTML/JSON noise to plain text, cap length to control tokens.
        text: m.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
      }));
  } catch {
    return [];
  }
}

// Admin GraphQL helper (read).
async function shopifyGraphQL(query, variables = {}) {
  const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const d = await r.json();
  return d.data;
}

// Fetch every blog article (lightweight: handle, title, tags, publish date, blog handle).
async function fetchAllArticlesLite() {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 12; page++) {           // safety cap (12 * 250 = 3000)
    const data = await shopifyGraphQL(`
      query($after: String) {
        articles(first: 250, after: $after) {
          edges { node { id handle title tags publishedAt blog { handle } } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { after: cursor });
    const conn = data && data.articles;
    if (!conn) break;
    conn.edges.forEach(e => out.push(e.node));
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// Pick the top N related OLDER blogs by shared-tag score. Specific (rare) tags are
// weighted higher via IDF; ubiquitous tags (Home-Decor, interior-design-concepts) barely
// count. Ties break to the OLDER post (already crawled → faster indexing).
function pickRelatedBlogs(currentUrl, currentTags, allArticles, n = 3, titleText = '') {
  const curHandle = (currentUrl.split('/').filter(Boolean).pop() || '').toLowerCase();
  const curTags = (currentTags || []).map(t => t.toLowerCase());
  // Need at least ONE signal: tags (blogs) OR title text (collections have no tags).
  if ((!curTags.length && !String(titleText).trim()) || !allArticles.length) return [];
  let origin = ''; try { origin = new URL(currentUrl).origin; } catch { origin = ''; }
  const df = {};
  allArticles.forEach(a => (a.tags || []).forEach(t => { const k = t.toLowerCase(); df[k] = (df[k] || 0) + 1; }));
  const total = allArticles.length;
  // Title-word overlap = a SECONDARY signal (tags still dominate). Strip generic/store
  // words so almost-every-blog matches ("wall art", "decor"…) don't pollute the score.
  const TITLE_STOP = new Set(['art','wall','decor','home','print','prints','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you']);
  const titleWords = new Set((String(titleText).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !TITLE_STOP.has(w)));
  return allArticles
    .filter(a => (a.handle || '').toLowerCase() !== curHandle)
    .map(a => {
      const bh = a.blogHandle || (a.blog && a.blog.handle);   // index rows are flat; live rows nest blog.handle
      const tags = (a.tags || []).map(t => t.toLowerCase());
      let score = 0;
      curTags.forEach(t => { if (tags.includes(t)) score += Math.log((total + 1) / ((df[t] || 0) + 1)); });
      if (titleWords.size) {
        const candWords = (a.title || '').toLowerCase().match(/[a-z]+/g) || [];
        let overlap = 0; candWords.forEach(w => { if (titleWords.has(w)) overlap++; });
        score += overlap * 0.5;                                // modest weight — tags lead
      }
      return { handle: a.handle, title: a.title, blogHandle: bh, publishedAt: a.publishedAt, gid: a.gid || a.id || null, score };
    })
    .filter(a => a.score > 0 && a.blogHandle)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : Infinity;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : Infinity;
      return ta - tb;                                // older first
    })
    .slice(0, n)
    .map(a => ({ url: `${origin}/blogs/${a.blogHandle}/${a.handle}`, title: a.title, publishedAt: a.publishedAt, gid: a.gid }));
}

// For each related blog, fetch its body and check whether THIS page's keyword already
// appears; if so, pull the sentence containing it so the link can wrap it in place.
async function enrichRelatedBlogs(related, keyword) {
  const kw = (keyword || '').toLowerCase();
  await Promise.all(related.map(async (b) => {
    b.keywordPresent = false; b.sentence = ''; b.outline = '';
    try {
      const handle = b.url.split('/').filter(Boolean).pop();
      const data = await shopifyGraphQL(`{ articles(first:1, query:"handle:${handle}") { edges { node { body } } } }`);
      const body = data && data.articles && data.articles.edges[0] && data.articles.edges[0].node.body || '';
      const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (kw && text.toLowerCase().includes(kw)) {
        b.keywordPresent = true;
        const sentences = text.split(/(?<=[.!?])\s+/);
        b.sentence = (sentences.find(s => s.toLowerCase().includes(kw)) || '').substring(0, 300);
      }
      // Compact ordered outline so the AI can give a CONCRETE placement (which section /
      // between which paragraphs). H2/H3 as headings, paragraphs as their opening words.
      const parts = body.match(/<(h2|h3|p)[^>]*>[\s\S]*?<\/\1>/gi) || [];
      let pIdx = 0;
      b.outline = parts.map(tag => {
        const t = tag.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!t) return '';
        if (/^<h2/i.test(tag)) { pIdx = 0; return `## ${t}`; }
        if (/^<h3/i.test(tag)) { return `# ${t}`; }
        pIdx++;
        return `  ¶${pIdx}: ${t.split(' ').slice(0, 10).join(' ')}…`;
      }).filter(Boolean).join('\n').substring(0, 1800);
    } catch { /* leave defaults */ }
  }));
  return related;
}

// Read the cached blog index (data/blog-index.json on GitHub). PUBLISHED blogs only.
// Returns an array of { handle, title, tags, blogHandle, publishedAt } or null on failure.
async function fetchBlogIndex() {
  try {
    const r = await fetch('https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/blog-index.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d && d.articles);
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch { return null; }
}

// Top-level: get up to 3 related older blogs to link FROM into this page.
// Reads the cached index first (fast); falls back to the live full fetch if the
// index file isn't there yet, so analysis never breaks.
async function getRelatedBlogLinks(yourPage, keyword) {
  try {
    // Blogs, collections, pages AND products all link FROM older blogs INTO themselves.
    const t = yourPage.shopifyType || '';
    if (t !== 'article' && !t.includes('collection') && t !== 'page' && t !== 'product') return [];
    let all = await fetchBlogIndex();
    if (!all) { console.warn('[Related Blogs] index missing — falling back to live fetch'); all = await fetchAllArticlesLite(); }
    const related = pickRelatedBlogs(yourPage.url, yourPage.tags, all, 3, `${yourPage.title || ''} ${keyword || ''}`);
    if (!related.length) return [];
    return await enrichRelatedBlogs(related, keyword);
  } catch (e) {
    console.warn('[Related Blogs] failed:', e.message);
    return [];
  }
}

// ── LINKED REFERENCE METAFIELDS (blog item #5) ───────────────────────────────
// Three reference-list metafields the theme reads to cross-link a blog:
//   custom.linked_blogs       → list.article_reference     (related published blogs)
//   custom.linked_collections → list.collection_reference  (relevant shop collections)
//   custom.linked_trends      → list.page_reference        (matching style "...TREND" pages)
// Each picker returns [{ gid, title, url }] so the frontend can show + push them.
const LINKREF_STOP = new Set(['art','wall','decor','home','print','prints','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you','trend','trends','interior','design','style','room','living']);

// Linked Blogs — reuse the related-blog picks (on-topic, published), resolved to GIDs.
async function getLinkedBlogs(yourPage, keyword) {
  try {
    let all = await fetchBlogIndex();
    if (!all || !all.length) return [];
    const related = pickRelatedBlogs(yourPage.url, yourPage.tags, all, 3, `${yourPage.title || ''} ${keyword || ''}`);
    return related.filter(b => b.gid).map(b => ({ gid: b.gid, title: b.title, url: b.url }));
  } catch (e) { console.warn('[Linked Blogs] failed:', e.message); return []; }
}

// Linked Collections — search collections by the keyword, score by word overlap with
// keyword + tags + title, return the top 3 relevant ones.
async function getLinkedCollections(yourPage, keyword) {
  try {
    const hayWords = new Set((`${keyword || ''} ${(yourPage.tags || []).slice(0, 6).join(' ')} ${yourPage.title || ''}`
      .toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !LINKREF_STOP.has(w)));
    if (!hayWords.size) return [];
    const q = (keyword || '').replace(/["\\]/g, ' ').trim();
    if (!q) return [];
    const data = await shopifyGraphQL(`{ collections(first: 30, query: ${JSON.stringify(q)}) { edges { node { id title handle } } } }`);
    const selfHandle = (yourPage.url.split('/').filter(Boolean).pop() || '').toLowerCase();
    const nodes = ((data && data.collections) ? data.collections.edges.map(e => e.node) : [])
      .filter(n => (n.handle || '').toLowerCase() !== selfHandle);   // never link a collection to itself
    let origin = ''; try { origin = new URL(yourPage.url).origin; } catch { origin = ''; }
    return nodes.map(n => {
      const cw = (n.title || '').toLowerCase().match(/[a-z]+/g) || [];
      let score = 0; cw.forEach(w => { if (hayWords.has(w)) score++; });
      return { gid: n.id, title: n.title, url: `${origin}/collections/${n.handle}`, score };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
      .map(c => ({ gid: c.gid, title: c.title, url: c.url }));
  } catch (e) { console.warn('[Linked Collections] failed:', e.message); return []; }
}

// Linked Trends — match the blog's style/topic to the store's "...TREND" pages
// (BOHO, COASTAL, JAPANDI, etc.). Returns up to 2.
async function getLinkedTrends(yourPage, keyword) {
  try {
    const hay = `${keyword || ''} ${yourPage.title || ''} ${(yourPage.tags || []).join(' ')}`.toLowerCase();
    const data = await shopifyGraphQL(`{ pages(first: 100) { edges { node { id title handle } } } }`);
    const pages = ((data && data.pages) ? data.pages.edges.map(e => e.node) : []).filter(p => /trend/i.test(p.title || ''));
    let origin = ''; try { origin = new URL(yourPage.url).origin; } catch { origin = ''; }
    return pages.map(p => {
      const words = (p.title || '').toLowerCase().match(/[a-z]+/g) || [];
      let score = 0; words.forEach(w => { if (w.length > 3 && !LINKREF_STOP.has(w) && hay.includes(w)) score++; });
      return { gid: p.id, title: p.title, url: `${origin}/pages/${p.handle}`, score };
    }).filter(t => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 2)
      .map(t => ({ gid: t.gid, title: t.title, url: t.url }));
  } catch (e) { console.warn('[Linked Trends] failed:', e.message); return []; }
}

// Top-level: all three linked-reference sets (run in parallel). Blogs and collections both
// support Linked Blogs / Collections / Trends.
async function getLinkedReferences(yourPage, keyword) {
  const t = yourPage.shopifyType || '';
  if (t !== 'article' && !t.includes('collection')) return { linkedBlogs: [], linkedCollections: [], linkedTrends: [] };
  const [linkedBlogs, linkedCollections, linkedTrends] = await Promise.all([
    getLinkedBlogs(yourPage, keyword),
    getLinkedCollections(yourPage, keyword),
    getLinkedTrends(yourPage, keyword)
  ]);
  return { linkedBlogs, linkedCollections, linkedTrends };
}

// Find up to 3 ACTIVE replacement products — same type/category, closest style (tag overlap).
// Each replacement returns title + product URL + first image URL (for a thumbnail).
async function findReplacements({ productType, tags, handleWords, excludeHandle, origin }) {
  try {
    const q = productType
      ? `status:active product_type:'${String(productType).replace(/['"\\]/g, '')}'`
      : `status:active ${String(handleWords || '').replace(/['"\\]/g, '')}`.trim();
    if (q === 'status:active') return [];
    const data = await shopifyGraphQL(`{ products(first:15, query:${JSON.stringify(q)}) { edges { node { handle title tags featuredImage { url } } } } }`);
    const tagset = (tags || []).map(t => t.toLowerCase());
    return (data && data.products ? data.products.edges.map(e => e.node) : [])
      .filter(n => (n.handle || '').toLowerCase() !== (excludeHandle || '').toLowerCase())
      .map(n => {
        const nt = (n.tags || []).map(t => t.toLowerCase());
        let score = 0; tagset.forEach(t => { if (nt.includes(t)) score++; });
        return { n, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => ({ title: x.n.title, url: `${origin}/products/${x.n.handle}`, imageUrl: x.n.featuredImage ? x.n.featuredImage.url : '' }));
  } catch { return []; }
}

// Scan the blog body for product links and flag any that are NOT active (draft, archived,
// or removed); for each, suggest active replacements by type + style.
async function findInactiveProductLinks(bodyHtml, origin) {
  try {
    if (!bodyHtml) return [];
    const hrefs = (bodyHtml.match(/href=["'][^"']*\/products\/[^"'?#]+/gi) || []);
    const handles = [...new Set(hrefs.map(h => {
      const m = h.match(/\/products\/([^/?#"']+)/i); return m ? m[1].toLowerCase() : null;
    }).filter(Boolean))];
    if (!handles.length) return [];
    const results = await Promise.all(handles.map(async (handle) => {
      try {
        const data = await shopifyGraphQL(`{ products(first:1, query:"handle:${handle}") { edges { node { id title status productType tags featuredImage { url } } } } }`);
        const node = data && data.products && data.products.edges[0] && data.products.edges[0].node;
        const url = `${origin}/products/${handle}`;
        if (!node) {
          const replacements = await findReplacements({ handleWords: handle.replace(/-/g, ' '), excludeHandle: handle, origin });
          return { handle, url, title: handle, status: 'NOT FOUND', imageUrl: '', adminUrl: null, replacements };
        }
        if (node.status && node.status.toUpperCase() !== 'ACTIVE') {
          const idNum = (node.id || '').split('/').pop();
          const replacements = await findReplacements({ productType: node.productType, tags: node.tags, handleWords: handle.replace(/-/g, ' '), excludeHandle: handle, origin });
          return { handle, url, title: node.title, status: node.status, imageUrl: node.featuredImage ? node.featuredImage.url : '', adminUrl: idNum ? `https://admin.shopify.com/store/${STORE_HANDLE}/products/${idNum}` : null, replacements };
        }
        return null;                                  // active → fine
      } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch (e) {
    console.warn('[Inactive Products] failed:', e.message);
    return [];
  }
}

// MISSING BUTTONS (Step 1, read-only, deterministic — no Shopify calls).
// Two cases:
//  • image-no-button: a product is shown via an <a href=/products/HANDLE> that WRAPS an <img>, but
//    that product has NO "Shop Here"-style button anchor anywhere → the shopper sees it but there's
//    no clear button to buy. We already know the handle + image from the body (thumbnail for free).
//  • text-no-link: a CTA phrase ("Shop Here" etc.) sitting as PLAIN TEXT with no link → handle
//    unknown, the user identifies the product later.
// Handles already flagged as DEAD are skipped here (those belong to the Dead Products list).
const _CTA_PHRASES = 'shop here|shop now|show me this product!?|buy now|shop the look|view product|get it here|click here to see this product!?|see this product!?';
function findMissingButtonPromos(bodyHtml, origin, inactiveHandles) {
  try {
    if (!bodyHtml) return [];
    const deadSet = new Set((inactiveHandles || []).map(h => String(h).toLowerCase()));
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    const hrefProdRe = /href=["'][^"']*\/products\/([^"'?#\/]+)/i;

    // Pass 1 — which product handles already have a PROPER "Shop Here" button. A real button is an
    // anchor STYLED with a background colour (the black box). Old promos put the CTA as plain TEXT
    // inside the image link with no such styling — those are NOT proper buttons.
    const properButton = new Set();
    let m;
    while ((m = anchorRe.exec(bodyHtml))) {
      const attrs = m[1] || '';
      const hp = attrs.match(hrefProdRe);
      if (!hp) continue;
      if (/style=["'][^"']*background-color/i.test(attrs)) properButton.add(hp[1].toLowerCase());
    }

    // Pass 2 — product promos = an anchor that WRAPS an <img> and links to a product. If that
    // product has no proper styled button it needs one. This covers BOTH old text-link promos
    // (image + "Show me this product!" / "Click here…" inside one link) AND image-only promos.
    // Skip dead handles (those belong to the Dead Products list).
    const results = [];
    const seen = new Set();
    anchorRe.lastIndex = 0;
    while ((m = anchorRe.exec(bodyHtml))) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      const hp = attrs.match(hrefProdRe);
      if (!hp) continue;
      const handle = hp[1].toLowerCase();
      const imgM = inner.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
      if (!imgM) continue;                       // anchor wraps text only → a normal inline link
      if (properButton.has(handle)) continue;    // already has the styled Shop Here button → fine
      if (deadSet.has(handle)) continue;         // dead product → handled by Dead Products list
      if (seen.has(handle)) continue;
      seen.add(handle);
      const titleM = attrs.match(/\btitle=["']([^"']*)["']/i);
      const altM = imgM[0].match(/\balt=["']([^"']*)["']/i);
      results.push({
        kind: 'image-no-button',
        handle,
        url: `${origin}/products/${handle}`,
        imageUrl: imgM[1],
        title: (titleM && titleM[1]) ? titleM[1] : ((altM && altM[1]) ? altM[1] : handle.replace(/-/g, ' '))
      });
    }

    // Pass 3 — plain-text CTA phrases that are NOT inside any link (product unknown)
    const noAnchors = bodyHtml.replace(/<a\b[\s\S]*?<\/a>/gi, ' ');
    const textOnly = noAnchors.replace(/<[^>]+>/g, ' ');
    const plainRe = new RegExp('(' + _CTA_PHRASES + ')', 'gi');
    const plainSeen = new Set();
    let pm;
    while ((pm = plainRe.exec(textOnly))) {
      const phrase = pm[1].replace(/\s+/g, ' ').trim();
      const key = phrase.toLowerCase();
      if (plainSeen.has(key)) continue;
      plainSeen.add(key);
      results.push({ kind: 'text-no-link', handle: null, url: null, imageUrl: '', title: phrase });
    }

    return results;
  } catch (e) {
    console.warn('[Missing Buttons] failed:', e.message);
    return [];
  }
}

// Give the heavy analysis pipeline the full Hobby-plan ceiling (60s) so big pages
// don't 504. Same value blogs.js uses.
module.exports.config = { maxDuration: 60 };
