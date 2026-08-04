// DC Concept daily stock sync (Vercel serverless + cron).
// Reads the supplier's live stock list + data/dc-matches.json (from GitHub), then
// writes each matched product's availability into metafields
// (custom.dc_status / dc_production / dc_delivery_time). The dc-concepts theme block reads those.
// Reuses the Shopify token already in Vercel — nothing to copy.
// Triggered daily by the cron in vercel.json. Add ?dry=1 to preview without writing.

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-10';
const FEED_BASE = 'https://stock-list-inventory-system.vercel.app/api/customer-stock?category=';
const MATCHES_URL = 'https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/dc-matches.json';
const CATEGORIES = ['armchair','sofa','office','dining','coffee','outdoor','dressing','cabinet','wardrobe','other','clearance'];

// ---- wording (edit here to change what customers see) ----
const IN_STOCK_PRODUCTION = 'In stock';
const IN_STOCK_DELIVERY = '3–5 working days';
function dispatchStr(days){ return days <= 14 ? `${days} days` : `${Math.round(days/7)} weeks`; }

async function getFeed() {
  const byId = {};
  for (const c of CATEGORIES) {
    try {
      const r = await fetch(FEED_BASE + c);
      if (!r.ok) continue;
      const j = await r.json();
      (j.products || []).forEach(p => { if (!byId[p.productId]) byId[p.productId] = p; });
    } catch (e) { /* skip category on error */ }
  }
  return byId;
}

function pickVariants(storeTitle, variants) {
  const t = (storeTitle || '').toLowerCase();
  const hit = (variants || []).filter(v => {
    const n = (v.variantName || '').toLowerCase().trim();
    return n && n.length > 1 && t.includes(n);
  });
  return hit.length ? hit : (variants || []);
}

function computeFields(storeTitle, supplierProduct) {
  const vars = pickVariants(storeTitle, supplierProduct.variants || []);
  if (vars.some(v => v.stock > 0)) {
    return { dc_status: 'in_stock', dc_production: IN_STOCK_PRODUCTION, dc_delivery_time: IN_STOCK_DELIVERY };
  }
  const withDate = vars.filter(v => v.nextAvailableDays && v.nextAvailableDays > 0).sort((a,b) => a.nextAvailableDays - b.nextAvailableDays);
  if (withDate.length) {
    return { dc_status: 'dispatch', dc_production: dispatchStr(withDate[0].nextAvailableDays), dc_delivery_time: '' };
  }
  return { dc_status: '', dc_production: '', dc_delivery_time: '' }; // made-to-order default
}

async function shopifyGraphQL(query) {
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query })
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

function metafieldInput(ownerId, key, value) {
  return `{ownerId:"${ownerId}", namespace:"custom", key:"${key}", type:"single_line_text_field", value:${JSON.stringify(value)}}`;
}

async function setMetafields(entries) {
  const errors = [];
  for (let i = 0; i < entries.length; i += 25) {
    const chunk = entries.slice(i, i + 25);
    const q = `mutation { metafieldsSet(metafields: [${chunk.map(e => metafieldInput(e.ownerId, e.key, e.value)).join(',')}]) { userErrors { field message } } }`;
    const data = await shopifyGraphQL(q);
    (data.metafieldsSet.userErrors || []).forEach(e => errors.push(e));
  }
  return errors;
}

module.exports = async (req, res) => {
  try {
    const dry = req.query && (req.query.dry === '1' || req.query.dry === 'true');
    if (!dry && (!STORE || !TOKEN)) return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN' });

    const matches = await (await fetch(MATCHES_URL)).json();
    const feed = await getFeed();

    const entries = [];
    const preview = [];
    let inStock = 0, dispatch = 0, mto = 0, missing = 0;
    for (const m of matches) {
      if (!m.supplierId || m.notFromSupplier) continue;
      const sp = feed[m.supplierId];
      if (!sp) { missing++; continue; }
      const f = computeFields(m.storeTitle, sp);
      if (f.dc_status === 'in_stock') inStock++; else if (f.dc_status === 'dispatch') dispatch++; else mto++;
      entries.push({ ownerId: m.storeId, key: 'dc_status', value: f.dc_status });
      entries.push({ ownerId: m.storeId, key: 'dc_production', value: f.dc_production });
      entries.push({ ownerId: m.storeId, key: 'dc_delivery_time', value: f.dc_delivery_time });
      preview.push({ product: m.storeTitle, status: f.dc_status || 'made-to-order', production: f.dc_production, delivery: f.dc_delivery_time });
    }

    const summary = { feedProducts: Object.keys(feed).length, matched: preview.length, inStock, dispatch, madeToOrder: mto, supplierItemMissing: missing };
    if (dry) return res.status(200).json({ dryRun: true, summary, preview });

    const errors = entries.length ? await setMetafields(entries) : [];
    return res.status(200).json({ ok: errors.length === 0, updated: preview.length, summary, errors });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
