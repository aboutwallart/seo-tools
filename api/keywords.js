// api/keywords.js — New Product Generator backend  ·  v0.8
// Actions (POST { action, ... }):
//   gap-research    -> { products:[{sku, collections, set, trends, primaryColour, colour, keywordWords}] }
//                       returns { results:[{ sku, options:[{keyword, volume, difficulty, difficultyRaw}] }] }
//                       (reads data/competitors-gap.csv — no Apify cost)
//   set-keyword     -> { sku, keyword }      validates (not locked, not used by another in-progress product) + saves onto product
//   research        -> { products:[{sku, collections, set, trends, primaryColour, colour}], locationCode?, languageCode? }  [PARKED — Apify, use sparingly]
//                       returns { results:[{ sku, options:[{keyword, volume, difficulty, intent}] }] }
//   list-products   -> {}                    returns { products:[...] }
//   save-product    -> { product }           upserts by sku into data/npg-products.json
//   delete-product  -> { sku }               removes from data/npg-products.json
//   reserve-keyword -> { keyword, sku }       locks a reservation row in the keyword registry (url = N/A, intent COMMERCIAL) — used at Send-to-Shopify time
//   raw             -> { input }             (debug) runs the actor with a raw input, returns dataset items
// Env: APIFY_TOKEN, GITHUB_TOKEN

const REPO = 'aboutwallart/seo-tools';
const PRODUCTS_PATH = 'data/npg-products.json';
const REGISTRY_PATH = 'data/keyword-locker-registry.csv';
const GAP_PATH = 'data/competitors-gap.csv';
const ACTOR = 'santhej~dataforseo-labs-keyword-explorer';
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
