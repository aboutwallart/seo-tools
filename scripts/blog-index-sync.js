#!/usr/bin/env node
/**
 * Daily blog list watcher.
 * Rebuilds data/blog-index.json from LIVE Shopify, so the saved blog list always
 * matches reality: blogs you delete drop out, new ones come in. Nothing to press.
 *
 * Why it exists: the blog list only ever ADDED new blogs (on publish), it never
 * removed deleted ones. A stale deleted blog in the list made publishing fail
 * ("Value references non-existent resource"). This keeps the list honest for every
 * tool that reads it. Costs no Claude/AI tokens — it only talks to Shopify + GitHub.
 *
 * Runs on a schedule via .github/workflows/blog-index-sync.yml.
 * Needs env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, GITHUB_TOKEN.
 */

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const API_VERSION = '2025-01';
const REPO = 'aboutwallart/seo-tools';
const INDEX_PATH = 'data/blog-index.json';
const NEWS_BLOG_ID = '93572858142';          // the one blog all articles live in
const NEWS_BLOG_HANDLE = 'news-articles-home-decor-inspiration';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!STORE || !TOKEN) { console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN'); process.exit(1); }
if (!DRY_RUN && !GH_TOKEN) { console.error('Missing GITHUB_TOKEN'); process.exit(1); }

async function shopifyGraphQL(query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!r.ok) throw new Error('Shopify error: ' + r.status);
  const d = await r.json();
  if (d.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(d.errors).slice(0, 300));
  return d.data;
}

// Pull every article (published + scheduled) from the news blog, live.
async function fetchAllArticles() {
  const out = [];
  let cursor = null;
  const QUERY = `query($c:String){ articles(first:250, after:$c, query:"blog_id:${NEWS_BLOG_ID}"){ pageInfo{ hasNextPage endCursor } edges{ node{ id title handle tags publishedAt blog{ handle } } } } }`;
  for (let page = 0; page < 30; page++) {
    let data = null;
    try { data = await shopifyGraphQL(QUERY, { c: cursor }); }
    catch (e1) { await new Promise(r => setTimeout(r, 800)); data = await shopifyGraphQL(QUERY, { c: cursor }); }
    const conn = data && data.articles; if (!conn) break;
    for (const e of (conn.edges || [])) {
      const n = e.node; if (!n || !n.id) continue;
      out.push({
        gid: n.id,
        handle: n.handle || '',
        title: n.title || '',
        tags: n.tags || [],
        blogHandle: (n.blog && n.blog.handle) || NEWS_BLOG_HANDLE,
        publishedAt: n.publishedAt || null
      });
    }
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

async function getGitHubSha(filePath) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'blog-index-sync' }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub read error: ' + r.status);
  const j = await r.json();
  return j.sha || null;
}

async function putGitHubFile(filePath, contentStr, sha, message) {
  const body = {
    message,
    content: Buffer.from(contentStr, 'utf8').toString('base64'),
    branch: 'main'
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'blog-index-sync' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub write error: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

(async () => {
  const articles = await fetchAllArticles();
  if (!articles.length) { console.error('Shopify returned no articles — not overwriting the list (safety).'); process.exit(1); }

  // Newest first (matches how the tool wrote it).
  articles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const index = { updatedAt: new Date().toISOString(), count: articles.length, articles };
  const out = JSON.stringify(index, null, 2);

  if (DRY_RUN) { console.log(`DRY RUN — ${articles.length} live blogs. Not writing.`); return; }

  // Skip the write if nothing actually changed (avoid a pointless daily commit).
  let sha = null, changed = true;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${INDEX_PATH}?_=${Date.now()}`);
    if (r.ok) { const prev = JSON.parse(await r.text()); changed = JSON.stringify(prev.articles || []) !== JSON.stringify(articles); }
  } catch (e) { /* if we can't read the old one, just write */ }
  if (!changed) { console.log(`No change — ${articles.length} live blogs, list already up to date.`); return; }

  sha = await getGitHubSha(INDEX_PATH);
  await putGitHubFile(INDEX_PATH, out, sha, `Blog list daily sync — ${articles.length} live blogs`);
  console.log(`Updated blog list — ${articles.length} live blogs.`);
})().catch(e => { console.error('blog-index-sync failed:', (e && e.message) || e); process.exit(1); });
