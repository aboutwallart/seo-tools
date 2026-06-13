module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopifyDomain || !accessToken) {
    return res.status(500).json({ error: 'Shopify credentials not configured' });
  }

  // -------------------------------------------------------
  // NEW: GET BLOGS BY MONTH — uses published_at date
  // -------------------------------------------------------
  if (req.query.action === 'get-blogs-by-month') {
    const month = req.query.month; // format: YYYY-MM
    if (!month) return res.status(400).json({ error: 'Missing month parameter (format: YYYY-MM)' });

    try {
      const [year, mon] = month.split('-');
      const startDate = `${year}-${mon}-01T00:00:00Z`;
      const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
      const endDate = `${year}-${mon}-${lastDay}T23:59:59Z`;

      const articles = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{
          articles(first: 250${cursorPart}, query: "published_at:>=${startDate} published_at:<=${endDate}") {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                publishedAt
                blog { handle title }
              }
            }
          }
        }`;

        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query })
        });

        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);

        const edges = data.data.articles.edges;
        edges.forEach(edge => {
          const node = edge.node;
          const blogHandle = node.blog ? node.blog.handle : 'news-articles-home-decor-inspiration';
          articles.push({
            id: node.id,
            title: node.title,
            handle: node.handle,
            publishedAt: node.publishedAt,
            url: `https://www.aboutwallart.com/blogs/${blogHandle}/${node.handle}`,
            blogTitle: node.blog ? node.blog.title : ''
          });
        });

        if (data.data.articles.pageInfo.hasNextPage) {
          cursor = data.data.articles.pageInfo.endCursor;
        } else {
          hasMore = false;
        }
      }

      return res.status(200).json({ success: true, month, articles });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // LINK WHISPERER — GET (read) and PUT (write links)
  // -------------------------------------------------------
  if (req.query.action === 'link-whisperer') {
    const endpoint = req.query.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint parameter' });

    const shopifyUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/' + endpoint;

    try {
      const fetchOptions = {
        method: req.method === 'PUT' ? 'PUT' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
      };

      if (req.method === 'PUT' && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const shopifyResponse = await fetch(shopifyUrl, fetchOptions);
      const responseText = await shopifyResponse.text();

      if (!shopifyResponse.ok) {
        return res.status(shopifyResponse.status).json({ error: true, status: shopifyResponse.status, message: responseText });
      }

      const linkHeader = shopifyResponse.headers.get('Link');
      if (linkHeader) res.setHeader('Link', linkHeader);

      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(responseText);

    } catch (err) {
      return res.status(500).json({ error: true, message: err.message });
    }
  }

  // -------------------------------------------------------
  // GET TITLES BY TYPE — returns all page titles of a given type for duplicate/similarity check
  // -------------------------------------------------------
  if (req.query.action === 'get-titles-by-type' && req.method === 'GET') {
    const type = req.query.type || '';
    if (!['product', 'collection', 'page', 'article'].includes(type)) {
      return res.status(400).json({ error: 'type must be product, collection, page, or article' });
    }
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const headers = { 'X-Shopify-Access-Token': accessToken };
    const items = [];

    async function fetchPaginated(startUrl, key, urlBuilder) {
      let url = startUrl;
      while (url) {
        const r = await fetch(url, { headers });
        const d = await r.json();
        (d[key] || []).forEach(item => {
          if (item.title) items.push({ title: item.title, url: urlBuilder(item) });
        });
        const link = r.headers.get('Link') || '';
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
      }
    }

    try {
      if (type === 'product') {
        await fetchPaginated(`${base}/products.json?limit=250&fields=id,title,handle&published_status=published`, 'products', i => `https://aboutwallart.com/products/${i.handle}`);
      } else if (type === 'collection') {
        await fetchPaginated(`${base}/custom_collections.json?limit=250&fields=id,title,handle`, 'custom_collections', i => `https://aboutwallart.com/collections/${i.handle}`);
        await fetchPaginated(`${base}/smart_collections.json?limit=250&fields=id,title,handle`, 'smart_collections', i => `https://aboutwallart.com/collections/${i.handle}`);
      } else if (type === 'page') {
        await fetchPaginated(`${base}/pages.json?limit=250&fields=id,title,handle`, 'pages', i => `https://aboutwallart.com/pages/${i.handle}`);
      } else if (type === 'article') {
        const blogsRes = await fetch(`${base}/blogs.json?fields=id,handle&limit=250`, { headers });
        const blogsData = await blogsRes.json();
        for (const blog of (blogsData.blogs || [])) {
          await fetchPaginated(`${base}/blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle`, 'articles', i => `https://aboutwallart.com/blogs/${blog.handle}/${i.handle}`);
        }
      }
      return res.status(200).json({ success: true, items, count: items.length });
    } catch(e) {
      return res.status(500).json({ error: 'Failed to fetch titles: ' + e.message });
    }
  }

  // -------------------------------------------------------
  // VERIFY URL — checks if a page URL exists in Shopify
  // -------------------------------------------------------
  if (req.query.action === 'verify-url' && req.method === 'GET') {
    const pageUrl = req.query.pageUrl || '';
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl required' });

    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const headers = { 'X-Shopify-Access-Token': accessToken };

    const path = pageUrl
      .replace('https://www.aboutwallart.com', '')
      .replace('https://aboutwallart.com', '')
      .replace(/\?.*$/, '')
      .replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);

    try {
      if (parts[0] === 'products' && parts[1]) {
        const r = await fetch(`${base}/products.json?handle=${encodeURIComponent(parts[1])}&fields=id,title,handle&limit=1`, { headers });
        const d = await r.json();
        const item = (d.products || [])[0];
        return res.status(200).json({ exists: !!item, title: item?.title || null, type: 'product' });
      }

      if (parts[0] === 'collections' && parts[1]) {
        const [cr, sr] = await Promise.all([
          fetch(`${base}/custom_collections.json?handle=${encodeURIComponent(parts[1])}&fields=id,title,handle&limit=1`, { headers }).then(r => r.json()),
          fetch(`${base}/smart_collections.json?handle=${encodeURIComponent(parts[1])}&fields=id,title,handle&limit=1`, { headers }).then(r => r.json())
        ]);
        const all = [...(cr.custom_collections || []), ...(sr.smart_collections || [])];
        const item = all[0];
        return res.status(200).json({ exists: !!item, title: item?.title || null, type: 'collection' });
      }

      if (parts[0] === 'pages' && parts[1]) {
        const r = await fetch(`${base}/pages.json?handle=${encodeURIComponent(parts[1])}&fields=id,title,handle&limit=1`, { headers });
        const d = await r.json();
        const item = (d.pages || [])[0];
        return res.status(200).json({ exists: !!item, title: item?.title || null, type: 'page' });
      }

      if (parts[0] === 'blogs' && parts[1] && parts[2]) {
        const blogsRes = await fetch(`${base}/blogs.json?fields=id,handle&limit=250`, { headers });
        const blogsData = await blogsRes.json();
        const blog = (blogsData.blogs || []).find(b => b.handle === parts[1]);
        if (!blog) return res.status(200).json({ exists: false });
        const artRes = await fetch(`${base}/blogs/${blog.id}/articles.json?fields=id,title,handle&limit=250`, { headers });
        const artData = await artRes.json();
        const article = (artData.articles || []).find(a => a.handle === parts[2]);
        return res.status(200).json({ exists: !!article, title: article?.title || null, type: 'article' });
      }

      return res.status(200).json({ exists: false, error: 'URL type not recognised — use /products/, /collections/, /pages/, or /blogs/' });
    } catch(e) {
      return res.status(500).json({ error: 'Verification failed: ' + e.message });
    }
  }

  // -------------------------------------------------------
  // AUTOLINK WEBHOOK — fires when Shopify creates a new item
  // -------------------------------------------------------
  if (req.query.action === 'autolink-webhook' && req.method === 'POST') {
    const shopifyDomainHeader = req.headers['x-shopify-domain'];
    if (shopifyDomainHeader && shopifyDomainHeader !== shopifyDomain) {
      return res.status(200).json({ ok: false, reason: 'domain mismatch' });
    }

    const topic = req.headers['x-shopify-topic'] || '';
    const payload = req.body;
    if (!payload || !payload.id) {
      return res.status(200).json({ ok: false, reason: 'no payload' });
    }

    let itemType = null;
    if (topic === 'products/create') itemType = 'product';
    else if (topic === 'collections/create') itemType = 'collection';
    else return res.status(200).json({ ok: true, skipped: true, reason: 'unsupported topic' });

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';

    async function ghGet(filePath) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!r.ok) throw new Error('GitHub fetch failed: ' + r.status);
      const d = await r.json();
      return { content: Buffer.from(d.content, 'base64').toString('utf-8'), sha: d.sha };
    }

    async function ghPut(filePath, content, sha, message) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) })
      });
      if (!r.ok) throw new Error('GitHub put failed: ' + await r.text());
    }

    function escRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function applyKeywordLink(html, keyword, url) {
      const escaped = escRegex(keyword);
      const parts = html.split(/(<[^>]*>)/);
      let insideAnchor = false;
      let replaced = false;
      const result = parts.map(part => {
        if (part.startsWith('<')) {
          if (/^<a[\s>]/i.test(part)) insideAnchor = true;
          if (/^<\/a>/i.test(part)) insideAnchor = false;
          return part;
        }
        if (insideAnchor || replaced) return part;
        const regex = new RegExp('(?<![\\w-])(' + escaped + ')(?![\\w-])', 'i');
        const newPart = part.replace(regex, '<a href="' + url + '">$1</a>');
        if (newPart !== part) replaced = true;
        return newPart;
      });
      return result.join('');
    }

    try {
      const bodyHtml = payload.body_html || '';

      const [rulesFile, settingsFile] = await Promise.all([
        ghGet('data/autolink-rules.json').catch(() => null),
        ghGet('data/lw-settings.json').catch(() => null)
      ]);

      const rules = rulesFile ? JSON.parse(rulesFile.content) : [];
      const settings = settingsFile ? JSON.parse(settingsFile.content) : {
        wordsToIgnore: [], dataTypes: ['product', 'page', 'article', 'collection'], ignoreNumbers: true
      };

      if (!(settings.dataTypes || []).includes(itemType)) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'type disabled in settings' });
      }

      const wordsToIgnoreSet = new Set((settings.wordsToIgnore || []).map(w => w.toLowerCase().trim()).filter(Boolean));
      const ignoreNumbers = settings.ignoreNumbers !== false;

      let updatedHtml = bodyHtml;
      const appliedIds = [];

      for (const rule of rules) {
        const keyword = (rule.keyword || '').trim();
        const url = (rule.url || '').trim();
        if (!keyword || !url) continue;
        if (wordsToIgnoreSet.has(keyword.toLowerCase())) continue;
        if (ignoreNumbers && /^\d+(\.\d+)?$/.test(keyword)) continue;
        if (updatedHtml.includes('href="' + url + '"') || updatedHtml.includes('href="https://aboutwallart.com' + url + '"')) continue;
        const newHtml = applyKeywordLink(updatedHtml, keyword, url);
        if (newHtml !== updatedHtml) {
          updatedHtml = newHtml;
          appliedIds.push(rule.id);
        }
      }

      if (!appliedIds.length) {
        return res.status(200).json({ ok: true, changed: false, rulesChecked: rules.length });
      }

      const shopifyBase = 'https://' + shopifyDomain + '/admin/api/2025-01/';
      const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
      let saveOk = false;

      if (itemType === 'product') {
        const r = await fetch(shopifyBase + 'products/' + payload.id + '.json', {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ product: { id: payload.id, body_html: updatedHtml } })
        });
        saveOk = r.ok;
      } else if (itemType === 'article') {
        const blogId = payload.blog_id;
        if (blogId) {
          const r = await fetch(shopifyBase + 'blogs/' + blogId + '/articles/' + payload.id + '.json', {
            method: 'PUT', headers: shopifyHeaders,
            body: JSON.stringify({ article: { id: payload.id, body_html: updatedHtml } })
          });
          saveOk = r.ok;
        }
      } else if (itemType === 'collection') {
        const isSmartCollection = Array.isArray(payload.rules);
        const collType = isSmartCollection ? 'smart_collections' : 'custom_collections';
        const bodyKey  = isSmartCollection ? 'smart_collection' : 'custom_collection';
        const r = await fetch(shopifyBase + collType + '/' + payload.id + '.json', {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ [bodyKey]: { id: payload.id, body_html: updatedHtml } })
        });
        saveOk = r.ok;
      }

      if (!saveOk) {
        return res.status(200).json({ ok: false, reason: 'shopify save failed', appliedIds });
      }

      if (rulesFile) {
        const updatedRules = rules.map(r =>
          appliedIds.includes(r.id) ? { ...r, linksAdded: (r.linksAdded || 0) + 1 } : r
        );
        await ghPut('data/autolink-rules.json', JSON.stringify(updatedRules, null, 2), rulesFile.sha, 'Auto-link applied: ' + appliedIds.length + ' rule(s)').catch(() => {});
      }

      return res.status(200).json({ ok: true, changed: true, rulesApplied: appliedIds.length, itemType });

    } catch (err) {
      console.error('Autolink webhook error:', err.message);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // REGISTER AUTOLINK WEBHOOKS — called from Settings tab
  // -------------------------------------------------------
  if (req.query.action === 'register-autolink-webhooks' && req.method === 'POST') {
    const webhookAddress = 'https://tools.aboutwallart.com/api/shopify-files?action=autolink-webhook';
    const topics = ['products/create', 'collections/create'];
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };

    try {
      // Delete existing webhooks with our address
      const existingRes = await fetch('https://' + shopifyDomain + '/admin/api/2025-01/webhooks.json?limit=250', {
        headers: { 'X-Shopify-Access-Token': accessToken }
      });
      const existingData = await existingRes.json();
      const toDelete = (existingData.webhooks || []).filter(w => (w.address || '').includes('action=autolink-webhook'));
      for (const w of toDelete) {
        await fetch('https://' + shopifyDomain + '/admin/api/2025-01/webhooks/' + w.id + '.json', {
          method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken }
        });
        await new Promise(r => setTimeout(r, 300));
      }
      if (toDelete.length) await new Promise(r => setTimeout(r, 500));

      // Register webhooks
      const created = [];
      for (const topic of topics) {
        const r = await fetch('https://' + shopifyDomain + '/admin/api/2025-01/webhooks.json', {
          method: 'POST', headers: shopifyHeaders,
          body: JSON.stringify({ webhook: { topic, address: webhookAddress, format: 'json' } })
        });
        const d = await r.json();
        if (d.webhook) created.push({ topic, id: d.webhook.id });
        else created.push({ topic, error: JSON.stringify(d.errors || d) });
        await new Promise(r => setTimeout(r, 300));
      }

      return res.status(200).json({ success: true, deleted: toDelete.length, created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // GET PRODUCT ID — resolve handle to numeric Shopify ID
  // -------------------------------------------------------
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body?.action === 'get-product-id') {
      const { handle } = body;
      if (!handle) return res.status(400).json({ error: 'Missing handle' });
      const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken };
      const r = await fetch(`https://${shopifyDomain}/admin/api/2025-01/products.json?handle=${encodeURIComponent(handle)}&fields=id`, { headers: shopifyHeaders });
      const data = await r.json();
      const id = data.products?.[0]?.id;
      if (!id) return res.status(404).json({ error: 'Product not found' });
      return res.status(200).json({ id });
    }
  }

  // -------------------------------------------------------
  // SEO UPDATE — push title, meta, description to Shopify
  // -------------------------------------------------------
  if (req.query.action === 'seo-update' && req.method === 'POST') {
    const { shopifyId, shopifyBlogId, shopifyType, seoTitle, seoMeta, description } = req.body;
    if (!shopifyId || !shopifyType) return res.status(400).json({ error: 'Missing shopifyId or shopifyType' });

    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;

    // Determine resource path and body key
    const typeMap = {
      product:           { path: `products/${shopifyId}`,                          key: 'product' },
      custom_collection: { path: `custom_collections/${shopifyId}`,                key: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,                 key: 'smart_collection' },
      page:              { path: `pages/${shopifyId}`,                             key: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`,   key: 'article' }
    };
    const resource = typeMap[shopifyType];
    if (!resource) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });

    const errors = [];

    // 0. Append HTML to existing body_html (for internal links)
    if (req.body.appendHtml) {
      try {
        const r = await fetch(`${base}/${resource.path}.json`, { headers: shopifyHeaders });
        const d = await r.json();
        const existing = d[resource.key]?.body_html || '';
        const appended = existing + req.body.appendHtml;
        const w = await fetch(`${base}/${resource.path}.json`, {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ [resource.key]: { id: parseInt(shopifyId), body_html: appended } })
        });
        if (!w.ok) { const e = await w.json(); errors.push(`Append: ${JSON.stringify(e.errors || w.statusText)}`); }
        else { return res.status(200).json({ success: true }); }
      } catch (err) { errors.push(`Append: ${err.message}`); }
    }

    // 1. Update body_html (description)
    if (description) {
      try {
        const r = await fetch(`${base}/${resource.path}.json`, {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ [resource.key]: { id: parseInt(shopifyId), body_html: description } })
        });
        if (!r.ok) { const d = await r.json(); errors.push(`Description: ${JSON.stringify(d.errors || r.statusText)}`); }
      } catch (err) { errors.push(`Description: ${err.message}`); }
    }

    // 2. Get existing metafields to find IDs for upsert
    let existingMeta = [];
    try {
      const r = await fetch(`${base}/${resource.path}/metafields.json?namespace=global`, { headers: shopifyHeaders });
      const d = await r.json();
      existingMeta = d.metafields || [];
    } catch (err) { errors.push(`Metafields fetch: ${err.message}`); }

    // Helper: create or update a metafield
    async function upsertMeta(key, value) {
      const existing = existingMeta.find(m => m.namespace === 'global' && m.key === key);
      if (existing) {
        const r = await fetch(`${base}/metafields/${existing.id}.json`, {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ metafield: { id: existing.id, value } })
        });
        return r.ok;
      } else {
        const r = await fetch(`${base}/${resource.path}/metafields.json`, {
          method: 'POST', headers: shopifyHeaders,
          body: JSON.stringify({ metafield: { namespace: 'global', key, value, type: 'single_line_text_field' } })
        });
        return r.ok;
      }
    }

    // 3. Update SEO title
    if (seoTitle) {
      try { if (!await upsertMeta('title_tag', seoTitle)) errors.push('Title update failed'); }
      catch (err) { errors.push(`Title: ${err.message}`); }
    }

    // 4. Update SEO meta description
    if (seoMeta) {
      try { if (!await upsertMeta('description_tag', seoMeta)) errors.push('Meta update failed'); }
      catch (err) { errors.push(`Meta: ${err.message}`); }
    }

    return res.status(errors.length ? 207 : 200).json({ success: errors.length === 0, errors });
  }

  // -------------------------------------------------------
  // GENERATE REDIRECTS — build /fr/ + /es/ list from Shopify
  // -------------------------------------------------------
  if (req.query.action === 'generate-redirects') {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;

    try {
      const paths = [];

      // 1. Products — vendor "About Wall Art" only, via GraphQL pagination
      let cursor = null, hasMore = true;
      while (hasMore) {
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{ products(first:250${cursorPart}, query:"vendor:'About Wall Art'") { pageInfo { hasNextPage endCursor } edges { node { handle } } } }`;
        const r = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query })
        });
        const d = await r.json();
        (d.data.products.edges || []).forEach(e => paths.push(`/products/${e.node.handle}`));
        hasMore = d.data.products.pageInfo.hasNextPage;
        cursor = d.data.products.pageInfo.endCursor;
      }

      // 2. Collections — all, via REST pagination
      let page = `${base}/custom_collections.json?limit=250&fields=handle`;
      while (page) {
        const r = await fetch(page, { headers: shopifyHeaders });
        const d = await r.json();
        (d.custom_collections || []).forEach(c => paths.push(`/collections/${c.handle}`));
        const link = r.headers.get('Link') || '';
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        page = next ? next[1] : null;
      }
      page = `${base}/smart_collections.json?limit=250&fields=handle`;
      while (page) {
        const r = await fetch(page, { headers: shopifyHeaders });
        const d = await r.json();
        (d.smart_collections || []).forEach(c => paths.push(`/collections/${c.handle}`));
        const link = r.headers.get('Link') || '';
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        page = next ? next[1] : null;
      }

      // 3. Blog articles — all, via REST pagination
      const blogsR = await fetch(`${base}/blogs.json?limit=250&fields=id,handle`, { headers: shopifyHeaders });
      const blogsD = await blogsR.json();
      for (const blog of (blogsD.blogs || [])) {
        page = `${base}/blogs/${blog.id}/articles.json?limit=250&fields=handle`;
        while (page) {
          const r = await fetch(page, { headers: shopifyHeaders });
          const d = await r.json();
          (d.articles || []).forEach(a => paths.push(`/blogs/${blog.handle}/${a.handle}`));
          const link = r.headers.get('Link') || '';
          const next = link.match(/<([^>]+)>;\s*rel="next"/);
          page = next ? next[1] : null;
        }
      }

      // 4. Pages — all, via REST pagination
      page = `${base}/pages.json?limit=250&fields=handle`;
      while (page) {
        const r = await fetch(page, { headers: shopifyHeaders });
        const d = await r.json();
        (d.pages || []).forEach(p => paths.push(`/pages/${p.handle}`));
        const link = r.headers.get('Link') || '';
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        page = next ? next[1] : null;
      }

      // Generate /fr/ and /es/ pairs
      const redirects = [];
      for (const path of paths) {
        redirects.push({ from: `/fr${path}`, to: path });
        redirects.push({ from: `/es${path}`, to: path });
      }

      // Read already-pushed list from GitHub
      let pushedSet = new Set();
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/data/pushed-redirects.json`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (r.ok) {
          const d = await r.json();
          const content = Buffer.from(d.content, 'base64').toString('utf-8');
          JSON.parse(content).forEach(u => pushedSet.add(u));
        }
      } catch(e) {}

      const newRedirects = redirects.filter(r => !pushedSet.has(r.from));

      return res.status(200).json({
        success: true,
        total: redirects.length,
        alreadyPushed: redirects.length - newRedirects.length,
        newCount: newRedirects.length,
        redirects: newRedirects
      });

    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // CREATE REDIRECTS — push a batch to Shopify
  // -------------------------------------------------------
  if (req.query.action === 'create-redirects' && req.method === 'POST') {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const { redirects } = req.body;

    if (!redirects || !Array.isArray(redirects)) {
      return res.status(400).json({ error: 'Missing redirects array' });
    }

    try {
      // Read current pushed list from GitHub
      let pushedList = [];
      let fileSha = null;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/data/pushed-redirects.json`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (r.ok) {
          const d = await r.json();
          fileSha = d.sha;
          pushedList = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8'));
        }
      } catch(e) {}

      const pushedSet = new Set(pushedList);
      const toCreate = redirects.filter(r => !pushedSet.has(r.from));

      // Create redirects in parallel (batches to respect rate limits)
      const results = await Promise.all(toCreate.map(async ({ from, to }) => {
        try {
          const r = await fetch(`https://${shopifyDomain}/admin/api/2025-01/redirects.json`, {
            method: 'POST', headers: shopifyHeaders,
            body: JSON.stringify({ redirect: { path: from, target: to } })
          });
          const d = await r.json();
          if (d.redirect) return { ok: true, from };
          return { ok: false, from, error: JSON.stringify(d.errors || d) };
        } catch(e) {
          return { ok: false, from, error: e.message };
        }
      }));

      const created = results.filter(r => r.ok).map(r => r.from);
      const errors = results.filter(r => !r.ok);

      // Update GitHub pushed list
      const newPushedList = [...pushedList, ...created];
      await fetch(`https://api.github.com/repos/${REPO}/contents/data/pushed-redirects.json`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Add ${created.length} redirects`,
          content: Buffer.from(JSON.stringify(newPushedList, null, 2)).toString('base64'),
          ...(fileSha ? { sha: fileSha } : {})
        })
      });

      return res.status(200).json({ success: true, created: created.length, skipped: redirects.length - toCreate.length, errors: errors.length });

    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // BLOG AUDIT METAFIELDS — fetch all articles + blog_products_list metafield
  // Used by Orphaned Products Detector tab in Link Whisperer
  // -------------------------------------------------------
  if (req.query.action === 'blog-audit-metafields' && req.method === 'GET') {
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };

    try {
      // Map: productGid -> [ { articleTitle, articleHandle, blogHandle, publishedAt } ]
      const productMap = {};
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{
          articles(first: 250${cursorPart}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                publishedAt
                blog { handle }
                metafield(namespace: "custom", key: "blog_products_list") {
                  value
                }
              }
            }
          }
        }`;

        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: shopifyHeaders,
          body: JSON.stringify({ query })
        });

        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);

        const edges = (data.data.articles.edges || []);
        for (const edge of edges) {
          const node = edge.node;
          const mfValue = node.metafield ? node.metafield.value : null;
          if (!mfValue) continue;
          let gids = [];
          try { gids = JSON.parse(mfValue); } catch(e) { continue; }
          for (const gid of gids) {
            if (!gid) continue;
            if (!productMap[gid]) productMap[gid] = [];
            productMap[gid].push({
              articleTitle: node.title,
              articleHandle: node.handle,
              blogHandle: node.blog ? node.blog.handle : '',
              publishedAt: node.publishedAt || null
            });
          }
        }

        hasMore = data.data.articles.pageInfo.hasNextPage;
        cursor = data.data.articles.pageInfo.endCursor;
      }

      return res.status(200).json({ success: true, productMap });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // BLOG SLOT MAP — all articles with slot counts + duplicates
  // -------------------------------------------------------
  if (req.query.action === 'blog-slot-map' && req.method === 'GET') {
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    try {
      const articles = [];
      let cursor = null, hasMore = true;
      while (hasMore) {
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{
          articles(first: 250${cursorPart}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id title handle publishedAt
                blog { handle }
                metafield(namespace: "custom", key: "blog_products_list") { id value }
              }
            }
          }
        }`;
        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query })
        });
        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);
        for (const edge of data.data.articles.edges) {
          const node = edge.node;
          let productGids = [];
          if (node.metafield && node.metafield.value) {
            try { productGids = JSON.parse(node.metafield.value).filter(Boolean); } catch(e) {}
          }
          const numericId = node.id.replace('gid://shopify/Article/', '');
          articles.push({
            gid: node.id, numericId,
            title: node.title, handle: node.handle,
            blogHandle: node.blog ? node.blog.handle : '',
            publishedAt: node.publishedAt || null,
            productGids, freeSlots: Math.max(0, 4 - productGids.length),
            duplicateGids: [], metafieldId: node.metafield ? node.metafield.id : null
          });
        }
        hasMore = data.data.articles.pageInfo.hasNextPage;
        cursor = data.data.articles.pageInfo.endCursor;
      }
      // Build cross-post frequency map — flag products appearing in more than 1 post
      const gidPostCount = {};
      for (const a of articles) {
        for (const g of a.productGids) {
          gidPostCount[g] = (gidPostCount[g] || 0) + 1;
        }
      }
      for (const a of articles) {
        a.duplicateGids = [...new Set(a.productGids.filter(g => gidPostCount[g] > 1))];
      }
      return res.status(200).json({ success: true, articles });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // PRODUCT IMAGES — fetch featured images for product GIDs
  // -------------------------------------------------------
  if (req.query.action === 'product-images' && req.method === 'GET') {
    const gids = (req.query.gids || '').split(',').map(g => decodeURIComponent(g.trim())).filter(Boolean).slice(0, 500);
    if (!gids.length) return res.status(200).json({ success: true, products: {} });
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    try {
      const products = {};
      for (let i = 0; i < gids.length; i += 50) {
        const batch = gids.slice(i, i + 50);
        const idsJson = JSON.stringify(batch);
        const query = `{ nodes(ids: ${idsJson}) { ... on Product { id title handle vendor images(first:1) { edges { node { url } } } } } }`;
        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query })
        });
        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);
        for (const node of (data.data.nodes || [])) {
          if (!node || !node.id) continue;
          const imgUrl = node.images && node.images.edges && node.images.edges[0]
            ? node.images.edges[0].node.url + '&width=200' : null;
          products[node.id] = { title: node.title, handle: node.handle, vendor: node.vendor || '', image: imgUrl };
        }
      }
      return res.status(200).json({ success: true, products });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // UPDATE BLOG PRODUCTS — set blog_products_list metafield
  // -------------------------------------------------------
  if (req.query.action === 'update-blog-products' && req.method === 'POST') {
    const { articleGid, productGids } = req.body;
    if (!articleGid || !Array.isArray(productGids)) {
      return res.status(400).json({ error: 'Missing articleGid or productGids' });
    }
    const uniqueGids = [...new Set(productGids.filter(Boolean))];
    if (uniqueGids.length > 4) return res.status(400).json({ error: 'Cannot set more than 4 products' });
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    try {
      const checkQuery = `{ node(id: "${articleGid}") { ... on Article { id metafield(namespace:"custom",key:"blog_products_list"){value} } } }`;
      const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
        method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: checkQuery })
      });
      const checkData = await checkRes.json();
      if (checkData.errors) throw new Error(checkData.errors[0].message);
      const mutation = `mutation metafieldsSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id value } userErrors { field message } } }`;
      const variables = { m: [{ ownerId: articleGid, namespace: 'custom', key: 'blog_products_list', value: JSON.stringify(uniqueGids), type: 'list.product_reference' }] };
      const mutRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
        method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: mutation, variables })
      });
      const mutData = await mutRes.json();
      if (mutData.errors) throw new Error(mutData.errors[0].message);
      const userErrors = mutData.data?.metafieldsSet?.userErrors || [];
      if (userErrors.length) throw new Error(userErrors[0].message);
      return res.status(200).json({ success: true, productGids: uniqueGids });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // GALLERY MANAGER — Lookfy-style shoppable gallery tool
  // Galleries stored in GitHub: data/galleries.json
  // -------------------------------------------------------
  if (req.query.action === 'gallery-manager') {
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    const gqlUrl = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
    const restBase = `https://${shopifyDomain}/admin/api/2025-01`;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const GALLERIES_FILE = 'data/galleries.json';

    async function ghGet(filePath) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (r.status === 404) return null; // file doesn't exist yet
      if (!r.ok) throw new Error('GitHub fetch failed: ' + r.status);
      const d = await r.json();
      return { content: Buffer.from(d.content, 'base64').toString('utf-8'), sha: d.sha };
    }

    async function ghPut(filePath, content, sha, message) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) })
      });
      if (!r.ok) throw new Error('GitHub put failed: ' + await r.text());
    }

    async function readGalleries() {
      const file = await ghGet(GALLERIES_FILE);
      if (!file) return { galleries: [], sha: null };
      return { galleries: JSON.parse(file.content), sha: file.sha };
    }

    async function writeGalleries(galleries, sha, message) {
      await ghPut(GALLERIES_FILE, JSON.stringify(galleries, null, 2), sha, message);
    }

    // ---- GET handlers ----
    if (req.method === 'GET') {
      const subAction = req.query.subAction;

      if (subAction === 'list-galleries') {
        try {
          const { galleries } = await readGalleries();
          return res.status(200).json({ success: true, galleries });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'get-gallery') {
        const id = parseInt(req.query.id);
        if (!id) return res.status(400).json({ error: 'Missing id' });
        try {
          const { galleries } = await readGalleries();
          const gallery = galleries.find(g => g.id === id);
          if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
          return res.status(200).json({ success: true, gallery });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'list-products') {
        try {
          const products = [];
          let page = `${restBase}/products.json?limit=250&fields=id,title,handle,images,variants&status=active`;
          while (page) {
            const r = await fetch(page, { headers: { 'X-Shopify-Access-Token': accessToken } });
            const d = await r.json();
            (d.products || []).forEach(p => products.push(p));
            const link = r.headers.get('Link') || '';
            const next = link.match(/<([^>]+)>;\s*rel="next"/);
            page = next ? next[1] : null;
          }
          return res.status(200).json({ success: true, products });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'list-collections') {
        try {
          const collections = [];
          for (const type of ['custom_collections', 'smart_collections']) {
            let page = `${restBase}/${type}.json?limit=250&fields=id,title,handle,image`;
            while (page) {
              const r = await fetch(page, { headers: { 'X-Shopify-Access-Token': accessToken } });
              const d = await r.json();
              const key = type === 'custom_collections' ? 'custom_collections' : 'smart_collections';
              (d[key] || []).forEach(c => collections.push({ ...c, collectionType: type }));
              const link = r.headers.get('Link') || '';
              const next = link.match(/<([^>]+)>;\s*rel="next"/);
              page = next ? next[1] : null;
            }
          }
          return res.status(200).json({ success: true, collections });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'list-pages') {
        try {
          const pages = [];
          let page = `${restBase}/pages.json?limit=250&fields=id,title,handle`;
          while (page) {
            const r = await fetch(page, { headers: { 'X-Shopify-Access-Token': accessToken } });
            const d = await r.json();
            (d.pages || []).forEach(p => pages.push(p));
            const link = r.headers.get('Link') || '';
            const next = link.match(/<([^>]+)>;\s*rel="next"/);
            page = next ? next[1] : null;
          }
          return res.status(200).json({ success: true, pages });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      return res.status(400).json({ error: 'Unknown subAction' });
    }

    // ---- POST handlers ----
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const subAction = body.subAction || req.query.subAction;

      if (subAction === 'save-gallery') {
        const gallery = body.gallery;
        if (!gallery || !gallery.title) return res.status(400).json({ error: 'Missing gallery data' });
        try {
          const { galleries, sha } = await readGalleries();
          if (gallery.id) {
            const idx = galleries.findIndex(g => g.id === gallery.id);
            if (idx >= 0) galleries[idx] = gallery;
            else galleries.push(gallery);
          } else {
            // Auto-generate ID only if none provided
            const maxId = galleries.reduce((m, g) => Math.max(m, g.id || 0), 10000);
            gallery.id = maxId + 1;
            gallery.createdAt = new Date().toISOString().split('T')[0];
            galleries.push(gallery);
          }
          await writeGalleries(galleries, sha, `Gallery save: ${gallery.title} (${gallery.id})`);
          return res.status(200).json({ success: true, gallery });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'delete-gallery') {
        const id = parseInt(body.id);
        if (!id) return res.status(400).json({ error: 'Missing id' });
        try {
          const { galleries, sha } = await readGalleries();
          await writeGalleries(galleries.filter(g => g.id !== id), sha, `Gallery delete: ${id}`);
          return res.status(200).json({ success: true });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'upload-image') {
        const { base64, filename, mimeType } = body;
        if (!base64 || !filename) return res.status(400).json({ error: 'Missing base64 or filename' });
        const mime = mimeType || 'image/jpeg';
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        try {
          // 1. Create staged upload target
          const stagedMutation = `mutation {
            stagedUploadsCreate(input: { resource: FILE, filename: "${safeFilename}", mimeType: "${mime}", httpMethod: POST }) {
              stagedTargets { url resourceUrl parameters { name value } }
              userErrors { field message }
            }
          }`;
          const sr = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: stagedMutation }) });
          const sd = await sr.json();
          if (sd.errors) throw new Error(sd.errors[0].message);
          const ue1 = sd.data.stagedUploadsCreate.userErrors || [];
          if (ue1.length) throw new Error(ue1[0].message);
          const target = sd.data.stagedUploadsCreate.stagedTargets[0];

          // 2. Upload binary to staged target
          const imageBuffer = Buffer.from(base64, 'base64');
          const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
          let formParts = '';
          for (const p of target.parameters) {
            formParts += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
          }
          formParts += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`;
          const bodyBuf = Buffer.concat([Buffer.from(formParts, 'utf8'), imageBuffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
          const ur = await fetch(target.url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: bodyBuf });
          if (!ur.ok) { const t = await ur.text(); throw new Error('Upload failed: ' + t.slice(0, 200)); }

          // 3. Register in Shopify Files
          const createMutation = `mutation {
            fileCreate(files: [{ originalSource: "${target.resourceUrl}", contentType: IMAGE, alt: "${safeFilename}" }]) {
              files { ... on MediaImage { id image { url } } }
              userErrors { field message }
            }
          }`;
          const cr = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: createMutation }) });
          const cd = await cr.json();
          if (cd.errors) throw new Error(cd.errors[0].message);
          const ue2 = cd.data.fileCreate.userErrors || [];
          if (ue2.length) throw new Error(ue2[0].message);
          const file = cd.data.fileCreate.files[0];

          // 4. Poll for CDN URL (Shopify processes async)
          let cdnUrl = file?.image?.url || null;
          if (!cdnUrl) {
            await new Promise(r => setTimeout(r, 3000));
            const pollQuery = `{ files(first: 5, query: "filename:${safeFilename}") { edges { node { ... on MediaImage { id image { url } } } } } }`;
            const pr = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: pollQuery }) });
            const pd = await pr.json();
            cdnUrl = pd.data?.files?.edges?.[0]?.node?.image?.url || target.resourceUrl;
          }

          return res.status(200).json({ success: true, url: cdnUrl, fileId: file?.id || null });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      // ---- Webhook: auto-replace archived product hotspots ----
      if (subAction === 'product-archived-webhook') {
        // Shopify products/update webhook fires here when a product is archived
        const payload = body.payload || body;
        if (!payload || !payload.id || payload.status !== 'archived') {
          return res.status(200).json({ ok: true, skipped: true, reason: 'not archived or no payload' });
        }

        try {
          const archivedProductId = String(payload.id);
          const archivedGid = `gid://shopify/Product/${archivedProductId}`;
          const archivedTags = (payload.tags || '').split(',').map(t => t.trim()).filter(Boolean);

          const { galleries, sha } = await readGalleries();
          if (!galleries.length) return res.status(200).json({ ok: true, skipped: true, reason: 'no galleries' });

          // Find all galleries + images that have a hotspot linking to the archived product
          let affectedCount = 0;
          const updatedGalleries = galleries.map(gallery => {
            if (!gallery.images) return gallery;
            const updatedImages = gallery.images.map(img => {
              if (!img.hotspots) return img;
              const updatedHotspots = img.hotspots.map(hs => {
                if (hs.productId !== archivedProductId && hs.productGid !== archivedGid) return hs;
                // Mark for replacement — replacement happens below
                affectedCount++;
                return { ...hs, _needsReplacement: true, _archivedProductId: archivedProductId, _archivedTags: archivedTags };
              });
              return { ...img, hotspots: updatedHotspots };
            });
            return { ...gallery, images: updatedImages };
          });

          if (!affectedCount) return res.status(200).json({ ok: true, skipped: true, reason: 'product not in any gallery hotspot' });

          // Find a replacement: active product sharing the most tags
          let replacementProduct = null;
          if (archivedTags.length > 0) {
            const tagQuery = archivedTags.slice(0, 3).map(t => `tag:'${t}'`).join(' OR ');
            const searchQuery = `{ products(first: 10, query: "status:active ${tagQuery}") { edges { node { id title handle tags images(first:1) { edges { node { url } } } } } } }`;
            const sr = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: searchQuery }) });
            const sd = await sr.json();
            const candidates = (sd.data?.products?.edges || [])
              .map(e => e.node)
              .filter(p => p.id !== archivedGid);
            // Pick the one with the most matching tags
            replacementProduct = candidates.sort((a, b) => {
              const aMatches = (a.tags || []).filter(t => archivedTags.includes(t)).length;
              const bMatches = (b.tags || []).filter(t => archivedTags.includes(t)).length;
              return bMatches - aMatches;
            })[0] || null;
          }

          // Apply replacement or remove hotspot if no match found
          const finalGalleries = updatedGalleries.map(gallery => {
            if (!gallery.images) return gallery;
            let galleryNeedsReview = false;
            const updatedImages = gallery.images.map(img => {
              if (!img.hotspots) return img;
              const updatedHotspots = img.hotspots.map(hs => {
                if (!hs._needsReplacement) return hs;
                if (replacementProduct) {
                  const numericId = replacementProduct.id.replace('gid://shopify/Product/', '');
                  return {
                    id: hs.id, x: hs.x, y: hs.y,
                    productId: numericId,
                    productGid: replacementProduct.id,
                    productTitle: replacementProduct.title,
                    productHandle: replacementProduct.handle,
                    productImage: replacementProduct.images?.edges?.[0]?.node?.url || ''
                  };
                }
                // No replacement found — remove hotspot, flag gallery
                galleryNeedsReview = true;
                return null;
              }).filter(Boolean);
              return { ...img, hotspots: updatedHotspots };
            });
            return { ...gallery, images: updatedImages, ...(galleryNeedsReview ? { needsReview: true } : {}) };
          });

          await writeGalleries(finalGalleries, sha, `Auto-replace archived product ${archivedProductId}`);
          return res.status(200).json({
            ok: true, affectedHotspots: affectedCount,
            replacedWith: replacementProduct ? replacementProduct.title : null,
            removedHotspots: replacementProduct ? 0 : affectedCount
          });

        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      if (subAction === 'register-gallery-webhook') {
        // Register the products/update webhook pointing to the gallery manager handler
        const webhookAddress = `https://tools.aboutwallart.com/api/shopify-files?action=gallery-manager&subAction=product-archived-webhook`;
        try {
          // Remove any existing gallery webhook
          const existingRes = await fetch(`${restBase}/webhooks.json?limit=250`, { headers: { 'X-Shopify-Access-Token': accessToken } });
          const existingData = await existingRes.json();
          const toDelete = (existingData.webhooks || []).filter(w => (w.address || '').includes('subAction=product-archived-webhook'));
          for (const w of toDelete) {
            await fetch(`${restBase}/webhooks/${w.id}.json`, { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } });
          }
          // Register fresh
          const r = await fetch(`${restBase}/webhooks.json`, {
            method: 'POST', headers: shopifyHeaders,
            body: JSON.stringify({ webhook: { topic: 'products/update', address: webhookAddress, format: 'json' } })
          });
          const d = await r.json();
          if (d.webhook) return res.status(200).json({ success: true, webhookId: d.webhook.id });
          return res.status(500).json({ error: JSON.stringify(d.errors || d) });
        } catch (e) { return res.status(500).json({ error: e.message }); }
      }

      return res.status(400).json({ error: 'Unknown subAction' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // -------------------------------------------------------
  // EXISTING IMAGE OPTIMIZER ACTIONS — POST only
  // -------------------------------------------------------
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const action = body.action;
    const imageUrl = body.imageUrl;
    const optimizedImageBase64 = body.optimizedImageBase64;
    const altText = body.altText || '';
    const safeAltText = altText.replace(/"/g, '\\"').replace(/\n/g, ' ');

    if (action === 'update_alt_only') {
      console.log('Updating alt text for: ' + imageUrl);

      function extractFilename(url) { return url.split('/').pop().split('?')[0]; }
      const filename = extractFilename(imageUrl);
      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id alt } } } } }';
      const searchResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:searchQuery}) });
      const searchData = await searchResponse.json();
      const files = searchData.data.files.edges;
      if (files.length === 0) return res.status(404).json({ error: 'File not found', details: filename });
      const fileId = files[0].node.id;
      const safeAlt = (body.altText || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
      const updateMutation = 'mutation { fileUpdate(files: [{ id: "' + fileId + '", alt: "' + safeAlt + '" }]) { files { id alt } userErrors { field message } } }';
      const updateResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:updateMutation}) });
      const updateData = await updateResponse.json();
      if (updateData.data.fileUpdate.userErrors.length > 0) return res.status(500).json({ error:'Failed to update alt text', details:updateData.data.fileUpdate.userErrors });
      return res.status(200).json({ success:true, message:'Alt text updated', fileId, altText:safeAlt });
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      function extractFilename(url) { return url.split('/').pop().split('?')[0]; }
      const filename = extractFilename(imageUrl);
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id image { url } alt } } } } }';
      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      const searchResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:searchQuery}) });
      if (!searchResponse.ok) { const e=await searchResponse.text(); return res.status(500).json({error:'Failed to search Shopify files',details:e}); }
      const searchData = await searchResponse.json();
      if (searchData.errors) return res.status(500).json({error:'Shopify GraphQL error',details:searchData.errors});
      const files = searchData.data.files.edges;
      if (files.length === 0) return res.status(404).json({error:'File not found in Shopify',details:'Could not find: '+filename});
      const fileId = files[0].node.id;
      const stagedUploadMutation = 'mutation { stagedUploadsCreate(input: { resource: FILE, filename: "' + filename + '", mimeType: "image/webp", httpMethod: POST }) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }';
      const stagedResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:stagedUploadMutation}) });
      const stagedData = await stagedResponse.json();
      if (stagedData.data.stagedUploadsCreate.userErrors.length > 0) return res.status(500).json({error:'Failed to create staged upload',details:stagedData.data.stagedUploadsCreate.userErrors});
      const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
      const imageBuffer = Buffer.from(optimizedImageBase64, 'base64');
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      let formBody = '';
      for (const param of stagedTarget.parameters) { formBody += '--'+boundary+'\r\nContent-Disposition: form-data; name="'+param.name+'"\r\n\r\n'+param.value+'\r\n'; }
      formBody += '--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: image/webp\r\n\r\n';
      const formBodyBuffer = Buffer.concat([Buffer.from(formBody,'utf8'), imageBuffer, Buffer.from('\r\n--'+boundary+'--\r\n','utf8')]);
      const uploadResponse = await fetch(stagedTarget.url, { method:'POST', headers:{'Content-Type':'multipart/form-data; boundary='+boundary}, body:formBodyBuffer });
      if (!uploadResponse.ok) { const e=await uploadResponse.text(); return res.status(500).json({error:'Failed to upload file',details:e}); }
      const createMutation = 'mutation { fileCreate(files: [{ originalSource: "' + stagedTarget.resourceUrl + '", contentType: IMAGE, alt: "' + safeAltText + '" }]) { files { id } userErrors { field message } } }';
      const createResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:createMutation}) });
      const createData = await createResponse.json();
      if (createData.data.fileCreate.userErrors.length > 0) return res.status(500).json({error:'Failed to create new file',details:createData.data.fileCreate.userErrors});
      const newFileId = createData.data.fileCreate.files[0].id;
      await new Promise(resolve => setTimeout(resolve, 3000));
      const deleteMutation = 'mutation { fileDelete(fileIds: ["' + fileId + '"]) { deletedFileIds userErrors { field message } } }';
      const deleteResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:deleteMutation}) });
      const deleteData = await deleteResponse.json();
      if (deleteData.data.fileDelete.userErrors.length > 0) return res.status(500).json({error:'Failed to delete old file',details:deleteData.data.fileDelete.userErrors});
      return res.status(200).json({success:true, message:'File replaced successfully', oldFileId:fileId, newFileId, filename});
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('API error: ' + error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
