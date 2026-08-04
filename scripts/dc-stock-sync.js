#!/usr/bin/env node
/**
 * DC Concept daily stock sync.
 * Reads the supplier's live stock list + data/dc-matches.json, then writes each
 * matched product's availability into metafields (custom.dc_status / dc_production
 * / dc_delivery_time). The dc-concepts theme block reads those.
 *
 * Runs on a schedule via .github/workflows/dc-stock-sync.yml.
 * Needs env: SHOPIFY_STORE_DOMAIN (e.g. aboutwallart.myshopify.com), SHOPIFY_ACCESS_TOKEN.
 */
const fs = require('fs');
const path = require('path');

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-10';
const FEED_BASE = 'https://stock-list-inventory-system.vercel.app/api/customer-stock?category=';
const CATEGORIES = ['armchair','sofa','office','dining','coffee','outdoor','dressing','cabinet','wardrobe','other','clearance'];

// ---- wording (edit here to change what customers see) ----
const IN_STOCK_PRODUCTION = 'In stock';
const IN_STOCK_DELIVERY = '3–5 working days';
function dispatchStr(days){ return days <= 14 ? `${days} days` : `${Math.round(days/7)} weeks`; }

const DRY_RUN = process.env.DRY_RUN === '1';
if (!DRY_RUN && (!STORE || !TOKEN)) { console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN'); process.exit(1); }

async function getFeed() {
  const byId = {};
  for (const c of CATEGORIES) {
    try {
      const r = await fetch(FEED_BASE + c);
      if (!r.ok) { console.warn(`feed ${c}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      (j.products || []).forEach(p => { if (!byId[p.productId]) byId[p.productId] = p; });
    } catch (e) { console.warn(`feed ${c}: ${e.message}`); }
  }
  return byId;
}

// choose the supplier variant(s) relevant to a store product (colour/size word match)
function pickVariants(storeTitle, variants) {
  const t = (storeTitle || '').toLowerCase();
  const hit = (variants || []).filter(v => {
    const n = (v.variantName || '').toLowerCase().trim();
    return n && n.length > 1 && t.includes(n);
  });
  return hit.length ? hit : (variants || []);
}

// compute the three metafield values for one matched product
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
  // entries: [{ownerId,key,value}]  -> batch of <=25
  for (let i = 0; i < entries.length; i += 25) {
    const chunk = entries.slice(i, i + 25);
    const q = `mutation { metafieldsSet(metafields: [${chunk.map(e => metafieldInput(e.ownerId, e.key, e.value)).join(',')}]) { userErrors { field message } } }`;
    const data = await shopifyGraphQL(q);
    const errs = data.metafieldsSet.userErrors;
    if (errs && errs.length) console.error('metafield errors:', JSON.stringify(errs));
  }
}

(async () => {
  const matches = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dc-matches.json'), 'utf8'));
  const feed = await getFeed();
  console.log(`Feed products: ${Object.keys(feed).length} · matches file: ${matches.length}`);

  const entries = [];
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
  }

  if (!entries.length) { console.log('Nothing matched to update.'); return; }
  if (DRY_RUN) {
    const byProduct = {};
    entries.forEach(e => { (byProduct[e.ownerId] = byProduct[e.ownerId] || {})[e.key] = e.value; });
    for (const [id, f] of Object.entries(byProduct)) {
      const t = matches.find(m => m.storeId === id)?.storeTitle || id;
      console.log(`  ${t}  ->  status:${f.dc_status||'(default)'} | prod:${f.dc_production||'-'} | delivery:${f.dc_delivery_time||'(default)'}`);
    }
    console.log(`DRY RUN — would update ${entries.length/3} products (no changes made).`);
    return;
  }
  await setMetafields(entries);
  console.log(`Updated ${entries.length/3} products — in stock: ${inStock}, dispatch date: ${dispatch}, made-to-order: ${mto}, supplier item missing: ${missing}`);
})().catch(e => { console.error(e); process.exit(1); });
