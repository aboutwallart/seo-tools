// price-guard.js — v1.0 (14 Sep 2026)
// "El vigilante": a daily job (Vercel cron) that keeps every Shopify Collective product
// at AT LEAST cost + MIN_MARKUP% (Mae's rule = cost incl. VAT + 25%).
//
// What it does each run:
//   1. Scans all products tagged "Shopify Collective".
//   2. For each variant with a cost, if its price is BELOW cost*(1+MIN_MARKUP/100) — because a
//      supplier raised the cost — it RAISES it to that minimum. It never lowers a price.
//   3. Before writing, it saves an undo snapshot to GitHub (same format as the Bulk Editor's undo)
//      and records each change in data/bulk-price-lastchange.json.
//   4. Writes a run summary to data/price-guard-last.json. A Google Apps Script
//      (price-guard-reminder-apps-script.gs) reads that file and emails Mae when something was fixed.
//
// Triggered by the cron in vercel.json. Add ?dry=1 to preview without writing.

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'aboutwallart/seo-tools';
const API_VERSION = '2025-01';
const MIN_MARKUP = 25;                 // cost + 25%
const UNDO_DIR = 'data/bulk-price-undo';
const UNDO_INDEX = 'data/bulk-price-undos.json';
const LASTCHANGE = 'data/bulk-price-lastchange.json';
const SUMMARY = 'data/price-guard-last.json';

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

async function shopify(query, variables){
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables })
  });
  const d = await r.json();
  if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
  return d.data;
}
async function ghGet(path){
  if (!GITHUB_TOKEN) return { json: null, sha: null };
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!r.ok) return { json: null, sha: null };
  const d = await r.json();
  let json = null;
  try { json = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) {}
  return { json, sha: d.sha };
}
async function ghPut(path, obj, message){
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');
  for (let attempt = 0; attempt < 5; attempt++){
    const cur = await ghGet(path);
    const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
    if (cur.sha) body.sha = cur.sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.ok) return true;
    if (![409, 422, 500, 502, 503, 504].includes(r.status)) throw new Error('GitHub save failed: ' + r.status);
    await new Promise(s => setTimeout(s, 400 * (attempt + 1)));
  }
  throw new Error('GitHub save failed after retries');
}

module.exports = async (req, res) => {
  const dry = req.query && (req.query.dry === '1' || req.query.dry === 'true');
  if (!STORE || !TOKEN) return res.status(500).json({ ok: false, error: 'Missing Shopify credentials' });

  try {
    // 1) scan all Collective products, find variants below cost + MIN_MARKUP%
    const byProduct = {};   // productId -> [{variantId, newPrice}]
    const snapshot = [];    // {variantId, oldPrice, oldCompareAt}
    const fixed = [];       // {title, variant, from, to, cost}
    const newByVid = {};    // variantId -> newPrice
    let cursor = null, pages = 0;
    while (pages < 400){
      const data = await shopify(
        `query($cursor:String){
           products(first:60, query:"tag:'Shopify Collective'", after:$cursor){
             pageInfo{ hasNextPage endCursor }
             nodes{ id title variants(first:100){ nodes{ id title price compareAtPrice inventoryItem{ unitCost{ amount } } } } }
           }
         }`,
        { cursor }
      );
      const conn = data.products;
      conn.nodes.forEach(pr => {
        pr.variants.nodes.forEach(v => {
          const costRaw = v.inventoryItem && v.inventoryItem.unitCost ? v.inventoryItem.unitCost.amount : null;
          if (costRaw == null) return;
          const cost = parseFloat(costRaw);
          if (!(cost > 0)) return;
          const target = round2(cost * (1 + MIN_MARKUP / 100));
          const price = parseFloat(v.price);
          if (price < target - 1e-9){
            (byProduct[pr.id] = byProduct[pr.id] || []).push({ variantId: v.id, newPrice: target });
            newByVid[v.id] = target;
            snapshot.push({ variantId: v.id, oldPrice: v.price, oldCompareAt: v.compareAtPrice });
            fixed.push({ title: pr.title, variant: (v.title === 'Default Title' ? '' : v.title), from: v.price, to: target, cost: cost });
          }
        });
      });
      pages++;
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }

    const ranAt = new Date().toISOString();

    if (!fixed.length){
      if (!dry) { try { await ghPut(SUMMARY, { ranAt, fixedCount: 0, items: [] }, 'price-guard: nothing to fix'); } catch (e) {} }
      return res.status(200).json({ ok: true, ranAt, fixedCount: 0, dry });
    }
    if (dry) return res.status(200).json({ ok: true, ranAt, fixedCount: fixed.length, items: fixed, dry: true });

    // 2) undo snapshot BEFORE writing
    const undoId = 'guard-' + ranAt.replace(/[:.]/g, '-');
    await ghPut(`${UNDO_DIR}/${undoId}.json`, { id: undoId, createdAt: ranAt, source: 'price-guard', count: snapshot.length, snapshot }, `price-guard undo ${undoId} (${snapshot.length})`);
    try {
      const idx = (await ghGet(UNDO_INDEX)).json || [];
      idx.unshift({ id: undoId, createdAt: ranAt, count: snapshot.length, source: 'price-guard', reverted: false });
      await ghPut(UNDO_INDEX, idx.slice(0, 100), `index ${undoId}`);
    } catch (e) {}
    // record last change per variant (so the tool shows them correct)
    try {
      const lc = (await ghGet(LASTCHANGE)).json || {};
      snapshot.forEach(s => {
        lc[s.variantId] = { mode: 'floor_cost', value: MIN_MARKUP, date: ranAt, from: s.oldPrice, to: newByVid[s.variantId] };
      });
      await ghPut(LASTCHANGE, lc, `price-guard lastchange (+${snapshot.length})`);
    } catch (e) {}

    // 3) write the new prices, batched
    const productIds = Object.keys(byProduct);
    const errors = [];
    let updated = 0;
    for (let i = 0; i < productIds.length; i += 20){
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

    // 4) write the run summary (the Apps Script reads this to email Mae)
    await ghPut(SUMMARY, { ranAt, fixedCount: updated, minMarkup: MIN_MARKUP, undoId, items: fixed.slice(0, 500) }, `price-guard fixed ${updated}`);

    return res.status(200).json({ ok: true, ranAt, fixedCount: updated, undoId, errors: errors.slice(0, 20) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
