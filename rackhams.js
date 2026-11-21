// rackhams.js — v0.1 (21 Nov 2026)
// READ-ONLY check for Rackhams (Marketplacer) adverts. Writes NOTHING — just reads.
//
// What it does:
//   1. Connects to the Marketplacer GraphQL API with RACKHAMS_API_KEY.
//   2. Lists the seller's adverts and reads each advert's Brand + sale status.
//   3. Reports: total on sale, a breakdown by brand, how many are NOT
//      "About Wall Art", and how many of those are currently on sale.
//   4. Returns a few sample non-About-Wall-Art adverts so we can confirm matching.
//
// Call (GET):
//   /api/rackhams                     -> scans DISPLAYED (currently on-sale) adverts
//   /api/rackhams?status=NOT_DISPLAYED
//   /api/rackhams?brand=About%20Wall%20Art   (override which brand counts as "mine")
//   /api/rackhams?maxpages=50         (safety cap on pages, default 300)

const ENDPOINT = 'https://rackhams.marketplacer.com/graphql';
const KEY = process.env.RACKHAMS_API_KEY;
const DEFAULT_BRAND = 'About Wall Art';
const PAGE_SIZE = 100;

async function mp(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) { throw new Error(`Non-JSON response (HTTP ${r.status}): ${text.slice(0, 400)}`); }
  if (d.errors) throw new Error('GraphQL error: ' + JSON.stringify(d.errors));
  return d.data;
}

const LIST_QUERY = `
query ($first: Int!, $after: String, $status: AdvertStatusEnum) {
  advertsWhere(first: $first, after: $after, status: $status) {
    totalCount
    nodes { id legacyId title published online displayable statusText brand { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COUNT_QUERY = `
query ($status: AdvertStatusEnum) {
  advertsWhere(first: 1, status: $status) { totalCount }
}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KEY) return res.status(500).json({ ok: false, error: 'Missing RACKHAMS_API_KEY in Vercel env' });

  const q = req.query || {};
  const status = (q.status || 'DISPLAYED').toString().toUpperCase();
  const myBrand = (q.brand || DEFAULT_BRAND).toString();
  const myBrandLc = myBrand.trim().toLowerCase();
  const maxPages = Math.max(1, Math.min(2000, parseInt(q.maxpages, 10) || 300));

  try {
    // --- Main pass: fully paginate the chosen status ---
    const nodes = [];
    let after = null, hasNext = true, pages = 0, totalCount = null;
    while (hasNext && pages < maxPages) {
      const data = await mp(LIST_QUERY, { first: PAGE_SIZE, after, status });
      const conn = data.advertsWhere;
      if (totalCount === null) totalCount = conn.totalCount;
      for (const n of (conn.nodes || [])) nodes.push(n);
      hasNext = conn.pageInfo && conn.pageInfo.hasNextPage;
      after = conn.pageInfo && conn.pageInfo.endCursor;
      pages++;
    }

    // --- Aggregate by brand ---
    const brandMap = new Map(); // name -> { count, onSale }
    let awaCount = 0, notAwaTotal = 0, notAwaOnSale = 0;
    const samplesNotAWA = [];
    const noBrand = { count: 0, onSale: 0 };

    for (const n of nodes) {
      const bname = n.brand && n.brand.name ? n.brand.name : null;
      const onSale = n.online === true; // truly purchasable
      if (bname === null) { noBrand.count++; if (onSale) noBrand.onSale++; }
      else {
        const cur = brandMap.get(bname) || { count: 0, onSale: 0 };
        cur.count++; if (onSale) cur.onSale++;
        brandMap.set(bname, cur);
      }
      const isMine = bname && bname.trim().toLowerCase() === myBrandLc;
      if (isMine) awaCount++;
      else {
        notAwaTotal++;
        if (onSale) notAwaOnSale++;
        if (samplesNotAWA.length < 20) {
          samplesNotAWA.push({
            legacyId: n.legacyId, id: n.id, title: n.title,
            brand: bname, online: n.online, published: n.published, statusText: n.statusText
          });
        }
      }
    }

    const brands = [...brandMap.entries()]
      .map(([name, v]) => ({ name, count: v.count, onSale: v.onSale }))
      .sort((a, b) => b.count - a.count);

    // --- Quick extra: how many adverts in the OTHER main status ---
    let otherStatus = status === 'DISPLAYED' ? 'NOT_DISPLAYED' : 'DISPLAYED';
    let otherCount = null;
    try {
      const od = await mp(COUNT_QUERY, { status: otherStatus });
      otherCount = od.advertsWhere.totalCount;
    } catch (e) { otherCount = 'error: ' + e.message; }

    return res.status(200).json({
      ok: true,
      endpoint: ENDPOINT,
      myBrand,
      statusChecked: status,
      totalCountForStatus: totalCount,
      scanned: nodes.length,
      pagesFetched: pages,
      truncated: hasNext, // true if we hit maxPages before finishing
      [`${otherStatus}_totalCount`]: otherCount,
      summary: {
        aboutWallArt_count: awaCount,
        notAboutWallArt_total: notAwaTotal,
        notAboutWallArt_onSale: notAwaOnSale
      },
      brands,
      noBrand,
      samplesNotAboutWallArt: samplesNotAWA,
      note: 'READ-ONLY. Nothing was changed in Rackhams. "onSale" = advert.online === true.'
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
