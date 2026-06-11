module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
