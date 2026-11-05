// DC Concept daily stock sync (Vercel serverless + cron). — v1.2 (5 Nov 2026)
// v1.2: SIMPLIFIED. Every DC Concept product is sold made-to-order with a fixed production time.
//   No supplier feed, no per-variant stock, no matches file. The daily cron just makes sure every
//   DC Concept product shows: "THIS PIECE IS MADE TO ORDER" + "Production Time: 6 weeks" and sits on
//   the dc-concepts theme template (so new ones are caught automatically).
//   To change the wording, edit PRODUCTION_TIME below.
// Reuses the Shopify token already in Vercel — nothing to copy.
// Triggered daily by the cron in vercel.json. Add ?dry=1 to preview without writing.

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-10';

// ---- wording (edit here to change what customers see) ----
const PRODUCTION_TIME = '6 weeks';

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

// Shopify won't "set" a blank value — to revert dc_status / dc_delivery_time to the made-to-order
// default (so the theme shows "THIS PIECE IS MADE TO ORDER") we DELETE those metafields.
async function deleteMetafields(entries) {
  const errors = [];
  for (let i = 0; i < entries.length; i += 25) {
    const chunk = entries.slice(i, i + 25);
    const q = `mutation { metafieldsDelete(metafields: [${chunk.map(e => `{ownerId:"${e.ownerId}", namespace:"custom", key:"${e.key}"}`).join(',')}]) { userErrors { field message } } }`;
    const data = await shopifyGraphQL(q);
    (data.metafieldsDelete.userErrors || []).forEach(e => errors.push(e));
  }
  return errors;
}

// Walk every DC Concept product: collect its id and whether it already sits on the dc-concepts template.
async function getDcProducts() {
  let after = null;
  const products = [];
  while (true) {
    const q = `query { products(first: 100, after: ${after ? `"${after}"` : 'null'}, query: "vendor:'DC Concept'") { pageInfo { hasNextPage endCursor } edges { node { id templateSuffix } } } }`;
    const c = (await shopifyGraphQL(q)).products;
    c.edges.forEach(e => products.push({ id: e.node.id, templateSuffix: e.node.templateSuffix }));
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return products;
}

async function moveTemplates(ids) {
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const m = `mutation { ${chunk.map((id, j) => `m${j}: productUpdate(input:{id:"${id}", templateSuffix:"dc-concepts"}){ userErrors { message } }`).join(' ')} }`;
    await shopifyGraphQL(m);
  }
}

module.exports = async (req, res) => {
  try {
    const dry = req.query && (req.query.dry === '1' || req.query.dry === 'true');
    if (!STORE || !TOKEN) return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN' });

    const products = await getDcProducts();
    const needTemplate = products.filter(p => p.templateSuffix !== 'dc-concepts').map(p => p.id);

    // Every product: set the fixed production time, clear status + delivery (made-to-order default).
    const toSet = products.map(p => ({ ownerId: p.id, key: 'dc_production', value: PRODUCTION_TIME }));
    const toDelete = [];
    products.forEach(p => {
      toDelete.push({ ownerId: p.id, key: 'dc_status' });
      toDelete.push({ ownerId: p.id, key: 'dc_delivery_time' });
    });

    const summary = { dcProducts: products.length, productionTime: PRODUCTION_TIME, templateMoved: needTemplate.length };
    if (dry) return res.status(200).json({ dryRun: true, summary });

    const errors = [];
    errors.push(...await setMetafields(toSet));
    errors.push(...await deleteMetafields(toDelete));
    await moveTemplates(needTemplate);

    return res.status(200).json({ ok: errors.length === 0, summary, errors });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
