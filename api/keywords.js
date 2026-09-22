// api/keywords.js — New Product Generator backend  ·  v0.15
// v0.15 (2026-09-22): two fixes found testing on ISLTRIAL2.
//   (1) SHARED images (3 fixed + room size guide) are now attached to each product by originalSource URL
//       (Shopify makes a COPY) instead of by media id (which MOVED the one shared file into the product,
//       so deleting any product deleted the shared file for everyone -> "Media ids ... do not exist").
//   (2) MANDATORY keyword lock: creating the product now writes the keyword into the registry as
//       LOCKED/DONE/OPTIMIZED with the real URL + date, so it's never offered again. New helper
//       lockKeywordInRegistry(); idempotent (skips if already LOCKED COMMERCIAL).
// v0.14: fixes found testing Batch 3 live on ISLTRIAL (2026-09-22): gallery order corrected (room-size
//   image now goes AFTER the canvas pair, right before Picture-frames); every variant gets 100 stock at
//   the store's location; sales-last-24h/sales-count no longer look fake (24h capped 5-15, total always
//   >= double); the generate-content prompt now quotes any phrase actually written ON the artwork when
//   it's used in the product title (e.g. "Allah Is The Light").
// v0.13: SEND-TO-SHOPIFY — Batch 3 (create the product in Shopify). New action:
//   send-to-shopify { sku } — builds the full variant matrix (Frame x Size x Paper, priced by Set
//     size from live price tables) + options + metafields/tags/collections (reuses resolveShopifyFields)
//     + product media in the confirmed gallery order + per-Frame variant images from the Flats, then
//     writes it all in one productSet mutation (status DRAFT), publishes to every live channel, and
//     marks the product 'sent' with the new Shopify product id/handle. Blocks with a plain-English
//     error (no raw JSON) if images/room/collections aren't ready yet — nothing partial is written.
//   Also: replaced the lifestyle-cover radio with drag-to-reorder (index 0 = cover) — new action
//   'reorder-lifestyle-images' replaces 'set-lifestyle-cover'. upload-fixed-images now takes an optional
//   { force: [keys] } to force re-upload a stale fixed/room image (e.g. after fixing a source file).
// v0.12: SEND-TO-SHOPIFY — Batch 2 (image uploads). New actions:
//   upload-image { sku, slot, image, imageMediaType } — slot: lifestyle|individual|flatWhite|flatBlack|
//     flatOak|flatCanvas|flatUnframed. Uploads to Shopify Files (staged upload + fileCreate + CDN poll),
//     names the file from the product's keyword + a number, writes an SEO alt text, saves the record
//     onto product.images in npg-products.json. Returns immediately per image (never batched).
//   remove-product-image { sku, slot, index? } — removes a saved image reference (Mae fixing a mistake).
//   upload-fixed-images {} / get-fixed-images {} — the 3 fixed + 9 room-size images, uploaded to Shopify
//     ONCE (idempotent — skips ones already done) and cached in data/npg-fixed-images.json for reuse on
//     every product forever after. Source files: assets/npg-images/{fixed,rooms}/*.
// v0.11: SEND-TO-SHOPIFY — Batch 1 (metafields + tags/collections resolver, READ-ONLY).
//   New action 'resolve-shopify-fields' { sku } — computes everything Send-to-Shopify will need
//   to write (metafields array, tags to add, collections to join, linked trends/blogs/collections,
//   related/complementary products, random sales/stock numbers) WITHOUT touching Shopify. Lets Mae
//   verify correctness before any live write. See handovers/npg-send-to-shopify-spec-2026-09-21.md.
//   Also tweaked the generate-content SEO-title instruction (keyword as close to the start as reads
//   natural, not forced).
// Actions (POST { action, ... }):
//   gap-research      -> { products:[{sku, collections, set, trends, primaryColour, colour, keywordWords}] }
//                         returns { results:[{ sku, options:[{keyword, volume, difficulty, difficultyRaw}] }] }
//                         (reads data/competitors-gap.csv — no Apify cost)
//   set-keyword       -> { sku, keyword }      validates (not locked, not used by another in-progress product) + saves onto product
//   generate-content  -> { sku, image, imageMediaType }   image = base64 (no data: prefix). Requires product.keyword.
//                         Finds top-3 SERP competitors for the keyword, reads the uploaded artwork image (vision),
//                         and generates productTitle/seoTitle/metaDescription/productDescription/aiItems.
//                         Saves onto product.content and returns { ok:true, content, products }.
//   resolve-shopify-fields -> { sku }          READ-ONLY. Returns { metafields, tagsToAdd, collectionsToJoin,
//                         unresolvedSmart, notFoundCollections, linkedTrendGids, linkedBlogGids, warnings, debug }.
//                         Nothing is written to Shopify or GitHub.
//   research          -> { products:[{sku, collections, set, trends, primaryColour, colour}], locationCode?, languageCode? }  [PARKED — Apify, use sparingly]
//                         returns { results:[{ sku, options:[{keyword, volume, difficulty, intent}] }] }
//   list-products     -> {}                    returns { products:[...] }
//   save-product      -> { product }           upserts by sku into data/npg-products.json
//   delete-product    -> { sku }               removes from data/npg-products.json
//   reserve-keyword   -> { keyword, sku }       locks a reservation row in the keyword registry (url = N/A, intent COMMERCIAL) — used at Send-to-Shopify time
//   raw               -> { input }             (debug) runs the actor with a raw input, returns dataset items
// Env: APIFY_TOKEN, GITHUB_TOKEN, SERPAPI_KEY, ANTHROPIC_API_KEY, SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN

const REPO = 'aboutwallart/seo-tools';
const PRODUCTS_PATH = 'data/npg-products.json';
const REGISTRY_PATH = 'data/keyword-locker-registry.csv';
const GAP_PATH = 'data/competitors-gap.csv';
const ACTOR = 'santhej~dataforseo-labs-keyword-explorer';
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const CATEGORY_SYNONYMS = ['wall art', 'art print', 'wall decor', 'wall hanging', 'canvas wall art', 'framed wall art', 'poster', 'wall pictures'];
const COLOUR_VOCAB = new Set(['black','white','blue','pink','green','grey','gray','gold','beige','brown','teal','purple','violet','mauve','plum','ivory','peach','maroon','aquamarine','burgundy','blush','magenta','mink','cream','navy','orange','yellow','red','silver','turquoise','coral','charcoal','sage','terracotta','rust','lilac','lavender','emerald','mustard','tan','taupe']);
// colours allowed = ONLY the given list's colour words; used to drop keywords mentioning any other colour
function colourWordsOf(list) { const s = new Set(); (list || []).forEach(c => String(c).toLowerCase().split(/[^a-z]+/).forEach(w => { if (COLOUR_VOCAB.has(w)) s.add(w); })); return s; }
function colourOk(kw, allowed) { for (const w of kw.split(/[^a-z]+/)) { if (COLOUR_VOCAB.has(w) && !allowed.has(w)) return false; } return true; }
const MIN_VOLUME = 10;
const MAX_SEEDS_PER_PRODUCT = 8;
const MAX_DIFF_CANDIDATES_PER_PRODUCT = 15;
const MAX_OPTIONS_PER_PRODUCT = 10;

/* ---------------- Apify ---------------- */
async function callActor(input, actorId) {
  const token = process.env.APIFY_TOKEN;
  const actor = (actorId || ACTOR).replace('/', '~');
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) throw new Error('Apify ' + r.status + ': ' + text.slice(0, 300));
  return Array.isArray(data) ? data : [];
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { __error: String(e.message || e) }; } }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* ---------------- GitHub ---------------- */
function ghHeaders() {
  return { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'npg' };
}
async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=main`, { headers: ghHeaders() });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error('GitHub get failed: ' + (await r.text()));
  const j = await r.json();
  return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}
async function ghPut(path, content, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha: sha || undefined, branch: 'main' })
  });
  if (!r.ok) { const t = await r.text(); const e = new Error('GitHub put failed: ' + t); e.status = r.status; throw e; }
  return true;
}
async function readProducts() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${PRODUCTS_PATH}?t=${Date.now()}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

/* ---------------- CSV registry ---------------- */
function csvField(v) { v = (v == null ? '' : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function parseCSVLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; } else cur += ch; }
  cols.push(cur.trim()); return cols;
}
// Set of keywords already LOCKED anywhere in the registry (any intent) — used to exclude from suggestions.
async function lockedKeywordSet() {
  const set = new Set();
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${REGISTRY_PATH}?t=${Date.now()}`);
    if (!r.ok) return set;
    const txt = await r.text();
    txt.split('\n').forEach(line => {
      if (!line.trim()) return;
      const c = parseCSVLine(line.replace(/\r/g, ''));
      const kw = (c[0] || '').toLowerCase();
      const locked = (c[2] || '').toUpperCase();
      if (kw && locked === 'LOCKED') set.add(kw);
    });
  } catch { /* ignore */ }
  return set;
}

/* ---------------- in-progress keyword set (products with a keyword, not yet sent to Shopify) ---------------- */
function inProgressKeywordMap(products, excludeSku) {
  // keyword(lower) -> sku, for products that already have a keyword and aren't sent yet
  const map = new Map();
  (products || []).forEach(p => {
    if (excludeSku && (p.sku || '').toLowerCase() === excludeSku.toLowerCase()) return;
    if (p.sent) return;
    if (p.keyword) map.set(String(p.keyword).toLowerCase().trim(), p.sku);
  });
  return map;
}

/* ---------------- GAP FILE (Competitors gap CSV) — primary keyword source, no Apify cost ---------------- */
function normDifficulty(raw) {
  if (raw == null) return 30;
  const s = String(raw).trim();
  if (s === '') return 30; // empty = treat as low
  const low = s.toLowerCase();
  if (low === 'low') return 30;
  if (low === 'medium') return 50;
  if (low === 'high') return 75;
  const n = Number(s);
  return Number.isFinite(n) ? n : 30;
}
function normVolume(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
async function readGapFile() {
  const rows = [];
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${GAP_PATH}?t=${Date.now()}`);
    if (!r.ok) return rows;
    let txt = await r.text();
    txt = txt.replace(/^﻿/, ''); // strip BOM
    const lines = txt.split('\n');
    for (let i = 1; i < lines.length; i++) { // skip header
      const line = lines[i].replace(/\r/g, '');
      if (!line.trim()) continue;
      const c = parseCSVLine(line);
      const keyword = (c[0] || '').toLowerCase().trim();
      if (!keyword) continue;
      const difficultyRaw = c[2] != null ? c[2].trim() : '';
      rows.push({ keyword, volume: normVolume(c[1]), difficulty: normDifficulty(c[2]), difficultyRaw: difficultyRaw || '' });
    }
  } catch { /* ignore */ }
  return rows;
}
// ART_WORDS: signal that a keyword is about wall art / decor (used ONLY together with the product's own colour).
const ART_WORDS = ['wall art', 'art print', 'print', 'prints', 'poster', 'posters', 'canvas', 'wall decor', 'artwork', 'painting', 'paintings', 'picture', 'pictures', 'wall hanging', 'wall pictures', 'art', 'decor'];
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// whole-word / whole-phrase match (so "sea" does NOT match inside "rousseau", "art" not inside "cartoon")
function wordMatch(kw, term) { if (!term) return false; return new RegExp('\\b' + escRe(term) + '\\b').test(kw); }
function anyWord(kw, list) { return (list || []).some(t => wordMatch(kw, t)); }
function gapTermsForProduct(p) {
  const col = p.collections || {};
  const styles = (col['By Style'] || []).map(s => s.toLowerCase());
  const rooms = (col['By Room'] || []).map(s => s.toLowerCase());
  // trend roots: "Coastal Decor" -> "coastal" (strip decor/design/style so it actually matches real keywords)
  const trendRoots = (p.trends || []).map(t => t.toLowerCase().replace(/\b(decor|design|style)\b/g, '').trim()).filter(Boolean);
  const colours = (p.primaryColour || []).map(c => c.toLowerCase());
  const extra = (p.keywordWords || []).map(w => String(w).toLowerCase().trim()).filter(Boolean);
  return { styles, rooms, trendRoots, colours, extra };
}
// Returns { qualifies, tier } — tier 1 = manual/extra word match (top priority), tier 2 = style/room/trend or product-colour+art.
// A colour only qualifies when the product's own colour describes art (colour word + an ART_WORD together);
// a colour alone, or a colour describing something else (e.g. "the white rabbit"), never qualifies.
function gapClassify(kw, terms) {
  const extraHit = anyWord(kw, terms.extra);
  if (extraHit) return { qualifies: true, tier: 1 };
  const themeHit = anyWord(kw, terms.styles) || anyWord(kw, terms.rooms) || anyWord(kw, terms.trendRoots);
  const colourArtHit = anyWord(kw, terms.colours) && anyWord(kw, ART_WORDS);
  if (themeHit || colourArtHit) return { qualifies: true, tier: 2 };
  return { qualifies: false, tier: 0 };
}
async function gapResearch(body) {
  const products = Array.isArray(body.products) ? body.products : [];
  if (!products.length) return { results: [] };
  const [gapRows, locked, allProducts] = await Promise.all([readGapFile(), lockedKeywordSet(), readProducts()]);
  const results = products.map(p => {
    const terms = gapTermsForProduct(p);
    const allowedColours = colourWordsOf((p.primaryColour || []).concat(p.keywordWords || []));
    const inProgress = inProgressKeywordMap(allProducts, p.sku);
    // opportunity = high volume + low difficulty; small colour bonus as a tie-breaker
    const opportunity = row => Math.sqrt(row.volume + 1) * (100 / (row.difficulty + 10)) + (anyWord(row.keyword, terms.colours) ? 1 : 0);
    const qualified = gapRows
      .filter(row => !locked.has(row.keyword) && !inProgress.has(row.keyword))
      .filter(row => colourOk(row.keyword, allowedColours))
      .map(row => ({ ...row, cls: gapClassify(row.keyword, terms) }))
      .filter(row => row.cls.qualifies);
    // tier 1 = manual/extra words first; tier 2 = the rest. Within each tier, best opportunity first.
    const byOpp = (a, b) => opportunity(b) - opportunity(a);
    const tier1 = qualified.filter(r => r.cls.tier === 1).sort(byOpp);
    const tier2 = qualified.filter(r => r.cls.tier === 2).sort(byOpp);
    const options = [...tier1, ...tier2]
      .slice(0, MAX_OPTIONS_PER_PRODUCT)
      .map(row => ({ keyword: row.keyword, volume: row.volume, difficulty: row.difficulty, difficultyRaw: row.difficultyRaw }));
    return { sku: p.sku || '', options };
  });
  return { results };
}

/* ---------------- seeds (Apify/DataForSEO path — PARKED, use sparingly) ---------------- */
function buildSeeds(p) {
  const col = p.collections || {};
  const styles = col['By Style'] || [];
  const rooms = col['By Room'] || [];
  const colours = (p.primaryColour || []); // research colours = Primary Colour ONLY (ignore Colour/Multicolour)
  const trends = p.trends || [];
  const setN = (p.set || '').match(/\d+/) ? (p.set || '').match(/\d+/)[0] : '';
  const seeds = [];
  const add = s => { s = (s || '').toLowerCase().trim(); if (s && !seeds.includes(s)) seeds.push(s); };
  styles.forEach(s => { add(`${s} wall art`); add(`${s} art print`); add(`${s} wall decor`); });
  colours.forEach(c => add(`${c} wall art`));
  rooms.forEach(r => { add(`${r} wall art`); add(`wall art for ${r}`); });
  trends.forEach(t => add(`${t}`));
  if (styles[0] && colours[0]) add(`${styles[0]} ${colours[0]} wall art`);
  if (styles[0] && setN) add(`${styles[0]} wall art set of ${setN}`);
  if (seeds.length === 0) CATEGORY_SYNONYMS.slice(0, 3).forEach(add);
  return seeds.slice(0, MAX_SEEDS_PER_PRODUCT);
}

/* ---------------- research ---------------- */
async function research(body) {
  const products = Array.isArray(body.products) ? body.products : [];
  const locationCode = body.locationCode || '2826';
  const languageCode = body.languageCode || 'en';
  if (!products.length) return { results: [] };

  // 1) seeds per product + global unique seed list
  const seedsByProduct = products.map(buildSeeds);
  const seedToProducts = new Map();
  seedsByProduct.forEach((seeds, pi) => seeds.forEach(s => {
    if (!seedToProducts.has(s)) seedToProducts.set(s, new Set());
    seedToProducts.get(s).add(pi);
  }));
  const uniqueSeeds = [...seedToProducts.keys()];

  // 2) suggestions for every unique seed (volume + intent), limited concurrency
  const sugg = await mapLimit(uniqueSeeds, 5, async (seed) => {
    const items = await callActor({ mode: 'keyword_suggestions', seedKeyword: seed, locationCode, languageCode });
    return { seed, items };
  });

  // helpers: collapse word-order / filler variants; relevance to the product's style/trend/room
  const FILLERS = ['and', 'the', 'for', 'in', 'on', 'of', 'a', 'to', 'with', '&'];
  const canonical = kw => kw.split(/\s+/).filter(w => !FILLERS.includes(w)).sort().join(' ');
  const relevanceOf = (kw, p) => {
    const col = p.collections || {};
    const styles = (col['By Style'] || []).map(s => s.toLowerCase());
    const rooms = (col['By Room'] || []).map(s => s.toLowerCase());
    const trendRoots = (p.trends || []).map(t => t.toLowerCase().replace(/\b(decor|design|style)\b/g, '').trim()).filter(Boolean);
    let r = 1;
    if (styles.some(s => s && kw.includes(s))) r += 3;
    if (trendRoots.some(t => t && kw.includes(t))) r += 3;
    if (rooms.some(rm => rm && kw.includes(rm))) r += 1.5;
    return r;
  };
  const commercial = i => i === 'commercial' || i === 'transactional';

  // 3) per-product candidates, DEDUPED by canonical form (one per concept, keep highest volume)
  const candByProduct = products.map(() => new Map()); // canonical -> {keyword, volume, intent}
  sugg.forEach(res => {
    if (!res || res.__error || !res.items) return;
    const pis = seedToProducts.get(res.seed) || new Set();
    res.items.forEach(it => {
      const kw = (it.keyword || '').toLowerCase().trim();
      if (!kw) return;
      const vol = (it.search_volume == null ? 0 : it.search_volume);
      const intent = it.search_intent || null;
      const can = canonical(kw);
      pis.forEach(pi => {
        const m = candByProduct[pi]; const prev = m.get(can);
        if (!prev || vol > prev.volume || (vol === prev.volume && kw.length < prev.keyword.length)) m.set(can, { keyword: kw, volume: vol, intent });
      });
    });
  });

  // 4) exclude locked + low volume; score by RELEVANCE × volume (style/trend rise, not just generic colour)
  const locked = await lockedKeywordSet();
  // colours allowed = ONLY the product's Primary Colour words (module-level colourWordsOf/colourOk); drop keywords that mention any other colour
  const scored = candByProduct.map((m, pi) => {
    const allowed = colourWordsOf(products[pi].primaryColour);
    return [...m.values()]
      .filter(c => !locked.has(c.keyword) && c.volume >= MIN_VOLUME && colourOk(c.keyword, allowed))
      .map(c => { const rel = relevanceOf(c.keyword, products[pi]); const intentF = commercial(c.intent) ? 1.25 : 1; return { ...c, score: rel * Math.sqrt(c.volume + 1) * intentF }; })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DIFF_CANDIDATES_PER_PRODUCT);
  });
  const diffNeeded = new Set();
  scored.forEach(arr => arr.forEach(c => diffNeeded.add(c.keyword)));

  // 5) difficulty (UK) for the shortlist
  const diffMap = new Map();
  const allKw = [...diffNeeded];
  for (let i = 0; i < allKw.length; i += 1000) {
    const chunk = allKw.slice(i, i + 1000);
    if (!chunk.length) continue;
    try {
      const items = await callActor({ mode: 'keyword_difficulty', keywords: chunk, locationCode, languageCode });
      items.forEach(it => { const kw = (it.keyword || '').toLowerCase().trim(); if (kw) diffMap.set(kw, it.keyword_difficulty); });
    } catch { /* difficulty stays unknown */ }
  }

  // 6) top options per product (already ranked by relevance × volume)
  const results = products.map((p, pi) => {
    const options = scored[pi].slice(0, MAX_OPTIONS_PER_PRODUCT).map(c => ({
      keyword: c.keyword, volume: c.volume,
      difficulty: diffMap.has(c.keyword) ? diffMap.get(c.keyword) : null,
      intent: c.intent
    }));
    return { sku: p.sku || '', options };
  });
  return { results };
}

/* ---------------- GENERATE CONTENT — competitor analysis + vision + Claude ---------------- */

// Lean competitor finder (top-3 SERP for the keyword). Copied/simplified from api/analyze-money-page.js
// findCompetitors() — no userUrl (product has no URL yet), no Scrappa fallback (SerpAPI only per spec).
const NON_COMPETABLE = ['amazon.', 'etsy.', 'ebay.', 'aliexpress.', 'temu.', 'walmart.', 'wayfair.',
  'pinterest.', 'youtube.', 'youtu.be', 'reddit.', 'quora.', 'tiktok.', 'instagram.', 'facebook.', 'm.facebook', 'fb.com'];
function normalizeUrl(u) { return String(u || '').toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, ''); }
function isNonCompetable(u) { const n = normalizeUrl(u); return NON_COMPETABLE.some(d => n.includes(d)); }
async function findTop3Competitors(keyword) {
  if (!SERPAPI_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`;
    const r = await fetch(url);
    const data = await r.json();
    const organicResults = data.organic_results || [];
    const competitors = [];
    organicResults.forEach((result, i) => {
      if (competitors.length >= 3) return;
      const resultUrl = result.link; if (!resultUrl) return;
      if (isNonCompetable(resultUrl)) return;
      competitors.push({ position: i + 1, title: result.title || '', url: resultUrl });
    });
    return competitors;
  } catch { return []; }
}

// Lean SEO extractor (title/meta/h1/h2/wordCount only — no schema/AI-optimisation detection, not needed here).
function extractLiteSEOData(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const metaDescription = metaMatch ? metaMatch[1].trim() : '';
  const h1 = (html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || []).map(m => m.replace(/<\/?h1[^>]*>/gi, '').trim());
  const h2 = (html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [])
    .map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim())
    .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { title, metaDescription, h1, h2, wordCount };
}
async function fetchCompetitorData(c) {
  try {
    const r = await fetch(c.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
    const html = await r.text();
    return { ...c, ...extractLiteSEOData(html) };
  } catch { return { ...c, title: '', metaDescription: '', h1: [], h2: [], wordCount: 0 }; }
}

function buildGenerateContentPrompt(product, competitors) {
  const col = product.collections || {};
  const styles = (col['By Style'] || []).join(', ');
  const rooms = (col['By Room'] || []).join(', ');
  const primaryColours = (product.primaryColour || []).join(', ');
  const trends = (product.trends || []).join(', ');
  const extraWords = (product.keywordWords || []).join(', ');
  const keyword = product.keyword;
  const setMatch = (product.set || '').match(/\d+/);
  const setN = setMatch ? setMatch[0] : '';
  const roomsLower = (col['By Room'] || []).map(r => r.toLowerCase());
  const moisture = roomsLower.includes('bathroom') || roomsLower.includes('laundry room');
  const firstRoom = (col['By Room'] || [])[0] || '';
  const scrollRoom = firstRoom ? ('a ' + firstRoom.toLowerCase()) : 'your room';

  // Title rule depends on set size: sets of 2/3 end with "| Set of X"; a set of 1 is a single print (never "Set of 1").
  const quoteRule = `If you name the product using a specific word or phrase that is actually WRITTEN ON the artwork itself (e.g. a quote, a name, lettering visible in the image) — as opposed to just describing the subject/colours — wrap that exact phrase in straight double quotes in the title, e.g. 'Wall Art Print "Allah Is The Light" Islamic Calligraphy'. Never quote ordinary descriptive words (colours, subjects, styles) — only wording actually printed on the piece.`;
  const productTitleRule = (setN === '1' || /set of 1/i.test(product.set || ''))
    ? `The product name — keyword near the front, PLUS a short distinctive detail of the actual artwork (its subject or main colours, from the image). This is a SINGLE print, so do NOT write 'Set of 1'. Make sure the title contains 'Wall Art Print' (singular) — but if the front part already contains 'Wall Art Print', do NOT repeat it. Title Case. e.g. 'Gold Celestial Yoga Wall Art Print'. ${quoteRule} This is also the page H1.`
    : `The product name — keyword near the front, PLUS a short distinctive detail of the actual artwork (its subject or main colours, from the image), and ENDS with the set size. Title Case. e.g. 'Gold Celestial Yoga Wall Art | Set of ${setN || '3'}'. ${quoteRule} This is also the page H1.`;

  const competitorsBlock = competitors.length
    ? competitors.map(c => `--- Position ${c.position}: ${c.url}\n  Title: ${c.title || 'N/A'}\n  H2s: ${(c.h2 || []).join(' | ') || 'N/A'}\n  Words: ${c.wordCount || 0}`).join('\n')
    : '(no competitor data — write the closing sections from the product itself)';

  return `You are an expert SEO copywriter AND a very warm, friendly UK interior-decor advisor writing a PRODUCT description for AboutWallArt (a UK wall art / home-decor store). You are looking at the ACTUAL product image supplied with this message. Return ONLY a valid JSON object — no text before or after, no markdown code fences.

WHAT YOU MAY TREAT AS FACT (never go beyond this):
- The IMAGE shows the artwork. Describe ONLY THE ART ITSELF — the subject, the colours, the style/pattern of the artwork. Say NOTHING about the frames, mounts, glass, the wall, the room, or how the pieces are hung or arranged: the image is only a mockup and the real framing/room will vary. Describe just what is drawn/printed in the art. NEVER invent anything not visible in the art.
- The product definition below. Never invent set size, style, room or colours beyond it.
- Product wording: refer to the items as "wall art prints" / "art prints" (this is the accepted wording).
- METALLIC COLOURS ARE NOT REAL METAL: we cannot print metallic or foil. If the art shows gold, rose gold, silver, copper or any metallic colour, describe it as a printed TONE / colour only (e.g. "warm rose-gold tones", "gold-toned linework") — NEVER as real metallic, metallic finish, or foil, and never imply the customer receives metallic foil or shine.

PRODUCT DEFINITION:
- Main keyword: "${keyword}"
- Set size: ${product.set || 'n/a'} (a set of ${setN || '?'} prints)
- Style: ${styles || 'n/a'}
- Room(s): ${rooms || 'n/a'}
- Defined colours: ${primaryColours || 'n/a'}
- Trends: ${trends || 'n/a'}
- Extra terms: ${extraWords || 'n/a'}

COMPETITORS (top-3 ranking for "${keyword}" right now). Use these to SHAPE the two closing H2 sections so this product covers what they cover and fills their gaps:
${competitorsBlock}

Return EXACTLY this JSON (real content, no placeholders):
{
  "productTitle": "${productTitleRule}",
  "seoTitle": "SEO title tag, max 60 chars, UK spelling. Put the exact keyword as close to the very beginning as still reads natural — front-loaded, never forced or awkward. It MUST contain the phrase 'wall art print' or 'wall art prints'.",
  "metaDescription": "Max 135 chars. PERSUASIVE, not a description — lead with the BENEFIT and what the art is GOOD FOR, and make the reader want to click through to the product. Keyword once, UK spelling. Do NOT write shipping yourself — the tool appends ' Free UK shipping!' automatically at the end.",
  "productDescription": "The FULL description as ONE HTML string — follow STRUCTURE + VOICE exactly.",
  "aiItems": [
    { "element":"Comparison Snippet", "metafieldKey":"comparison_snippet", "format":"richtext_snippet", "priority":"high", "content":"<h2>What is/are ${keyword}?</h2><p>[standalone 3-5 sentence answer; first sentence answers fully]</p>", "competitorDriven": false },
    { "element":"How-To Block", "metafieldKey":"how_to_block", "format":"richtext_snippet", "priority":"medium", "content":"<h2>[how-to title about ${keyword}]</h2><p><strong>1. Step:</strong> ...</p><p><strong>2. Step:</strong> ...</p>", "competitorDriven": false },
    { "element":"Comparison Table", "metafieldKey":"comparison_table", "format":"richtext_snippet", "priority":"medium", "content":"<h2>[title]</h2><p><strong>Feature —</strong> A. B.</p><p><strong>Feature —</strong> A. B.</p>", "competitorDriven": false }
  ]
}

═══ JSON SAFETY ═══
- RAW JSON only, no code fences. In productDescription and every aiItems content use SINGLE quotes for ALL HTML attributes, never double. Keep each string on ONE line (no raw line breaks/tabs/unescaped double quotes inside a value).

═══ PRODUCT DESCRIPTION — build "productDescription" as ONE HTML string, in THIS order ═══
1. INTRO — 2 short paragraphs, NO heading, do NOT repeat the title as a heading.
   - Open the FIRST sentence with an EVERYDAY, common verb people actually say (Add, Bring, Give, Picture, Imagine, Hang, Make, Turn...) — choose the one that best fits THIS artwork and VARY it across products. NEVER use an academic, formal or fancy verb (e.g. "Gracing", "Adorn", "Bestow", "Grace") — those sound odd. Include the exact keyword "${keyword}" in that first sentence.
   - It must be EMOTIONAL and persuasive — make the buyer want it — but in the grounded, chatty, friendly-advisor voice below. Speak as I/we. Describe the REAL artwork you see (subject, colours, where it suits) in plain, concrete words. A light question is fine.
   - The description must NEVER begin with the word "SHOP".
   - NO poetic / abstract / luxury-brochure lines.
2. <h3>What's Included with [productTitle]</h3> then a short <ul>:
   - Product-specific receivables / quality only, real facts (e.g. printed in the UK with fade-resistant pigment inks; for indoor use).
   - INCLUDE a convenience bullet (ALL products): the FRAMED and CANVAS-WRAPPED options arrive READY TO HANG — saving the time and hassle of hunting for a frame that fits. (The unframed option is the print only.)
   - Do NOT describe specific frame colours, exact sizes or gsm here (those live in the shared theme section) — only the convenience bullet and the options bullet below.
   - The LAST bullet MUST read exactly: <li>Choose between unframed and framed options in multiple sizes and in Luster or Museum quality; also available in wrapped canvas size options</li>
3. <h2>How to Style ${keyword} ...</h2> — one or two WARM first-person paragraphs of real styling/hanging advice, with ONE internal link to a relevant collection/page (full URL, target='_blank' rel='noopener'). Shape it around the styling angles the top-3 competitors cover.
4. <h2>[a natural "what to consider when choosing" heading — NOT the exact keyword]</h2> — WARM first-person advice on choosing for this artwork's style, colours and wall size, shaped by what competitors cover.
   - END this section with a friendly line telling the reader to scroll down to see how each size looks in ${scrollRoom} — there is a size-guide image below showing every size in that room (e.g. "Scroll down to see how each size looks in ${scrollRoom} before you decide.").${moisture ? '\n   - THIS PRODUCT IS FOR A BATHROOM / LAUNDRY ROOM: include a clear recommendation that for damp, high-moisture rooms the CANVAS-WRAPPED option is the best choice because it is moisture-resistant.' : ''}
(The EXACT keyword belongs in AT MOST two headings across the whole description + snippets. Vary all other headings.)

═══ VOICE (the most important part) ═══
- A very friendly, warm UK interior-decor advisor giving genuine advice to ONE person. First person (I/we). Conversational, human, practical, inspiring. Active voice. Vary sentence length. UK spelling throughout. If it reads like AI or a dry spec sheet, it has FAILED — rewrite warmer.
- GOLD-STANDARD VOICE (copy the VOICE, not the content): "Picture this set of three prints above your sofa — soft greys with warm gold running through them, calm but never boring. I love how they pull a living room together without shouting for attention. I'd hang all three in a row at eye level with an even gap between each one; because the palette is neutral, they pair brilliantly with warm white or sage walls."
- The customer SELECTS framing options — never say "I add" frames/mounts.
- Use ONLY what you SEE in the image + the definition. NEVER invent set size, subject, colours, style or room.
- Do NOT begin the description with "SHOP", and do NOT open with the same verb every time.
- Use plain, EVERYDAY words the way a real person talks — NEVER academic, literary or fancy vocabulary (no "gracing", "adorn", "bestow", "resplendent", etc.). If a word sounds like it belongs in an essay, use a simpler one.
- BANNED WORDS (never use): Delve, Spearheading, Embarking, Compelling, Empowering, Encompassing, Comprehensively, Effectively, Beacon, Dive, Showcasing, Remarked, Aligns, Surpassing, Tragically, Impacting, Prioritize, Sparking, Standout, Hindering, Advancements, Aiding, Fostering, Multifaceted, Revolutionary, Testament, Elevate.
- BANNED PHRASES: "in the ever-evolving world of", "at the forefront of", "in summary", "in conclusion", "in essence", "it's important to note", "emerges as a beacon", "dive into".

═══ AI ITEMS ═══
- Generate all three in the EXACT H2 formats shown. Keep metafieldKey + format EXACTLY. Set competitorDriven:true when the block fills a competitor gap, else false. how_to_block and comparison_table use bold-labelled paragraphs (rich text can't hold real tables).
- Comparison Table — use ONLY the REAL options this shop offers, never invented paper names or gsm. The options are: Unframed print, Framed print, Wrapped canvas; and the paper choice for prints is Luster art paper or Museum quality paper. (Remember: any metallic look in the art is a printed tone, not real foil.)

Return ONLY the JSON object — no other text.`;
}

async function generateContent(body) {
  const sku = body.sku;
  const image = body.image;
  const imageMediaType = body.imageMediaType || 'image/jpeg';
  if (!sku) throw new Error('sku required');
  if (!image) throw new Error('image required');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const products = await readProducts();
  const product = products.find(p => (p.sku || '').toLowerCase() === sku.toLowerCase());
  if (!product) throw new Error('product not found: ' + sku);
  if (!product.keyword) { const e = new Error('This product has no keyword yet — pick one first.'); e.status = 400; throw e; }

  const competitors = await findTop3Competitors(product.keyword);
  const competitorsData = competitors.length ? await Promise.all(competitors.map(fetchCompetitorData)) : [];

  const prompt = buildGenerateContentPrompt(product, competitorsData);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: image } }
      ] }]
    })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Claude API error ' + r.status + ': ' + t.slice(0, 300)); }
  const data = await r.json();
  let responseText = '';
  if (data.content && Array.isArray(data.content)) {
    responseText = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  let clean = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) clean = jsonMatch[0];
  let parsed;
  try { parsed = JSON.parse(clean); } catch (e) { throw new Error('Could not parse Claude response as JSON: ' + String(e.message || e)); }

  // meta description must always end with "Free UK shipping!"
  let meta = (parsed.metaDescription || '').trim();
  if (!/free uk shipping!?$/i.test(meta)) meta = meta.replace(/\s+$/, '') + ' Free UK shipping!';
  parsed.metaDescription = meta;

  const content = {
    productTitle: parsed.productTitle || '',
    seoTitle: parsed.seoTitle || '',
    metaDescription: parsed.metaDescription || '',
    productDescription: parsed.productDescription || '',
    aiItems: Array.isArray(parsed.aiItems) ? parsed.aiItems : [],
    generatedAt: new Date().toISOString()
  };

  // save onto the product (SHA-conflict retry ×1, same pattern as save-product)
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found: ' + sku);
    arr[idx] = { ...arr[idx], content, updatedAt: new Date().toISOString() };
    try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG generate content: ${sku}`); return { content, products: arr }; }
    catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

/* ---------------- set keyword (no registry lock — just saves onto the product; lock happens at Send-to-Shopify) ---------------- */
async function setKeyword(sku, keyword) {
  keyword = (keyword || '').trim();
  if (!sku) throw new Error('sku required');
  if (!keyword) throw new Error('keyword required');
  const locked = await lockedKeywordSet();
  if (locked.has(keyword.toLowerCase())) return { taken: true, reason: 'This keyword is already locked in the registry.' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const inProgress = inProgressKeywordMap(arr, sku);
    if (inProgress.has(keyword.toLowerCase())) return { taken: true, reason: `Already used by product ${inProgress.get(keyword.toLowerCase())}.` };
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found: ' + sku);
    arr[idx] = { ...arr[idx], keyword, updatedAt: new Date().toISOString() };
    try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG set keyword: ${sku} -> ${keyword}`); return { ok: true, products: arr }; }
    catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

/* ---------------- reserve keyword (Send-to-Shopify phase — locks the registry) ---------------- */
async function reserveKeyword(keyword, sku) {
  keyword = (keyword || '').trim();
  if (!keyword) throw new Error('keyword required');
  for (let attempt = 0; attempt < 2; attempt++) {
    const reg = await ghGet(REGISTRY_PATH);
    if (reg.content == null) throw new Error('registry not found');
    const lines = reg.content.split('\n').map(l => l.replace(/\r/g, ''));
    // duplicate check: same keyword already LOCKED under COMMERCIAL intent
    for (const line of lines) {
      if (!line.trim()) continue;
      const c = parseCSVLine(line);
      if ((c[0] || '').toLowerCase() === keyword.toLowerCase() && (c[2] || '').toUpperCase() === 'LOCKED' && (c[10] || '').toUpperCase() === 'COMMERCIAL') {
        return { duplicate: true, lockedTo: c[1] || '' };
      }
    }
    const source = 'NPG' + (sku ? ':' + sku : '');
    const newRow = `${csvField(keyword)},N/A,LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,${csvField(source)},COMMERCIAL,`;
    const updated = reg.content.trimEnd() + '\n' + newRow + '\n';
    try {
      await ghPut(REGISTRY_PATH, updated, reg.sha, `NPG reserve keyword: ${keyword}`);
      return { ok: true, keyword };
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue; // SHA conflict — retry once with fresh sha
      throw e;
    }
  }
  throw new Error('registry write conflict, try again');
}
// Called after a product is created in Shopify: writes the keyword into the registry as LOCKED so it's
// never offered again. Status is OPTIMIZED (not TO_OPTIMIZE) on purpose — a brand-new product shouldn't
// show up in Money Page Doctor's "Start Here". Columns match reserveKeyword's 12-column layout, but with
// the real product URL and today's date. Idempotent: skips if the keyword is already LOCKED COMMERCIAL.
async function lockKeywordInRegistry(keyword, sku, productUrl) {
  keyword = (keyword || '').trim();
  if (!keyword) throw new Error('keyword required');
  const today = new Date().toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reg = await ghGet(REGISTRY_PATH);
    if (reg.content == null) throw new Error('registry not found');
    const lines = reg.content.split('\n').map(l => l.replace(/\r/g, ''));
    for (const line of lines) {
      if (!line.trim()) continue;
      const c = parseCSVLine(line);
      if ((c[0] || '').toLowerCase() === keyword.toLowerCase() && (c[2] || '').toUpperCase() === 'LOCKED' && (c[10] || '').toUpperCase() === 'COMMERCIAL') {
        return { ok: true, alreadyLocked: true };
      }
    }
    const source = 'NPG' + (sku ? ':' + sku : '');
    const newRow = `${csvField(keyword)},${csvField(productUrl || 'N/A')},LOCKED,DONE,OPTIMIZED,N/A,N/A,N/A,N/A,${csvField(source)},COMMERCIAL,${csvField(today)}`;
    const updated = reg.content.trimEnd() + '\n' + newRow + '\n';
    try {
      await ghPut(REGISTRY_PATH, updated, reg.sha, `NPG lock keyword (sent to Shopify): ${keyword}`);
      return { ok: true, keyword };
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue;
      throw e;
    }
  }
  throw new Error('registry write conflict, try again');
}

/* ---------------- SHOPIFY (Send-to-Shopify support, v0.11) ---------------- */
const SHOPIFY_API_VERSION = '2025-01';
function shopifyGqlUrl() { return `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`; }
async function shopifyGQL(query, variables) {
  const sleep = ms => new Promise(s => setTimeout(s, ms));
  for (let attempt = 0; attempt < 6; attempt++) {
    let r, d;
    try {
      r = await fetch(shopifyGqlUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
        body: JSON.stringify({ query, variables })
      });
      d = await r.json();
    } catch (e) { if (attempt < 5) { await sleep(1200 * (attempt + 1)); continue; } throw e; }
    const throttled = (r.status === 429) || (d && Array.isArray(d.errors) && d.errors.some(e => (e.extensions && e.extensions.code === 'THROTTLED') || /throttl/i.test(e.message || '')));
    if (throttled && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
    return d.data;
  }
  throw new Error('Shopify request failed after retries (throttled)');
}
function normTitle(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandomN(arr, n) { const pool = [...arr]; const out = []; while (pool.length && out.length < n) { const i = Math.floor(Math.random() * pool.length); out.push(pool.splice(i, 1)[0]); } return out; }

// Shopify rich-text JSON builder — COPIED VERBATIM from api/shopify-files.js (that's where Money Page
// Doctor's push-metafields builds rich_text_field values). Keep in sync if the source ever changes.
function htmlToRichText(html) {
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  function parseInline(str) {
    const nodes = [];
    const pushText = (chunk) => { const t = decode(chunk.replace(/<[^>]+>/g, '')); if (t) nodes.push({ type: 'text', value: t }); };
    const re = /(<a\b[^>]*>[\s\S]*?<\/a>)|(<(?:strong|b)\b[^>]*>[\s\S]*?<\/(?:strong|b)>)/gi;
    let last = 0, m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) pushText(str.slice(last, m.index));
      if (m[1]) {
        const tag = m[1];
        const url = (tag.match(/href=["']([^"']*)["']/i) || [])[1] || '';
        const title = (tag.match(/title=["']([^"']*)["']/i) || [])[1] || null;
        const target = (tag.match(/target=["']([^"']*)["']/i) || [])[1] || null;
        const innerTxt = tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
        const boldInner = /<(?:strong|b)\b/i.test(innerTxt);
        const textVal = decode(innerTxt.replace(/<[^>]+>/g, '')).trim();
        nodes.push({ type: 'link', url, title, target, children: [boldInner ? { type: 'text', value: textVal, bold: true } : { type: 'text', value: textVal }] });
      } else if (m[2]) {
        const t = decode(m[2].replace(/<[^>]+>/g, ''));
        if (t) nodes.push({ type: 'text', value: t, bold: true });
      }
      last = re.lastIndex;
    }
    if (last < str.length) pushText(str.slice(last));
    return nodes;
  }
  const children = [];
  const blockRe = /<(h2|h3|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m, matched = false;
  while ((m = blockRe.exec(html)) !== null) {
    matched = true;
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === 'h2' || tag === 'h3') {
      const kids = parseInline(inner);
      if (kids.length) children.push({ type: 'heading', level: tag === 'h2' ? 2 : 3, children: kids });
    } else if (tag === 'p') {
      const kids = parseInline(inner);
      if (kids.length) children.push({ type: 'paragraph', children: kids });
    } else {
      const listType = tag === 'ol' ? 'ordered' : 'unordered';
      const lis = inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
      const liNodes = lis
        .map(li => ({ type: 'list-item', children: parseInline(li.replace(/^<li[^>]*>/i, '').replace(/<\/li>$/i, '')) }))
        .filter(n => n.children.length);
      if (liNodes.length) children.push({ type: 'list', listType, children: liNodes });
    }
  }
  if (!matched) { const kids = parseInline(html); if (kids.length) children.push({ type: 'paragraph', children: kids }); }
  return JSON.stringify({ type: 'root', children: children.length ? children : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }] });
}

// ---- Site mega-menu (Shopify admin: Content > Menus > "New Main Menu", handle "new-mega-menu").
// THIS is the source of truth for matching a ticked form name (Room/Style/Colour/Occasion/Trend) to
// its real Shopify collection or page — collection TITLES in the store are marketing titles that
// often look nothing like the form checkbox (e.g. "Living room" -> collection titled "Living Room
// Pictures | Framed Wall Art"), so a blind title match on the collections list fails. The menu is
// 3 levels deep: SHOP WALL ART > By Room/Style/Colour/Occasion > individual items (each a COLLECTION,
// title = the exact form label); and SHOP HOME DECOR > By Trend > individual items (each a PAGE,
// title = the exact TRENDS[] label).
async function fetchMegaMenu() {
  const list = await shopifyGQL(`query{ menus(first:20){ nodes{ id handle } } }`);
  const hit = (list.menus.nodes || []).find(m => m.handle === 'new-mega-menu');
  if (!hit) throw new Error('Site menu "new-mega-menu" not found — check Content > Menus in Shopify admin.');
  const data = await shopifyGQL(
    `query($id:ID!){ menu(id:$id){ items{ title resourceId items{ title resourceId items{ title resourceId } } } } }`,
    { id: hit.id }
  );
  const collectionMap = new Map(); // normTitle -> collection GID (Room/Style/Colour/Occasion + top-level items like "New arrivals")
  const trendMap = new Map();      // normTitle -> page GID
  const shopWallArt = (data.menu.items || []).find(t => normTitle(t.title) === 'shop wall art');
  (shopWallArt ? shopWallArt.items || [] : []).forEach(group => {
    if (group.resourceId && /\/Collection\//.test(group.resourceId)) collectionMap.set(normTitle(group.title), group.resourceId);
    (group.items || []).forEach(leaf => { if (leaf.resourceId && /\/Collection\//.test(leaf.resourceId)) collectionMap.set(normTitle(leaf.title), leaf.resourceId); });
  });
  const shopHomeDecor = (data.menu.items || []).find(t => normTitle(t.title) === 'shop home decor');
  const byTrend = shopHomeDecor ? (shopHomeDecor.items || []).find(g => normTitle(g.title) === 'by trend') : null;
  (byTrend ? byTrend.items || [] : []).forEach(leaf => { if (leaf.resourceId && /\/Page\//.test(leaf.resourceId)) trendMap.set(normTitle(leaf.title), leaf.resourceId); });
  return { collectionMap, trendMap };
}
// ---- Fallback: full collections list by exact title — only for names the mega-menu doesn't cover
// (e.g. "Bestsellers" under Featured, which is a smart collection with no menu item of its own). ----
async function fetchAllCollectionsByTitle() {
  const map = new Map();
  let cursor = null, pages = 0;
  while (pages < 40) {
    const data = await shopifyGQL(`query($c:String){ collections(first:100, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id title } } }`, { c: cursor });
    const conn = data.collections;
    conn.nodes.forEach(n => map.set(normTitle(n.title), { id: n.id, title: n.title }));
    pages++;
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return map;
}
// ---- Given specific collection GIDs (only the ones actually ticked), fetch each one's ruleSet in ONE
// batched GraphQL call (aliases) — smart w/ a single plain TAG=X rule -> tag known; smart w/ any other
// rule shape -> unresolvedSmart (Mae picks by hand); no ruleSet at all -> manual (join directly). ----
async function fetchRuleSetsByIds(ids) {
  const out = new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const q = 'query {\n' + chunk.map((id, j) => `c${j}: collection(id:"${id}"){ id title ruleSet{ rules{ column relation condition } } } `).join('\n') + '\n}';
    const data = await shopifyGQL(q);
    chunk.forEach((id, j) => {
      const n = data['c' + j]; if (!n) return;
      const isSmart = !!(n.ruleSet && Array.isArray(n.ruleSet.rules) && n.ruleSet.rules.length);
      // Trust the rules (add ALL the tags) only when EVERY rule is a plain TAG=X condition — that's a
      // safe superset regardless of whether the store's collection matches ANY or ALL of its rules.
      // Any non-tag rule (VARIANT_PRICE, TYPE, VARIANT_INVENTORY…) can't be satisfied by tagging alone.
      let tags = null;
      if (isSmart && n.ruleSet.rules.every(r => r.column === 'TAG' && r.relation === 'EQUALS' && r.condition)) {
        tags = n.ruleSet.rules.map(r => r.condition);
      }
      out.set(id, { isSmart, tags, ruleCount: isSmart ? n.ruleSet.rules.length : 0, title: n.title });
    });
  }
  return out;
}
async function readBlogIndex() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/blog-index.json?t=${Date.now()}`);
    if (!r.ok) return { articles: [] };
    const j = await r.json();
    return { articles: Array.isArray(j.articles) ? j.articles : [] };
  } catch { return { articles: [] }; }
}
// ---- Complementary products — always these 2 fixed handles ----
const COMPLEMENTARY_HANDLES = ['black-picture-frame-mount', 'white-picture-frame-mount'];
async function resolveComplementaryProducts() {
  const gids = [];
  for (const handle of COMPLEMENTARY_HANDLES) {
    try {
      const data = await shopifyGQL(`query($q:String){ products(first:1, query:$q){ nodes{ id } } }`, { q: `handle:'${handle}'` });
      const n = data.products && data.products.nodes && data.products.nodes[0];
      if (n) gids.push(n.id);
    } catch { /* caller warns if short */ }
  }
  return gids;
}
// ---- Related products — 4 random from the "main collection" (re-rolled every call, never a fixed set) ----
// Rule: room ticked is ONLY "Living room" -> main = first By Style ticked. Any other room (or none) -> main = first By Room ticked (style ignored).
async function resolveRelatedProducts(product, megaMenu, fallbackByTitle) {
  const col = product.collections || {};
  const rooms = (col['By Room'] || []);
  const onlyLivingRoom = rooms.length === 1 && normTitle(rooms[0]) === 'living room';
  const mainName = onlyLivingRoom ? ((col['By Style'] || [])[0] || null) : (rooms[0] || null);
  if (!mainName) return { gids: [], mainName: null, reason: 'no room/style ticked to pick a main collection' };
  let gid = megaMenu.collectionMap.get(normTitle(mainName));
  if (!gid) { const f = fallbackByTitle.get(normTitle(mainName)); if (f) gid = f.id; }
  if (!gid) return { gids: [], mainName, reason: 'main collection not found: ' + mainName };
  try {
    const data = await shopifyGQL(`query($id:ID!){ collection(id:$id){ products(first:50){ nodes{ id } } } }`, { id: gid });
    const ids = ((data.collection && data.collection.products && data.collection.products.nodes) || []).map(n => n.id);
    return { gids: pickRandomN(ids, Math.min(4, ids.length)), mainName, collectionId: gid };
  } catch (e) { return { gids: [], mainName, reason: String(e.message || e) }; }
}

/* ---------------- IMAGE UPLOAD (Send-to-Shopify Batch 2) ---------------- */
const FIXED_IMAGES_PATH = 'data/npg-fixed-images.json';
// Uploads one image to Shopify Files: stagedUploadsCreate -> manual multipart POST -> fileCreate -> poll
// for the permanent CDN url. COPIED/ADAPTED from api/shopify-files.js's proven 'upload-image' subAction
// (same 3 steps + polling) — do not diverge from that pattern.
async function uploadImageToShopify(base64, filename, mimeType, altText) {
  const mime = mimeType || 'image/jpeg';
  const safeFilename = String(filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  const sd = await shopifyGQL(
    `mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }`,
    { input: [{ resource: 'FILE', filename: safeFilename, mimeType: mime, httpMethod: 'POST' }] }
  );
  const ue1 = sd.stagedUploadsCreate.userErrors || [];
  if (ue1.length) throw new Error(ue1[0].message);
  const target = sd.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error('No staged upload target returned');

  const imageBuffer = Buffer.from(base64, 'base64');
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  let formParts = '';
  for (const p of target.parameters) formParts += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
  formParts += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`;
  const bodyBuf = Buffer.concat([Buffer.from(formParts, 'utf8'), imageBuffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
  const ur = await fetch(target.url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: bodyBuf });
  if (!ur.ok) { const t = await ur.text(); throw new Error('Upload to Shopify failed: ' + t.slice(0, 200)); }

  const cd = await shopifyGQL(
    `mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ ... on MediaImage { id image{ url } } } userErrors{ field message } } }`,
    { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: String(altText || safeFilename).slice(0, 512) }] }
  );
  const ue2 = cd.fileCreate.userErrors || [];
  if (ue2.length) throw new Error(ue2[0].message);
  const file = cd.fileCreate.files[0];
  let cdnUrl = file && file.image ? file.image.url : null;
  const fileId = file ? file.id : null;
  if (!fileId) throw new Error('fileCreate did not return a file id.');

  for (let attempt = 0; !cdnUrl && attempt < 6; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const pd = await shopifyGQL(`query($id:ID!){ node(id:$id){ ... on MediaImage { image{ url } } } }`, { id: fileId });
      cdnUrl = pd.node && pd.node.image ? pd.node.image.url : null;
    } catch { /* keep polling */ }
  }
  return { gid: fileId, url: cdnUrl };
}

function slugifyKeyword(keyword) {
  return String(keyword || 'wall-art').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wall-art';
}
function extFromMime(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  return 'jpg';
}
function altFor(slot, keyword, n, setSize) {
  const kw = String(keyword || '').trim();
  const cap = kw ? kw.charAt(0).toUpperCase() + kw.slice(1) : 'Wall art';
  if (slot === 'lifestyle') return `${cap} styled in a room setting${n > 1 ? ' — view ' + n : ''}`;
  if (slot === 'individual') return setSize > 1 ? `${cap} — individual print ${n} of ${setSize}` : `${cap} print close-up`;
  if (slot === 'flatWhite') return `${cap} shown in a white frame`;
  if (slot === 'flatBlack') return `${cap} shown in a black frame`;
  if (slot === 'flatOak') return `${cap} shown in an oak frame`;
  if (slot === 'flatCanvas') return `${cap} as a wrapped canvas`;
  if (slot === 'flatUnframed') return `${cap} unframed print`;
  return cap;
}
const FLAT_SLOTS = ['flatWhite', 'flatBlack', 'flatOak', 'flatCanvas', 'flatUnframed'];

async function uploadProductImage(body) {
  const { sku, slot, image, imageMediaType } = body;
  if (!sku) throw new Error('sku required');
  if (!slot) throw new Error('slot required');
  if (!image) throw new Error('image required');
  if (slot !== 'lifestyle' && slot !== 'individual' && !FLAT_SLOTS.includes(slot)) throw new Error('invalid slot: ' + slot);

  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found: ' + sku);
    const product = arr[idx];
    const images = product.images ? { ...product.images, lifestyle: [...(product.images.lifestyle || [])], individuals: [...(product.images.individuals || [])], flats: { ...(product.images.flats || {}) } } : { lifestyle: [], individuals: [], flats: {} };

    const setMatch = (product.set || '').match(/\d+/);
    const setSize = setMatch ? parseInt(setMatch[0], 10) : 1;
    const ext = extFromMime(imageMediaType);
    let n;
    if (slot === 'lifestyle') n = images.lifestyle.length + 1;
    else if (slot === 'individual') { n = images.individuals.length + 1; if (n > setSize) throw new Error(`This product is a ${product.set || 'set'} — it already has ${setSize} individual image(s).`); }
    else n = 1; // flats are single slots

    const filename = `${slugifyKeyword(product.keyword)}-${slot === 'individual' ? 'individual-' + n : slot === 'lifestyle' ? 'lifestyle-' + n : slot.replace('flat', '').toLowerCase()}.${ext}`;
    const alt = altFor(slot, product.keyword, n, setSize);

    const uploaded = await uploadImageToShopify(image, filename, imageMediaType, alt);
    const record = { gid: uploaded.gid, url: uploaded.url, filename, alt };

    if (slot === 'lifestyle') images.lifestyle.push(record);
    else if (slot === 'individual') images.individuals.push(record);
    else images.flats[slot] = record;

    arr[idx] = { ...product, images, updatedAt: new Date().toISOString() };
    try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG upload image: ${sku} (${slot})`); return { image: record, products: arr }; }
    catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

// Cover is simply lifestyle[0] — dragging a tile to the front makes it the cover, no separate flag.
async function reorderLifestyleImages(sku, order) {
  if (!Array.isArray(order)) throw new Error('order required');
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found: ' + sku);
    const product = arr[idx];
    const lifestyle = (product.images && product.images.lifestyle) || [];
    const valid = order.length === lifestyle.length && new Set(order).size === lifestyle.length && order.every(i => Number.isInteger(i) && i >= 0 && i < lifestyle.length);
    if (!valid) throw new Error('invalid order');
    const images = { ...(product.images || {}), lifestyle: order.map(i => lifestyle[i]) };
    delete images.lifestyleCoverIndex;
    arr[idx] = { ...product, images, updatedAt: new Date().toISOString() };
    try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG reorder lifestyle images: ${sku}`); return { products: arr }; }
    catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

async function removeProductImage(sku, slot, index) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found: ' + sku);
    const product = arr[idx];
    const images = product.images ? { ...product.images, lifestyle: [...(product.images.lifestyle || [])], individuals: [...(product.images.individuals || [])], flats: { ...(product.images.flats || {}) } } : { lifestyle: [], individuals: [], flats: {} };
    if (slot === 'lifestyle') images.lifestyle.splice(index, 1);
    else if (slot === 'individual') images.individuals.splice(index, 1);
    else if (FLAT_SLOTS.includes(slot)) delete images.flats[slot];
    else throw new Error('invalid slot: ' + slot);
    arr[idx] = { ...product, images, updatedAt: new Date().toISOString() };
    try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG remove image: ${sku} (${slot})`); return { products: arr }; }
    catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

// ---- Shared images (3 fixed + 9 room) — uploaded ONCE, reused by every product forever after. ----
const FIXED_IMAGE_FILES = [
  { key: 'frameSizes', path: 'assets/npg-images/fixed/frame-sizes.jpg', alt: 'Frame sizes' },
  { key: 'pictureFrames', path: 'assets/npg-images/fixed/picture-frames.jpg', alt: 'Picture frames' },
  { key: 'canvasWrapped', path: 'assets/npg-images/fixed/canvas-wrapped.webp', alt: 'Canvas wrapped' }
];
// room-13..21 map to the form's room names, confirmed with Mae 2026-09-21. Games room shares Living
// room's image; Laundry room shares Bathroom's image (no separate file for those two).
const ROOM_IMAGE_FILES = {
  'Above Fireplace': 'assets/npg-images/rooms/room-21.jpg',
  'Bathroom': 'assets/npg-images/rooms/room-15.jpg',
  'Bedroom': 'assets/npg-images/rooms/room-14.jpg',
  'Games room': 'assets/npg-images/rooms/room-18.jpg',
  'Hallway': 'assets/npg-images/rooms/room-17.jpg',
  'Kitchen': 'assets/npg-images/rooms/room-13.jpg',
  'Laundry room': 'assets/npg-images/rooms/room-15.jpg',
  'Living room': 'assets/npg-images/rooms/room-18.jpg',
  'Nursery': 'assets/npg-images/rooms/room-19.jpg',
  'Office': 'assets/npg-images/rooms/room-20.jpg',
  'Teens Bedroom': 'assets/npg-images/rooms/room-19.jpg'
};
async function fetchRepoFileAsBase64(path) {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${path}?t=${Date.now()}`);
  if (!r.ok) throw new Error('Could not fetch ' + path + ' from GitHub (status ' + r.status + ') — make sure it was uploaded.');
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}
function mimeFromPath(path) {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}
async function getFixedImages() {
  const r = await ghGet(FIXED_IMAGES_PATH);
  let data = {}; if (r.content) { try { data = JSON.parse(r.content); } catch { data = {}; } }
  return { data, sha: r.sha };
}
async function uploadFixedImages(force) {
  const forceSet = new Set(Array.isArray(force) ? force : []);
  const { data } = await getFixedImages();
  const out = { fixed: { ...(data.fixed || {}) }, rooms: { ...(data.rooms || {}) } };
  const results = [];
  for (const f of FIXED_IMAGE_FILES) {
    if (out.fixed[f.key] && out.fixed[f.key].gid && !forceSet.has(f.key)) { results.push({ key: f.key, status: 'already uploaded' }); continue; }
    try {
      const b64 = await fetchRepoFileAsBase64(f.path);
      const uploaded = await uploadImageToShopify(b64, f.path.split('/').pop(), mimeFromPath(f.path), f.alt);
      out.fixed[f.key] = { gid: uploaded.gid, url: uploaded.url, alt: f.alt };
      results.push({ key: f.key, status: 'uploaded' });
    } catch (e) { results.push({ key: f.key, status: 'error', error: String(e.message || e) }); }
  }
  // path -> record uploaded IN THIS RUN, so shared rooms reuse the FRESH upload, never a stale/old gid
  // (forcing a re-upload of a shared pair like Living room + Games room must not reuse the dead id).
  const uploadedThisRun = {};
  for (const roomName of Object.keys(ROOM_IMAGE_FILES)) {
    const path = ROOM_IMAGE_FILES[roomName];
    if (out.rooms[roomName] && out.rooms[roomName].gid && !forceSet.has(roomName)) { results.push({ key: roomName, status: 'already uploaded' }); continue; }
    // Rooms that SHARE a file (Games room <-> Living room, Laundry room <-> Bathroom) reuse the copy
    // uploaded earlier in THIS run instead of uploading the same image twice.
    if (uploadedThisRun[path]) { out.rooms[roomName] = { ...uploadedThisRun[path] }; results.push({ key: roomName, status: 'reused from this run' }); continue; }
    try {
      const b64 = await fetchRepoFileAsBase64(path);
      const uploaded = await uploadImageToShopify(b64, path.split('/').pop(), mimeFromPath(path), `Wall art size guide — ${roomName}`);
      const rec = { gid: uploaded.gid, url: uploaded.url };
      out.rooms[roomName] = rec;
      uploadedThisRun[path] = rec;
      results.push({ key: roomName, status: 'uploaded' });
    } catch (e) { results.push({ key: roomName, status: 'error', error: String(e.message || e) }); }
  }
  const { sha } = await getFixedImages();
  await ghPut(FIXED_IMAGES_PATH, JSON.stringify(out, null, 2), sha, 'NPG upload fixed/room images');
  return { data: out, results };
}

/* ---------------- resolve-shopify-fields — READ-ONLY preview of everything Send-to-Shopify will write ---------------- */
async function resolveShopifyFields(sku) {
  const products = await readProducts();
  const product = products.find(p => (p.sku || '').toLowerCase() === (sku || '').toLowerCase());
  if (!product) throw new Error('product not found: ' + sku);
  if (!product.keyword) { const e = new Error('This product has no keyword yet.'); e.status = 400; throw e; }
  if (!product.content) { const e = new Error('This product has no generated content yet.'); e.status = 400; throw e; }

  const warnings = [];
  const col = product.collections || {};
  const allTicked = [];
  Object.keys(col).forEach(g => (col[g] || []).forEach(name => allTicked.push({ group: g, name })));

  const megaMenu = await fetchMegaMenu();
  const fallbackByTitle = await fetchAllCollectionsByTitle();

  const collectionsToJoin = [];
  const linkedCollectionGids = [];
  const tagsToAdd = [];
  const unresolvedSmart = [];
  const notFoundCollections = [];
  const resolvedTicked = [];
  allTicked.forEach(({ name }) => {
    // Menu first (authoritative — covers Room/Style/Colour/Occasion + top-level items like "New arrivals").
    // Fallback to an exact title match only for names the menu doesn't have (e.g. "Bestsellers").
    let gid = megaMenu.collectionMap.get(normTitle(name));
    if (!gid) { const f = fallbackByTitle.get(normTitle(name)); if (f) gid = f.id; }
    if (!gid) { notFoundCollections.push(name); return; }
    resolvedTicked.push({ name, gid });
  });
  linkedCollectionGids.push(...resolvedTicked.map(r => r.gid));
  if (resolvedTicked.length) {
    const ruleSets = await fetchRuleSetsByIds(resolvedTicked.map(r => r.gid));
    resolvedTicked.forEach(r => {
      const rs = ruleSets.get(r.gid);
      if (!rs) { notFoundCollections.push(r.name); return; }
      if (rs.isSmart) {
        if (rs.tags && rs.tags.length) tagsToAdd.push(...rs.tags);
        else unresolvedSmart.push({ name: r.name, collectionId: r.gid, title: rs.title, ruleCount: rs.ruleCount });
      } else {
        collectionsToJoin.push({ id: r.gid, title: rs.title });
      }
    });
  }
  if (product.set) tagsToAdd.push(product.set);

  let linkedTrendGids = [], linkedBlogGids = [];
  const trendsList = product.trends || [];
  if (trendsList.length) {
    trendsList.forEach(t => { const gid = megaMenu.trendMap.get(normTitle(t)); if (gid) linkedTrendGids.push(gid); else warnings.push('Trend page not found in menu: ' + t); });
    const blogIdx = await readBlogIndex();
    const trendRoots = trendsList.map(t => t.toLowerCase().replace(/\b(decor|design|style)\b/g, '').trim()).filter(Boolean);
    const matches = blogIdx.articles.filter(a => trendRoots.some(root => (a.tags || []).some(tag => tag.toLowerCase().includes(root)) || (a.title || '').toLowerCase().includes(root)));
    linkedBlogGids = matches.slice(0, 10).map(a => a.gid);
  }

  const complementaryGids = await resolveComplementaryProducts();
  if (complementaryGids.length < COMPLEMENTARY_HANDLES.length) warnings.push('Could not find one or both complementary products (black/white picture frame mount) in the store.');
  const related = await resolveRelatedProducts(product, megaMenu, fallbackByTitle);
  if (related.reason) warnings.push('Related products: ' + related.reason);

  // Sales count must look believable — Mae's rule (2026-09-22): last-24h stays small (5-15), total
  // sales is always at least double that, so it never reads as "37 of 38 sold today".
  const sales24 = randInt(5, 15);
  const salesCount = randInt(sales24 * 2, 150);
  const foxkit = randInt(2, 12);

  const metafields = [];
  const push = (namespace, key, type, value) => { if (value != null && value !== '' && !(Array.isArray(value) && !value.length)) metafields.push({ namespace, key, type, value }); };
  push('global', 'title_tag', 'single_line_text_field', product.content.seoTitle);
  push('global', 'description_tag', 'single_line_text_field', product.content.metaDescription);
  (product.content.aiItems || []).forEach(it => { if (it.metafieldKey && it.content) push('custom', it.metafieldKey, 'rich_text_field', htmlToRichText(it.content)); });
  if (linkedTrendGids.length) push('custom', 'linked_trends', 'list.page_reference', JSON.stringify(linkedTrendGids));
  if (linkedBlogGids.length) push('custom', 'linked_blogs', 'list.article_reference', JSON.stringify(linkedBlogGids));
  if (linkedCollectionGids.length) push('custom', 'linked_collections', 'list.collection_reference', JSON.stringify(linkedCollectionGids));
  if ((product.primaryColour || []).length) push('custom', 'primary_colour', 'list.single_line_text_field', JSON.stringify(product.primaryColour));
  if (product.colour) push('custom', 'colour', 'single_line_text_field', product.colour);
  if ((col['By Room'] || []).length) push('custom', 'room_type', 'list.single_line_text_field', JSON.stringify(col['By Room']));
  push('custom', 'foxkit_stock', 'number_integer', String(foxkit));
  push('custom', 'sales_last_24_hs', 'number_integer', String(sales24));
  push('custom', 'sales_count', 'number_integer', String(salesCount));
  push('custom', 'lead_time', 'number_integer', '2');
  if (product.sku) push('custom', 'sku_for_print_files', 'single_line_text_field', product.sku);
  if (complementaryGids.length) push('shopify--discovery--product_recommendation', 'complementary_products', 'list.product_reference', JSON.stringify(complementaryGids));
  if (related.gids.length) push('shopify--discovery--product_recommendation', 'related_products', 'list.product_reference', JSON.stringify(related.gids));

  return {
    sku: product.sku, metafields, tagsToAdd: [...new Set(tagsToAdd)], collectionsToJoin,
    unresolvedSmart, notFoundCollections, relatedMainCollection: related.mainName || null, warnings,
    debug: { sales24, salesCount, foxkit }
  };
}

/* ---------------- SEND TO SHOPIFY (Send-to-Shopify Batch 3 — create the product) ---------------- */
// Price tables read LIVE from one real product per set size, 2026-09-22 (Alexandrite=Set1,
// "Bathroom wall pictures"=Set2, "Bathroom pictures"=Set3 — see npg-send-to-shopify-spec-2026-09-21.md).
// Set 2's canvas A3(12x16)/A2(16x22) prices are NOT a typo — verified identical on 2 independent live
// Set-of-2 products: the smaller (12x16) canvas genuinely costs more than the bigger (16x22) one on
// this store. Kept as-is on purpose.
const PRICE_TABLES = {
  1: {
    UN: { A4: 19, A3: 25, A2_SP: 52, A2_MQ: 66, A1_SP: 62, A1_MQ: 82 },
    FB: { A4: 33, A3: 43, A2_SP: 110, A2_MQ: 132, A1_SP: 129, A1_MQ: 159 },
    FW: { A4: 33, A3: 43, A2_SP: 110, A2_MQ: 129, A1_SP: 129, A1_MQ: 149 },
    FO: { A4: 33, A3: 43, A2_SP: 110, A2_MQ: 129, A1_SP: 129, A1_MQ: 149 },
    CW: { A1: 129, A3: 43, A2: 110 }
  },
  2: {
    UN: { A4: 20, A3: 29, A2_SP: 62, A2_MQ: 82, A1_SP: 72, A1_MQ: 92 },
    FB: { A4: 45, A3: 65, A2_SP: 149, A2_MQ: 169, A1_SP: 159, A1_MQ: 179 },
    FW: { A4: 45, A3: 65, A2_SP: 149, A2_MQ: 169, A1_SP: 159, A1_MQ: 179 },
    FO: { A4: 45, A3: 65, A2_SP: 149, A2_MQ: 159, A1_SP: 159, A1_MQ: 179 },
    CW: { A1: 159, A3: 149, A2: 65 }
  },
  3: {
    UN: { A4: 26, A3: 35, A2_SP: 72, A2_MQ: 92, A1_SP: 82, A1_MQ: 102 },
    FB: { A4: 57, A3: 87, A2_SP: 179, A2_MQ: 199, A1_SP: 199, A1_MQ: 219 },
    FW: { A4: 57, A3: 87, A2_SP: 179, A2_MQ: 199, A1_SP: 199, A1_MQ: 219 },
    FO: { A4: 57, A3: 87, A2_SP: 179, A2_MQ: 199, A1_SP: 199, A1_MQ: 219 },
    CW: { A1: 199, A3: 87, A2: 179 }
  }
};
const SIZE_LABEL = { A4: 'A4 8.27 x 11.69 in / 21 x 29.7 cm', A3: 'A3 11.69 x 16.54 in / 29.7 x 42 cm', A2: 'A2 16.54 x 23.39 in / 42 x 59.4 cm', A1: '20 x 30 in / 50 x 76 cm' };
const CANVAS_SIZE_LABEL = { A1: '20 x 30 in / 50 x 76 cm', A3: '12 x 16 inches / 30.5 x 40.65 cm', A2: '16 x 22 inches / 40.65 cm x 56 cm' };
const FRAME_LABEL = { UN: 'Unframed', FB: 'Black Frame', FW: 'White Frame', FO: 'Oak Frame', CW: 'Canvas wrapped' };
const PAPER_LABEL = { SP: 'Satin Photo paper 280 gsm', MQ: 'Matte museum Quality Art Paper 290 gsm', CANVAS: 'Polyester Canvas 260 gsm' };
const PRODUCT_CATEGORY_GID = 'gid://shopify/TaxonomyCategory/hg-3-4-2-2';
const STORE_LOCATION_GID = 'gid://shopify/Location/76881428766'; // "Bluecoats Court" — the store's only location

// SKU ending pattern confirmed live on real variants: "ALEXANDRITE1- A4UN SP" / "ALEXANDRITE1- A1CW"
// — no space before the dash (the spec doc said "space-dash-space"; the real data doesn't have it).
function buildVariantMatrix(skuRoot, priceTable, flatFileGids) {
  const variants = [];
  for (const frameCode of ['UN', 'FB', 'FW', 'FO']) {
    const p = priceTable[frameCode];
    const fileRef = flatFileGids[frameCode] ? { id: flatFileGids[frameCode] } : undefined;
    const rows = [['A4', 'SP', p.A4], ['A3', 'SP', p.A3], ['A2', 'SP', p.A2_SP], ['A2', 'MQ', p.A2_MQ], ['A1', 'SP', p.A1_SP], ['A1', 'MQ', p.A1_MQ]];
    for (const [sizeCode, paperCode, price] of rows) {
      variants.push({
        optionValues: [{ optionName: 'Frame', name: FRAME_LABEL[frameCode] }, { optionName: 'Size', name: SIZE_LABEL[sizeCode] }, { optionName: 'Paper', name: PAPER_LABEL[paperCode] }],
        price: String(price), sku: `${skuRoot}- ${sizeCode}${frameCode} ${paperCode}`,
        inventoryQuantities: [{ locationId: STORE_LOCATION_GID, name: 'available', quantity: 100 }],
        ...(fileRef ? { file: fileRef } : {})
      });
    }
  }
  const cw = priceTable.CW;
  const cwFile = flatFileGids.CW ? { id: flatFileGids.CW } : undefined;
  for (const [sizeCode, price] of [['A1', cw.A1], ['A3', cw.A3], ['A2', cw.A2]]) {
    variants.push({
      optionValues: [{ optionName: 'Frame', name: 'Canvas wrapped' }, { optionName: 'Size', name: CANVAS_SIZE_LABEL[sizeCode] }, { optionName: 'Paper', name: PAPER_LABEL.CANVAS }],
      price: String(price), sku: `${skuRoot}- ${sizeCode}CW`,
      inventoryQuantities: [{ locationId: STORE_LOCATION_GID, name: 'available', quantity: 100 }],
      ...(cwFile ? { file: cwFile } : {})
    });
  }
  return variants;
}
async function fetchAllPublicationIds() {
  const data = await shopifyGQL(`query{ publications(first:50){ nodes{ id } } }`);
  return (data.publications.nodes || []).map(n => n.id);
}
async function sendToShopify(sku) {
  if (!sku) throw new Error('sku required');
  const products = await readProducts();
  const product = products.find(p => (p.sku || '').toLowerCase() === sku.toLowerCase());
  if (!product) throw new Error('product not found: ' + sku);
  if (product.sent) { const e = new Error('This product was already sent to Shopify.'); e.status = 400; throw e; }
  if (!product.keyword) { const e = new Error('This product has no keyword yet.'); e.status = 400; throw e; }
  if (!product.content) { const e = new Error('This product has no generated content yet.'); e.status = 400; throw e; }

  const setMatch = (product.set || '').match(/\d+/);
  const setSize = setMatch ? parseInt(setMatch[0], 10) : 1;
  if (!PRICE_TABLES[setSize]) { const e = new Error('No price table for "' + product.set + '" — only Set of 1/2/3 are supported.'); e.status = 400; throw e; }

  const img = product.images || { lifestyle: [], individuals: [], flats: {} };
  const missing = [];
  if (!(img.lifestyle || []).length) missing.push('at least 1 lifestyle photo');
  if ((img.individuals || []).length !== setSize) missing.push(`${setSize} individual photo(s) (has ${(img.individuals || []).length})`);
  FLAT_SLOTS.forEach(slot => { if (!img.flats || !img.flats[slot]) missing.push('flat image: ' + slot.replace('flat', '')); });
  if (missing.length) { const e = new Error('Missing before sending — ' + missing.join(', ') + '.'); e.status = 400; throw e; }

  const col = product.collections || {};
  const rooms = col['By Room'] || [];
  if (rooms.length !== 1) { const e = new Error(rooms.length === 0 ? 'Tick a Room collection before sending (needed for the size-guide image).' : 'More than one Room ticked — untick down to just one before sending.'); e.status = 400; throw e; }
  const roomName = rooms[0];
  if (!ROOM_IMAGE_FILES[roomName]) { const e = new Error('No size-guide image mapped for room: ' + roomName); e.status = 400; throw e; }

  const { data: fixedData } = await getFixedImages();
  const roomGidEntry = fixedData.rooms && fixedData.rooms[roomName];
  const f = fixedData.fixed || {};
  const fixedOk = f.frameSizes && f.frameSizes.url && f.pictureFrames && f.pictureFrames.url && f.canvasWrapped && f.canvasWrapped.url;
  if (!roomGidEntry || !roomGidEntry.url || !fixedOk) { const e = new Error('Shared images not uploaded yet — click "Check / upload shared images" first.'); e.status = 400; throw e; }

  const resolved = await resolveShopifyFields(sku);
  if (resolved.unresolvedSmart.length || resolved.notFoundCollections.length) {
    const parts = [];
    if (resolved.unresolvedSmart.length) parts.push('collections needing a manual check: ' + resolved.unresolvedSmart.map(u => u.name).join(', '));
    if (resolved.notFoundCollections.length) parts.push('collections not found: ' + resolved.notFoundCollections.join(', '));
    const e = new Error('Fix before sending — ' + parts.join('; ') + '.'); e.status = 400; throw e;
  }

  const flatFileGids = {
    UN: img.flats.flatUnframed.gid, FB: img.flats.flatBlack.gid, FW: img.flats.flatWhite.gid,
    FO: img.flats.flatOak.gid, CW: img.flats.flatCanvas.gid
  };
  const variants = buildVariantMatrix(product.sku, PRICE_TABLES[setSize], flatFileGids);

  // Gallery order, confirmed with Mae 2026-09-22 (corrected same day after checking a live test
  // product): Lifestyle (cover=first) -> Individuals -> Flats (Unframed/White/Oak/Black) ->
  // Canvas-wrapped FLAT -> Canvas-wrapped FIXED -> Room size -> Picture-frames FIXED -> Frame-sizes FIXED.
  //
  // Product-OWN images (lifestyle/individuals/flats) are passed by { id } — they belong to this product.
  // SHARED images (the 3 fixed + the room size guide) are passed by { originalSource: url } so Shopify
  // makes a COPY for each product. Passing them by { id } would MOVE the one shared file into this
  // product, and deleting any product would then delete the shared file for everyone (this is exactly
  // the "Media ids ... do not exist" bug hit on 2026-09-22). Copying keeps the originals in Files intact.
  const files = [];
  (img.lifestyle || []).forEach(im => files.push({ id: im.gid }));
  (img.individuals || []).forEach(im => files.push({ id: im.gid }));
  ['flatUnframed', 'flatWhite', 'flatOak', 'flatBlack'].forEach(slot => files.push({ id: img.flats[slot].gid }));
  files.push({ id: img.flats.flatCanvas.gid });
  files.push({ originalSource: fixedData.fixed.canvasWrapped.url, alt: fixedData.fixed.canvasWrapped.alt || 'Canvas wrapped' });
  files.push({ originalSource: roomGidEntry.url, alt: `Wall art size guide — ${roomName}` });
  files.push({ originalSource: fixedData.fixed.pictureFrames.url, alt: fixedData.fixed.pictureFrames.alt || 'Picture frames' });
  files.push({ originalSource: fixedData.fixed.frameSizes.url, alt: fixedData.fixed.frameSizes.alt || 'Frame sizes' });

  // global.title_tag/description_tag are set via the dedicated `seo` field below instead of as raw
  // metafields (same underlying value — resolveShopifyFields still returns them for the debug preview).
  const metafields = resolved.metafields.filter(m => !(m.namespace === 'global' && (m.key === 'title_tag' || m.key === 'description_tag')));

  const input = {
    title: product.content.productTitle,
    descriptionHtml: product.content.productDescription,
    vendor: 'About Wall Art',
    productType: 'Wall art Prints',
    templateSuffix: 'wall-decor',
    category: PRODUCT_CATEGORY_GID,
    status: 'DRAFT',
    seo: { title: product.content.seoTitle, description: product.content.metaDescription },
    tags: resolved.tagsToAdd,
    collections: resolved.collectionsToJoin.map(c => c.id),
    metafields,
    files,
    productOptions: [
      { name: 'Frame', position: 1, values: ['Unframed', 'Black Frame', 'White Frame', 'Oak Frame', 'Canvas wrapped'].map(name => ({ name })) },
      { name: 'Size', position: 2, values: [SIZE_LABEL.A4, SIZE_LABEL.A3, SIZE_LABEL.A2, SIZE_LABEL.A1, CANVAS_SIZE_LABEL.A3, CANVAS_SIZE_LABEL.A2].map(name => ({ name })) },
      { name: 'Paper', position: 3, values: [PAPER_LABEL.SP, PAPER_LABEL.MQ, PAPER_LABEL.CANVAS].map(name => ({ name })) }
    ],
    variants
  };

  const result = await shopifyGQL(
    `mutation($input: ProductSetInput!){ productSet(input:$input, synchronous:true){ product{ id handle onlineStoreUrl } userErrors{ field message } } }`,
    { input }
  );
  const ue = result.productSet.userErrors || [];
  if (ue.length) { const e = new Error(ue.map(u => u.message).join('; ')); e.status = 502; throw e; }
  const created = result.productSet.product;

  const warnings = [...resolved.warnings];
  try {
    const pubIds = await fetchAllPublicationIds();
    if (pubIds.length) {
      const pubResult = await shopifyGQL(
        `mutation($id:ID!, $input:[PublicationInput!]!){ publishablePublish(id:$id, input:$input){ userErrors{ field message } } }`,
        { id: created.id, input: pubIds.map(id => ({ publicationId: id })) }
      );
      const pue = pubResult.publishablePublish.userErrors || [];
      if (pue.length) warnings.push('Publish warning: ' + pue.map(u => u.message).join('; '));
    }
  } catch (e) { warnings.push('Could not publish to channels: ' + String(e.message || e)); }

  // Mandatory: lock the keyword in the registry the moment the product is live, so it can never be
  // offered again for another product. If this fails, the product is still created — surface a warning
  // rather than losing the created product.
  const productUrl = `https://aboutwallart.com/products/${created.handle}`;
  try { await lockKeywordInRegistry(product.keyword, product.sku, productUrl); }
  catch (e) { warnings.push('Keyword NOT locked in the registry — add it by hand. Reason: ' + String(e.message || e)); }

  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await ghGet(PRODUCTS_PATH);
    let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
    if (idx < 0) throw new Error('product not found on save: ' + sku);
    arr[idx] = { ...arr[idx], sent: true, shopifyProductId: created.id, shopifyHandle: created.handle, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    try {
      await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG sent to Shopify: ${sku}`);
      return { sku, shopifyProductId: created.id, shopifyHandle: created.handle, onlineStoreUrl: created.onlineStoreUrl || null, warnings, products: arr };
    } catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
  }
  throw new Error('write conflict, try again');
}

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = body.action || 'research';

    if (action === 'gap-research') {
      const out = await gapResearch(body);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'set-keyword') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const out = await setKeyword(body.sku, body.keyword);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'generate-content') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });
      const out = await generateContent(body);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'upload-image') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });
      const out = await uploadProductImage(body);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'reorder-lifestyle-images') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const out = await reorderLifestyleImages(body.sku, Array.isArray(body.order) ? body.order.map(Number) : []);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'remove-product-image') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const out = await removeProductImage(body.sku, body.slot, Number(body.index) || 0);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'get-fixed-images') {
      const out = await getFixedImages();
      return res.status(200).json({ ok: true, images: out.data });
    }

    if (action === 'upload-fixed-images') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });
      const out = await uploadFixedImages(body.force);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'resolve-shopify-fields') {
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });
      const out = await resolveShopifyFields(body.sku);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'send-to-shopify') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });
      const out = await sendToShopify(body.sku);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'research') {
      if (!process.env.APIFY_TOKEN) return res.status(500).json({ ok: false, error: 'APIFY_TOKEN not set' });
      const out = await research(body);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'raw') {
      if (!process.env.APIFY_TOKEN) return res.status(500).json({ ok: false, error: 'APIFY_TOKEN not set' });
      const items = await callActor(body.input || {}, body.actor);
      return res.status(200).json({ ok: true, count: items.length, items });
    }

    if (action === 'list-products') {
      const products = await readProducts();
      return res.status(200).json({ ok: true, products });
    }

    if (action === 'save-product') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const product = body.product;
      if (!product || !product.sku) return res.status(400).json({ ok: false, error: 'product.sku required' });
      for (let attempt = 0; attempt < 2; attempt++) {
        const file = await ghGet(PRODUCTS_PATH);
        let arr = [];
        if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
        if (!Array.isArray(arr)) arr = [];
        const now = new Date().toISOString();
        const idx = arr.findIndex(x => (x.sku || '').toLowerCase() === product.sku.toLowerCase());
        if (idx >= 0) arr[idx] = { ...arr[idx], ...product, updatedAt: now };
        else arr.push({ ...product, sent: false, createdAt: now, updatedAt: now });
        try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG save product: ${product.sku}`); return res.status(200).json({ ok: true, products: arr }); }
        catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
      }
    }

    if (action === 'delete-product') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const sku = body.sku;
      if (!sku) return res.status(400).json({ ok: false, error: 'sku required' });
      for (let attempt = 0; attempt < 2; attempt++) {
        const file = await ghGet(PRODUCTS_PATH);
        let arr = []; if (file.content) { try { arr = JSON.parse(file.content); } catch { arr = []; } }
        arr = arr.filter(x => (x.sku || '').toLowerCase() !== sku.toLowerCase());
        try { await ghPut(PRODUCTS_PATH, JSON.stringify(arr, null, 2), file.sha, `NPG delete product: ${sku}`); return res.status(200).json({ ok: true, products: arr }); }
        catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
      }
    }

    if (action === 'reserve-keyword') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const out = await reserveKeyword(body.keyword, body.sku);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'list-collections') {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/npg-collections.json?t=${Date.now()}`);
        const custom = r.ok ? await r.json() : {};
        return res.status(200).json({ ok: true, custom: (custom && typeof custom === 'object') ? custom : {} });
      } catch { return res.status(200).json({ ok: true, custom: {} }); }
    }

    if (action === 'save-collections') {
      if (!process.env.GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set' });
      const custom = body.custom || {};
      for (let attempt = 0; attempt < 2; attempt++) {
        const file = await ghGet('data/npg-collections.json');
        try { await ghPut('data/npg-collections.json', JSON.stringify(custom, null, 2), file.sha, 'NPG save collections'); return res.status(200).json({ ok: true, custom }); }
        catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
      }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error', message: String(err && err.message || err) });
  }
}
