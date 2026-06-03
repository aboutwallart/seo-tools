import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'aboutwallart/seo-tools';
  const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;

  // Helper: fetch file from GitHub
  async function getGitHubFile(filePath) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
    const data = await response.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha
    };
  }

  // Helper: update file on GitHub
  async function updateGitHubFile(filePath, content, sha, message) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to update ${filePath}: ${err}`);
    }
    return true;
  }

  // Helper: parse CSV line handling quoted fields
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += char; }
    }
    result.push(current.trim());
    return result;
  }

  // Helper: append row to Google Sheet via Apps Script webhook
  async function appendToGoogleSheet(keyword, perspective, title) {
    if (!SHEETS_WEBHOOK) {
      console.log('SHEETS_WEBHOOK_URL not configured - skipping Google Sheets append');
      return { skipped: true };
    }
    const response = await fetch(SHEETS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        colA: 'BLOG MANAGER TOOL',
        colB: perspective || '',
        colC: keyword || '',
        colF: title || '',
        colAS: 'READY TO GENERATE BLOG'
      })
    });
    if (!response.ok) throw new Error(`Sheets webhook error: ${response.status}`);
    return await response.json();
  }

  try {

    // ============================================
    // GET - Read published blogs from registry
    // ============================================
    if (req.method === 'GET') {

      // ── NEW ACTION: get-published-keywords ──
      if (req.query.action === 'get-published-keywords') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) {
          return res.status(404).json({ error: 'Registry file not found' });
        }
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const publishedBlogs = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 10) {
            const keyword = cols[0];
            const url = cols[1];
            const source = cols[9];
            if ((source === 'Published Blog' || source === 'To_Write_Blog') && keyword) {
              publishedBlogs.push({ keyword: keyword.toLowerCase(), url });
            }
          }
        }
        return res.status(200).json({ success: true, publishedBlogs });
      }

      // ── ACTION: get-registry ──
      if (req.query.action === 'get-registry') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) return res.status(200).json({ success: true, registry: [] });
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const registry = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 2 && cols[0]) {
            registry.push({
              keyword: cols[0],
              url: cols[1],
              locked: cols[2] === 'LOCKED',
              status: cols[3] || '',
              action: cols[4] || ''
            });
          }
        }
        return res.status(200).json({ success: true, registry });
      }

      // ── ACTION: get-revenue-by-month ──
      if (req.query.action === 'get-revenue-by-month') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const months = {};
        const since = new Date();
        since.setMonth(since.getMonth() - 13);
        since.setDate(1);
        since.setHours(0, 0, 0, 0);

        let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=created_at,total_price,financial_status`;

        while (url) {
          const orderRes = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': shopifyToken }
          });
          if (!orderRes.ok) throw new Error('Shopify Orders API error: ' + orderRes.status);
          const data = await orderRes.json();

          for (const order of (data.orders || [])) {
            if (['voided', 'refunded'].includes(order.financial_status)) continue;
            const month = order.created_at.slice(0, 7);
            months[month] = (months[month] || 0) + parseFloat(order.total_price || 0);
          }

          const linkHeader = orderRes.headers.get('Link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = nextMatch ? nextMatch[1] : null;
        }

        const revenue = {};
        Object.entries(months).forEach(([month, total]) => {
          revenue[month.replace('-', '')] = Math.round(total);
        });

        return res.status(200).json({ success: true, revenue });
      }

      // ── ACTION: get-susp-events ──
      if (req.query.action === 'get-susp-events') {
        try {
          const file = await getGitHubFile('data/suspicious-events.json');
          return res.status(200).json({ success: true, events: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, events: [] });
        }
      }

      // ── ACTION: get-optimisations ──
      if (req.query.action === 'get-optimisations') {
        try {
          const file = await getGitHubFile('data/keyword-optimisations.json');
          return res.status(200).json({ success: true, optimisations: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, optimisations: {} });
        }
      }

      // ── ACTION: get-tracked-keywords ──
      if (req.query.action === 'get-tracked-keywords') {
        try {
          const file = await getGitHubFile('data/tracked-keywords.json');
          const keywords = JSON.parse(file.content);
          return res.status(200).json({ success: true, keywords });
        } catch(e) {
          return res.status(200).json({ success: true, keywords: [] });
        }
      }

      // ── ACTION: get-keyword-tabs ──
      if (req.query.action === 'get-keyword-tabs') {
        try {
          const file = await getGitHubFile('data/keyword-tracker.json');
          const tabs = JSON.parse(file.content);
          return res.status(200).json({ success: true, tabs });
        } catch(e) {
          return res.status(200).json({ success: true, tabs: [] });
        }
      }

      // ── ACTION: get-autolink-rules ──
      if (req.query.action === 'get-autolink-rules') {
        try {
          const file = await getGitHubFile('data/autolink-rules.json');
          return res.status(200).json({ success: true, rules: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, rules: [] });
        }
      }

      // ── ACTION: seo-metafield-scan ──
      if (req.query.action === 'seo-metafield-scan') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const cursor = req.query.cursor || null;
        const gqlQuery = `
          query($cursor: String) {
            products(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  title
                  handle
                  metafield(namespace: "SEO", key: "meta_description") {
                    id
                    value
                  }
                }
              }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: gqlQuery, variables: { cursor } })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const products = data.data.products;
        const found = [];

        for (const edge of products.edges) {
          const p = edge.node;
          if (p.metafield) {
            found.push({
              productId: p.id.replace('gid://shopify/Product/', ''),
              productGid: p.id,
              title: p.title,
              handle: p.handle,
              metafieldId: p.metafield.id.replace('gid://shopify/Metafield/', ''),
              value: p.metafield.value
            });
          }
        }

        return res.status(200).json({
          success: true,
          found,
          hasNextPage: products.pageInfo.hasNextPage,
          endCursor: products.pageInfo.endCursor
        });
      }

      // ── ORIGINAL GET: Read published blogs from registry ──
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');

      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'Registry file not found', path: csvPath });
      }

      const csvText = fs.readFileSync(csvPath, 'utf-8');
      const lines = csvText.split('\n');
      const blogs = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim().replace(/\r/g, '');
        if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length >= 10) {
          const keyword = cols[0];
          const url = cols[1];
          const source = cols[9];
          if (source === 'Published Blog' && keyword) {
            blogs.push({ title: keyword, keyword, status: 'published', url, date: null });
          }
        }
      }

      return res.status(200).json({ blogs });
    }

    // ============================================
    // POST
    // ============================================
    if (req.method === 'POST') {

      // ── ACTION: lock-keyword ──
      if (req.body.action === 'lock-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const newRow = `${keyword},${url},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,User Resolved`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Lock keyword from rankings: ${keyword}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: save-susp-events ──
      if (req.body.action === 'save-susp-events') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { events } = req.body;
        const jsonContent = JSON.stringify(events, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/suspicious-events.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/suspicious-events.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update suspicious traffic events', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-optimisations ──
      if (req.body.action === 'save-optimisations') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { optimisations } = req.body;
        const jsonContent = JSON.stringify(optimisations, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-optimisations.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-optimisations.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword optimisations', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-tracked-keywords ──
      if (req.body.action === 'save-tracked-keywords') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords must be an array' });
        const jsonContent = JSON.stringify(keywords, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/tracked-keywords.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/tracked-keywords.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update tracked keywords', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: keywords.length });
      }

      // ── ACTION: save-keyword-tabs ──
      if (req.body.action === 'save-keyword-tabs') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { tabs } = req.body;
        if (!Array.isArray(tabs)) return res.status(400).json({ error: 'tabs must be an array' });
        const jsonContent = JSON.stringify(tabs, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-tracker.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-tracker.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword tracker tabs', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: tabs.length });
      }

      // ── ACTION: save-autolink-rules ──
      if (req.body.action === 'save-autolink-rules') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { rules } = req.body;
        if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules must be an array' });
        const jsonContent = JSON.stringify(rules, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/autolink-rules.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/autolink-rules.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update autolink rules', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: rules.length });
      }

      // ── ACTION: seo-metafield-delete ──
      if (req.body.action === 'seo-metafield-delete') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const { productGid } = req.body;
        if (!productGid) return res.status(400).json({ error: 'productGid required' });

        const mutation = `
          mutation {
            metafieldsDelete(metafields: [{ ownerId: "${productGid}", namespace: "SEO", key: "meta_description" }]) {
              deletedMetafields { key namespace ownerId }
              userErrors { field message }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: mutation })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const result = data.data.metafieldsDelete;
        if (result.userErrors.length > 0) return res.status(500).json({ error: result.userErrors[0].message });

        return res.status(200).json({ success: true });
      }

      const { keyword, url, title, perspective } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const newRow = `${keyword},${url || ''},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,To_Write_Blog`;
      const updatedRegistry = registry.content.trimEnd() + '\n' + newRow + '\n';
      await updateGitHubFile('data/keyword-locker-registry.csv', updatedRegistry, registry.sha, `Add to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'TO_WRITE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as TO_WRITE: ${keyword}`);

      let sheetsResult = null;
      try {
        sheetsResult = await appendToGoogleSheet(keyword, perspective, title);
      } catch (sheetsError) {
        console.error('Google Sheets append failed (non-fatal):', sheetsError.message);
        sheetsResult = { error: sheetsError.message };
      }

      return res.status(200).json({ success: true, keyword, url, sheetsResult });
    }

    // ============================================
    // PATCH
    // ============================================
    if (req.method === 'PATCH') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'KEYWORD_CHANGE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as KEYWORD_CHANGE: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    // ============================================
    // DELETE
    // ============================================
    if (req.method === 'DELETE') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const registryLines = registry.content.split('\n');
      const filteredRegistry = registryLines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        const cols = parseCSVLine(trimmed);
        return !(cols[0] === keyword && cols[9] === 'To_Write_Blog');
      }).join('\n');
      await updateGitHubFile('data/keyword-locker-registry.csv', filteredRegistry, registry.sha, `Undo to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = '';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Clear status: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
