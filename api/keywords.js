// api/keywords.js — New Product Generator backend  ·  v0.2
// Actions (POST { action, ... }):
//   research        -> { products:[{sku, collections, set, trends, primaryColour, colour}], locationCode?, languageCode? }
//                       returns { results:[{ sku, options:[{keyword, volume, difficulty, intent}] }] }
//   list-products   -> {}                    returns { products:[...] }
//   save-product    -> { product }           upserts by sku into data/npg-products.json
//   delete-product  -> { sku }               removes from data/npg-products.json
//   reserve-keyword -> { keyword, sku }       locks a reservation row in the keyword registry (url = N/A, intent COMMERCIAL)
//   raw             -> { input }             (debug) runs the actor with a raw input, returns dataset items
// Env: APIFY_TOKEN, GITHUB_TOKEN

const REPO = 'aboutwallart/seo-tools';
const PRODUCTS_PATH = 'data/npg-products.json';
const REGISTRY_PATH = 'data/keyword-locker-registry.csv';
const ACTOR = 'santhej~dataforseo-labs-keyword-explorer';
const CATEGORY_SYNONYMS = ['wall art', 'art print', 'wall decor', 'wall hanging', 'canvas wall art', 'framed wall art', 'poster', 'wall pictures'];
const MIN_VOLUME = 10;
const MAX_SEEDS_PER_PRODUCT = 8;
const MAX_DIFF_CANDIDATES_PER_PRODUCT = 15;
const MAX_OPTIONS_PER_PRODUCT = 10;

/* ---------------- Apify ---------------- */
async function callActor(input) {
  const token = process.env.APIFY_TOKEN;
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
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

/* ---------------- seeds ---------------- */
function buildSeeds(p) {
  const col = p.collections || {};
  const styles = col['By Style'] || [];
  const rooms = col['By Room'] || [];
  const colours = [...(p.primaryColour || []), ...(p.colour ? [p.colour] : []), ...(col['By Colour'] || [])];
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

  // 3) build per-product candidate map { keyword -> {volume, intent} }
  const candByProduct = products.map(() => new Map());
  sugg.forEach(res => {
    if (!res || res.__error || !res.items) return;
    const pis = seedToProducts.get(res.seed) || new Set();
    res.items.forEach(it => {
      const kw = (it.keyword || '').toLowerCase().trim();
      if (!kw) return;
      const vol = (it.search_volume == null ? 0 : it.search_volume);
      const intent = it.search_intent || null;
      pis.forEach(pi => {
        const m = candByProduct[pi];
        const prev = m.get(kw);
        if (!prev || vol > prev.volume) m.set(kw, { volume: vol, intent });
      });
    });
  });

  // 4) exclude locked + low volume; pick top-by-volume candidates for difficulty
  const locked = await lockedKeywordSet();
  const diffNeeded = new Set();
  const shortlists = candByProduct.map(m => {
    const arr = [...m.entries()]
      .filter(([kw, d]) => !locked.has(kw) && d.volume >= MIN_VOLUME)
      .map(([kw, d]) => ({ keyword: kw, volume: d.volume, intent: d.intent }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_DIFF_CANDIDATES_PER_PRODUCT);
    arr.forEach(c => diffNeeded.add(c.keyword));
    return arr;
  });

  // 5) difficulty for all shortlisted keywords (batched, up to 1000 per call)
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

  // 6) score + rank + top options
  const commercial = i => i === 'commercial' || i === 'transactional';
  const results = products.map((p, pi) => {
    const options = shortlists[pi].map(c => {
      const difficulty = diffMap.has(c.keyword) ? diffMap.get(c.keyword) : null;
      const diffFactor = difficulty == null ? 0.7 : (100 - difficulty) / 100;
      const intentFactor = commercial(c.intent) ? 1.3 : 1;
      const score = c.volume * diffFactor * intentFactor;
      return { keyword: c.keyword, volume: c.volume, difficulty, intent: c.intent, score };
    }).sort((a, b) => b.score - a.score).slice(0, MAX_OPTIONS_PER_PRODUCT)
      .map(({ score, ...rest }) => rest);
    return { sku: p.sku || '', options };
  });
  return { results };
}

/* ---------------- reserve keyword ---------------- */
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

    if (action === 'research') {
      if (!process.env.APIFY_TOKEN) return res.status(500).json({ ok: false, error: 'APIFY_TOKEN not set' });
      const out = await research(body);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'raw') {
      if (!process.env.APIFY_TOKEN) return res.status(500).json({ ok: false, error: 'APIFY_TOKEN not set' });
      const items = await callActor(body.input || {});
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
