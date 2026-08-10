// shopify-files.js — v2.8
// v2.8 (June 29, 2026): BATCH 3 fixes. (1) NEW push-edits kind 'word-swap' — whole-word, case-aware
//                       find→replace across the body (British English bulk/per-item push). (2) Each
//                       edit in a push-edits batch is now isolated in try/catch → a bad edit is
//                       reported as "failed", never 500s the whole push. (markInline added for
//                       inline word-swap preview highlighting.)
// v2.7 (June 29, 2026): BATCH 3 push engine. NEW body-edit op 'push-edits' — applies one OR many
//                       edits to a single body read + single write (single Undo reverts the lot) and
//                       reports any not found. Kinds: 'overuse' (reword/remove), 'h2-rename',
//                       'h2-remove', 'h2-add', 'link' (mode replace|new — used for BOTH this-page
//                       outbound links AND inbound links on other pages, since the target's own
//                       shopifyId/type/blogId are passed), 'toc' (replace/insert the contents list).
//                       Helpers: locateBlock / locateHeadingSection / addSectionIndex / applyOneEdit.
// v2.6 (June 29, 2026): (1) add-button now also strips any LEFTOVER separate old text-CTA link for
//                       the product (stripLeftoverCtas) so the new black button truly replaces it
//                       instead of leaving an old "SHOP HERE"/"Show me this product" link below.
//                       (2) NEW action 'update-image-alt-bulk' — sets the alt of MANY body images in
//                       ONE save (re-reads body once, applies all, backs up to body-undo for undo).
// v2.5 (June 29, 2026): Promo fixer polish. (1) add-video WATCH line is now LEFT-aligned (matches
//                       blog text). (2) add-button accepts MANY products (productHandles[]) so one
//                       preview/approve can add ALL missing buttons at once (single body write +
//                       single undo). (3) promo previews use a centred highlight so the SHOP HERE
//                       button shows centred in the preview (matches live).
// v2.4 (June 29, 2026): PROMO FIXER Step 2. body-edit gains op 'add-button' (rebuild a Missing
//                       Button promo into the modern format = linked image + black SHOP HERE
//                       button, replacing the old text CTA) and op 'swap-promo' (replace a Dead
//                       Product's promo with a chosen live replacement: new linked image + button).
//                       New SHOP HERE button style: black, white text, theme font, UPPERCASE,
//                       normal weight, square corners; image up to 1024px, centred. Both link to
//                       the same product URL. Preview highlights the rebuilt promo; undo as usual.
//                       NEW action 'search-products-promo' (GET ?q=) returns up to 8 active
//                       products (title/handle/thumbnail) for the describe-and-pick replacement.
// v2.3 (June 28, 2026): body-edit — 'add-video' now adds a bold "WATCH: <title>" line (title
//                       auto-fetched via YouTube oembed) above the embed; new op 'remove-paa'
//                       removes an in-body People Also Ask section, but ONLY when the saved
//                       people_also_ask_new metafield still has content (never loses copy);
//                       preview highlights the removed section in red. Undo as usual.
// v2.2 (June 28, 2026): body-edit gains op 'add-video' — builds the responsive YouTube embed
//                       (exact blog format) from a pasted link and appends it at the end of the
//                       body. Same preview + undo as Quick Answer. Powers the "🎬 Add a video" block.
// v2.1 (June 28, 2026): body-edit engine + restore-body — safely insert content into a live blog
//                       body for the user (Batch 1: Quick Answer box placed after the opening,
//                       before the first List of Contents / H2). 'preview' shows the result with
//                       the new box highlighted; 'apply' backs up the previous body to
//                       data/body-undo.json (any-computer undo) then writes live. restore-body
//                       rolls back to that backup. Powers the "✍️ Insert it for me" + Undo buttons.
// v2.0 (June 22, 2026): new update-image-alt action — sets ONE image's alt by URL: body images
//                       via the resource body_html (re-fetched live so pushes don't clobber each
//                       other), main/featured image via the resource image alt. Powers the per-image
//                       "Push alt" button in Image SEO. Filenames stay manual (renaming changes URLs).
// v1.9 (June 22, 2026): new push-body action — overwrites body_html (description) of a
//                       product/page/article/collection. Powers the product description rewrite
//                       "Push to product body" button.
// v1.8 (June 22, 2026): push-metafields gains an optional per-item "ownerGid" — when set, the
//                       metafield is written via GraphQL metafieldsSet on THAT owner (any type),
//                       enabling cross-owner pushes (a PAGE pushing browse_the_collection to its
//                       inner COLLECTION). rich_text values are still converted first.
// v1.7 (June 21, 2026): htmlToRichText rewritten — now emits HEADINGS (h2/h3) and LISTS
//                       (ul/ol) in document order, not just paragraphs. Powers collection
//                       seo_text_links_ "add" sections (and future pages). Link target is
//                       now null unless explicitly set (matches the live rich-text format).
// v1.6 (June 21, 2026): New search-linkable action — searches collections / blog articles /
//                       trend pages by keyword, returns {gid,title,url} for the Linked
//                       References manual picker (used when a group has no auto-matches).
// v1.5 (June 21, 2026): (a) push-metafields now writes REFERENCE-LIST metafields
//                       (list.collection_reference / list.article_reference /
//                       list.page_reference) via GraphQL metafieldsSet — value is a JSON
//                       array of GIDs. Powers blog item #5 (Linked Collections/Blogs/Trends).
//                       (b) build-blog-index now also stores each article's GID (for Linked Blogs).
// v1.4 (June 21, 2026): build-blog-index now indexes PUBLISHED blogs only (reads each
//                       article's isPublished flag and skips drafts — drafts can't host
//                       crawlable internal links).
// v1.3 (June 21, 2026): New build-blog-index action — caches every article
//                       (handle, title, tags, blog handle, publish date) to
//                       data/blog-index.json on GitHub. Powers Money Page Doctor's
//                       related-blog matching without fetching all blogs live each run.
// v1.2 (June 20, 2026): push-metafields gains richTextMode "patch-leading" — for over-use
//                       fixes on rich_text fields, swaps only the leading text and KEEPS the
//                       existing embedded links (no link loss). Powers blog item #4.
// v1.1 (June 20, 2026): New push-metafields action — writes one or more metafields by
//                       namespace/key (upsert). Plain string for text fields; builds
//                       Shopify rich-text JSON (keeping embedded links) for
//                       rich_text_field. Powers the AI snippet pushes + over-use fixes.
// v1.0 (June 18, 2026): Blog excerpt fix — for blog articles the Page Description
//                       now writes to the excerpt (summary_html) ONLY, never the body.

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

    // 1. Update the description field
    //    Blog articles: write to the excerpt (summary_html) ONLY — never the body.
    //    All other types: unchanged (body_html).
    if (description) {
      try {
        const descField = shopifyType === 'article' ? 'summary_html' : 'body_html';
        const r = await fetch(`${base}/${resource.path}.json`, {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ [resource.key]: { id: parseInt(shopifyId), [descField]: description } })
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
  // PUSH METAFIELDS — write one or more metafields by namespace/key.
  // Used by the AI snippet pushes (multi_line_text_field, plain string) and the
  // keyword over-use fixes (incl. rich_text_field, where we build the JSON and
  // KEEP any embedded link).
  // -------------------------------------------------------
  if (req.query.action === 'push-metafields' && req.method === 'POST') {
    const { shopifyId, shopifyBlogId, shopifyType, metafields } = req.body;
    if (!shopifyId || !shopifyType || !Array.isArray(metafields) || metafields.length === 0) {
      return res.status(400).json({ error: 'Missing shopifyId, shopifyType or metafields' });
    }

    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const typeMap = {
      product:           { path: `products/${shopifyId}` },
      custom_collection: { path: `custom_collections/${shopifyId}` },
      smart_collection:  { path: `smart_collections/${shopifyId}` },
      page:              { path: `pages/${shopifyId}` },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}` }
    };
    const resource = typeMap[shopifyType];
    if (!resource) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });

    // Owner GID for GraphQL writes (reference-list metafields go through metafieldsSet).
    const ownerGidMap = {
      product:           `gid://shopify/Product/${shopifyId}`,
      custom_collection: `gid://shopify/Collection/${shopifyId}`,
      smart_collection:  `gid://shopify/Collection/${shopifyId}`,
      page:              `gid://shopify/Page/${shopifyId}`,
      article:           `gid://shopify/Article/${shopifyId}`
    };
    const ownerGid = ownerGidMap[shopifyType];

    // Build Shopify rich-text JSON from a small HTML subset. Handles block tags in
    // document order — <h2>/<h3> → heading (level 2/3), <p> → paragraph, <ul>/<ol> →
    // list/list-item — with inline <strong>/<b> and <a> (links kept). Used for
    // rich_text_field metafields (blog more_about_, collection seo_text_links_, etc.).
    function htmlToRichText(html) {
      const decode = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      function parseInline(str) {
        const nodes = [];
        const pushText = (chunk) => { const t = decode(chunk.replace(/<[^>]+>/g,'')); if (t) nodes.push({ type:'text', value:t }); };
        const re = /(<a\b[^>]*>[\s\S]*?<\/a>)|(<(?:strong|b)\b[^>]*>[\s\S]*?<\/(?:strong|b)>)/gi;
        let last = 0, m;
        while ((m = re.exec(str)) !== null) {
          if (m.index > last) pushText(str.slice(last, m.index));
          if (m[1]) {
            const tag = m[1];
            const url    = (tag.match(/href=["']([^"']*)["']/i)||[])[1] || '';
            const title  = (tag.match(/title=["']([^"']*)["']/i)||[])[1] || null;
            // Match the live format: target is null unless the link explicitly sets one.
            const target = (tag.match(/target=["']([^"']*)["']/i)||[])[1] || null;
            const innerTxt = tag.replace(/^<a\b[^>]*>/i,'').replace(/<\/a>$/i,'');
            const boldInner = /<(?:strong|b)\b/i.test(innerTxt);
            const textVal = decode(innerTxt.replace(/<[^>]+>/g,'')).trim();
            nodes.push({ type:'link', url, title, target, children:[ boldInner ? { type:'text', value:textVal, bold:true } : { type:'text', value:textVal } ] });
          } else if (m[2]) {
            const t = decode(m[2].replace(/<[^>]+>/g,''));
            if (t) nodes.push({ type:'text', value:t, bold:true });
          }
          last = re.lastIndex;
        }
        if (last < str.length) pushText(str.slice(last));
        return nodes;
      }
      const children = [];
      const blockRe = /<(h2|h3|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let m, matched = false;
      while ((m = blockRe.exec(html)) !== null) {
        matched = true;
        const tag = m[1].toLowerCase();
        const inner = m[2];
        if (tag === 'h2' || tag === 'h3') {
          const kids = parseInline(inner);
          if (kids.length) children.push({ type:'heading', level: tag === 'h2' ? 2 : 3, children: kids });
        } else if (tag === 'p') {
          const kids = parseInline(inner);
          if (kids.length) children.push({ type:'paragraph', children: kids });
        } else {
          const listType = tag === 'ol' ? 'ordered' : 'unordered';
          const lis = inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
          const liNodes = lis
            .map(li => ({ type:'list-item', children: parseInline(li.replace(/^<li[^>]*>/i,'').replace(/<\/li>$/i,'')) }))
            .filter(n => n.children.length);
          if (liNodes.length) children.push({ type:'list', listType, children: liNodes });
        }
      }
      if (!matched) {                      // no block tags — treat the whole input as one paragraph
        const kids = parseInline(html);
        if (kids.length) children.push({ type:'paragraph', children: kids });
      }
      return JSON.stringify({ type:'root', children: children.length ? children : [{ type:'paragraph', children:[{ type:'text', value:'' }] }] });
    }

    // For an over-use fix on a rich_text field: replace only the leading text (before the
    // first link) in the first paragraph with newText, KEEPING the link + everything after.
    // This guarantees embedded links survive. Returns null if it can't safely patch.
    function patchRichTextLeadingText(existingJsonStr, newText) {
      let root;
      try { root = JSON.parse(existingJsonStr); } catch { return null; }
      if (!root || root.type !== 'root' || !Array.isArray(root.children)) return null;
      const firstPara = root.children.find(c => c && c.type === 'paragraph' && Array.isArray(c.children));
      if (!firstPara) return null;
      const linkIdx = firstPara.children.findIndex(n => n && n.type === 'link');
      if (linkIdx === -1) firstPara.children = [{ type:'text', value: newText }];
      else firstPara.children = [{ type:'text', value: newText + ' ' }, ...firstPara.children.slice(linkIdx)];
      return JSON.stringify(root);
    }

    // Fetch all existing metafields once to find IDs for upsert.
    let existingMeta = [];
    try {
      const r = await fetch(`${base}/${resource.path}/metafields.json`, { headers: shopifyHeaders });
      const d = await r.json();
      existingMeta = d.metafields || [];
    } catch (err) { /* fall through; will create */ }

    const results = [];
    for (const mf of metafields) {
      const namespace = mf.namespace || 'custom';
      const key  = mf.key;
      const type = mf.type || 'multi_line_text_field';
      let value  = (mf.value == null) ? '' : String(mf.value);
      if (!key)         { results.push({ key, ok:false, error:'missing key' }); continue; }
      if (!value.trim()){ results.push({ key, ok:false, error:'empty value' }); continue; }
      // Reference-list metafields (e.g. list.collection_reference / list.article_reference /
      // list.page_reference). Value must be a JSON array of GIDs. Written via GraphQL
      // metafieldsSet — the same proven path used by the blog-products feature.
      if (/^list\./.test(type)) {
        let gids;
        try { gids = JSON.parse(value); } catch { results.push({ key, ok:false, error:'value is not a JSON array' }); continue; }
        if (!Array.isArray(gids) || !gids.length) { results.push({ key, ok:false, error:'empty GID list' }); continue; }
        if (!ownerGid) { results.push({ key, ok:false, error:'no owner GID for this type' }); continue; }
        try {
          const mutation = `mutation metafieldsSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`;
          const variables = { m: [{ ownerId: ownerGid, namespace, key, value: JSON.stringify(gids), type }] };
          const mr = await fetch(`${base}/graphql.json`, { method:'POST', headers: shopifyHeaders, body: JSON.stringify({ query: mutation, variables }) });
          const md = await mr.json();
          const ue = (md.data && md.data.metafieldsSet && md.data.metafieldsSet.userErrors) || [];
          if (md.errors) results.push({ key, ok:false, error: md.errors[0].message });
          else if (ue.length) results.push({ key, ok:false, error: ue[0].message });
          else results.push({ key, ok:true });
        } catch (err) { results.push({ key, ok:false, error: err.message }); }
        continue;
      }
      // Cross-owner push (e.g. a PAGE pushing browse_the_collection to its INNER collection):
      // when an explicit ownerGid is supplied, write via GraphQL metafieldsSet — it upserts on
      // any owner + type without needing the REST resource path or custom/smart distinction.
      if (mf.ownerGid) {
        let outVal = value;
        if (type === 'rich_text_field') {
          try { outVal = htmlToRichText(value); } catch { results.push({ key, ok:false, error:'rich-text convert failed' }); continue; }
        }
        try {
          const mutation = `mutation metafieldsSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`;
          const variables = { m: [{ ownerId: mf.ownerGid, namespace, key, value: outVal, type }] };
          const mr = await fetch(`${base}/graphql.json`, { method:'POST', headers: shopifyHeaders, body: JSON.stringify({ query: mutation, variables }) });
          const md = await mr.json();
          const ue = (md.data && md.data.metafieldsSet && md.data.metafieldsSet.userErrors) || [];
          if (md.errors) results.push({ key, ok:false, error: md.errors[0].message });
          else if (ue.length) results.push({ key, ok:false, error: ue[0].message });
          else results.push({ key, ok:true });
        } catch (err) { results.push({ key, ok:false, error: err.message }); }
        continue;
      }
      if (type === 'rich_text_field') {
        try {
          if (mf.richTextMode === 'patch-leading') {
            // Over-use fix: keep the existing links, swap only the leading text.
            const ex = existingMeta.find(m => m.namespace === namespace && m.key === key);
            const patched = ex ? patchRichTextLeadingText(ex.value, value) : null;
            value = patched || htmlToRichText(value);
          } else {
            value = htmlToRichText(value);
          }
        } catch (e) { results.push({ key, ok:false, error:'rich-text convert failed' }); continue; }
      }
      try {
        const existing = existingMeta.find(m => m.namespace === namespace && m.key === key);
        let r;
        if (existing) {
          r = await fetch(`${base}/metafields/${existing.id}.json`, {
            method:'PUT', headers: shopifyHeaders,
            body: JSON.stringify({ metafield: { id: existing.id, value } })
          });
        } else {
          r = await fetch(`${base}/${resource.path}/metafields.json`, {
            method:'POST', headers: shopifyHeaders,
            body: JSON.stringify({ metafield: { namespace, key, value, type } })
          });
        }
        if (r.ok) results.push({ key, ok:true });
        else { const e = await r.json().catch(()=>({})); results.push({ key, ok:false, error: JSON.stringify(e.errors || r.statusText) }); }
      } catch (err) { results.push({ key, ok:false, error: err.message }); }
    }

    const allOk = results.every(r => r.ok);
    return res.status(allOk ? 200 : 207).json({ success: allOk, results });
  }

  // -------------------------------------------------------
  // PUSH BODY — overwrite the body_html (description) of a product/page/article/collection.
  // Used by the Money Page Doctor "Push to product body" button (product description rewrite).
  // -------------------------------------------------------
  if (req.query.action === 'push-body' && req.method === 'POST') {
    const { shopifyId, shopifyType, shopifyBlogId, html } = req.body;
    if (!shopifyId || !shopifyType || typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'Missing shopifyId, shopifyType or html' });
    }
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const bodyMap = {
      product:           { path: `products/${shopifyId}`,                       wrap: 'product' },
      page:              { path: `pages/${shopifyId}`,                          wrap: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`, wrap: 'article' },
      custom_collection: { path: `custom_collections/${shopifyId}`,             wrap: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,             wrap: 'smart_collection' }
    };
    const t = bodyMap[shopifyType];
    if (!t) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });
    try {
      const r = await fetch(`${base}/${t.path}.json`, {
        method: 'PUT', headers: shopifyHeaders,
        body: JSON.stringify({ [t.wrap]: { id: shopifyId, body_html: html } })
      });
      if (r.ok) return res.status(200).json({ success: true });
      const e = await r.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: JSON.stringify(e.errors || r.statusText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // BODY EDIT ENGINE — safely insert/edit a blog (or page/collection/product) body for the user.
  // The tool re-reads the LIVE body each call, makes ONE change, and (on apply) saves a backup
  // of the previous body to data/body-undo.json so the change can be undone from any computer.
  //   mode = 'preview' → returns the new body (the change highlighted) WITHOUT saving.
  //   mode = 'apply'   → saves an undo backup, writes the new body live.
  //   op  = 'quick-answer' (Batch 1) — places the Quick Answer box after the opening, before
  //          the first List of Contents / first H2.
  //   op  = 'add-video' (Batch 2) — builds the responsive YouTube embed from videoUrl and
  //          appends it at the END of the body (same format the blogs already use).
  // -------------------------------------------------------
  if (req.query.action === 'body-edit' && req.method === 'POST') {
    const { shopifyId, shopifyType, shopifyBlogId, op, snippet, videoUrl, mode,
            productHandle, productHandles, newUrl, newImageUrl, newTitle } = req.body;
    if (!shopifyId || !shopifyType || !op) {
      return res.status(400).json({ error: 'Missing shopifyId, shopifyType or op' });
    }
    if (op === 'quick-answer' && (typeof snippet !== 'string' || !snippet.trim())) {
      return res.status(400).json({ error: 'Missing snippet' });
    }
    if (op === 'add-video' && (typeof videoUrl !== 'string' || !videoUrl.trim())) {
      return res.status(400).json({ error: 'Missing videoUrl' });
    }
    if (op === 'add-button' && !(productHandle && productHandle.trim()) && !(Array.isArray(productHandles) && productHandles.length)) {
      return res.status(400).json({ error: 'Missing productHandle / productHandles' });
    }
    if (op === 'swap-promo' && (!productHandle || !newUrl || !newImageUrl)) {
      return res.status(400).json({ error: 'Missing productHandle / newUrl / newImageUrl' });
    }
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const bodyMap = {
      product:           { path: `products/${shopifyId}`,                        wrap: 'product' },
      page:              { path: `pages/${shopifyId}`,                           wrap: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`, wrap: 'article' },
      custom_collection: { path: `custom_collections/${shopifyId}`,              wrap: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,              wrap: 'smart_collection' }
    };
    const t = bodyMap[shopifyType];
    if (!t) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });

    // Place the Quick Answer box after the second intro paragraph, but never after the first
    // heading or List of Contents. Returns { idx } or { already:true } if a box is already there.
    function placeQuickAnswer(body) {
      if (/quick\s*answer\s*:/i.test(body)) return { already: true };
      let count = 0, idx = -1, m;
      const re = /<\/p>/gi;
      while ((m = re.exec(body))) { count++; if (count === 2) { idx = m.index + m[0].length; break; } }
      if (idx === -1) { const m1 = /<\/p>/i.exec(body); if (m1) idx = m1.index + m1[0].length; }
      const mh = /<h2\b/i.exec(body);          // never let it land after the first H2
      if (mh && (idx === -1 || idx > mh.index)) idx = mh.index;
      if (idx === -1) idx = 0;                  // empty/odd body → prepend
      return { idx };
    }
    // Pull the 11-char YouTube id from any watch / share / embed / shorts link. '' if none.
    function extractYouTubeId(link) {
      const patterns = [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/, /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/];
      for (const p of patterns) { const m = (link || '').match(p); if (m) return m[1]; }
      return '';
    }
    // Responsive 16:9 embed — the exact format the blogs already use.
    function buildResponsiveEmbed(id) {
      return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;"><iframe src="https://www.youtube.com/embed/${id}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen></iframe></div>`;
    }
    const markWrap = (html) => '<div data-bodyedit-preview="1" style="outline:3px solid #ff9800;outline-offset:4px;">' + html + '</div>';
    // Centred variant — for promo rebuilds, so the preview shows the button centred (matching live).
    const markWrapC = (html) => '<div data-bodyedit-preview="1" style="outline:3px solid #ff9800;outline-offset:4px;text-align:center;">' + html + '</div>';
    // Inline variant — for word-level swaps (British English) so the highlight stays inside the sentence.
    const markInline = (t) => '<span data-bodyedit-preview="1" style="background:#fff3cd;outline:2px solid #ff9800;">' + t + '</span>';
    // Find an in-body "People Also Ask" / FAQ section: from its H2/H3 heading to the next
    // same-or-higher heading (or end of body). Returns { start, end } or null.
    function findPaaSection(body) {
      const re = /<(h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi; let m;
      while ((m = re.exec(body))) {
        const txt = m[2].replace(/<[^>]+>/g, '').toLowerCase();
        if (/people\s*also\s*ask|frequently\s*asked\s*questions|related\s*questions|common\s*questions/.test(txt)) {
          const level = m[1].toLowerCase();
          const after = m.index + m[0].length;
          const nextRe = /<(h1|h2|h3)\b/gi; nextRe.lastIndex = after;
          let n, end = body.length;
          while ((n = nextRe.exec(body))) { if (n[1].toLowerCase() <= level) { end = n.index; break; } }
          return { start: m.index, end };
        }
      }
      return null;
    }

    // ---- Promo rebuild helpers (add-button / swap-promo) ----
    // The new SHOP HERE button style she confirmed: black box, white text, THEME font (none set),
    // UPPERCASE, normal weight, no letter-spacing, square 90° corners. Image = original, centred,
    // responsive up to 1024px. Image + button BOTH link to the same product URL.
    const SHOP_BTN_STYLE = 'display:inline-block;margin-top:15px;padding:12px 30px;background-color:#000;color:#fff;text-decoration:none;text-transform:uppercase;font-weight:400;border-radius:0;';
    const IMG_STYLE = 'max-width:1024px;width:100%;height:auto;';
    const esc = (s) => String(s || '').replace(/"/g, '&quot;');
    // Build the inner of a modern promo: linked image + black SHOP HERE button (both to url).
    function buildPromoInner(url, imgSrc, imgAlt) {
      return `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(imgSrc)}" alt="${esc(imgAlt)}" style="${IMG_STYLE}"></a><br><a href="${esc(url)}" target="_blank" rel="noopener" style="${SHOP_BTN_STYLE}">Shop Here</a>`;
    }
    // Find the FIRST anchor that links to /products/HANDLE. Returns { full, attrs, inner, index } or null.
    function findProductAnchor(body, handle) {
      const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m;
      const h = String(handle || '').toLowerCase();
      while ((m = re.exec(body))) {
        const attrs = m[1] || '';
        const hp = attrs.match(/href=["'][^"']*\/products\/([^"'?#\/]+)/i);
        if (hp && hp[1].toLowerCase() === h) return { full: m[0], attrs, inner: m[2] || '', index: m.index };
      }
      return null;
    }
    const getImgFrom = (html) => {
      const im = (html || '').match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
      if (!im) return null;
      const alt = im[0].match(/\balt=["']([^"']*)["']/i);
      return { src: im[1], alt: alt ? alt[1] : '' };
    };
    // Remove any LEFTOVER old text-CTA link to this product (a separate "SHOP HERE" / "Show me this
    // product" link sitting near the image) so the new black button truly REPLACES it instead of
    // leaving it behind. Keeps the new styled button (has background-color) and the image link.
    const _CTA_TXT = /^(?:shop here|shop now|show me this product!?|click here to see this product!?|see this product!?|buy now|view product|get it here|click here)$/i;
    function stripLeftoverCtas(body, handle) {
      const h = String(handle || '').toLowerCase();
      let out = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
        const hp = attrs.match(/href=["'][^"']*\/products\/([^"'?#\/]+)/i);
        if (!hp || hp[1].toLowerCase() !== h) return full;          // not this product
        if (/style=["'][^"']*background-color/i.test(attrs)) return full;  // the new black button → keep
        if (/<img\b/i.test(inner)) return full;                     // an image link → keep
        const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return _CTA_TXT.test(text) ? '' : full;                     // leftover old text CTA → remove
      });
      // Tidy any now-empty paragraph the removed CTA left behind.
      out = out.replace(/<p[^>]*>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, '');
      return out;
    }

    // ===== Batch 3 — unified push edits (over-use, H2 rename/remove/add, links, ToC) =====
    const _normTx = s => String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    // Smallest matching body element (by visible text). Returns {start,end,openTag,closeTag,tag} or null.
    function locateBlock(body, text, tagsRe) {
      const want = _normTx(text); if (!want) return null;
      const re = new RegExp('<(' + (tagsRe || 'h1|h2|h3|h4|p|li') + ')\\b[^>]*>([\\s\\S]*?)<\\/\\1>', 'gi');
      let m, best = null;
      while ((m = re.exec(body))) {
        const inner = _normTx(m[2]); if (!inner) continue;
        const hit = inner === want || inner.includes(want) || (want.includes(inner) && inner.length >= 10);
        if (hit) {
          const openEnd = m.index + m[0].indexOf('>') + 1, closeStart = m.index + m[0].lastIndexOf('<');
          const c = { start: m.index, end: m.index + m[0].length, openTag: body.slice(m.index, openEnd), closeTag: body.slice(closeStart, m.index + m[0].length), tag: m[1].toLowerCase() };
          if (!best || (c.end - c.start) < (best.end - best.start)) best = c;
        }
      }
      return best;
    }
    // A heading + its whole section (until the next same-or-higher heading or end of body).
    function locateHeadingSection(body, text) {
      const loc = locateBlock(body, text, 'h2|h3|h4'); if (!loc) return null;
      const nextRe = /<(h1|h2|h3|h4)\b/gi; nextRe.lastIndex = loc.end; let n, end = body.length;
      while ((n = nextRe.exec(body))) { if (n[1].toLowerCase() <= loc.tag) { end = n.index; break; } }
      return { start: loc.start, end };
    }
    // Where a NEW section goes: before the first trailing/boilerplate section, else the end.
    function addSectionIndex(body) {
      const re = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi; let m;
      while ((m = re.exec(body))) {
        const t = m[2].replace(/<[^>]+>/g, '').toLowerCase();
        if (/pro tip|more about|feeling inspired|people also ask|frequently asked|related questions/.test(t)) return m.index;
      }
      const w = /<p[^>]*>\s*<strong>\s*watch:/i.exec(body); if (w) return w.index;
      return body.length;
    }
    const strikeWrap = (html) => '<div data-bodyedit-preview="1" style="outline:3px solid #e53935;background:#ffebee;text-decoration:line-through;">' + html + '</div>';
    // Apply ONE edit to the clean body (b) and the marked-preview body (mk). Returns {b,mk,ok}.
    function applyOneEdit(b, mk, e) {
      const kind = e.kind, content = e.content || '';
      // ── word-swap: whole-word, case-aware find→replace across the whole body (British English) ──
      if (kind === 'word-swap') {
        const find = e.find || ''; if (!find) return { b, mk, ok: false };
        const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reTest = new RegExp('\\b' + esc + '\\b', 'i');
        if (!reTest.test(b)) return { b, mk, ok: false };
        const cased = (m) => /^[A-Z]/.test(m) ? ((e.replace || '').charAt(0).toUpperCase() + (e.replace || '').slice(1)) : (e.replace || '');
        b = b.replace(new RegExp('\\b' + esc + '\\b', 'gi'), cased);          // case-aware swap
        mk = mk.replace(new RegExp('\\b' + esc + '\\b', 'gi'), (m) => markInline(cased(m)));
        return { b, mk, ok: true };
      }
      // ── link-wrap: wrap the Nth occurrence of an anchor phrase that is NOT already inside a link.
      //    Never touches text inside an existing <a>…</a> or inside a tag. (Branded body links.)
      if (kind === 'link-wrap') {
        const anchor = e.anchor || ''; if (!anchor) return { b, mk, ok: false };
        const href = e.href || '';
        const title = e.title || '';
        const want = Math.max(1, parseInt(e.occurrence || 1, 10));
        const escA = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wrapped = `<a href="${href}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener">${anchor}</a>`;
        const skipPre = String(e.skipIfPrecededBy || '').toLowerCase();   // e.g. "unique " so plain "wall art" never lands inside "unique wall art"
        const findNth = (str) => {
          const ranges = []; const aRe = /<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>/gi; let am;
          while ((am = aRe.exec(str))) ranges.push([am.index, am.index + am[0].length]);   // skip inside links AND tags
          const inSkip = (i) => ranges.some(r => i >= r[0] && i < r[1]);
          const re = new RegExp('(^|[^A-Za-z])(' + escA + ')(?![A-Za-z])', 'gi');
          let m, count = 0;
          while ((m = re.exec(str))) {
            const ws = m.index + m[1].length;
            if (inSkip(ws)) continue;
            if (skipPre && str.slice(Math.max(0, ws - skipPre.length), ws).toLowerCase() === skipPre) continue;
            if (++count === want) return { start: ws, end: ws + m[2].length };
          }
          return null;
        };
        const t = findNth(b); if (!t) return { b, mk, ok: false };
        b = b.slice(0, t.start) + wrapped + b.slice(t.end);
        const tk = findNth(mk);
        if (tk) mk = mk.slice(0, tk.start) + markWrap(wrapped) + mk.slice(tk.end);
        return { b, mk, ok: true };
      }
      // ── insertion kinds: h2-add, toc, link(mode=new) ──
      if (kind === 'toc') {
        const tocRe = /<h[23]\b[^>]*>\s*(list of contents|table of contents|contents|index)\s*<\/h[23]>\s*(<ul\b[\s\S]*?<\/ul>)?/i;
        const mt = tocRe.exec(b);
        if (mt) {
          const mtk = tocRe.exec(mk);
          b = b.slice(0, mt.index) + content + b.slice(mt.index + mt[0].length);
          mk = mtk ? mk.slice(0, mtk.index) + markWrap(content) + mk.slice(mtk.index + mtk[0].length) : mk;
          return { b, mk, ok: true };
        }
        const h = /<h2\b/i.exec(b), i = h ? h.index : 0, hk = /<h2\b/i.exec(mk), ik = hk ? hk.index : 0;
        b = b.slice(0, i) + content + '\n' + b.slice(i); mk = mk.slice(0, ik) + markWrap(content) + '\n' + mk.slice(ik);
        return { b, mk, ok: true };
      }
      if (kind === 'h2-add') {
        const i = addSectionIndex(b), ik = addSectionIndex(mk);
        b = b.slice(0, i) + '\n' + content + '\n' + b.slice(i); mk = mk.slice(0, ik) + '\n' + markWrap(content) + '\n' + mk.slice(ik);
        return { b, mk, ok: true };
      }
      if (kind === 'link' && String(e.mode).toLowerCase() === 'new') {
        const ins = content.trim().startsWith('<') ? content : ('<p>' + content + '</p>');
        const loc = locateBlock(b, e.find), lk = locateBlock(mk, e.find);
        const i = loc ? loc.end : b.length, ik = lk ? lk.end : mk.length;
        b = b.slice(0, i) + '\n' + ins + '\n' + b.slice(i); mk = mk.slice(0, ik) + '\n' + markWrap(ins) + '\n' + mk.slice(ik);
        return { b, mk, ok: true };
      }
      // ── prepend-para: add content as the VERY FIRST paragraph of the body. (Page description, in bold.) ──
      if (kind === 'prepend-para') {
        const ins = String(content).trim().startsWith('<') ? content : ('<p><strong>' + content + '</strong></p>');
        b = ins + '\n' + b;
        mk = markWrap(ins) + '\n' + mk;
        return { b, mk, ok: true };
      }
      // ── after-first-para: insert content right after the first paragraph (the page-description line). (Author bio.) ──
      if (kind === 'after-first-para') {
        const ins = String(content).trim().startsWith('<') ? content : ('<p>' + content + '</p>');
        const pRe = /<p\b[^>]*>[\s\S]*?<\/p>/i;
        const iOf = (str) => { const m = pRe.exec(str); return m ? m.index + m[0].length : 0; };
        const i = iOf(b), ik = iOf(mk);
        b = b.slice(0, i) + '\n' + ins + '\n' + b.slice(i);
        mk = mk.slice(0, ik) + '\n' + markWrap(ins) + '\n' + mk.slice(ik);
        return { b, mk, ok: true };
      }
      // ── find-based kinds: h2-remove, overuse(remove/reword), h2-rename, link(replace) ──
      if (kind === 'h2-remove') {
        const sec = locateHeadingSection(b, e.find), sk = locateHeadingSection(mk, e.find);
        if (!sec) return { b, mk, ok: false };
        b = b.slice(0, sec.start) + b.slice(sec.end);
        mk = sk ? mk.slice(0, sk.start) + strikeWrap(mk.slice(sk.start, sk.end)) + mk.slice(sk.end) : mk;
        return { b, mk, ok: true };
      }
      const tags = (kind === 'h2-rename') ? 'h2|h3|h4' : undefined;
      const loc = locateBlock(b, e.find, tags), lk = locateBlock(mk, e.find, tags);
      if (!loc) return { b, mk, ok: false };
      if (kind === 'overuse' && (!e.replace || !String(e.replace).trim())) {   // over-use REMOVE
        b = b.slice(0, loc.start) + b.slice(loc.end);
        mk = lk ? mk.slice(0, lk.start) + strikeWrap(mk.slice(lk.start, lk.end)) + mk.slice(lk.end) : mk;
        return { b, mk, ok: true };
      }
      // NEVER wipe an existing link. If the text being replaced has a link and the new text doesn't:
      //  • if the linked words still appear in the new text → put the SAME link back on them (preserve it);
      //  • otherwise → skip this one silently (leave the original with its link untouched).
      if (kind !== 'link' && e.replace && !/<a\b/i.test(String(e.replace))) {
        const origBlock = b.slice(loc.start, loc.end);
        const linkM = origBlock.match(/<a\b[^>]*>[\s\S]*?<\/a>/i);
        if (linkM) {
          const anchorTxt = linkM[0].replace(/<[^>]+>/g, '').trim();
          const idx = anchorTxt ? String(e.replace).toLowerCase().indexOf(anchorTxt.toLowerCase()) : -1;
          if (idx >= 0) {
            e.replace = e.replace.slice(0, idx) + linkM[0] + e.replace.slice(idx + anchorTxt.length);
          } else {
            return { b, mk, ok: false, linkGuarded: true };   // nowhere to keep the link → skip silently
          }
        }
      }
      const repl = (kind === 'link')
        ? (String(content).trim().startsWith('<') ? content : (loc.openTag + content + loc.closeTag))
        : (loc.openTag + (e.replace || '') + loc.closeTag);                    // over-use reword & H2 rename
      b = b.slice(0, loc.start) + repl + b.slice(loc.end);
      mk = lk ? mk.slice(0, lk.start) + markWrap(repl) + mk.slice(lk.end) : mk;
      return { b, mk, ok: true };
    }

    try {
      const gr = await fetch(`${base}/${t.path}.json?fields=id,body_html`, { headers: shopifyHeaders });
      const gd = await gr.json();
      const oldBody = gd[t.wrap]?.body_html || '';

      let newBody, markedAfter, editReport = null;

      if (op === 'quick-answer') {
        const place = placeQuickAnswer(oldBody);
        if (place.already) return res.status(200).json({ success: false, already: true, error: 'A Quick Answer box is already in this blog.' });
        newBody = oldBody.slice(0, place.idx) + '\n' + snippet + '\n' + oldBody.slice(place.idx);
        markedAfter = oldBody.slice(0, place.idx) + '\n' + markWrap(snippet) + '\n' + oldBody.slice(place.idx);
      }
      else if (op === 'add-video') {
        const id = extractYouTubeId(videoUrl);
        if (!id) return res.status(200).json({ success: false, error: "That doesn't look like a YouTube link. Paste a normal YouTube video link." });
        if (oldBody.includes('youtube.com/embed/' + id)) return res.status(200).json({ success: false, already: true, error: 'This video is already in the blog.' });
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        // Fetch the real video title (no API key needed) for the bold "WATCH:" line.
        let videoTitle = '';
        try {
          const o = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
          if (o.ok) { const oj = await o.json(); videoTitle = (oj.title || '').trim(); }
        } catch { /* fall back to generic link text */ }
        const linkText = (videoTitle || 'Watch on YouTube').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const titleLine = `<p><strong>WATCH: <a href="${watchUrl}" target="_blank" rel="noopener">${linkText}</a></strong></p>`;
        const block = titleLine + '\n' + buildResponsiveEmbed(id);
        newBody = oldBody + '\n' + block + '\n';
        markedAfter = oldBody + '\n' + markWrap(block) + '\n';
      }
      else if (op === 'remove-paa') {
        // Guard: the saved People Also Ask metafield MUST still have content, else removing the
        // in-body copy would lose it. Read the article's metafields and check.
        let savedExists = false;
        try {
          const mr = await fetch(`${base}/${t.path}/metafields.json?namespace=custom`, { headers: shopifyHeaders });
          if (mr.ok) {
            const md = await mr.json();
            savedExists = (md.metafields || []).some(x => x.namespace === 'custom'
              && (x.key === 'people_also_ask_new' || x.key === 'people_also_ask')
              && String(x.value || '').trim().length > 0);
          }
        } catch { /* treat as not-found below */ }
        const sec = findPaaSection(oldBody);
        if (!sec) return res.status(200).json({ success: false, notFound: true, error: 'No People Also Ask section found in the blog body.' });
        if (!savedExists) return res.status(200).json({ success: false, error: 'Your saved People Also Ask field looks empty — not removing the body copy, so nothing is lost.' });
        const removed = oldBody.slice(sec.start, sec.end);
        newBody = oldBody.slice(0, sec.start) + oldBody.slice(sec.end);
        markedAfter = oldBody.slice(0, sec.start)
          + '<div data-bodyedit-preview="1" style="outline:3px solid #e53935;background:#ffebee;text-decoration:line-through;">' + removed + '</div>'
          + oldBody.slice(sec.end);
      }
      else if (op === 'add-button') {
        // Missing Button: a product is shown with an image link but no proper black button.
        // Rebuild that promo into the modern format (linked image + black SHOP HERE button),
        // replacing whatever old text CTA was inside the link. Handles ONE productHandle or MANY
        // productHandles (the "Add ALL buttons" action) in a single body write + single undo.
        const handles = [...new Set((Array.isArray(productHandles) && productHandles.length ? productHandles : [productHandle]).map(h => String(h).toLowerCase()))];
        newBody = oldBody; markedAfter = oldBody;
        let doneCount = 0;
        for (const h of handles) {
          const a  = findProductAnchor(newBody, h);
          const am = findProductAnchor(markedAfter, h);
          if (!a || !am) continue;
          const img = getImgFrom(a.inner);
          if (!img) continue;                       // no image to build the button around → skip
          const hrefM = a.attrs.match(/href=["']([^"']+)["']/i);
          const url = hrefM ? hrefM[1] : `https://${shopifyDomain.replace('.myshopify.com','')}/products/${h}`;
          const built = buildPromoInner(url, img.src, img.alt);
          newBody     = newBody.slice(0, a.index)  + built            + newBody.slice(a.index + a.full.length);
          markedAfter = markedAfter.slice(0, am.index) + markWrapC(built) + markedAfter.slice(am.index + am.full.length);
          // Remove any leftover separate old CTA text link for this product (so it's replaced, not doubled).
          newBody     = stripLeftoverCtas(newBody, h);
          markedAfter = stripLeftoverCtas(markedAfter, h);
          doneCount++;
        }
        if (!doneCount) return res.status(200).json({ success: false, notFound: true, error: 'Could not find that product image in the blog body any more — it may have been edited.' });
      }
      else if (op === 'swap-promo') {
        // Dead Product: replace the dead product's promo with the chosen live replacement
        // (new linked image + black SHOP HERE button), removing the old dead link.
        const a = findProductAnchor(oldBody, productHandle);
        if (!a) return res.status(200).json({ success: false, notFound: true, error: 'Could not find that product link in the blog body any more — it may have been edited.' });
        const built = buildPromoInner(newUrl, newImageUrl, newTitle || '');
        newBody = oldBody.slice(0, a.index) + built + oldBody.slice(a.index + a.full.length);
        markedAfter = oldBody.slice(0, a.index) + markWrapC(built) + oldBody.slice(a.index + a.full.length);
      }
      else if (op === 'push-edits') {
        // One or many edits (over-use, H2 rename/remove/add, internal/inbound links, ToC) applied to
        // ONE body read + ONE write, so a single Undo reverts the whole push. Reports any not found.
        const edits = Array.isArray(req.body.edits) ? req.body.edits : [];
        if (!edits.length) return res.status(400).json({ error: 'No edits supplied' });
        let b = oldBody, mk = oldBody; const applied = [], failed = [], guarded = [];
        // Each edit is isolated: a bad one is reported as "failed", never crashes the whole push.
        edits.forEach((e, i) => {
          try { const r = applyOneEdit(b, mk, e); if (r && r.ok) { b = r.b; mk = r.mk; applied.push(i); } else { if (r && r.linkGuarded) guarded.push(i); failed.push(i); } }
          catch (_) { failed.push(i); }
        });
        newBody = b; markedAfter = mk; editReport = { applied, failed, guarded };
        if (!applied.length) return res.status(200).json({ success: false, notFound: true, failed, error: 'Could not find any of those items in the page any more — it may have been edited.' });
      }
      else {
        return res.status(400).json({ error: `Unknown op: ${op}` });
      }

      // PREVIEW — return the body with the change highlighted; nothing saved.
      if (mode === 'preview') {
        return res.status(200).json({ success: true, mode: 'preview', after: markedAfter, ...(editReport || {}) });
      }

      // APPLY — back up the current body, then write the new body live.
      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const REPO = 'aboutwallart/seo-tools';
      const UNDO_FILE = 'data/body-undo.json';
      const undoKey = `${shopifyType}:${shopifyId}`;
      try {
        let store = {}, sha = null;
        const gh = await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (gh.ok) { const d = await gh.json(); sha = d.sha; store = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8') || '{}'); }
        store[undoKey] = { body: oldBody, blogId: shopifyBlogId || null, ts: new Date().toISOString() };
        await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `body-undo backup ${undoKey}`, content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
      } catch (e) { /* backup failure must not silently lose the body */ return res.status(500).json({ success: false, error: 'Could not save undo backup — change not applied. ' + e.message }); }

      const wr = await fetch(`${base}/${t.path}.json`, {
        method: 'PUT', headers: shopifyHeaders,
        body: JSON.stringify({ [t.wrap]: { id: shopifyId, body_html: newBody } })
      });
      if (wr.ok) return res.status(200).json({ success: true, mode: 'apply', ...(editReport || {}) });
      const e = await wr.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: JSON.stringify(e.errors || wr.statusText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // RESTORE BODY — roll the body back to the version saved before the last body-edit apply.
  // -------------------------------------------------------
  if (req.query.action === 'restore-body' && req.method === 'POST') {
    const { shopifyId, shopifyType, shopifyBlogId } = req.body;
    if (!shopifyId || !shopifyType) return res.status(400).json({ error: 'Missing shopifyId or shopifyType' });
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const bodyMap = {
      product:           { path: `products/${shopifyId}`,                        wrap: 'product' },
      page:              { path: `pages/${shopifyId}`,                           wrap: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`, wrap: 'article' },
      custom_collection: { path: `custom_collections/${shopifyId}`,              wrap: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,              wrap: 'smart_collection' }
    };
    const t = bodyMap[shopifyType];
    if (!t) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const UNDO_FILE = 'data/body-undo.json';
    const undoKey = `${shopifyType}:${shopifyId}`;
    try {
      const gh = await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!gh.ok) return res.status(404).json({ success: false, error: 'No previous version saved.' });
      const d = await gh.json();
      const store = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8') || '{}');
      const saved = store[undoKey];
      if (!saved || typeof saved.body !== 'string') return res.status(404).json({ success: false, error: 'No previous version saved for this item.' });
      const wr = await fetch(`${base}/${t.path}.json`, {
        method: 'PUT', headers: shopifyHeaders,
        body: JSON.stringify({ [t.wrap]: { id: shopifyId, body_html: saved.body } })
      });
      if (!wr.ok) { const e = await wr.json().catch(() => ({})); return res.status(502).json({ success: false, error: JSON.stringify(e.errors || wr.statusText) }); }
      // Clear the used backup so a second undo doesn't re-apply a stale body.
      delete store[undoKey];
      await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `body-undo clear ${undoKey}`, content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64'), sha: d.sha })
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // SEARCH PRODUCTS (promo replacement finder) — returns up to 8 ACTIVE products matching a
  // keyword/description, each with title + handle + thumbnail. Used by the Dead Products /
  // Missing Buttons replacement picker so the user can describe what she wants and pick.
  // -------------------------------------------------------
  if (req.query.action === 'search-products-promo' && req.method === 'GET') {
    const q = String(req.query.q || '').replace(/['"\\]/g, '').trim();
    if (!q) return res.status(200).json({ success: true, products: [] });
    try {
      const gqlQuery = `status:active ${q}`;
      const r = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query: `{ products(first:8, query:${JSON.stringify(gqlQuery)}) { edges { node { handle title featuredImage { url } } } } }` })
      });
      const d = await r.json();
      const edges = (d && d.data && d.data.products) ? d.data.products.edges : [];
      const products = edges.map(e => ({
        handle: e.node.handle,
        title: e.node.title,
        imageUrl: e.node.featuredImage ? e.node.featuredImage.url : ''
      }));
      return res.status(200).json({ success: true, products });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // UPDATE IMAGE ALT — set the alt text of ONE image, by URL. For a body image it edits the
  // alt attribute inside the resource's body_html (re-fetched live each call so earlier pushes
  // aren't overwritten). For the featured/main image it sets the resource image alt.
  // -------------------------------------------------------
  if (req.query.action === 'update-image-alt' && req.method === 'POST') {
    const { shopifyId, shopifyType, shopifyBlogId, imageSrc, alt, isMain } = req.body;
    if (!shopifyId || !shopifyType || !imageSrc || typeof alt !== 'string') {
      return res.status(400).json({ error: 'Missing shopifyId, shopifyType, imageSrc or alt' });
    }
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const map = {
      product:           { path: `products/${shopifyId}`,                        wrap: 'product' },
      custom_collection: { path: `custom_collections/${shopifyId}`,              wrap: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,               wrap: 'smart_collection' },
      page:              { path: `pages/${shopifyId}`,                           wrap: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`, wrap: 'article' }
    };
    const t = map[shopifyType];
    if (!t) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });
    const altEsc = alt.replace(/"/g, '&quot;');
    try {
      // ── Main/featured image alt (article, collection) ──
      if (isMain && (shopifyType === 'article' || shopifyType.includes('collection'))) {
        const r = await fetch(`${base}/${t.path}.json`, {
          method: 'PUT', headers: shopifyHeaders,
          body: JSON.stringify({ [t.wrap]: { id: shopifyId, image: { alt } } })
        });
        if (r.ok) return res.status(200).json({ success: true });
        const e = await r.json().catch(() => ({}));
        return res.status(502).json({ success: false, error: JSON.stringify(e.errors || r.statusText) });
      }
      // ── Body image: re-fetch the live body, set this <img>'s alt, save ──
      const gr = await fetch(`${base}/${t.path}.json?fields=id,body_html`, { headers: shopifyHeaders });
      const gd = await gr.json();
      const body = gd[t.wrap]?.body_html || '';
      if (!body) return res.status(404).json({ success: false, error: 'No body_html on this resource' });
      const escaped = imageSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const imgRe = new RegExp('<img\\b[^>]*src=["\']' + escaped + '["\'][^>]*>', 'i');
      if (!imgRe.test(body)) return res.status(404).json({ success: false, error: 'Image not found in body' });
      const newBody = body.replace(imgRe, (tag) =>
        /\balt=["'][^"']*["']/i.test(tag)
          ? tag.replace(/\balt=["'][^"']*["']/i, `alt="${altEsc}"`)
          : tag.replace(/<img\b/i, `<img alt="${altEsc}"`)
      );
      const r = await fetch(`${base}/${t.path}.json`, {
        method: 'PUT', headers: shopifyHeaders,
        body: JSON.stringify({ [t.wrap]: { id: shopifyId, body_html: newBody } })
      });
      if (r.ok) return res.status(200).json({ success: true });
      const e = await r.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: JSON.stringify(e.errors || r.statusText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // UPDATE IMAGE ALT (BULK) — set the alt of MANY body images in ONE save. Re-reads the live body
  // once, applies every {imageSrc, alt}, backs up the previous body to data/body-undo.json (so the
  // whole batch can be undone via restore-body), then writes once. Featured/main image excluded.
  // -------------------------------------------------------
  if (req.query.action === 'update-image-alt-bulk' && req.method === 'POST') {
    const { shopifyId, shopifyType, shopifyBlogId, images } = req.body;
    if (!shopifyId || !shopifyType || !Array.isArray(images) || !images.length) {
      return res.status(400).json({ error: 'Missing shopifyId, shopifyType or images' });
    }
    const shopifyHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopifyDomain}/admin/api/2025-01`;
    const map = {
      product:           { path: `products/${shopifyId}`,                        wrap: 'product' },
      custom_collection: { path: `custom_collections/${shopifyId}`,              wrap: 'custom_collection' },
      smart_collection:  { path: `smart_collections/${shopifyId}`,               wrap: 'smart_collection' },
      page:              { path: `pages/${shopifyId}`,                           wrap: 'page' },
      article:           { path: `blogs/${shopifyBlogId}/articles/${shopifyId}`, wrap: 'article' }
    };
    const t = map[shopifyType];
    if (!t) return res.status(400).json({ error: `Unknown shopifyType: ${shopifyType}` });
    try {
      const gr = await fetch(`${base}/${t.path}.json?fields=id,body_html`, { headers: shopifyHeaders });
      const gd = await gr.json();
      const oldBody = gd[t.wrap]?.body_html || '';
      if (!oldBody) return res.status(404).json({ success: false, error: 'No body_html on this resource' });

      let newBody = oldBody, applied = 0, missed = 0;
      for (const it of images) {
        if (!it || !it.imageSrc || typeof it.alt !== 'string' || !it.alt.trim()) { missed++; continue; }
        const escaped = it.imageSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imgRe = new RegExp('<img\\b[^>]*src=["\']' + escaped + '["\'][^>]*>', 'i');
        if (!imgRe.test(newBody)) { missed++; continue; }
        const altEsc = it.alt.replace(/"/g, '&quot;');
        newBody = newBody.replace(imgRe, (tag) =>
          /\balt=["'][^"']*["']/i.test(tag)
            ? tag.replace(/\balt=["'][^"']*["']/i, `alt="${altEsc}"`)
            : tag.replace(/<img\b/i, `<img alt="${altEsc}"`)
        );
        applied++;
      }
      if (!applied) return res.status(200).json({ success: false, error: 'None of the images were found in the blog body.' });

      // Back up the previous body so the whole batch can be undone (same slot as body-edit).
      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const REPO = 'aboutwallart/seo-tools';
      const UNDO_FILE = 'data/body-undo.json';
      const undoKey = `${shopifyType}:${shopifyId}`;
      try {
        let store = {}, sha = null;
        const gh = await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (gh.ok) { const d = await gh.json(); sha = d.sha; store = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8') || '{}'); }
        store[undoKey] = { body: oldBody, blogId: shopifyBlogId || null, ts: new Date().toISOString() };
        await fetch(`https://api.github.com/repos/${REPO}/contents/${UNDO_FILE}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `body-undo backup ${undoKey}`, content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
      } catch (e) { return res.status(500).json({ success: false, error: 'Could not save undo backup — nothing changed. ' + e.message }); }

      const wr = await fetch(`${base}/${t.path}.json`, {
        method: 'PUT', headers: shopifyHeaders,
        body: JSON.stringify({ [t.wrap]: { id: shopifyId, body_html: newBody } })
      });
      if (wr.ok) return res.status(200).json({ success: true, applied, missed });
      const e = await wr.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: JSON.stringify(e.errors || wr.statusText) });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------------------------------------
  // BUILD BLOG INDEX — cache every article to data/blog-index.json on GitHub.
  // Run manually (the "Refresh Blog Index" button) whenever blogs are added or
  // retagged. Money Page Doctor's related-blog matching reads THIS file instead
  // of fetching the whole blog list live on every analysis (big speed win).
  // -------------------------------------------------------
  if (req.query.action === 'build-blog-index' && (req.method === 'POST' || req.method === 'GET')) {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const INDEX_FILE = 'data/blog-index.json';
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };

    try {
      const articles = [];
      let cursor = null, hasMore = true, pages = 0;
      while (hasMore && pages < 16) {            // safety cap (16 * 250 = 4000)
        pages++;
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{
          articles(first: 250${cursorPart}) {
            pageInfo { hasNextPage endCursor }
            edges { node { id handle title tags publishedAt isPublished blog { handle } } }
          }
        }`;
        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query })
        });
        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);
        for (const edge of data.data.articles.edges) {
          const n = edge.node;
          if (!n.isPublished) continue;          // PUBLISHED blogs only — drafts can't host crawlable links
          articles.push({
            gid: n.id,                            // gid://shopify/Article/… — used by Linked Blogs
            handle: n.handle,
            title: n.title,
            tags: n.tags || [],
            blogHandle: n.blog ? n.blog.handle : '',
            publishedAt: n.publishedAt || null
          });
        }
        hasMore = data.data.articles.pageInfo.hasNextPage;
        cursor = data.data.articles.pageInfo.endCursor;
      }

      // Find existing file's sha so we overwrite instead of erroring.
      let sha = null;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${INDEX_FILE}`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (r.ok) { const d = await r.json(); sha = d.sha; }
      } catch (e) { /* file doesn't exist yet — create it */ }

      const payload = { updatedAt: new Date().toISOString(), count: articles.length, articles };
      const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${INDEX_FILE}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Refresh blog index (${articles.length} articles)`,
          content: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'),
          ...(sha ? { sha } : {})
        })
      });
      if (!put.ok) throw new Error('GitHub write failed: ' + await put.text());

      return res.status(200).json({ success: true, count: articles.length, updatedAt: payload.updatedAt });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // SEARCH LINKABLE — find collections / blog articles / trend pages by keyword,
  // returning { gid, title, url } for the Linked References manual picker (item #5).
  // -------------------------------------------------------
  if (req.query.action === 'search-linkable' && req.method === 'GET') {
    const type = (req.query.type || '').toLowerCase();
    const q = (req.query.q || '').trim();
    if (!q) return res.status(200).json({ success: true, items: [] });
    const gql = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    const SITE = 'https://aboutwallart.com';
    async function run(query, variables) {
      const r = await fetch(gql, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query, variables }) });
      const d = await r.json();
      if (d.errors) throw new Error(d.errors[0].message);
      return d.data;
    }
    try {
      let items = [];
      if (type === 'collection') {
        const d = await run(`query($q:String){ collections(first:15, query:$q){ edges{ node{ id title handle } } } }`, { q });
        items = (d.collections?.edges || []).map(e => ({ gid: e.node.id, title: e.node.title, url: `${SITE}/collections/${e.node.handle}` }));
      } else if (type === 'article') {
        const d = await run(`query($q:String){ articles(first:15, query:$q){ edges{ node{ id title handle blog{ handle } } } } }`, { q });
        items = (d.articles?.edges || []).map(e => ({ gid: e.node.id, title: e.node.title, url: `${SITE}/blogs/${e.node.blog ? e.node.blog.handle : 'news-articles-home-decor-inspiration'}/${e.node.handle}` }));
      } else if (type === 'trend') {
        const d = await run(`{ pages(first:100){ edges{ node{ id title handle } } } }`, {});
        const all = (d.pages?.edges || []).map(e => e.node).filter(n => /trend/i.test(n.title || ''));
        const ql = q.toLowerCase();
        let matched = all.filter(n => (n.title || '').toLowerCase().includes(ql));
        if (!matched.length) matched = all;       // no keyword hit → show all trend pages to pick from
        items = matched.map(n => ({ gid: n.id, title: n.title, url: `${SITE}/pages/${n.handle}` }));
      } else {
        return res.status(400).json({ error: 'type must be collection, article, or trend' });
      }
      return res.status(200).json({ success: true, items: items.slice(0, 15) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
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

      if (subAction === 'proxy-image') {
        const imgUrl = req.query.url;
        if (!imgUrl || !imgUrl.startsWith('https://cdn.shopify.com/')) {
          return res.status(400).json({ error: 'Invalid URL — only cdn.shopify.com allowed' });
        }
        try {
          const upstream = await fetch(imgUrl);
          if (!upstream.ok) return res.status(upstream.status).end();
          const contentType = upstream.headers.get('content-type') || 'image/jpeg';
          const buffer = await upstream.arrayBuffer();
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
          return res.status(200).send(Buffer.from(buffer));
        } catch (e) { return res.status(500).json({ error: 'Proxy failed: ' + e.message }); }
      }

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
          const collectionId = req.query.collectionId;

          if (collectionId) {
            // GraphQL — gets images + variant prices in one shot
            const collectionGid = `gid://shopify/Collection/${collectionId}`;
            let cursor = null;
            let hasMore = true;
            while (hasMore) {
              const query = `query CollectionProducts($id: ID!, $cursor: String) {
                collection(id: $id) {
                  products(first: 50, after: $cursor) {
                    pageInfo { hasNextPage endCursor }
                    edges {
                      node {
                        id title handle status
                        images(first: 5) { edges { node { id url altText } } }
                        variants(first: 20) { edges { node { price } } }
                      }
                    }
                  }
                }
              }`;
              const r = await fetch(gqlUrl, {
                method: 'POST', headers: shopifyHeaders,
                body: JSON.stringify({ query, variables: { id: collectionGid, cursor } })
              });
              const d = await r.json();
              if (d.errors) throw new Error(d.errors[0].message);
              const conn = d.data?.collection?.products;
              if (!conn) break;
              conn.edges.forEach(({ node }) => {
                if (node.status !== 'ACTIVE') return;
                const numericId = node.id.replace('gid://shopify/Product/', '');
                products.push({
                  id: parseInt(numericId),
                  title: node.title,
                  handle: node.handle,
                  images: node.images.edges.map(e => ({ id: e.node.id, src: e.node.url, url: e.node.url, alt: e.node.altText })),
                  variants: node.variants.edges.map(e => ({ price: e.node.price }))
                });
              });
              hasMore = conn.pageInfo.hasNextPage;
              cursor = conn.pageInfo.endCursor;
            }
          } else {
            // REST fallback for all products (no collection filter)
            let page = `${restBase}/products.json?limit=250&fields=id,title,handle,images&status=active`;
            while (page) {
              const r = await fetch(page, { headers: { 'X-Shopify-Access-Token': accessToken } });
              const d = await r.json();
              (d.products || []).forEach(p => products.push(p));
              const link = r.headers.get('Link') || '';
              const next = link.match(/<([^>]+)>;\s*rel="next"/);
              page = next ? next[1] : null;
            }
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
        const payload = body.payload || body;
        if (!payload || !payload.id || payload.status !== 'archived') {
          return res.status(200).json({ ok: true, skipped: true, reason: 'not archived or no payload' });
        }

        // Skip About Wall Art's own products — they never get archived
        const vendor = (payload.vendor || '').trim().toLowerCase();
        if (vendor === 'about wall art') {
          return res.status(200).json({ ok: true, skipped: true, reason: 'about wall art product — skipped' });
        }

        try {
          const archivedProductId = String(payload.id);
          const archivedGid = `gid://shopify/Product/${archivedProductId}`;
          const archivedTags = (payload.tags || '').split(',').map(t => t.trim()).filter(Boolean);

          const { galleries, sha } = await readGalleries();
          if (!galleries.length) return res.status(200).json({ ok: true, skipped: true, reason: 'no galleries' });

          // Collect affected images with their collectionId
          let affectedCount = 0;
          const collectionIds = new Set();
          const updatedGalleries = galleries.map(gallery => {
            if (!gallery.images) return gallery;
            const updatedImages = gallery.images.map(img => {
              if (!img.hotspots) return img;
              const hasArchived = img.hotspots.some(hs => hs.productId === archivedProductId || hs.productGid === archivedGid);
              if (!hasArchived) return img;
              if (img.collectionId) collectionIds.add(img.collectionId);
              const updatedHotspots = img.hotspots.map(hs => {
                if (hs.productId !== archivedProductId && hs.productGid !== archivedGid) return hs;
                affectedCount++;
                return { ...hs, _needsReplacement: true };
              });
              return { ...img, hotspots: updatedHotspots };
            });
            return { ...gallery, images: updatedImages };
          });

          if (!affectedCount) return res.status(200).json({ ok: true, skipped: true, reason: 'product not in any gallery hotspot' });

          // Helper: score a product by tag match count
          const scoreByTags = (product) => {
            const tags = Array.isArray(product.tags) ? product.tags : (product.tags || '').split(',').map(t => t.trim());
            return tags.filter(t => archivedTags.includes(t)).length;
          };

          // Helper: map REST product to common shape
          const mapRest = (p) => ({
            id: `gid://shopify/Product/${p.id}`,
            numericId: String(p.id),
            title: p.title,
            handle: p.handle,
            tags: (p.tags || '').split(',').map(t => t.trim()),
            imageUrl: p.images?.[0]?.src || ''
          });

          // Helper: map GraphQL product to common shape
          const mapGql = (node) => ({
            id: node.id,
            numericId: node.id.replace('gid://shopify/Product/', ''),
            title: node.title,
            handle: node.handle,
            tags: node.tags || [],
            imageUrl: node.images?.edges?.[0]?.node?.url || ''
          });

          let replacementProduct = null;

          // 1. Search in the same collection(s) first
          for (const collId of collectionIds) {
            if (replacementProduct) break;
            const colRes = await fetch(
              `${restBase}/products.json?collection_id=${collId}&status=active&limit=250`,
              { headers: { 'X-Shopify-Access-Token': accessToken } }
            );
            const colData = await colRes.json();
            const candidates = (colData.products || [])
              .filter(p => String(p.id) !== archivedProductId)
              .map(mapRest)
              .sort((a, b) => scoreByTags(b) - scoreByTags(a));
            if (candidates.length) replacementProduct = candidates[0];
          }

          // 2. Fallback: store-wide tag search if no collection match
          if (!replacementProduct && archivedTags.length > 0) {
            const tagQuery = archivedTags.slice(0, 3).map(t => `tag:'${t}'`).join(' OR ');
            const searchQuery = `{ products(first: 20, query: "status:active ${tagQuery}") { edges { node { id title handle tags images(first:1) { edges { node { url } } } } } } }`;
            const sr = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: searchQuery }) });
            const sd = await sr.json();
            const candidates = (sd.data?.products?.edges || [])
              .map(e => mapGql(e.node))
              .filter(p => p.numericId !== archivedProductId)
              .sort((a, b) => scoreByTags(b) - scoreByTags(a));
            if (candidates.length) replacementProduct = candidates[0];
          }

          // Apply replacement or remove hotspot
          const finalGalleries = updatedGalleries.map(gallery => {
            if (!gallery.images) return gallery;
            let galleryNeedsReview = false;
            const updatedImages = gallery.images.map(img => {
              if (!img.hotspots) return img;
              const updatedHotspots = img.hotspots.map(hs => {
                if (!hs._needsReplacement) return hs;
                if (replacementProduct) {
                  return {
                    id: hs.id, x: hs.x, y: hs.y,
                    productId: replacementProduct.numericId,
                    productGid: replacementProduct.id,
                    productTitle: replacementProduct.title,
                    productHandle: replacementProduct.handle,
                    productImage: replacementProduct.imageUrl
                  };
                }
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
  // SET PAGE METAFIELD LINKS — append a GID to a page's linked_* metafield
  // Used by Link Whisperer inbound link push for trend pages (Phase 1)
  // -------------------------------------------------------
  if (req.query.action === 'set-page-metafield-links' && req.method === 'POST') {
    const { ownerGid, metafieldKey, targetGid, metafieldType } = req.body;
    if (!ownerGid || !metafieldKey || !targetGid || !metafieldType) {
      return res.status(400).json({ error: 'Missing ownerGid, metafieldKey, targetGid, or metafieldType' });
    }
    const shopifyHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    const gqlUrl = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
    try {
      // Read current metafield value — fragment depends on owner type
      const ownerType = ownerGid.includes('/Article/') ? 'Article' : ownerGid.includes('/Product/') ? 'Product' : ownerGid.includes('/Collection/') ? 'Collection' : 'Page';
      const readQuery = `{ node(id: "${ownerGid}") { ... on ${ownerType} { metafield(namespace: "custom", key: "${metafieldKey}") { value } } } }`;
      const readRes = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: readQuery }) });
      const readData = await readRes.json();
      if (readData.errors) throw new Error(readData.errors[0].message);
      const existing = readData.data?.node?.metafield?.value;
      let gids = [];
      if (existing) { try { gids = JSON.parse(existing); } catch(e) {} }
      // Append only if not already present
      if (gids.includes(targetGid)) {
        return res.status(200).json({ success: true, skipped: true, message: 'Already linked' });
      }
      gids.push(targetGid);
      // Write back
      const mutation = `mutation metafieldsSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id value } userErrors { field message } } }`;
      const variables = { m: [{ ownerId: ownerGid, namespace: 'custom', key: metafieldKey, value: JSON.stringify(gids), type: metafieldType }] };
      const mutRes = await fetch(gqlUrl, { method: 'POST', headers: shopifyHeaders, body: JSON.stringify({ query: mutation, variables }) });
      const mutData = await mutRes.json();
      if (mutData.errors) throw new Error(mutData.errors[0].message);
      const userErrors = mutData.data?.metafieldsSet?.userErrors || [];
      if (userErrors.length) throw new Error(userErrors[0].message);
      return res.status(200).json({ success: true, gids });
    } catch (err) {
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
