// shopify-bulk.js — v1.0 (7 Sep 2026)
// Backend for the "Shopify Bulk Editor" tool (Step 1: bulk PRICE editing).
// Reuses the Shopify token + GitHub token already in Vercel. No local storage.
//
// What it does:
//   - Filter products with Shopify's own search (vendor / status / type / tag / title / "only Collective").
//   - Compute new prices per variant using the "cost" (Cost per item = inventoryItem.unitCost):
//       markup_cost : price = cost * (1 + p/100)
//       floor_cost  : price = max(current price, cost * (1 + p/100))   ← never lowers a good margin
//       inc_pct/dec_pct/inc_amt/dec_amt/set : simple maths on the current price
//   - Live PREVIEW (paged) showing before → after + % over cost.
//   - APPLY via productVariantsBulkUpdate, in batches.
//   - UNDO: before applying, the OLD prices are snapshotted to GitHub, so one click restores them.
//
// Actions:
//   GET  ?action=vendors                               -> distinct vendors + counts (for the supplier filter)
//   POST { action:'preview', filters, change, cursor } -> one page of rows with new prices + nextCursor + counts
//   POST { action:'apply',   filters, change }         -> snapshot old prices to GitHub, then update; returns undoId
//   GET  ?action=undo-list                             -> list saved undo snapshots
//   POST { action:'undo', undoId }                     -> restore prices from a snapshot
//
// Cost note (verified 7 Sep 2026): for Shopify Collective products the supplier cost lands in the
// native "Cost per item" (inventoryItem.unitCost) INCLUDING tax — that is the value used here.

const REPO = 'aboutwallart/seo-tools';
const API_VERSION = '2025-01';
const UNDO_INDEX = 'data/bulk-price-undos.json';       // list of snapshots
const UNDO_DIR = 'data/bulk-price-undo';                // <dir>/<id>.json holds the old prices

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

  async function shopify(query, variables) {
    const r = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query, variables })
    });
    const d = await r.json();
    if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
    return d.data;
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

  // ---------- price maths ----------
  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function applyRounding(x, rounding) {
    if (rounding === 'up_99') {           // charm price, always rounds UP (never below target)
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
    return round2(x);                      // 'none' -> 2 decimals
  }
  // Returns { newPrice:Number|null, changed:Bool } for one variant given the change config.
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
    // Safety: cost-based modes must never end BELOW the intended cost+% (rounding could nudge down).
    if (needCost) {
      const floorTarget = c * (1 + val / 100);
      if (out < floorTarget - 1e-9) out = applyRounding(floorTarget, rounding === 'none' ? 'up_99' : rounding);
      if (out < floorTarget - 1e-9) out = round2(floorTarget);
    }
    const changed = Math.abs(out - p) > 1e-9;
    return { newPrice: out, changed };
  }

  // ---------- build a Shopify product search query from the filters ----------
  function buildQuery(filters) {
    filters = filters || {};
    const parts = [];
    const esc = s => `'${String(s).replace(/'/g, "\\'")}'`;
    if (filters.vendor) parts.push(`vendor:${esc(filters.vendor)}`);
    if (filters.status) parts.push(`status:${filters.status}`);            // active|draft|archived
    if (filters.productType) parts.push(`product_type:${esc(filters.productType)}`);
    if (filters.tag) parts.push(`tag:${esc(filters.tag)}`);
    if (filters.onlyCollective) parts.push(`tag:'Shopify Collective'`);
    if (filters.titleContains) parts.push(`title:*${String(filters.titleContains).replace(/[:'"()]/g, '')}*`);
    return parts.join(' ').trim();
  }

  const method = req.method;
  const q = req.query || {};
  let body = {};
  if (method === 'POST') { try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) { body = {}; } }
  const action = q.action || body.action;

  try {
    // ---------------- vendors (for the supplier dropdown) ----------------
    if (action === 'vendors') {
      const counts = {};
      let cursor = null, pages = 0;
      while (pages < 60) { // cap ~15k products
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

    // ---------------- preview (one page) ----------------
    if (action === 'preview') {
      const change = body.change || {};
      const searchQ = buildQuery(body.filters);
      const data = await shopify(
        `query($q:String,$cursor:String){
           products(first:60, query:$q, after:$cursor){
             pageInfo{ hasNextPage endCursor }
             nodes{
               id title vendor
               variants(first:100){ nodes{ id title price compareAtPrice inventoryItem{ unitCost{ amount } } } }
             }
           }
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

    // ---------------- apply ----------------
    if (action === 'apply') {
      const change = body.change || {};
      const searchQ = buildQuery(body.filters);

      // 1) scan everything that matches and compute the updates
      const updatesByProduct = {};   // productId -> [{variantId, newPrice}]
      const snapshot = [];           // {variantId, oldPrice, oldCompareAt}
      let cursor = null, pages = 0, changeCount = 0;
      while (pages < 400) {
        const data = await shopify(
          `query($q:String,$cursor:String){
             products(first:60, query:$q, after:$cursor){
               pageInfo{ hasNextPage endCursor }
               nodes{ id variants(first:100){ nodes{ id price compareAtPrice inventoryItem{ unitCost{ amount } } } } }
             }
           }`,
          { q: searchQ || null, cursor }
        );
        const conn = data.products;
        conn.nodes.forEach(pr => {
          pr.variants.nodes.forEach(v => {
            const cost = v.inventoryItem && v.inventoryItem.unitCost ? v.inventoryItem.unitCost.amount : null;
            const r = computeNew(v.price, cost, change);
            if (r.changed) {
              (updatesByProduct[pr.id] = updatesByProduct[pr.id] || []).push({ variantId: v.id, newPrice: r.newPrice });
              snapshot.push({ variantId: v.id, oldPrice: v.price, oldCompareAt: v.compareAtPrice });
              changeCount++;
            }
          });
        });
        pages++;
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }

      if (changeCount === 0) return res.status(200).json({ ok: true, updated: 0, message: 'Nothing to change.' });

      // 2) save the undo snapshot BEFORE writing anything
      const undoId = 'undo-' + new Date().toISOString().replace(/[:.]/g, '-');
      await ghPut(`${UNDO_DIR}/${undoId}.json`, {
        id: undoId, createdAt: new Date().toISOString(),
        filters: body.filters || {}, change, count: snapshot.length, snapshot
      }, `bulk price undo snapshot ${undoId} (${snapshot.length})`);
      // index (best-effort)
      try {
        const idx = (await ghGet(UNDO_INDEX)).json || [];
        idx.unshift({ id: undoId, createdAt: new Date().toISOString(), count: snapshot.length, change, filters: body.filters || {}, reverted: false });
        await ghPut(UNDO_INDEX, idx.slice(0, 100), `index ${undoId}`);
      } catch (e) { /* index is convenience only */ }

      // 3) write the new prices, batched (one productVariantsBulkUpdate per product, ~20 per request)
      const productIds = Object.keys(updatesByProduct);
      const errors = [];
      let updated = 0;
      for (let i = 0; i < productIds.length; i += 20) {
        const chunk = productIds.slice(i, i + 20);
        const m = 'mutation {\n' + chunk.map((pid, j) => {
          const vars = updatesByProduct[pid].map(u => `{id:"${u.variantId}", price:"${u.newPrice.toFixed(2)}"}`).join(',');
          return `  m${j}: productVariantsBulkUpdate(productId:"${pid}", variants:[${vars}]){ userErrors{ field message } }`;
        }).join('\n') + '\n}';
        const data = await shopify(m);
        chunk.forEach((pid, j) => {
          const ue = data[`m${j}`] && data[`m${j}`].userErrors ? data[`m${j}`].userErrors : [];
          if (ue.length) ue.forEach(e => errors.push(`${pid}: ${e.message}`));
          else updated += updatesByProduct[pid].length;
        });
      }
      return res.status(200).json({ ok: true, updated, changeCount, undoId, errors: errors.slice(0, 20) });
    }

    // ---------------- undo list ----------------
    if (action === 'undo-list') {
      const idx = (await ghGet(UNDO_INDEX)).json || [];
      return res.status(200).json({ ok: true, undos: idx });
    }

    // ---------------- undo (restore) ----------------
    if (action === 'undo') {
      const undoId = body.undoId;
      if (!undoId) return res.status(400).json({ ok: false, error: 'undoId required' });
      const snap = (await ghGet(`${UNDO_DIR}/${undoId}.json`)).json;
      if (!snap || !Array.isArray(snap.snapshot)) return res.status(404).json({ ok: false, error: 'Snapshot not found' });

      // group old prices back by product
      const byProduct = {};
      // we stored variantId + oldPrice; productVariantsBulkUpdate needs the productId, which we
      // can derive from the variant via a quick lookup.
      // Fetch productId for each variant in one query batch.
      const vids = snap.snapshot.map(s => s.variantId);
      const idToProduct = {};
      for (let i = 0; i < vids.length; i += 100) {
        const chunk = vids.slice(i, i + 100);
        const qy = 'query { ' + chunk.map((vid, j) => `v${j}: productVariant(id:"${vid}"){ id product{ id } }`).join(' ') + ' }';
        const data = await shopify(qy);
        chunk.forEach((vid, j) => { const n = data[`v${j}`]; if (n && n.product) idToProduct[vid] = n.product.id; });
      }
      snap.snapshot.forEach(s => {
        const pid = idToProduct[s.variantId];
        if (!pid) return;
        (byProduct[pid] = byProduct[pid] || []).push(s);
      });

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
      // mark reverted in index (best-effort)
      try {
        const idx = (await ghGet(UNDO_INDEX)).json || [];
        const hit = idx.find(x => x.id === undoId); if (hit) hit.reverted = true;
        await ghPut(UNDO_INDEX, idx, `mark reverted ${undoId}`);
      } catch (e) {}
      return res.status(200).json({ ok: true, restored, errors: errors.slice(0, 20) });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
