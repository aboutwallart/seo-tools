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
  const NEWS_FILE       = 'data/newsletters.json';
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

  async function anthropic(prompt, maxTok, model) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: maxTok || 2000, messages: [{ role: 'user', content: prompt }] })
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

    // ---------- 1c) write ONE warm intro line for the chosen tool/guide ----------
    if (action === 'newsletter-tool-intro') {
      var tn = (body.toolName || '').toString().slice(0, 120);
      if (!tn) { res.status(400).json({ ok: false, error: 'toolName required' }); return; }
      var tt = body.toolType === 'guide' ? 'guide' : 'tool';
      var bt = (body.blogTitle || '').toString().slice(0, 200);
      var iprompt = [
        'You are Mae of About Wall Art, warm UK first-person voice.',
        'This month\'s newsletter is built from the blog: "' + bt + '".',
        'Write ONE short, warm sentence that points the reader to a free on-site ' + tt + ' as a helpful next step — never pushy, never urgency, never "in a hurry".',
        'The ' + tt + ' is: "' + tn + '".',
        'Return ONLY the sentence — no quotes, no preamble.'
      ].join('\n');
      var iraw = await anthropic(iprompt, 120, 'claude-haiku-4-5-20251001');
      res.status(200).json({ ok: true, intro: (iraw || '').trim().replace(/^["']+|["']+$/g, '') });
      return;
    }

    // ---------- 1d) approve -> register the blog as USED on GitHub (no repeats) ----------
    if (action === 'newsletter-approve') {
      var handle = (body.handle || '').toString().trim();
      if (!handle) { res.status(400).json({ ok: false, error: 'handle required' }); return; }
      var gr = await fetch(`https://api.github.com/repos/${REPO}/contents/${USED_FILE}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      var sha = null, arr = [];
      if (gr.ok) {
        var gd = await gr.json(); sha = gd.sha;
        try { arr = JSON.parse(Buffer.from(gd.content || '', 'base64').toString('utf-8')) || []; } catch (e) { arr = []; }
      }
      if (!Array.isArray(arr)) arr = [];
      var low = arr.map(function (x) { return String(x).toLowerCase(); });
      var already = low.indexOf(handle.toLowerCase()) >= 0;
      if (!already) arr.push(handle);
      var pr = await fetch(`https://api.github.com/repos/${REPO}/contents/${USED_FILE}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Newsletter approved: mark blog used — ' + handle, content: Buffer.from(JSON.stringify(arr, null, 2) + '\n').toString('base64'), ...(sha ? { sha: sha } : {}) })
      });
      if (!pr.ok && !already) { var et = await pr.text(); res.status(502).json({ ok: false, error: 'Could not save to GitHub: ' + pr.status + ' ' + et.slice(0, 150) }); return; }

      // also save the full newsletter to the archive (month + content) — never blocks approval
      var savedId = null;
      try {
        var month = (body.month || '').toString();
        var copy = body.copy || null;
        var nr = await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        var nsha = null, list = [];
        if (nr.ok) { var nd = await nr.json(); nsha = nd.sha; try { list = JSON.parse(Buffer.from(nd.content || '', 'base64').toString('utf-8')) || []; } catch (e) { list = []; } }
        if (!Array.isArray(list)) list = [];
        savedId = Date.now();
        list.unshift({
          id: savedId, month: month, handle: handle,
          title: (copy && copy.article && copy.article.title) || '',
          subject: (copy && copy.subject) || '',
          savedAt: new Date().toISOString(), copy: copy
        });
        await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Newsletter approved & saved — ' + month + ' ' + handle, content: Buffer.from(JSON.stringify(list, null, 2) + '\n').toString('base64'), ...(nsha ? { sha: nsha } : {}) })
        });
      } catch (e) {}

      res.status(200).json({ ok: true, used: arr, already: already, savedId: savedId });
      return;
    }

    // ---------- 1f-b) delete a saved newsletter + free its blog from the registry ----------
    if (action === 'newsletter-delete') {
      var did = body.id != null ? String(body.id) : '';
      var dh = (body.handle || '').toString();
      if (!did && !dh) { res.status(400).json({ ok: false, error: 'id or handle required' }); return; }
      // remove from newsletters.json
      try {
        var dr = await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (dr.ok) {
          var dd = await dr.json(); var dsha = dd.sha; var dlist = [];
          try { dlist = JSON.parse(Buffer.from(dd.content || '', 'base64').toString('utf-8')) || []; } catch (e) { dlist = []; }
          if (!Array.isArray(dlist)) dlist = [];
          var kept = dlist.filter(function (x) { return did ? String(x.id) !== did : (String(x.handle).toLowerCase() !== dh.toLowerCase()); });
          await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, { method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Delete saved newsletter ' + (did || dh), content: Buffer.from(JSON.stringify(kept, null, 2) + '\n').toString('base64'), sha: dsha }) });
          // figure the handle to free (from the deleted entry if id-based)
          if (!dh && did) { var goneById = dlist.filter(function (x) { return String(x.id) === did; })[0]; if (goneById) dh = (goneById.handle || ''); }
        }
      } catch (e) {}
      // free the blog from used-newsletter-blogs.json
      if (dh) {
        try {
          var ur = await fetch(`https://api.github.com/repos/${REPO}/contents/${USED_FILE}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
          if (ur.ok) {
            var ud = await ur.json(); var usha = ud.sha; var uarr = [];
            try { uarr = JSON.parse(Buffer.from(ud.content || '', 'base64').toString('utf-8')) || []; } catch (e) { uarr = []; }
            if (!Array.isArray(uarr)) uarr = [];
            var uk = uarr.filter(function (h) { return String(h).toLowerCase() !== dh.toLowerCase(); });
            await fetch(`https://api.github.com/repos/${REPO}/contents/${USED_FILE}`, { method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Free blog after newsletter delete — ' + dh, content: Buffer.from(JSON.stringify(uk, null, 2) + '\n').toString('base64'), sha: usha }) });
          }
        } catch (e) {}
      }
      res.status(200).json({ ok: true });
      return;
    }

    // ---------- 1f) list saved newsletters (archive) ----------
    if (action === 'newsletter-archive') {
      var list = await ghGetJSON(NEWS_FILE);
      if (!Array.isArray(list)) list = [];
      res.status(200).json({ ok: true, items: list });
      return;
    }

    // ---------- 1g) host a custom uploaded image (data URL) on Vercel Blob ----------
    if (action === 'newsletter-host-image') {
      var dataUrl = (body.imageData || '').toString();
      if (dataUrl.indexOf('data:') !== 0) { res.status(400).json({ ok: false, error: 'no image data' }); return; }
      try {
        var put = require('@vercel/blob').put;
        var mime = (dataUrl.match(/^data:([^;]+);/) || [])[1] || 'image/png';
        var ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '');
        var buf = Buffer.from(dataUrl.split(',')[1], 'base64');
        var blob = await put('newsletter/tool-' + Date.now() + '.' + ext, buf, { access: 'public', contentType: mime });
        res.status(200).json({ ok: true, url: blob.url });
      } catch (e) { res.status(502).json({ ok: false, error: 'image host failed: ' + (e && e.message ? e.message : String(e)) }); }
      return;
    }

    // ---------- 1h) create the DRAFT campaign in Klaviyo ----------
    if (action === 'newsletter-create-draft') {
      var KLAVIYO_KEY = process.env.KLAVIYO_KEY;
      if (!KLAVIYO_KEY) { res.status(500).json({ ok: false, error: 'KLAVIYO_KEY not configured on the server' }); return; }
      var month = (body.month || '').toString();
      var subject = (body.subject || '').toString();
      var preview = (body.preview || '').toString();
      var html = (body.html || '').toString();
      var dhandle = (body.handle || '').toString();
      if (!month || !subject || !html) { res.status(400).json({ ok: false, error: 'month, subject and html required' }); return; }
      var SEGMENT = 'Tg3Mqd', REV = '2024-10-15';
      var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var ymp = month.split('-'); var Y = +ymp[0], Mo = +ymp[1];
      var cName = 'NEWSLETTER ' + ((MONTHS[Mo - 1] || '').toUpperCase()) + ' ' + Y;

      // ---- anti double-send: look up this newsletter in the archive; block if already in Klaviyo ----
      var newsletterId = body.newsletterId != null ? String(body.newsletterId) : '';
      var newsSha = null, newsList = [], newsIdx = -1;
      try {
        var ngr = await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (ngr.ok) { var ngd = await ngr.json(); newsSha = ngd.sha; try { newsList = JSON.parse(Buffer.from(ngd.content || '', 'base64').toString('utf-8')) || []; } catch (e) { newsList = []; } }
      } catch (e) {}
      if (!Array.isArray(newsList)) newsList = [];
      for (var ni = 0; ni < newsList.length; ni++) {
        var e0 = newsList[ni];
        if ((newsletterId && String(e0.id) === newsletterId) || (!newsletterId && String(e0.handle || '').toLowerCase() === dhandle.toLowerCase() && String(e0.month || '') === month)) { newsIdx = ni; break; }
      }
      if (newsIdx >= 0 && newsList[newsIdx].klaviyo && newsList[newsIdx].klaviyo.campaignId) {
        res.status(200).json({ ok: false, already: true, error: 'This newsletter is already in Klaviyo.', url: newsList[newsIdx].klaviyo.url });
        return;
      }

      // 3rd Friday of the month at 10:00 UK (handles BST) -> ISO
      function lastSunday(y, m0) { var d = new Date(Date.UTC(y, m0 + 1, 0)); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.getUTCDate(); }
      function isBST(y, mo1, day) { if (mo1 < 3 || mo1 > 10) return false; if (mo1 > 3 && mo1 < 10) return true; if (mo1 === 3) return day >= lastSunday(y, 2); return day < lastSunday(y, 9); }
      var firstDow = new Date(Date.UTC(Y, Mo - 1, 1)).getUTCDay();
      var thirdFri = (1 + ((5 - firstDow + 7) % 7)) + 14;
      var utcHour = 10 - (isBST(Y, Mo, thirdFri) ? 1 : 0);
      function p2(n){ return (n < 10 ? '0' : '') + n; }
      var dt = Y + '-' + p2(Mo) + '-' + p2(thirdFri) + 'T' + p2(utcHour) + ':00:00+00:00';

      function kv(path, method, payload) {
        return fetch('https://a.klaviyo.com' + path, { method: method, headers: { 'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY, 'revision': REV, 'accept': 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' }, body: payload ? JSON.stringify(payload) : undefined });
      }
      async function kvJson(r) { var t = await r.text(); var j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, status: r.status, json: j, text: t }; }

      // 1) create the HTML template
      var tRes = await kvJson(await kv('/api/templates/', 'POST', { data: { type: 'template', attributes: { name: cName + ' (tool)', editor_type: 'CODE', html: html } } }));
      if (!tRes.ok || !tRes.json || !tRes.json.data) { res.status(502).json({ ok: false, error: 'Template create failed (' + tRes.status + '): ' + (tRes.text || '').slice(0, 250) }); return; }
      var templateId = tRes.json.data.id;

      // 2) create the campaign as a DRAFT (with its email message)
      var camp = { data: { type: 'campaign', attributes: {
        name: cName,
        audiences: { included: [SEGMENT] },
        send_strategy: { method: 'static', datetime: dt, options: { is_local: false } },
        'campaign-messages': { data: [ { type: 'campaign-message', attributes: { channel: 'email', label: cName, content: { subject: subject, preview_text: preview, from_email: 'info@aboutwallart.com', from_label: 'Mae from About Wall Art' } } } ] }
      } } };
      var cRes = await kvJson(await kv('/api/campaigns/', 'POST', camp));
      if (!cRes.ok || !cRes.json || !cRes.json.data) { res.status(502).json({ ok: false, error: 'Campaign create failed (' + cRes.status + '): ' + (cRes.text || '').slice(0, 300) }); return; }
      var campaignId = cRes.json.data.id;
      var msgId = null; try { msgId = cRes.json.data.relationships['campaign-messages'].data[0].id; } catch (e) {}
      if (!msgId) { res.status(502).json({ ok: false, error: 'Campaign created but no message id returned', campaignId: campaignId }); return; }

      // 3) assign the template to the campaign's message
      var aRes = await kvJson(await kv('/api/campaign-message-assign-template/', 'POST', { data: { type: 'campaign-message', id: msgId, relationships: { template: { data: { type: 'template', id: templateId } } } } }));
      if (!aRes.ok) { res.status(502).json({ ok: false, error: 'Assign template failed (' + aRes.status + '): ' + (aRes.text || '').slice(0, 250), campaignId: campaignId }); return; }

      // 4) mark the Content Board 'email-newsletter' done for this month (never blocks)
      try {
        var mf = 'data/content-board-manual.json';
        var mgr = await fetch(`https://api.github.com/repos/${REPO}/contents/${mf}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
        var msha = null, mobj = { months: {} };
        if (mgr.ok) { var mgd = await mgr.json(); msha = mgd.sha; try { mobj = JSON.parse(Buffer.from(mgd.content || '', 'base64').toString('utf-8')) || { months: {} }; } catch (e) { mobj = { months: {} }; } }
        if (!mobj.months) mobj.months = {};
        if (!mobj.months[month]) mobj.months[month] = {};
        mobj.months[month]['email-newsletter'] = true;
        await fetch(`https://api.github.com/repos/${REPO}/contents/${mf}`, { method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Newsletter draft created — mark board ' + month, content: Buffer.from(JSON.stringify(mobj, null, 2) + '\n').toString('base64'), ...(msha ? { sha: msha } : {}) }) });
      } catch (e) {}

      // 5) stamp the archive entry as sent so it can't be pushed twice (from flow OR archive)
      var kvUrl = 'https://www.klaviyo.com/campaign/' + campaignId + '/wizard';
      try {
        if (newsIdx >= 0) {
          newsList[newsIdx].klaviyo = { campaignId: campaignId, url: kvUrl, sentAt: new Date().toISOString() };
          await fetch(`https://api.github.com/repos/${REPO}/contents/${NEWS_FILE}`, { method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Newsletter sent to Klaviyo — ' + month, content: Buffer.from(JSON.stringify(newsList, null, 2) + '\n').toString('base64'), ...(newsSha ? { sha: newsSha } : {}) }) });
        }
      } catch (e) {}

      res.status(200).json({ ok: true, campaignId: campaignId, url: kvUrl });
      return;
    }

    // ---------- 1e) spelling / grammar check (tells you; you decide to apply) ----------
    if (action === 'newsletter-check') {
      var c = body.copy || {};
      var payload = {
        subject: c.subject || '', preview: c.preview || '', greeting: c.greeting || '',
        body: c.body || [], toolIntro: (c.toolBlock && c.toolBlock.intro) || '',
        toolButton: (c.toolBlock && c.toolBlock.buttonLabel) || '', close: c.close || []
      };
      var cprompt = [
        'You are a careful UK-English proofreader for an email.',
        'Check ONLY: spelling, typos, grammar, punctuation, doubled words, spacing.',
        'Do NOT reword, do NOT change tone or meaning, do NOT touch merge tags like {{ first_name|default:\'friend\' }}, URLs, or emojis.',
        'Email content as JSON:',
        JSON.stringify(payload),
        'Return ONLY JSON in this shape:',
        '{ "issues": [ { "original": "exact text with the mistake", "suggestion": "corrected text", "why": "3-5 word reason" } ], "corrected": { "subject":"", "preview":"", "greeting":"", "body":[], "toolIntro":"", "toolButton":"", "close":[] } }',
        'The "corrected" object must be the SAME content with only the fixes applied. If there are no mistakes, return "issues":[] and "corrected" equal to the input.'
      ].join('\n');
      var craw = await anthropic(cprompt, 2000);
      var cout = extractJSON(craw);
      if (!cout) { res.status(502).json({ ok: false, error: 'Could not check — try again.' }); return; }
      res.status(200).json({ ok: true, issues: cout.issues || [], corrected: cout.corrected || null });
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
      // leave the tool intro BLANK — it is written/rewritten by 'newsletter-tool-intro' when the tool is chosen/changed
      if (copy.toolBlock) copy.toolBlock.intro = '';
      copy.article = { id: article.id, title: article.title, handle: article.handle, url: article.url };

      res.status(200).json({ ok: true, copy: copy });
      return;
    }

    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) ? e.message : String(e) });
  }
};
