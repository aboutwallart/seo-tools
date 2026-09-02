// Email Marketing — backend for the "Email Marketing" tab (Newsletters + Monthly Promos).
// PART 1 (this file, Newsletters copy stage):
//   POST { action:'newsletter-blogs' }                          -> 5 recent Shopify blogs (title + hero + alt), minus already-used
//   POST { action:'newsletter-write',  articleId }              -> AI writes the newsletter in Mae's voice (structured JSON)
//   POST { action:'newsletter-rewrite', articleId, current, note } -> AI rewrites using Mae's note (incl. "you misunderstood the blog")
//
// The Klaviyo DRAFT push is a LATER step (not in this file yet).

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
  const REPO            = 'aboutwallart/seo-tools';
  const USED_FILE       = 'data/used-newsletter-blogs.json';
  const SHOPIFY_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN;
  const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

  // ---- helpers ----
  async function ghGetJSON(filePath) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (r.status === 404) return [];
      if (!r.ok) return [];
      const d = await r.json();
      const content = (d.content && d.content.length) ? Buffer.from(d.content, 'base64').toString('utf-8') : '';
      if (!content) return [];
      try { return JSON.parse(content); } catch (e) { return []; }
    } catch (e) { return []; }
  }

  async function shopifyGraphQL(query, variables) {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) throw new Error('Shopify credentials not configured');
    const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) throw new Error('Shopify error: ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(d.errors).slice(0, 200));
    return d.data;
  }

  async function anthropic(prompt, maxTok) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok || 2000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw new Error('AI error: ' + r.status);
    const d = await r.json();
    return (d.content && d.content[0] && d.content[0].text) ? d.content[0].text : '';
  }

  // make a Shopify CDN image ≥ targetW wide (retina rule: source ≥ 1.5× display width)
  function retinaImg(url, targetW) {
    if (!url) return url;
    var w = targetW || 1200;
    if (/[?&]width=/.test(url)) return url.replace(/([?&])width=\d+/, '$1width=' + w);
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=' + w;
  }

  // force a square crop (center) so portrait + square images all render the same in the email
  function squareImg(url, size) {
    if (!url) return url;
    var s = size || 800;
    if (url.indexOf('cdn.shopify.com') < 0) return retinaImg(url, s);
    var base = url.split('?')[0];
    var q = url.split('?')[1] || '';
    var vm = q.match(/(?:^|&)v=([^&]+)/);
    return base + '?width=' + s + '&height=' + s + '&crop=center' + (vm ? ('&v=' + vm[1]) : '');
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  // strip HTML to plain text, drop furniture/partner blocks (wall-art-only rule)
  function blogToText(html) {
    if (!html) return '';
    var t = html.replace(/<div[^>]*class=["'][^"']*awa-partner[^"']*["'][\s\S]*?<\/div>/gi, ' ');
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
    return t.replace(/\s+/g, ' ').trim().slice(0, 6000);
  }

  function extractJSON(text) {
    if (!text) return null;
    var a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < 0 || b <= a) return null;
    try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
  }

  // FREE on-site tools + guides the secondary CTA points to.
  // The AI picks the ONE that best fits the chosen blog (NOT always the quiz).
  var SITE = 'https://aboutwallart.com';
  var FREE_TOOLS = [
    // interactive tools
    { name: 'Interior Style Quiz', url: '/pages/interior-style-quiz', note: 'find your style in 60s' },
    { name: 'Room Colour & Art Matcher', url: '/pages/room-colour-art-matcher', note: 'match art to your room colours' },
    { name: 'Wall Art Size Calculator', url: '/pages/wall-art-size-calculator', note: 'what size fits the wall' },
    { name: 'Art Hanging Height Calculator', url: '/pages/art-hanging-height-calculator', note: 'how high to hang art' },
    { name: 'Gallery Wall Planner', url: '/pages/gallery-wall-planner', note: 'plan a gallery wall' },
    { name: 'Find Their Perfect Gift quiz', url: '/pages/find-their-perfect-gift-quiz', note: 'gift finder quiz' },
    // guides (read online + downloadable)
    { name: 'Interior Design Styles Explained', url: '/pages/interior-design-styles-explained', note: '24+ styles explained' },
    { name: 'Colour Matching Guide for Wall Art', url: '/pages/color-matching-guide-wall-art', note: 'colour matching guide' },
    { name: 'Interior Design Principles & Concepts', url: '/pages/interior-design-guide-principles-and-concepts', note: 'design principles guide' },
    { name: 'How to Choose the Right Wall Art Size', url: '/pages/how-to-choose-wall-art-size', note: 'sizing guide' },
    { name: 'Gallery Wall Ideas & Layouts', url: '/pages/gallery-wall-ideas-and-layouts', note: 'gallery wall layouts' },
    { name: 'Free DIY Interior Design Workbook', url: '/pages/diy-interior-design-workbook', note: 'DIY design workbook' },
    { name: 'How to Choose the Perfect Celebration Gift', url: '/pages/how-to-choose-the-perfect-celebration-gift', note: 'gift-choosing guide' }
  ];

  // ---- the newsletter voice + recipe (kept identical for write & rewrite) ----
  // Follows Mae's REAL Klaviyo template XMA3dY structure:
  //   greeting -> body -> BLACK button (to the blog) -> tool intro + tool block (AI picks best-fit tool) -> closing (hit reply, Warmly Mae)
  function recipe(article, extraNote) {
    var bodyText = blogToText(article.bodyHtml);
    var toolLines = FREE_TOOLS.map(function (t) { return '- ' + t.name + ' (' + SITE + t.url + ') — ' + t.note; }).join('\n');
    return [
      'You are Mae, founder of About Wall Art (a WALL ART shop). Write a monthly NEWSLETTER email in Mae\'s real first-person voice (UK spelling).',
      '',
      'JOB OF THE NEWSLETTER: keep customers WARM and inspire them. It is NOT a hard sell (selling is the promos\' job).',
      '',
      'HARD RULES (a newsletter that breaks these is rejected):',
      '1. SHORT. ~130–150 words total. Must stay well under Gmail\'s clip size.',
      '2. Art-first, few words. Not an article, not walls of advice.',
      '3. Primary CTA = the BLACK button to the blog guide below. No "shop now" soup.',
      '4. WALL ART only. Never mention furniture, lamps, rugs, sideboards, etc.',
      '5. Sound like Mae — warm, honest, human. NOT a generic AI article. Vary; no "myth → reveal" formula.',
      '6. Keep-warm, not sell. Position art as the easy, low-risk FIRST step to build a style.',
      '7. SECONDARY CTA = pick the ONE free on-site tool/guide below that BEST FITS THIS BLOG (NOT always the style quiz). Frame it as HELP, never urgency, never "in a hurry".',
      '8. End with a warm "hit reply" line, then "Warmly," then "Mae ❤️".',
      'BANNED words/phrases: elevate, curated, timeless, transform your space, dive in, unlock, discover, effortless, elevate your home, in today\'s world. Avoid marketing clichés.',
      '',
      'SUBJECT formula: a punchy, relatable tension AS A QUESTION using the merge tag {{ first_name|title|default:\'Friend\' }} at the start when natural. Not flat/descriptive.',
      'PREVIEW formula: invite the open by promising the fix is inside (do NOT just restate the subject).',
      '',
      'THE BLOG (this newsletter is built from it — read it and pull the ONE simplest angle):',
      'Blog title: ' + article.title,
      'Blog URL (primary black button target): ' + article.url,
      'Blog body (plain text, furniture blocks already removed):',
      bodyText,
      '',
      'FREE tools/guides — pick the SINGLE most relevant to THIS blog for the secondary CTA (return its exact full URL):',
      toolLines,
      '',
      (extraNote ? ('MAE\'S FEEDBACK — apply this exactly. If she says the concept was misunderstood, RE-READ the blog and rewrite around what she says it is really about:\n' + extraNote + '\n') : ''),
      'Return ONLY valid JSON, no prose, in this exact shape (matches the email template blocks in order):',
      '{',
      '  "subject": "...",',
      '  "preview": "...",',
      '  "greeting": "Dear {{ first_name|default:\'friend\' }},",',
      '  "body": ["paragraph before the button", "..."],',
      '  "primaryButton": { "label": "READ THE GUIDE & FIND YOUR STYLE", "url": "' + article.url + '" },',
      '  "toolBlock": { "intro": "one warm sentence introducing the free tool as help", "toolName": "exact tool name from the list", "url": "' + SITE + '/pages/...", "buttonLabel": "SHORT UPPERCASE BUTTON e.g. TAKE THE QUIZ" },',
      '  "close": ["line after the tool (e.g. once you know it, your walls are the easiest place to start)", "a personal question to prompt a reply", "Hit reply; I read every one.", "Warmly,", "Mae ❤️"]',
      '}'
    ].join('\n');
  }

  // ---- fetch a single article with body ----
  async function getArticle(articleId) {
    var gid = String(articleId).indexOf('gid://') === 0 ? articleId : ('gid://shopify/Article/' + String(articleId).replace(/\D/g, ''));
    var data = await shopifyGraphQL(
      'query($id:ID!){ article(id:$id){ id title handle summary body image{ url altText } blog{ handle } } }',
      { id: gid }
    );
    var a = data.article;
    if (!a) throw new Error('Article not found');
    var blogHandle = (a.blog && a.blog.handle) || 'news-articles-home-decor-inspiration';
    return {
      id: a.id,
      title: a.title,
      handle: a.handle,
      summary: a.summary || '',
      bodyHtml: a.body || '',
      url: 'https://aboutwallart.com/blogs/' + blogHandle + '/' + a.handle,
      image: (a.image && a.image.url) || '',
      alt: (a.image && a.image.altText) || ''
    };
  }

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var action = body.action || (req.query && req.query.action);

    // ---------- 1) list 5 recent blogs (minus used) ----------
    if (action === 'newsletter-blogs') {
      var used = await ghGetJSON(USED_FILE); // array of handles
      var usedSet = {};
      (Array.isArray(used) ? used : []).forEach(function (h) { usedSet[String(h).toLowerCase()] = 1; });

      var data = await shopifyGraphQL(
        'query{ articles(first:25, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle publishedAt image{ url altText } blog{ handle } } } } }',
        {}
      );
      var edges = (data.articles && data.articles.edges) ? data.articles.edges : [];
      var out = [];
      for (var i = 0; i < edges.length && out.length < 5; i++) {
        var n = edges[i].node;
        if (!n || !n.handle) continue;
        if (usedSet[n.handle.toLowerCase()]) continue;
        var blogHandle = (n.blog && n.blog.handle) || 'news-articles-home-decor-inspiration';
        out.push({
          id: n.id,
          title: n.title,
          handle: n.handle,
          publishedAt: n.publishedAt,
          image: retinaImg((n.image && n.image.url) || '', 600),
          alt: (n.image && n.image.altText) || n.title,
          url: 'https://aboutwallart.com/blogs/' + blogHandle + '/' + n.handle
        });
      }
      res.status(200).json({ ok: true, blogs: out });
      return;
    }

    // ---------- 1b) fetch a page's own image (for guides), squared ----------
    if (action === 'newsletter-page-image') {
      var purl = body.url || (req.query && req.query.url);
      if (!purl) { res.status(400).json({ ok: false, error: 'url required' }); return; }
      var pr = await fetch(purl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      var phtml = await pr.text();
      var m = phtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || phtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      var img = m ? m[1].replace(/&amp;/g, '&') : '';
      res.status(200).json({ ok: true, image: img ? squareImg(img, 800) : '' });
      return;
    }

    // ---------- 2) write the newsletter for a chosen blog ----------
    if (action === 'newsletter-write' || action === 'newsletter-rewrite') {
      if (!body.articleId) { res.status(400).json({ ok: false, error: 'articleId required' }); return; }
      var article = await getArticle(body.articleId);

      var note = '';
      if (action === 'newsletter-rewrite') {
        note = (body.note || '').toString().slice(0, 1500);
        if (body.current) {
          try { note = 'CURRENT DRAFT (change per my feedback):\n' + JSON.stringify(body.current).slice(0, 2500) + '\n\nMY FEEDBACK:\n' + note; } catch (e) {}
        }
      }

      var raw = await anthropic(recipe(article, note), 2200);
      var copy = extractJSON(raw);
      if (!copy) { res.status(502).json({ ok: false, error: 'AI did not return usable copy', raw: raw.slice(0, 400) }); return; }

      // hero = the blog's featured image, forced to a retina-safe width (600px display -> ≥1200 source), links to the blog
      copy.hero = {
        url: retinaImg(article.image, 1200),
        alt: copy.heroAlt || article.alt || article.title,
        link: article.url,
        filename: slugify(copy.heroAlt || article.alt || article.title) + '.jpg'
      };
      delete copy.heroAlt;
      // primary button always points at the blog
      if (!copy.primaryButton) copy.primaryButton = {};
      copy.primaryButton.url = article.url;
      // normalise the tool link to an absolute URL
      if (copy.toolBlock && copy.toolBlock.url && copy.toolBlock.url.indexOf('http') !== 0) {
        copy.toolBlock.url = SITE + (copy.toolBlock.url.charAt(0) === '/' ? '' : '/') + copy.toolBlock.url;
      }
      copy.article = { id: article.id, title: article.title, handle: article.handle, url: article.url };

      res.status(200).json({ ok: true, copy: copy });
      return;
    }

    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) ? e.message : String(e) });
  }
};
