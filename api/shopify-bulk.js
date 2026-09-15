// shopify-bulk.js — v2.2 (15 Sep 2026)
// v2.2: (1) shopify() now respects Shopify's rate limit — on THROTTLED / 429 it waits and
//       retries, and it paces itself when the cost budget runs low. (2) Tab 2 backup is now
//       PER FIELD: 'backup-field?field=X' snapshots just that one field across the whole store
//       (weight = About Wall Art only), 'last-field-backup?field=X' checks it. You back up a
//       field once, then edit it as many times as you like.
// v2.1: backup was per tab (a single combined 'backup-fields' — replaced by per-field in v2.2).
// v2.0: NEW FIELDS beyond price (Tab 2 "Other fields"). Everything from v1.x (prices +
//       backup gate + per-supplier undo) is UNCHANGED. Added, each with a full snapshot +
//       one-click undo saved to GitHub before writing:
//         - TAGS        : add / remove / replace-one. Two groups: COLLECTION tags (read live
//                         from smart collections; a product must always keep >=1) + SECONDARY
//                         cluster tags (data/cluster-tags.json).
//         - PRODUCT TYPE: assign (only products with no type) or replace (only products that
//                         already have one). One value, from the store's existing product types.
//         - WEIGHT      : About Wall Art vendor only. Groups = Unframed / Framed / Canvas x size.
//                         Paper does not affect weight. Set via inventoryItemUpdate (measurement).
//         - UNIT PRICE  : Able Bulk-style variant price editor (+ optional Compare-at edit).
//         - COLLECTIONS : add / remove / replace, MANUAL collections only (via collectionsToJoin/Leave).
//         - CATEGORY    : assign or replace. One value from Shopify's standard taxonomy.
//       New generic actions: field-meta (product-types + collection tags + manual collections +
//       cluster tags), category-search, preview-field, apply-field, field-undo-list, field-undo.
// ---- v1.x history (prices) ----
// v1.4: apply records the supplier(s) on each undo entry (vendors[]) for per-supplier undo.
// v1.3: status filter accepts MANY statuses; 'lastchange' map; apply takes explicit ticked items.
// v1.2: backup-all also writes data/price-backup-latest.json; 'last-backup' returns it.
// v1.1: 'backup-all' saves every product's prices to GitHub as a full-store restore point.
// Backend for the "Shopify Bulk Editor" tool. Reuses the Shopify + GitHub tokens in Vercel. No local storage.

const REPO = 'aboutwallart/seo-tools';
const API_VERSION = '2025-01';
const UNDO_INDEX = 'data/bulk-price-undos.json';       // price undo list
const UNDO_DIR = 'data/bulk-price-undo';                // price undo snapshots
const FIELD_UNDO_INDEX = 'data/bulk-field-undos.json';  // other-fields undo list
const FIELD_UNDO_DIR = 'data/bulk-field-undo';          // other-fields undo snapshots
const CLUSTER_TAGS_PATH = 'data/cluster-tags.json';
const AWA_VENDOR = 'About Wall Art';                    // weight is restricted to this vendor

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!shopifyDomain || !accessToken) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });

  const gqlUrl = `https://${shopifyDomain}/admin/api/${API_VERSION}/graphql.json`;

  const sleep = ms => new Promise(s => setTimeout(s, ms));
  async function shopify(query, variables) {
    for (let attempt = 0; attempt < 8; attempt++) {
      let r, d;
      try {
        r = await fetch(gqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query, variables })
        });
        d = await r.json();
      } catch (e) {
        if (attempt < 7) { await sleep(1500 * (attempt + 1)); continue; }
        throw e;
      }
      const throttled = (r.status === 429) ||
        (d && Array.isArray(d.errors) && d.errors.some(e =>
          (e.extensions && e.extensions.code === 'THROTTLED') || /throttl/i.test(e.message || '')));
      if (throttled && attempt < 7) { await sleep(2500 * (attempt + 1)); continue; }
      if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
      // pace: if the cost bucket is running low, wait a beat so the next call doesn't get throttled
      const cost = d.extensions && d.extensions.cost;
      if (cost && cost.throttleStatus && cost.throttleStatus.currentlyAvailable != null && cost.throttleStatus.currentlyAvailable < 300) {
        await sleep(1200);
      }
      return d.data;
    }
    throw new Error('Shopify request failed after retries (throttled)');
  }

  // ---------- GitHub helpers (missing file = empty; write retries on hiccups) ----------
  async function ghGet(path) {
    if (!GITHUB_TOKEN) return { json: null, sha: null };
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return { json: null, sha: null };
    const d = await r.json();
    let json = null;
    try { json = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) { json = null; }
    return { json, sha: d.sha };
  }
  async function ghPut(path, obj, message) {
    if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await ghGet(path);
      const body = {
        message: message || `bulk-editor ${path}`,
        content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64')
      };
      if (cur.sha) body.sha = cur.sha;
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.ok) return true;
      if (![409, 422, 500, 502, 503, 504].includes(r.status)) {
        throw new Error('GitHub save failed: ' + r.status + ' ' + (await r.text()));
      }
      await new Promise(s => setTimeout(s, 400 * (attempt + 1)));
    }
    throw new Error('GitHub save failed after retries');
  }

  // ---------- price maths (Tab 1) ----------
  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function applyRounding(x, rounding) {
    if (rounding === 'up_99') {
      let base = Math.ceil(x) - 0.01;
      if (base < x - 1e-9) base = Math.ceil(x) + 0.99;
      return round2(base);
    }
    if (rounding === 'up_95') {
      let base = Math.ceil(x) - 0.05;
      if (base < x - 1e-9) base = Math.ceil(x) + 0.95;
      return round2(base);
    }
    if (rounding === 'whole') return Math.round(x);
    return round2(x);
  }
  function computeNew(price, cost, change) {
    const p = parseFloat(price);
    const c = (cost === null || cost === undefined || cost === '') ? null : parseFloat(cost);
    const val = parseFloat(change.value);
    const rounding = change.rounding || 'none';
    let target = null;
    const needCost = ['markup_cost', 'floor_cost'].includes(change.mode);
    if (needCost && (c === null || isNaN(c) || c <= 0)) return { newPrice: null, changed: false, noCost: true };
    switch (change.mode) {
      case 'markup_cost': target = c * (1 + val / 100); break;
      case 'floor_cost':  target = Math.max(p, c * (1 + val / 100)); break;
      case 'inc_pct':     target = p * (1 + val / 100); break;
      case 'dec_pct':     target = p * (1 - val / 100); break;
      case 'inc_amt':     target = p + val; break;
      case 'dec_amt':     target = p - val; break;
      case 'set':         target = val; break;
      default: return { newPrice: null, changed: false };
    }
    if (target === null || isNaN(target)) return { newPrice: null, changed: false };
    if (target < 0) target = 0;
    let out = applyRounding(target, rounding);
    if (needCost) {
      const floorTarget = c * (1 + val / 100);
      if (out < floorTarget - 1e-9) out = applyRounding(floorTarget, rounding === 'none' ? 'up_99' : rounding);
      if (out < floorTarget - 1e-9) out = round2(floorTarget);
    }
    const changed = Math.abs(out - p) > 1e-9;
    return { newPrice: out, changed };
  }

  // ---------- unit-price maths (Tab 2) — Able Bulk-style ----------
  function roundUnit(x, r) {
    if (r === 'p50') return Math.round(x * 2) / 2;   // nearest 0.50
    if (r === 'p00') return Math.round(x);            // nearest whole
    return round2(x);
  }
  // base = the number we are editing (price or compare-at); refs carry price/cost/compareAt.
  function computeMoney(base, refs, how, value) {
    const v = parseFloat(value);
    const price = refs.price != null ? parseFloat(refs.price) : null;
    const cost = refs.cost != null && refs.cost !== '' ? parseFloat(refs.cost) : null;
    const cmp = refs.compareAt != null && refs.compareAt !== '' ? parseFloat(refs.compareAt) : null;
    const b = base != null && base !== '' ? parseFloat(base) : null;
    if (isNaN(v)) return null;
    switch (how) {
      case 'dec_pct':          return b == null ? null : b * (1 - v / 100);
      case 'inc_pct':          return b == null ? null : b * (1 + v / 100);
      case 'change_pct':       return b == null ? null : b * (1 + v / 100);
      case 'change_amt':       return b == null ? null : b + v;
      case 'set_fixed':        return v;
      case 'set_pct_price':    return price == null ? null : price * v / 100;
      case 'set_pct_cost':     return cost == null ? null : cost * v / 100;
      case 'set_pct_compare':  return cmp == null ? null : cmp * v / 100;
      case 'cost_plus_amt':    return cost == null ? null : cost + v;
      case 'clear':            return null; // used only for compare-at "remove"
      default: return null;
    }
  }

  // ---------- weight grouping (Tab 2) ----------
  function frameKey(v) {
    if (!v) return null;
    if (/unframed/i.test(v)) return 'unframed';
    if (/canvas/i.test(v)) return 'canvas';
    return 'framed'; // Black / White / Oak all weigh the same
  }
  function sizeKey(v) {
    if (!v) return null;
    if (/^A4/i.test(v)) return 'A4';
    if (/^A3/i.test(v)) return 'A3';
    if (/^A2/i.test(v)) return 'A2';
    if (/20\s*x\s*30/i.test(v)) return '20x30';
    if (/12\s*x\s*16/i.test(v)) return '12x16';
    if (/16\s*x\s*22/i.test(v)) return '16x22';
    return null;
  }
  function weightGroupOf(selectedOptions) {
    let frameV = '', sizeV = '';
    (selectedOptions || []).forEach(o => {
      if (o.name === 'Frame') frameV = o.value;
      if (o.name === 'Size') sizeV = o.value;
    });
    const f = frameKey(frameV), s = sizeKey(sizeV);
    if (!f || !s) return null;
    return f + '|' + s;
  }

  // ---------- product search query (Tab 1 + Tab 2) ----------
  function buildQuery(filters) {
    filters = filters || {};
    const parts = [];
    const esc = s => `'${String(s).replace(/'/g, "\\'")}'`;
    if (filters.vendor) parts.push(`vendor:${esc(filters.vendor)}`);
    const statuses = Array.isArray(filters.statuses) ? filters.statuses.filter(Boolean)
                     : (filters.status ? [filters.status] : []);
    if (statuses.length === 1) parts.push(`status:${statuses[0]}`);
    else if (statuses.length > 1) parts.push('(' + statuses.map(s => `status:${s}`).join(' OR ') + ')');
    if (filters.productType) parts.push(`product_type:${esc(filters.productType)}`);
    if (filters.tag) parts.push(`tag:${esc(filters.tag)}`);
    if (filters.onlyCollective) parts.push(`tag:'Shopify Collective'`);
    if (filters.titleContains) parts.push(`title:*${String(filters.titleContains).replace(/[:'"()]/g, '')}*`);
    return parts.join(' ').trim();
  }

  // per-product GraphQL selection needed for each field
  function productSelection(field) {
    if (field === 'tags')     return 'id title vendor status tags';
    if (field === 'ptype')    return 'id title vendor status productType';
    if (field === 'category') return 'id title vendor status category { id fullName }';
    if (field === 'collections') return 'id title vendor status collections(first:100){ nodes { id title } }';
    if (field === 'weight')   return 'id title vendor status variants(first:100){ nodes { id title selectedOptions{ name value } inventoryItem{ id measurement{ weight{ value unit } } } } }';
    if (field === 'unitprice')return 'id title vendor status variants(first:100){ nodes { id title price compareAtPrice inventoryItem{ unitCost{ amount } } } } ';
    return 'id title vendor status';
  }

  const method = req.method;
  const q = req.query || {};
  let body = {};
  if (method === 'POST') { try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) { body = {}; } }
  const action = q.action || body.action;

  try {
    // ======================= TAB 1 — PRICES (unchanged) =======================
    if (action === 'backup-all') {
      const rows = [];
      let cursor = null, pages = 0;
      while (pages < 400) {
        const data = await shopify(
          `query($cursor:String){
             products(first:100, after:$cursor){
               pageInfo{ hasNextPage endCursor }
               nodes{ id title variants(first:100){ nodes{ id title price compareAtPrice } } } }
           }`,
          { cursor }
        );
        const conn = data.products;
        conn.nodes.forEach(pr => pr.variants.nodes.forEach(v => rows.push({
          productId: pr.id, productTitle: pr.title,
          variantId: v.id, variantTitle: v.title,
          price: v.price, compareAtPrice: v.compareAtPrice
        })));
        pages++;
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }
      const createdAt = new Date().toISOString();
      const stamp = createdAt.replace(/[:.]/g, '-');
      const path = `data/price-backups/price-backup-${stamp}.json`;
      await ghPut(path, { createdAt, count: rows.length, rows }, `full price backup (${rows.length} variants)`);
      try { await ghPut('data/price-backup-latest.json', { createdAt, count: rows.length, path }, 'latest backup pointer'); } catch (e) {}
      return res.status(200).json({ ok: true, count: rows.length, path, createdAt });
    }

    if (action === 'last-backup') {
      const latest = (await ghGet('data/price-backup-latest.json')).json;
      return res.status(200).json({ ok: true, latest: latest || null });
    }

    // ---------------- per-FIELD backup (Tab 2: one field across the whole store) ----------------
    if (action === 'backup-field') {
      const field = q.field || body.field;
      const allowed = ['tags', 'ptype', 'category', 'collections', 'weight', 'unitprice'];
      if (!field || allowed.indexOf(field) === -1) return res.status(400).json({ ok: false, error: 'valid field required' });
      // weight only exists for About Wall Art products, so back up just those (keeps it small & fast)
      const vendorFilter = (field === 'weight') ? `vendor:'About Wall Art'` : null;
      const pageSize = (field === 'weight') ? 40 : (field === 'collections' || field === 'unitprice') ? 60 : 200;
      function sel() {
        if (field === 'tags') return 'id tags';
        if (field === 'ptype') return 'id productType';
        if (field === 'category') return 'id category{ id }';
        if (field === 'collections') return 'id collections(first:50){ nodes{ id } }';
        if (field === 'weight') return 'id variants(first:100){ nodes{ id inventoryItem{ id measurement{ weight{ value unit } } } } }';
        if (field === 'unitprice') return 'id variants(first:100){ nodes{ id price compareAtPrice } }';
        return 'id';
      }
      const rows = [];
      let cursor = null, pages = 0;
      while (pages < 1500) {
        const data = await shopify(
          `query($q:String,$cursor:String){ products(first:${pageSize}, query:$q, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{ ${sel()} } } }`,
          { q: vendorFilter, cursor }
        );
        const conn = data.products;
        conn.nodes.forEach(pr => {
          if (field === 'tags') rows.push({ productId: pr.id, tags: pr.tags || [] });
          else if (field === 'ptype') rows.push({ productId: pr.id, productType: pr.productType || '' });
          else if (field === 'category') rows.push({ productId: pr.id, categoryId: pr.category ? pr.category.id : null });
          else if (field === 'collections') rows.push({ productId: pr.id, collectionIds: (pr.collections && pr.collections.nodes ? pr.collections.nodes.map(c => c.id) : []) });
          else if (field === 'weight') rows.push({ productId: pr.id, weights: (pr.variants && pr.variants.nodes ? pr.variants.nodes : []).map(v => { const w = v.inventoryItem && v.inventoryItem.measurement && v.inventoryItem.measurement.weight ? v.inventoryItem.measurement.weight : null; return { variantId: v.id, inventoryItemId: v.inventoryItem ? v.inventoryItem.id : null, value: w ? w.value : null, unit: w ? w.unit : null }; }) });
          else if (field === 'unitprice') rows.push({ productId: pr.id, variants: (pr.variants && pr.variants.nodes ? pr.variants.nodes : []).map(v => ({ variantId: v.id, price: v.price, compareAtPrice: v.compareAtPrice })) });
        });
        pages++;
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }
      const createdAt = new Date().toISOString();
      const stamp = createdAt.replace(/[:.]/g, '-');
      const path = `data/field-backups/${field}-backup-${stamp}.json`;
      await ghPut(path, { createdAt, field, count: rows.length, rows }, `field backup ${field} (${rows.length})`);
      try { await ghPut(`data/field-backup-latest-${field}.json`, { createdAt, field, count: rows.length, path }, `latest ${field} backup pointer`); } catch (e) {}
      return res.status(200).json({ ok: true, field, count: rows.length, path, createdAt });
    }

    if (action === 'last-field-backup') {
      const field = q.field || body.field;
      if (!field) return res.status(400).json({ ok: false, error: 'field required' });
      const latest = (await ghGet(`data/field-backup-latest-${field}.json`)).json;
      return res.status(200).json({ ok: true, field, latest: latest || null });
    }

    if (action === 'lastchange') {
      const map = (await ghGet('data/bulk-price-lastchange.json')).json || {};
      return res.status(200).json({ ok: true, map });
    }

    if (action === 'vendors') {
      const counts = {};
      let cursor = null, pages = 0;
      while (pages < 60) {
        const data = await shopify(
          `query($cursor:String){ products(first:250, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{ vendor } } }`,
          { cursor }
        );
        const conn = data.products;
        conn.nodes.forEach(n => { const v = n.vendor || '(no vendor)'; counts[v] = (counts[v] || 0) + 1; });
        pages++;
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }
      const vendors = Object.keys(counts).map(v => ({ vendor: v, count: counts[v] })).sort((a, b) => a.vendor.localeCompare(b.vendor));
      return res.status(200).json({ ok: true, vendors });
    }

    if (action === 'preview') {
      const change = body.change || {};
      const searchQ = buildQuery(body.filters);
      const data = await shopify(
        `query($q:String,$cursor:String){
           products(first:60, query:$q, after:$cursor){
             pageInfo{ hasNextPage endCursor }
             nodes{ id title vendor variants(first:100){ nodes{ id title price compareAtPrice inventoryItem{ unitCost{ amount } } } } } }
         }`,
        { q: searchQ || null, cursor: body.cursor || null }
      );
      const conn = data.products;
      const rows = [];
      let productCount = 0, variantCount = 0, changeCount = 0, noCostCount = 0;
      conn.nodes.forEach(pr => {
        productCount++;
        pr.variants.nodes.forEach(v => {
          variantCount++;
          const cost = v.inventoryItem && v.inventoryItem.unitCost ? v.inventoryItem.unitCost.amount : null;
          const r = computeNew(v.price, cost, change);
          if (r.noCost) noCostCount++;
          if (r.changed) changeCount++;
          rows.push({
            productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
            variantId: v.id, variantTitle: v.title,
            cost: cost, oldPrice: v.price, newPrice: r.newPrice,
            changed: r.changed, noCost: !!r.noCost
          });
        });
      });
      return res.status(200).json({
        ok: true, rows,
        pageInfo: { hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor },
        counts: { productCount, variantCount, changeCount, noCostCount }
      });
    }

    if (action === 'apply') {
      const change = body.change || {};
      const items = Array.isArray(body.items) ? body.items.filter(it => it && it.variantId && it.newPrice != null) : [];
      if (!items.length) return res.status(200).json({ ok: true, updated: 0, message: 'Nothing selected.' });
      const vids = items.map(it => it.variantId);
      const cur = {};
      for (let i = 0; i < vids.length; i += 100) {
        const chunk = vids.slice(i, i + 100);
        const qy = 'query { ' + chunk.map((vid, j) =>
          `v${j}: productVariant(id:"${vid}"){ id price compareAtPrice product{ id vendor } }`).join(' ') + ' }';
        const data = await shopify(qy);
        chunk.forEach((vid, j) => {
          const n = data[`v${j}`];
          if (n) cur[vid] = { price: n.price, compareAt: n.compareAtPrice, productId: n.product ? n.product.id : null, vendor: n.product ? n.product.vendor : null };
        });
      }
      const now = new Date().toISOString();
      const snapshot = [];
      const byProduct = {};
      const vendorsSet = new Set();
      const lc = (await ghGet('data/bulk-price-lastchange.json')).json || {};
      items.forEach(it => {
        const c = cur[it.variantId]; if (!c) return;
        const pid = it.productId || c.productId; if (!pid) return;
        const newPrice = Number(it.newPrice);
        if (Math.abs(newPrice - parseFloat(c.price)) < 1e-9) return;
        snapshot.push({ variantId: it.variantId, oldPrice: c.price, oldCompareAt: c.compareAt });
        (byProduct[pid] = byProduct[pid] || []).push({ variantId: it.variantId, newPrice });
        if (c.vendor) vendorsSet.add(c.vendor);
        lc[it.variantId] = { mode: change.mode, value: change.value, date: now, from: c.price, to: newPrice };
      });
      if (!snapshot.length) return res.status(200).json({ ok: true, updated: 0, message: 'Nothing to change.' });
      const undoId = 'undo-' + now.replace(/[:.]/g, '-');
      await ghPut(`${UNDO_DIR}/${undoId}.json`, { id: undoId, createdAt: now, change, count: snapshot.length, snapshot }, `bulk price undo ${undoId} (${snapshot.length})`);
      try {
        const idx = (await ghGet(UNDO_INDEX)).json || [];
        idx.unshift({ id: undoId, createdAt: now, count: snapshot.length, change, vendors: Array.from(vendorsSet), reverted: false });
        await ghPut(UNDO_INDEX, idx.slice(0, 100), `index ${undoId}`);
      } catch (e) {}
      try { await ghPut('data/bulk-price-lastchange.json', lc, `lastchange (+${snapshot.length})`); } catch (e) {}
      const productIds = Object.keys(byProduct);
      const errors = [];
      let updated = 0;
      for (let i = 0; i < productIds.length; i += 20) {
        const chunk = productIds.slice(i, i + 20);
        const m = 'mutation {\n' + chunk.map((pid, j) => {
          const vars = byProduct[pid].map(u => `{id:"${u.variantId}", price:"${u.newPrice.toFixed(2)}"}`).join(',');
          return `  m${j}: productVariantsBulkUpdate(productId:"${pid}", variants:[${vars}]){ userErrors{ field message } }`;
        }).join('\n') + '\n}';
        const data = await shopify(m);
        chunk.forEach((pid, j) => {
          const ue = data[`m${j}`] && data[`m${j}`].userErrors ? data[`m${j}`].userErrors : [];
          if (ue.length) ue.forEach(e => errors.push(`${pid}: ${e.message}`));
          else updated += byProduct[pid].length;
        });
      }
      return res.status(200).json({ ok: true, updated, undoId, errors: errors.slice(0, 20) });
    }

    if (action === 'undo-list') {
      const idx = (await ghGet(UNDO_INDEX)).json || [];
      return res.status(200).json({ ok: true, undos: idx });
    }

    if (action === 'undo') {
      const undoId = body.undoId;
      if (!undoId) return res.status(400).json({ ok: false, error: 'undoId required' });
      const snap = (await ghGet(`${UNDO_DIR}/${undoId}.json`)).json;
      if (!snap || !Array.isArray(snap.snapshot)) return res.status(404).json({ ok: false, error: 'Snapshot not found' });
      const byProduct = {};
      const vids = snap.snapshot.map(s => s.variantId);
      const idToProduct = {};
      for (let i = 0; i < vids.length; i += 100) {
        const chunk = vids.slice(i, i + 100);
        const qy = 'query { ' + chunk.map((vid, j) => `v${j}: productVariant(id:"${vid}"){ id product{ id } }`).join(' ') + ' }';
        const data = await shopify(qy);
        chunk.forEach((vid, j) => { const n = data[`v${j}`]; if (n && n.product) idToProduct[vid] = n.product.id; });
      }
      snap.snapshot.forEach(s => { const pid = idToProduct[s.variantId]; if (!pid) return; (byProduct[pid] = byProduct[pid] || []).push(s); });
      const productIds = Object.keys(byProduct);
      const errors = [];
      let restored = 0;
      for (let i = 0; i < productIds.length; i += 20) {
        const chunk = productIds.slice(i, i + 20);
        const m = 'mutation {\n' + chunk.map((pid, j) => {
          const vars = byProduct[pid].map(s => `{id:"${s.variantId}", price:"${parseFloat(s.oldPrice).toFixed(2)}"}`).join(',');
          return `  m${j}: productVariantsBulkUpdate(productId:"${pid}", variants:[${vars}]){ userErrors{ message } }`;
        }).join('\n') + '\n}';
        const data = await shopify(m);
        chunk.forEach((pid, j) => {
          const ue = data[`m${j}`] && data[`m${j}`].userErrors ? data[`m${j}`].userErrors : [];
          if (ue.length) ue.forEach(e => errors.push(`${pid}: ${e.message}`));
          else restored += byProduct[pid].length;
        });
      }
      try {
        const idx = (await ghGet(UNDO_INDEX)).json || [];
        const hit = idx.find(x => x.id === undoId); if (hit) hit.reverted = true;
        await ghPut(UNDO_INDEX, idx, `mark reverted ${undoId}`);
      } catch (e) {}
      return res.status(200).json({ ok: true, restored, errors: errors.slice(0, 20) });
    }

    // ======================= TAB 2 — OTHER FIELDS =======================

    // ---- field-meta: everything the Tab 2 dropdowns need (one call) ----
    if (action === 'field-meta') {
      // product types
      const ptypes = [];
      try {
        let cursor = null, pages = 0;
        while (pages < 10) {
          const d = await shopify(`query($c:String){ productTypes(first:250, after:$c){ pageInfo{ hasNextPage endCursor } edges{ node } } }`, { c: cursor });
          const conn = d.productTypes;
          (conn.edges || []).forEach(e => { if (e.node && e.node.trim()) ptypes.push(e.node); });
          pages++;
          if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
          cursor = conn.pageInfo.endCursor;
        }
      } catch (e) {}
      // collections: derive collection-defining tags from smart collections + list manual collections
      const collTagSet = new Set();
      const manualCollections = [];
      let cursor = null, pages = 0;
      while (pages < 40) {
        const d = await shopify(
          `query($c:String){ collections(first:100, after:$c){ pageInfo{ hasNextPage endCursor }
             nodes{ id title ruleSet{ rules{ column relation condition } } } } }`,
          { c: cursor }
        );
        const conn = d.collections;
        conn.nodes.forEach(n => {
          if (n.ruleSet && Array.isArray(n.ruleSet.rules)) {
            n.ruleSet.rules.forEach(r => { if (r.column === 'TAG' && r.condition) collTagSet.add(r.condition); });
          } else {
            manualCollections.push({ id: n.id, title: n.title }); // manual (no rules) = editable by hand
          }
        });
        pages++;
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }
      const collectionTags = Array.from(collTagSet).sort((a, b) => a.localeCompare(b));
      manualCollections.sort((a, b) => a.title.localeCompare(b.title));
      // secondary cluster tags
      const cluster = (await ghGet(CLUSTER_TAGS_PATH)).json || { groups: {} };
      return res.status(200).json({ ok: true, productTypes: ptypes.sort((a, b) => a.localeCompare(b)), collectionTags, manualCollections, clusterGroups: cluster.groups || {} });
    }

    // ---- category-search: Shopify standard taxonomy ----
    if (action === 'category-search') {
      const term = (q.q || body.q || '').trim();
      if (!term) return res.status(200).json({ ok: true, categories: [] });
      const d = await shopify(
        `query($s:String!){ taxonomy{ categories(search:$s, first:25){ nodes{ id name fullName isLeaf level } } } }`,
        { s: term }
      );
      const nodes = (d.taxonomy && d.taxonomy.categories && d.taxonomy.categories.nodes) || [];
      return res.status(200).json({ ok: true, categories: nodes });
    }

    // ---- preview-field: one page of rows for a Tab 2 field ----
    if (action === 'preview-field') {
      const field = body.field;
      const cfg = body.config || {};
      let filters = body.filters || {};
      if (field === 'weight') filters = Object.assign({}, filters, { vendor: AWA_VENDOR }); // safety: AWA only
      const searchQ = buildQuery(filters);
      const data = await shopify(
        `query($q:String,$cursor:String){ products(first:60, query:$q, after:$cursor){
           pageInfo{ hasNextPage endCursor } nodes{ ${productSelection(field)} } } }`,
        { q: searchQ || null, cursor: body.cursor || null }
      );
      const conn = data.products;
      const rows = [];
      let productCount = 0, unitCount = 0, changeCount = 0, blockedCount = 0;
      const collTags = new Set(Array.isArray(cfg.collectionTags) ? cfg.collectionTags : []);

      conn.nodes.forEach(pr => {
        productCount++;

        if (field === 'tags') {
          const curTags = Array.isArray(pr.tags) ? pr.tags.slice() : [];
          const set = new Set(curTags);
          let next = new Set(curTags), blocked = false, note = '';
          if (cfg.action === 'add') {
            (cfg.tags || []).forEach(t => next.add(t));
          } else if (cfg.action === 'remove') {
            (cfg.tags || []).forEach(t => next.delete(t));
          } else if (cfg.action === 'replace') {
            if (cfg.fromTag) next.delete(cfg.fromTag);
            if (cfg.toTag) next.add(cfg.toTag);
          }
          // guard: must keep >=1 collection tag if it had one
          const hadColl = curTags.some(t => collTags.has(t));
          const willHaveColl = Array.from(next).some(t => collTags.has(t));
          if (hadColl && !willHaveColl) { blocked = true; note = 'Would leave the product with NO collection tag'; }
          const nextArr = Array.from(next);
          const changed = !blocked && (nextArr.length !== curTags.length || nextArr.some(t => !set.has(t)));
          unitCount++;
          if (changed) changeCount++;
          if (blocked) blockedCount++;
          rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
            oldVal: curTags.join(', '), newVal: nextArr.join(', '),
            changed, blocked, note, payload: { tags: nextArr } });
        }

        else if (field === 'ptype') {
          const curType = pr.productType || '';
          const has = !!curType;
          const eligible = cfg.action === 'assign' ? !has : has; // assign→only empty, replace→only with a type
          const newType = cfg.value || '';
          const changed = eligible && newType && newType !== curType;
          unitCount++;
          if (changed) changeCount++;
          rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
            oldVal: curType || '(none)', newVal: eligible ? newType : (curType || '(none)'),
            changed, blocked: false, note: eligible ? '' : (cfg.action === 'assign' ? 'already has a type' : 'has no type yet'),
            payload: { productType: newType } });
        }

        else if (field === 'category') {
          const cur = pr.category || null;
          const curId = cur ? cur.id : '';
          const has = !!curId;
          const eligible = cfg.action === 'assign' ? !has : has;
          const changed = eligible && cfg.categoryId && cfg.categoryId !== curId;
          unitCount++;
          if (changed) changeCount++;
          rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
            oldVal: cur ? cur.fullName : '(none)', newVal: eligible ? (cfg.categoryName || cfg.categoryId) : (cur ? cur.fullName : '(none)'),
            changed, blocked: false, note: eligible ? '' : (cfg.action === 'assign' ? 'already has a category' : 'has no category yet'),
            payload: { category: cfg.categoryId } });
        }

        else if (field === 'collections') {
          const curNodes = (pr.collections && pr.collections.nodes) || [];
          const manualIds = new Set(Array.isArray(cfg.manualIds) ? cfg.manualIds : []);
          const curManual = curNodes.filter(c => manualIds.has(c.id));
          const curManualIds = new Set(curManual.map(c => c.id));
          const sel = (cfg.collectionIds || []);
          const titleById = {}; curNodes.forEach(c => titleById[c.id] = c.title);
          (cfg.collectionTitles || []).forEach(t => { titleById[t.id] = t.title; });
          let join = [], leave = [];
          if (cfg.action === 'add') {
            join = sel.filter(id => !curManualIds.has(id));
          } else if (cfg.action === 'remove') {
            leave = sel.filter(id => curManualIds.has(id));
          } else if (cfg.action === 'replace') {
            join = sel.filter(id => !curManualIds.has(id));
            leave = Array.from(curManualIds).filter(id => sel.indexOf(id) === -1);
          }
          const changed = (join.length + leave.length) > 0;
          unitCount++;
          if (changed) changeCount++;
          rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
            oldVal: curManual.map(c => c.title).join(', ') || '(none)',
            newVal: (function(){ const s = new Set(curManualIds); join.forEach(id=>s.add(id)); leave.forEach(id=>s.delete(id)); return Array.from(s).map(id=>titleById[id]||id).join(', ') || '(none)'; })(),
            changed, blocked: false, note: '', payload: { join, leave } });
        }

        else if (field === 'weight') {
          const groups = cfg.groups || {};
          const unit = cfg.unit || 'KILOGRAMS';
          (pr.variants ? pr.variants.nodes : []).forEach(v => {
            unitCount++;
            const gk = weightGroupOf(v.selectedOptions);
            const invId = v.inventoryItem ? v.inventoryItem.id : null;
            const curW = v.inventoryItem && v.inventoryItem.measurement && v.inventoryItem.measurement.weight ? v.inventoryItem.measurement.weight.value : null;
            const target = (gk && groups[gk] !== undefined && groups[gk] !== '' && groups[gk] !== null) ? parseFloat(groups[gk]) : null;
            const changed = target != null && !isNaN(target) && invId && (curW == null || Math.abs(target - Number(curW)) > 1e-9);
            if (changed) changeCount++;
            rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
              variantId: v.id, variantTitle: v.title, group: gk || '(no group)',
              oldVal: curW != null ? (curW + ' ' + (v.inventoryItem.measurement.weight.unit || '')) : '(none)',
              newVal: target != null ? (target + ' ' + unit) : '—',
              changed: !!changed, blocked: false, note: gk ? '' : 'variant not in any weight group',
              payload: invId ? { inventoryItemId: invId, weight: { value: target, unit } } : null });
          });
        }

        else if (field === 'unitprice') {
          (pr.variants ? pr.variants.nodes : []).forEach(v => {
            unitCount++;
            const price = v.price, compareAt = v.compareAtPrice;
            const cost = v.inventoryItem && v.inventoryItem.unitCost ? v.inventoryItem.unitCost.amount : null;
            const refs = { price, cost, compareAt };
            let newPrice = computeMoney(price, refs, cfg.how, cfg.value);
            if (newPrice != null) { if (newPrice < 0) newPrice = 0; newPrice = roundUnit(newPrice, cfg.rounding || 'none'); }
            let newCompare = compareAt;
            if (cfg.compareAt && cfg.compareAt.enabled) {
              if (cfg.compareAt.how === 'clear') newCompare = null;
              else {
                let nc = computeMoney(compareAt, { price: newPrice != null ? newPrice : price, cost, compareAt }, cfg.compareAt.how, cfg.compareAt.value);
                if (nc != null) { if (nc < 0) nc = 0; nc = roundUnit(nc, cfg.rounding || 'none'); newCompare = nc; }
              }
            }
            const priceChanged = newPrice != null && Math.abs(newPrice - parseFloat(price)) > 1e-9;
            const compChanged = cfg.compareAt && cfg.compareAt.enabled && ((newCompare == null) !== (compareAt == null) || (newCompare != null && compareAt != null && Math.abs(parseFloat(newCompare) - parseFloat(compareAt)) > 1e-9));
            const changed = priceChanged || compChanged;
            if (changed) changeCount++;
            rows.push({ productId: pr.id, productTitle: pr.title, vendor: pr.vendor,
              variantId: v.id, variantTitle: v.title, cost,
              oldVal: '£' + Number(price).toFixed(2) + (compareAt != null ? ' (was £' + Number(compareAt).toFixed(2) + ')' : ''),
              newVal: (newPrice != null ? '£' + Number(newPrice).toFixed(2) : '£' + Number(price).toFixed(2)) + (cfg.compareAt && cfg.compareAt.enabled ? (newCompare != null ? ' (was £' + Number(newCompare).toFixed(2) + ')' : ' (no compare-at)') : ''),
              changed, blocked: false, note: '',
              payload: { price: priceChanged ? Number(newPrice).toFixed(2) : null, compareAtPrice: compChanged ? (newCompare == null ? null : Number(newCompare).toFixed(2)) : undefined } });
          });
        }
      });

      return res.status(200).json({
        ok: true, rows,
        pageInfo: { hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor },
        counts: { productCount, unitCount, changeCount, blockedCount }
      });
    }

    // ---- apply-field: write ticked rows + save undo snapshot ----
    if (action === 'apply-field') {
      const field = body.field;
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return res.status(200).json({ ok: true, updated: 0, message: 'Nothing selected.' });
      const now = new Date().toISOString();
      const undoId = 'fundo-' + now.replace(/[:.]/g, '-');
      const snapshot = [];
      const errors = [];
      let updated = 0;

      // ---------- PRODUCT-level fields via productUpdate ----------
      if (field === 'tags' || field === 'ptype' || field === 'category' || field === 'collections') {
        const pids = items.map(it => it.productId).filter(Boolean);
        // read current values for undo
        const cur = {};
        for (let i = 0; i < pids.length; i += 50) {
          const chunk = pids.slice(i, i + 50);
          const qy = 'query { ' + chunk.map((pid, j) =>
            `p${j}: product(id:"${pid}"){ id tags productType category{ id } collections(first:100){ nodes{ id } } }`).join(' ') + ' }';
          const data = await shopify(qy);
          chunk.forEach((pid, j) => { const n = data[`p${j}`]; if (n) cur[pid] = n; });
        }
        items.forEach(it => {
          const c = cur[it.productId]; if (!c) return;
          if (field === 'tags') snapshot.push({ productId: it.productId, oldTags: c.tags || [] });
          else if (field === 'ptype') snapshot.push({ productId: it.productId, oldType: c.productType || '' });
          else if (field === 'category') snapshot.push({ productId: it.productId, oldCategoryId: c.category ? c.category.id : null });
          else if (field === 'collections') snapshot.push({ productId: it.productId, added: it.payload.join || [], removed: it.payload.leave || [] });
        });
        // save undo BEFORE writing
        await ghPut(`${FIELD_UNDO_DIR}/${undoId}.json`, { id: undoId, createdAt: now, field, count: snapshot.length, snapshot }, `field undo ${undoId} (${field})`);
        try {
          const idx = (await ghGet(FIELD_UNDO_INDEX)).json || [];
          idx.unshift({ id: undoId, createdAt: now, field, count: snapshot.length, reverted: false });
          await ghPut(FIELD_UNDO_INDEX, idx.slice(0, 100), `field index ${undoId}`);
        } catch (e) {}
        // write, one productUpdate per product, batched
        for (let i = 0; i < items.length; i += 20) {
          const chunk = items.slice(i, i + 20);
          const parts = chunk.map((it, j) => {
            const p = it.payload || {};
            let input = `id:"${it.productId}"`;
            if (field === 'tags') input += `, tags:[${(p.tags || []).map(t => JSON.stringify(t)).join(',')}]`;
            if (field === 'ptype') input += `, productType:${JSON.stringify(p.productType || '')}`;
            if (field === 'category') input += `, category:${p.category ? `"${p.category}"` : 'null'}`;
            if (field === 'collections') {
              if (p.join && p.join.length) input += `, collectionsToJoin:[${p.join.map(id => `"${id}"`).join(',')}]`;
              if (p.leave && p.leave.length) input += `, collectionsToLeave:[${p.leave.map(id => `"${id}"`).join(',')}]`;
            }
            return `  u${j}: productUpdate(input:{${input}}){ userErrors{ field message } }`;
          });
          const m = 'mutation {\n' + parts.join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((it, j) => {
            const ue = data[`u${j}`] && data[`u${j}`].userErrors ? data[`u${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(`${it.productId}: ${e.message}`));
            else updated++;
          });
        }
      }

      // ---------- WEIGHT via inventoryItemUpdate ----------
      else if (field === 'weight') {
        const its = items.filter(it => it.payload && it.payload.inventoryItemId && it.payload.weight && it.payload.weight.value != null);
        // read current weights for undo
        const invIds = its.map(it => it.payload.inventoryItemId);
        const cur = {};
        for (let i = 0; i < invIds.length; i += 50) {
          const chunk = invIds.slice(i, i + 50);
          const qy = 'query { ' + chunk.map((iid, j) => `w${j}: inventoryItem(id:"${iid}"){ id measurement{ weight{ value unit } } }`).join(' ') + ' }';
          const data = await shopify(qy);
          chunk.forEach((iid, j) => { const n = data[`w${j}`]; if (n) cur[iid] = n.measurement && n.measurement.weight ? n.measurement.weight : null; });
        }
        its.forEach(it => {
          const w = cur[it.payload.inventoryItemId];
          snapshot.push({ inventoryItemId: it.payload.inventoryItemId, oldValue: w ? w.value : null, oldUnit: w ? w.unit : (it.payload.weight.unit || 'KILOGRAMS') });
        });
        await ghPut(`${FIELD_UNDO_DIR}/${undoId}.json`, { id: undoId, createdAt: now, field, count: snapshot.length, snapshot }, `field undo ${undoId} (weight)`);
        try {
          const idx = (await ghGet(FIELD_UNDO_INDEX)).json || [];
          idx.unshift({ id: undoId, createdAt: now, field, count: snapshot.length, reverted: false });
          await ghPut(FIELD_UNDO_INDEX, idx.slice(0, 100), `field index ${undoId}`);
        } catch (e) {}
        for (let i = 0; i < its.length; i += 20) {
          const chunk = its.slice(i, i + 20);
          const m = 'mutation {\n' + chunk.map((it, j) =>
            `  w${j}: inventoryItemUpdate(id:"${it.payload.inventoryItemId}", input:{ measurement:{ weight:{ value:${Number(it.payload.weight.value)}, unit:${it.payload.weight.unit || 'KILOGRAMS'} } } }){ userErrors{ message } }`
          ).join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((it, j) => {
            const ue = data[`w${j}`] && data[`w${j}`].userErrors ? data[`w${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(e.message));
            else updated++;
          });
        }
      }

      // ---------- UNIT PRICE via productVariantsBulkUpdate ----------
      else if (field === 'unitprice') {
        const its = items.filter(it => it.variantId && it.payload);
        const vids = its.map(it => it.variantId);
        const cur = {};
        for (let i = 0; i < vids.length; i += 100) {
          const chunk = vids.slice(i, i + 100);
          const qy = 'query { ' + chunk.map((vid, j) => `v${j}: productVariant(id:"${vid}"){ id price compareAtPrice product{ id } }`).join(' ') + ' }';
          const data = await shopify(qy);
          chunk.forEach((vid, j) => { const n = data[`v${j}`]; if (n) cur[vid] = { price: n.price, compareAt: n.compareAtPrice, productId: n.product ? n.product.id : null }; });
        }
        const byProduct = {};
        its.forEach(it => {
          const c = cur[it.variantId]; if (!c || !c.productId) return;
          snapshot.push({ variantId: it.variantId, oldPrice: c.price, oldCompareAt: c.compareAt });
          const v = { id: it.variantId };
          if (it.payload.price != null) v.price = it.payload.price;
          if (it.payload.compareAtPrice !== undefined) v.compareAtPrice = it.payload.compareAtPrice; // null clears
          (byProduct[c.productId] = byProduct[c.productId] || []).push(v);
        });
        await ghPut(`${FIELD_UNDO_DIR}/${undoId}.json`, { id: undoId, createdAt: now, field, count: snapshot.length, snapshot }, `field undo ${undoId} (unitprice)`);
        try {
          const idx = (await ghGet(FIELD_UNDO_INDEX)).json || [];
          idx.unshift({ id: undoId, createdAt: now, field, count: snapshot.length, reverted: false });
          await ghPut(FIELD_UNDO_INDEX, idx.slice(0, 100), `field index ${undoId}`);
        } catch (e) {}
        const productIds = Object.keys(byProduct);
        for (let i = 0; i < productIds.length; i += 20) {
          const chunk = productIds.slice(i, i + 20);
          const m = 'mutation {\n' + chunk.map((pid, j) => {
            const vars = byProduct[pid].map(v => {
              let s = `{id:"${v.id}"`;
              if (v.price != null) s += `, price:"${v.price}"`;
              if (v.compareAtPrice !== undefined) s += `, compareAtPrice:${v.compareAtPrice == null ? 'null' : `"${v.compareAtPrice}"`}`;
              return s + '}';
            }).join(',');
            return `  m${j}: productVariantsBulkUpdate(productId:"${pid}", variants:[${vars}]){ userErrors{ field message } }`;
          }).join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((pid, j) => {
            const ue = data[`m${j}`] && data[`m${j}`].userErrors ? data[`m${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(`${pid}: ${e.message}`));
            else updated += byProduct[pid].length;
          });
        }
      }

      return res.status(200).json({ ok: true, updated, undoId, field, errors: errors.slice(0, 20) });
    }

    // ---- field-undo-list ----
    if (action === 'field-undo-list') {
      const idx = (await ghGet(FIELD_UNDO_INDEX)).json || [];
      return res.status(200).json({ ok: true, undos: idx });
    }

    // ---- field-undo: restore a Tab 2 change ----
    if (action === 'field-undo') {
      const undoId = body.undoId;
      if (!undoId) return res.status(400).json({ ok: false, error: 'undoId required' });
      const snap = (await ghGet(`${FIELD_UNDO_DIR}/${undoId}.json`)).json;
      if (!snap || !Array.isArray(snap.snapshot)) return res.status(404).json({ ok: false, error: 'Snapshot not found' });
      const field = snap.field;
      const errors = [];
      let restored = 0;

      if (field === 'tags' || field === 'ptype' || field === 'category' || field === 'collections') {
        for (let i = 0; i < snap.snapshot.length; i += 20) {
          const chunk = snap.snapshot.slice(i, i + 20);
          const m = 'mutation {\n' + chunk.map((s, j) => {
            let input = `id:"${s.productId}"`;
            if (field === 'tags') input += `, tags:[${(s.oldTags || []).map(t => JSON.stringify(t)).join(',')}]`;
            if (field === 'ptype') input += `, productType:${JSON.stringify(s.oldType || '')}`;
            if (field === 'category') input += `, category:${s.oldCategoryId ? `"${s.oldCategoryId}"` : 'null'}`;
            if (field === 'collections') {
              // reverse: re-join what we removed, re-leave what we added
              if (s.removed && s.removed.length) input += `, collectionsToJoin:[${s.removed.map(id => `"${id}"`).join(',')}]`;
              if (s.added && s.added.length) input += `, collectionsToLeave:[${s.added.map(id => `"${id}"`).join(',')}]`;
            }
            return `  u${j}: productUpdate(input:{${input}}){ userErrors{ message } }`;
          }).join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((s, j) => {
            const ue = data[`u${j}`] && data[`u${j}`].userErrors ? data[`u${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(e.message)); else restored++;
          });
        }
      } else if (field === 'weight') {
        const items = snap.snapshot.filter(s => s.oldValue != null);
        for (let i = 0; i < items.length; i += 20) {
          const chunk = items.slice(i, i + 20);
          const m = 'mutation {\n' + chunk.map((s, j) =>
            `  w${j}: inventoryItemUpdate(id:"${s.inventoryItemId}", input:{ measurement:{ weight:{ value:${Number(s.oldValue)}, unit:${s.oldUnit || 'KILOGRAMS'} } } }){ userErrors{ message } }`
          ).join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((s, j) => {
            const ue = data[`w${j}`] && data[`w${j}`].userErrors ? data[`w${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(e.message)); else restored++;
          });
        }
      } else if (field === 'unitprice') {
        const byProduct = {};
        const vids = snap.snapshot.map(s => s.variantId);
        const idToProduct = {};
        for (let i = 0; i < vids.length; i += 100) {
          const chunk = vids.slice(i, i + 100);
          const qy = 'query { ' + chunk.map((vid, j) => `v${j}: productVariant(id:"${vid}"){ id product{ id } }`).join(' ') + ' }';
          const data = await shopify(qy);
          chunk.forEach((vid, j) => { const n = data[`v${j}`]; if (n && n.product) idToProduct[vid] = n.product.id; });
        }
        snap.snapshot.forEach(s => { const pid = idToProduct[s.variantId]; if (!pid) return; (byProduct[pid] = byProduct[pid] || []).push(s); });
        const productIds = Object.keys(byProduct);
        for (let i = 0; i < productIds.length; i += 20) {
          const chunk = productIds.slice(i, i + 20);
          const m = 'mutation {\n' + chunk.map((pid, j) => {
            const vars = byProduct[pid].map(s => {
              let str = `{id:"${s.variantId}", price:"${parseFloat(s.oldPrice).toFixed(2)}"`;
              str += `, compareAtPrice:${s.oldCompareAt == null ? 'null' : `"${parseFloat(s.oldCompareAt).toFixed(2)}"`}`;
              return str + '}';
            }).join(',');
            return `  m${j}: productVariantsBulkUpdate(productId:"${pid}", variants:[${vars}]){ userErrors{ message } }`;
          }).join('\n') + '\n}';
          const data = await shopify(m);
          chunk.forEach((pid, j) => {
            const ue = data[`m${j}`] && data[`m${j}`].userErrors ? data[`m${j}`].userErrors : [];
            if (ue.length) ue.forEach(e => errors.push(e.message)); else restored += byProduct[pid].length;
          });
        }
      }

      try {
        const idx = (await ghGet(FIELD_UNDO_INDEX)).json || [];
        const hit = idx.find(x => x.id === undoId); if (hit) hit.reverted = true;
        await ghPut(FIELD_UNDO_INDEX, idx, `mark reverted ${undoId}`);
      } catch (e) {}
      return res.status(200).json({ ok: true, restored, errors: errors.slice(0, 20) });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
