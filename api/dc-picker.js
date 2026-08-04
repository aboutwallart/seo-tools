// Backend for the DC Concepts Picker (live version).
//   GET  /api/dc-picker            -> { store:[...], supplier:[...], matches:[...] }  (live product list + supplier feed + saved matches)
//   POST /api/dc-picker  body=[...] -> saves the matches array to data/dc-matches.json on GitHub
// Reuses env already in Vercel: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, GITHUB_TOKEN.

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const API_VERSION = '2024-10';
const REPO = 'aboutwallart/seo-tools';
const MATCHES_PATH = 'data/dc-matches.json';
const FEED_BASE = 'https://stock-list-inventory-system.vercel.app/api/customer-stock?category=';
const CATEGORIES = ['armchair','sofa','office','dining','coffee','outdoor','dressing','cabinet','wardrobe','other','clearance'];

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

async function getStoreProducts() {
  let after = null; const out = [];
  while (true) {
    const q = `query { products(first: 100, after: ${after ? `"${after}"` : 'null'}, query: "vendor:'DC Concept'") { pageInfo { hasNextPage endCursor } edges { node { id title status featuredImage { url } } } } }`;
    const c = (await shopifyGraphQL(q)).products;
    c.edges.forEach(e => {
      const n = e.node;
      if (n.status === 'ARCHIVED') return; // active + draft only
      out.push({ id: n.id, title: n.title, status: n.status, img: n.featuredImage ? n.featuredImage.url : '' });
    });
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  out.sort((a,b) => a.title.localeCompare(b.title));
  return out;
}

async function getSupplier() {
  const byId = {};
  for (const cat of CATEGORIES) {
    try {
      const r = await fetch(FEED_BASE + cat);
      if (!r.ok) continue;
      const j = await r.json();
      (j.products || []).forEach(p => {
        if (byId[p.productId]) return;
        byId[p.productId] = { id: p.productId, name: p.productName, img: p.imageUrl || '',
          vars: (p.variants || []).map(v => ({ n: v.variantName, s: v.stock, d: v.nextAvailableDays })) };
      });
    } catch (e) { /* skip */ }
  }
  return Object.values(byId).sort((a,b) => a.name.localeCompare(b.name));
}

// Put every DC Concept product (incl. drafts) on the dc-concepts template. Cheap when nothing to move.
async function ensureTemplates() {
  let after = null; const toMove = [];
  while (true) {
    const q = `query { products(first: 100, after: ${after ? `"${after}"` : 'null'}, query: "vendor:'DC Concept'") { pageInfo { hasNextPage endCursor } edges { node { id templateSuffix } } } }`;
    const c = (await shopifyGraphQL(q)).products;
    c.edges.forEach(e => { if (e.node.templateSuffix !== 'dc-concepts') toMove.push(e.node.id); });
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  for (let i = 0; i < toMove.length; i += 25) {
    const chunk = toMove.slice(i, i + 25);
    const m = `mutation { ${chunk.map((id, j) => `m${j}: productUpdate(input:{id:"${id}", templateSuffix:"dc-concepts"}){ userErrors { message } }`).join(' ')} }`;
    await shopifyGraphQL(m);
  }
  return toMove.length;
}

async function getSavedMatches() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${MATCHES_PATH}?t=${Date.now()}`);
    if (!r.ok) return [];
    return await r.json();
  } catch (e) { return []; }
}

async function saveMatches(matches) {
  const base = `https://api.github.com/repos/${REPO}/contents/${MATCHES_PATH}`;
  const headers = { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'dc-picker' };
  let sha;
  const cur = await fetch(`${base}?ref=main`, { headers });
  if (cur.ok) sha = (await cur.json()).sha;
  const content = Buffer.from(JSON.stringify(matches, null, 2)).toString('base64');
  const put = await fetch(base, { method: 'PUT', headers, body: JSON.stringify({
    message: 'Update DC Concept matches (from picker)', content, sha, branch: 'main' }) });
  if (!put.ok) throw new Error('GitHub save failed: ' + (await put.text()));
  return true;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (!GH_TOKEN) return res.status(500).json({ error: 'Missing GITHUB_TOKEN' });
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '[]');
      if (!Array.isArray(body)) return res.status(400).json({ error: 'Expected an array of matches' });
      await saveMatches(body);
      return res.status(200).json({ ok: true, saved: body.length });
    }
    // GET — first make sure all DC products (incl. new drafts) are on the dc-concepts template, then load
    const templateMoved = await ensureTemplates();
    const [store, supplier, matches] = await Promise.all([getStoreProducts(), getSupplier(), getSavedMatches()]);
    return res.status(200).json({ store, supplier, matches, templateMoved });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
