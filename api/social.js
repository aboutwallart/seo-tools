// Social Content Tool — tick-state persistence on GitHub.
// Stores which video cards are marked done (Kling prompt / on-screen text)
// in data/social-video-state.json so the ticks show on every computer.
//
//   GET  /api/social?action=get-state   -> { ok:true, state:{...} }
//   POST /api/social  { action:'save-state', state:{...} }  -> { ok:true }

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'aboutwallart/seo-tools';
  const FILE = 'data/social-video-state.json';
  const CARDS_FILE = 'data/social-cards.json';
  const SCHEDULE_FILE = 'data/social-schedule.json';

  async function ghGet(filePath) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (r.status === 404) return { content: null, sha: null };
    if (!r.ok) throw new Error('GitHub fetch failed: ' + r.status);
    const d = await r.json();
    let content = (d.content && d.content.length) ? Buffer.from(d.content, 'base64').toString('utf-8') : '';
    // The contents API returns EMPTY content for files over ~1MB. Reading that as empty
    // is what wiped saved cards — so for a large file, read the blob directly (up to 100MB).
    if ((!content || !content.length) && d.sha && d.size) {
      const b = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${d.sha}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!b.ok) throw new Error('GitHub blob fetch failed: ' + b.status);
      const bd = await b.json();
      content = Buffer.from(bd.content, bd.encoding || 'base64').toString('utf-8');
    }
    return { content: content || null, sha: d.sha };
  }

  async function ghPut(filePath, content, sha, message) {
    return fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) })
    });
  }

  // Conflict-safe save: re-reads the latest file and re-applies the change if two
  // saves collide, so a rapid one-by-one save can never be silently lost.
  async function ghSave(filePath, build, message) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await ghGet(filePath);
      const newContent = build(cur.content);
      const r = await ghPut(filePath, newContent, cur.sha, message);
      if (r.ok) return;
      if (r.status === 409 || r.status === 422) { await new Promise(function (res) { setTimeout(res, 200 * (attempt + 1)); }); continue; }
      throw new Error('GitHub put failed: ' + r.status + ' ' + await r.text());
    }
    throw new Error('Save could not complete — please save again.');
  }

  function parseCards(content) {
    var data = { generated: {}, custom: {}, removed: [] };
    if (content) { try { var p = JSON.parse(content); data.generated = p.generated || {}; data.custom = p.custom || {}; data.removed = p.removed || []; } catch (e) {} }
    return data;
  }

  try {
    const action = (req.method === 'POST' ? (req.body && req.body.action) : req.query.action) || 'get-state';

    if (action === 'get-state') {
      const { content } = await ghGet(FILE);
      let state = {};
      if (content) { try { state = JSON.parse(content); } catch (e) { state = {}; } }
      return res.status(200).json({ ok: true, state });
    }

    if (action === 'save-state') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const state = body.state && typeof body.state === 'object' ? body.state : {};
      await ghSave(FILE, function () { return JSON.stringify(state, null, 2); }, 'Update social video tick-state');
      return res.status(200).json({ ok: true });
    }

    if (action === 'generate-kling') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const title = (body.title || '').toString().slice(0, 300);
      const room = (body.room || '').toString().slice(0, 120);
      let seconds = parseInt(body.duration, 10);
      if (isNaN(seconds)) seconds = 8;
      seconds = Math.max(8, Math.min(15, seconds));
      const startUrl = (body.startImageUrl || '').toString();
      const startData = (body.startImageBase64 || '').toString(); // full data URL or ''
      const endData = (body.endImageBase64 || '').toString(); // full data URL or ''

      function imgBlock(dataUrl){
        var mm = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        return mm ? { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } } : null;
      }

      var only = (body.only || '').toString();          // '', 'prompt', or 'onscreen'
      var wantPrompt = only !== 'onscreen';
      var wantLines = only !== 'prompt';

      var PROMPT_PART =
        'PROMPT — Produce the Kling prompt by FILLING IN the [bracketed] parts of this EXACT template and keeping every other word VERBATIM — same sentences, same order, same connective phrases. Do NOT paraphrase, reorder, shorten or "improve" the wording. One flowing paragraph, no brackets left.\n' +
        'TEMPLATE: "The video features [the person/people exactly as seen in the images: number, approx age, hair, clothing], same [face/faces], same hair, same [outfit/outfits] throughout, [brief scene/room context]. The video opens with [the START-frame moment], the [name the specific artwork/prints exactly as seen on the wall] clearly visible on the wall behind [her/him/them]. Naturally and at a completely normal human pace, [she/he/they] transition[s] into [the END-frame moment], the wall art prints prominently visible behind [her/him/them]. Throughout the video [she/he/they] move[s] naturally between these two moments — [4-5 short beats] — in a [adjective] [room] rhythm. Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. [She/He/They] stay[s] visible in frame at all times. The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible. Lighting: [describe the light in the images]. Mood: [fitting the room]. Style: premium editorial home lifestyle."\n' +
        'GOLD-STANDARD (template filled for a games-room poker video — match this structure and phrasing exactly): "The video features three men in their 30s in smart-casual clothes, same faces, same hair, same outfits throughout, sitting around a table in a moody games room on poker night. The video opens with them mid-game, holding cards, focused and grinning, the set of 3 pop prints (darts, aces, chess king) clearly visible on the wall behind them. Naturally and at a completely normal human pace, they transition into a big win/lose moment — one throwing his arms up, the others reacting and laughing, the wall art prints prominently visible behind them. Throughout the video they move naturally between these two moments — playing, reacting, laughing, leaning back — in a lively relaxed games-room rhythm. Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. They stay visible in frame at all times. The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible. Lighting: warm moody low light with a pendant over the table. Mood: fun, confident, masculine games-room lifestyle. Style: premium editorial home lifestyle."\n' +
        'Rules: fill ONLY the brackets using what you actually SEE in the two images; keep all connective sentences word-for-word; the final sentence MUST be exactly "Style: premium editorial home lifestyle." Never invent people, art or objects not in the images. If no person is visible, use the ambient subject (light, fabric, steam, a hand entering) but keep the skeleton.';

      var LINES_PART =
        'ON-SCREEN TEXT — write AT LEAST 10 short caption options, each under 8 words. VOICE: FIRST PERSON, written AS THE PERSON IN THE VIDEO speaking about their OWN home (use "I / my / me / we / our"), like a caption they would post themselves. NEVER address the viewer — do NOT use the words "you" or "your". Feeling-led, NO product name, UK spelling, not salesy, no words like elevate/delve/showcase. FIRST think of clearly DIFFERENT angles (a feeling, an everyday thought, a little confession, a proud moment, a before/after, a cosy line, a playful line, a quiet-luxury line, a seasonal/mood line, a punchy line), THEN write the 10 — every one genuinely different, never ten versions of the same line. Voice examples: "obsessed with my new calm corner", "finally happy with my bathroom", "my little spa moment before work", "we redid this wall and I can\'t stop looking".';

      var schema = (wantPrompt && wantLines) ? '{"kling_prompt":"...","onscreen":["...", at least 10 distinct lines]}'
                 : wantPrompt ? '{"kling_prompt":"..."}'
                 : '{"onscreen":["...", at least 10 distinct lines]}';

      var instructions =
        'You are creating content for a Kling AI image-to-video (about ' + seconds + ' seconds, vertical 9:16) for this wall-art product: "' + title + '"' + (room ? (' (room: ' + room + ')') : '') + '. You are given a START frame and an END frame.\n\n'
        + (wantPrompt ? (PROMPT_PART + '\n\n') : '')
        + (wantLines ? (LINES_PART + '\n\n') : '')
        + 'Return ONLY strict JSON, no markdown: ' + schema;

      var content = [{ type: 'text', text: instructions }];
      var startBlk = startData ? imgBlock(startData) : (startUrl ? { type: 'image', source: { type: 'url', url: startUrl } } : null);
      if (startBlk) {
        content.push({ type: 'text', text: 'START frame (first frame of the video):' });
        content.push(startBlk);
      }
      var endBlk = endData ? imgBlock(endData) : null;
      if (endBlk) {
        content.push({ type: 'text', text: 'END frame (final frame of the video):' });
        content.push(endBlk);
      }

      var ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, messages: [{ role: 'user', content: content }] })
      });
      if (!ar.ok) return res.status(ar.status).json({ ok: false, error: 'Claude error: ' + (await ar.text()) });
      var ad = await ar.json();
      var txt = (ad.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      var jm = txt.match(/\{[\s\S]*\}/);
      var parsed = {};
      try { parsed = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not parse AI output', raw: txt }); }
      var out = { ok: true };
      if (wantPrompt) { out.kling_prompt = parsed.kling_prompt || ''; }
      if (wantLines) { out.onscreen = Array.isArray(parsed.onscreen) ? parsed.onscreen.filter(function (x) { return x && x.toString().trim(); }) : []; }
      return res.status(200).json(out);
    }

    if (action === 'get-cards') {
      const gh = await ghGet(CARDS_FILE);
      var data = { generated: {}, custom: {}, removed: [] };
      if (gh.content) { try { var p = JSON.parse(gh.content); data.generated = p.generated || {}; data.custom = p.custom || {}; data.removed = p.removed || []; } catch (e) {} }
      return res.status(200).json({ ok: true, generated: data.generated, custom: data.custom, removed: data.removed });
    }

    if (action === 'save-card') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      await ghSave(CARDS_FILE, function (content) {
        var data = parseCards(content);
        // merge ONLY the fields sent, so images / prompt / lines can be saved independently
        var rec = data.generated[sku] || {};
        if (typeof body.prompt !== 'undefined') { rec.prompt = body.prompt || ''; }
        if (typeof body.onscreen !== 'undefined') { rec.onscreen = Array.isArray(body.onscreen) ? body.onscreen : []; }
        if (typeof body.seconds !== 'undefined') { rec.seconds = body.seconds || 8; }
        if (typeof body.startImg !== 'undefined') { rec.startImg = body.startImg || ''; }
        if (typeof body.endImg !== 'undefined') { rec.endImg = body.endImg || ''; }
        rec.approved = true;
        rec.savedAt = new Date().toISOString();
        data.generated[sku] = rec;
        return JSON.stringify(data, null, 2);
      }, 'Save card ' + sku);
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove-card') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      await ghSave(CARDS_FILE, function (content) {
        var data = parseCards(content);
        delete data.custom[sku];
        delete data.generated[sku];
        if (data.removed.indexOf(sku) === -1) { data.removed.push(sku); }
        return JSON.stringify(data, null, 2);
      }, 'Remove card ' + sku);
      return res.status(200).json({ ok: true });
    }

    if (action === 'add-product') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString().trim();
      if (!sku) return res.status(400).json({ ok: false, error: 'Type a sku for print files first' });
      const domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) return res.status(500).json({ ok: false, error: 'Shopify not configured' });
      const gq = 'query($q:String!){ products(first:1, query:$q){ edges{ node{ title handle onlineStoreUrl featuredImage{url} room:metafield(namespace:"custom",key:"room_type"){value} skumf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } } }';
      const sr = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gq, variables: { q: 'metafield:custom.sku_for_print_files:' + sku } })
      });
      if (!sr.ok) return res.status(sr.status).json({ ok: false, error: 'Shopify error ' + sr.status });
      const sd = await sr.json();
      const edges = sd && sd.data && sd.data.products && sd.data.products.edges;
      if (!edges || !edges.length) return res.status(200).json({ ok: false, error: 'No product found for "' + sku + '"' });
      const n = edges[0].node;
      var room = '';
      try { var arr = JSON.parse((n.room && n.room.value) || '[]'); room = (arr[0] || '').toString().split(',')[0].trim(); } catch (e) {}
      const card = {
        sku: (n.skumf && n.skumf.value) || sku,
        title: n.title || '',
        handle: n.handle || '',
        url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')),
        image: (n.featuredImage && n.featuredImage.url) || '',
        room: room
      };
      await ghSave(CARDS_FILE, function (content) {
        var data = parseCards(content);
        data.custom[card.sku] = card;
        return JSON.stringify(data, null, 2);
      }, 'Add custom card ' + card.sku);
      return res.status(200).json({ ok: true, card: card });
    }

    if (action === 'get-schedule') {
      const gh = await ghGet(SCHEDULE_FILE);
      var sched = { videos: [], state: {}, savedCaptions: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); sched.videos = p.videos || []; sched.state = p.state || {}; sched.savedCaptions = p.savedCaptions || {}; } catch (e) {} }
      return res.status(200).json({ ok: true, videos: sched.videos, state: sched.state, savedCaptions: sched.savedCaptions });
    }

    if (action === 'save-schedule') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      await ghSave(SCHEDULE_FILE, function (content) {
        var sched = { videos: [], state: {}, savedCaptions: {} };
        if (content) { try { var p = JSON.parse(content); sched.videos = p.videos || []; sched.state = p.state || {}; sched.savedCaptions = p.savedCaptions || {}; } catch (e) {} }
        if (body.state && typeof body.state === 'object') { sched.state = body.state; }
        if (body.savedCaptions && typeof body.savedCaptions === 'object') { sched.savedCaptions = body.savedCaptions; }
        return JSON.stringify(sched, null, 2);
      }, 'Update schedule state');
      return res.status(200).json({ ok: true });
    }

    if (action === 'generate-caption') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const platform = (body.platform || 'tiktok').toString().toLowerCase();
      const title = (body.title || '').toString().slice(0, 200);
      const room = (body.room || '').toString().slice(0, 60);
      const length = (body.length || 'short').toString().toLowerCase() === 'long' ? 'long' : 'short';
      if (platform !== 'tiktok') return res.status(400).json({ ok: false, error: 'Only TikTok captions are generated here.' });
      var lenInstr = length === 'long'
        ? 'a longer caption of 2 to 3 short, warm sentences, then 5 to 8 relevant hashtags'
        : 'a very short caption of one warm human line (about 120 characters max), then 3 to 5 relevant hashtags';
      var instr =
        'You are a warm, friendly home-decor advisor writing ONE organic TikTok caption for a wall-art product, to post with its styled-in-room video. Product: "' + title + '"' + (room ? (' — room: ' + room) : '') + '.\n' +
        'Write ' + lenInstr + '.\n' +
        'STRICT TikTok rules — the caption MUST follow ALL of these (this is required to avoid policy strikes):\n' +
        '- NO call to action of any kind. Never say shop, buy, tap, click, link, order, get yours, DM, or anything similar.\n' +
        '- NO links, URLs, phone numbers, emails, @handles, QR codes, or any direction to go off TikTok.\n' +
        '- NO price, discount, sale, or exaggerated / unverifiable claims. Describe the product honestly.\n' +
        '- NO words in ALL CAPS, and no letters replaced by symbols or numbers.\n' +
        '- Sentence case: start the caption and every new sentence with a capital letter; keep the rest natural (never a whole word in caps).\n' +
        '- Native, genuine, conversational; the product and room come through naturally. UK spelling. Never use words like elevate, delve, showcase, dive, beacon.\n' +
        'Hashtags: lowercase, relevant to wall art / the room / the decor style, not spammy, no banned words.\n' +
        'Return ONLY strict JSON, no markdown: {"caption":"...","hashtags":"#one #two #three"}';
      var ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: instr }] })
      });
      if (!ar.ok) return res.status(ar.status).json({ ok: false, error: 'Claude error: ' + (await ar.text()) });
      var ad = await ar.json();
      var txt = (ad.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      var jm = txt.match(/\{[\s\S]*\}/);
      var parsed = {};
      try { parsed = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not parse AI output', raw: txt }); }
      // guarantee sentence case: capitalise the first letter and the start of every sentence
      var cap = (parsed.caption || '').replace(/(^\s*|[.!?]\s+|\n\s*)([a-z])/g, function (mm, pre, ch) { return pre + ch.toUpperCase(); });
      return res.status(200).json({ ok: true, caption: cap, hashtags: parsed.hashtags || '', length: length });
    }

    if (action === 'make-feed') {
      // hands Make.com the approved FB / X / Pinterest / LinkedIn posts (caption + image + link)
      const gh = await ghGet(SCHEDULE_FILE);
      var sched = { videos: [], savedCaptions: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); sched.videos = p.videos || []; sched.savedCaptions = p.savedCaptions || {}; } catch (e) {} }
      var plats = ['facebook', 'x', 'pinterest', 'linkedin'];
      var posts = [];
      sched.videos.forEach(function (v) {
        plats.forEach(function (plat) {
          var k = v.id + '_' + plat;
          var cap = (k in sched.savedCaptions) ? sched.savedCaptions[k] : ((v.captions && v.captions[plat]) || '');
          if (!cap) return;
          posts.push({ id: v.id, sku: v.sku, title: v.title, date: v.date, platform: plat, image: v.image, link: v.url, caption: cap });
        });
      });
      return res.status(200).json({ ok: true, count: posts.length, posts: posts });
    }

    // ---- MONTHLY PLANNER (Tab 3) ----
    const OCC_FILE = 'data/marketing-occasions.json';
    const USED_FILE = 'data/used-videos.json';
    const USEDBLOG_FILE = 'data/used-blogs.json';
    const PLAN_FILE = 'data/social-plan.json';
    const BEST_TIMES_FILE = 'data/metricool-best-times.json';

    async function usedSetLower() {
      const gh = await ghGet(USED_FILE);
      var set = {};
      if (gh.content) { try { (JSON.parse(gh.content).used || []).forEach(function (x) { set[(x.sku || '').toUpperCase()] = 1; }); } catch (e) {} }
      return set;
    }
    // one Shopify lookup helper for the print-files SKU metafield
    async function shopifyByTagOrSku(q, n) {
      const domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) throw new Error('Shopify not configured');
      const gq = 'query($q:String!,$n:Int!){ products(first:$n, query:$q){ edges{ node{ title handle onlineStoreUrl featuredImage{url} tags room:metafield(namespace:"custom",key:"room_type"){value} skumf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } } }';
      const sr = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gq, variables: { q: q, n: n } })
      });
      if (!sr.ok) throw new Error('Shopify error ' + sr.status);
      const sd = await sr.json();
      return (sd && sd.data && sd.data.products && sd.data.products.edges) || [];
    }
    function nodeToCard(n, fallbackSku) {
      var sku = (n.skumf && n.skumf.value) || fallbackSku || '';
      var room = '';
      try { var arr = JSON.parse((n.room && n.room.value) || '[]'); room = (arr[0] || '').toString().split(',')[0].trim(); } catch (e) { room = (n.room && n.room.value) || ''; }
      return {
        sku: sku, title: n.title || '', handle: n.handle || '',
        url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')),
        image: (n.featuredImage && n.featuredImage.url) || '', room: room, tags: n.tags || []
      };
    }

    if (action === 'get-occasions') {
      const gh = await ghGet(OCC_FILE);
      var occ = [];
      if (gh.content) { try { occ = (JSON.parse(gh.content).occasions) || []; } catch (e) {} }
      return res.status(200).json({ ok: true, occasions: occ });
    }

    if (action === 'get-used') {
      const gh = await ghGet(USED_FILE);
      var used = [];
      if (gh.content) { try { used = (JSON.parse(gh.content).used) || []; } catch (e) {} }
      return res.status(200).json({ ok: true, used: used });
    }

    if (action === 'mark-used') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString().trim();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      await ghSave(USED_FILE, function (content) {
        var doc = { used: [] };
        if (content) { try { doc = JSON.parse(content); if (!Array.isArray(doc.used)) doc.used = []; } catch (e) { doc = { used: [] }; } }
        if (!doc.used.some(function (x) { return (x.sku || '').toUpperCase() === sku.toUpperCase(); })) {
          doc.used.push({ sku: sku, name: (body.name || '').toString(), room: (body.room || '').toString(), usedMonth: (body.usedMonth || '').toString() });
        }
        return JSON.stringify(doc, null, 2);
      }, 'Mark video used ' + sku);
      return res.status(200).json({ ok: true });
    }

    if (action === 'get-plan') {
      const gh = await ghGet(PLAN_FILE);
      var months = {};
      if (gh.content) { try { months = (JSON.parse(gh.content).months) || {}; } catch (e) {} }
      return res.status(200).json({ ok: true, months: months });
    }

    if (action === 'set-plan-date') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const month = (body.month || '').toString();
      const index = parseInt(body.index, 10);
      const date = (body.date || '').toString();
      if (!month || isNaN(index) || !date) return res.status(400).json({ ok: false, error: 'Missing month/index/date' });
      await ghSave(PLAN_FILE, function (content) {
        var plan = { months: {} };
        if (content) { try { plan = JSON.parse(content); if (!plan.months) plan.months = {}; } catch (e) { plan = { months: {} }; } }
        var mm = plan.months[month];
        if (mm && Array.isArray(mm.days) && mm.days[index]) { mm.days[index].date = date; mm.updated = new Date().toISOString(); }
        return JSON.stringify(plan, null, 2);
      }, 'Update plan date ' + month + ' #' + index);
      return res.status(200).json({ ok: true });
    }

    if (action === 'save-plan') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const month = (body.month || '').toString();
      if (!month) return res.status(400).json({ ok: false, error: 'Missing month' });
      const days = Array.isArray(body.days) ? body.days : [];
      await ghSave(PLAN_FILE, function (content) {
        var plan = { months: {} };
        if (content) { try { plan = JSON.parse(content); if (!plan.months) plan.months = {}; } catch (e) { plan = { months: {} }; } }
        plan.months[month] = { updated: new Date().toISOString(), days: days };
        return JSON.stringify(plan, null, 2);
      }, 'Save monthly plan ' + month);
      // also push each picked product onto Tab 1 as a card, tagged with its month
      await ghSave(CARDS_FILE, function (content) {
        var data = parseCards(content);
        days.forEach(function (d) {
          var sku = (d.sku || '').toString(); if (!sku) return;
          var ri = data.removed.indexOf(sku); if (ri !== -1) data.removed.splice(ri, 1); // un-hide if removed before
          var rec = data.custom[sku] || {};
          rec.sku = sku;
          rec.title = d.title || rec.title || '';
          rec.handle = d.handle || rec.handle || '';
          rec.url = d.url || rec.url || ('https://aboutwallart.com/products/' + (d.handle || ''));
          rec.image = d.image || rec.image || '';
          rec.room = d.room || rec.room || '';
          rec.planMonth = month;
          rec.planDate = d.date || rec.planDate || '';
          data.custom[sku] = rec;
        });
        return JSON.stringify(data, null, 2);
      }, 'Push plan cards ' + month);
      return res.status(200).json({ ok: true });
    }

    // ---- BEST-POST TIMES BRIDGE ----
    // She pulls the times from Metricool in a Claude chat, then pastes the block here.
    // Stored as data/metricool-best-times.json = { times:{ youtube:"Wednesday 16:00", ... }, updated:"YYYY-MM-DD" }.
    const BEST_TIME_NETS = ['youtube', 'facebook', 'instagram', 'linkedin', 'tiktok', 'twitter', 'pinterest', 'threads', 'gbp'];
    function parseBestTimes(raw) {
      var times = {}, updated = '';
      String(raw || '').split(/\r?\n/).forEach(function (ln) {
        var i = ln.indexOf(':'); if (i < 0) return;
        var key = ln.slice(0, i).trim().toLowerCase().replace(/[^a-z]/g, '');
        var val = ln.slice(i + 1).trim();
        if (!key || !val) return;
        if (key === 'updated') { updated = val; return; }
        if (key === 'x' || key === 'twitterx') key = 'twitter';
        if (BEST_TIME_NETS.indexOf(key) >= 0) times[key] = val;
      });
      return { times: times, updated: updated };
    }

    if (action === 'get-best-times') {
      const gh = await ghGet(BEST_TIMES_FILE);
      var doc = { times: {}, updated: '' };
      if (gh.content) { try { var p = JSON.parse(gh.content); doc.times = p.times || {}; doc.updated = p.updated || ''; } catch (e) {} }
      return res.status(200).json({ ok: true, times: doc.times, updated: doc.updated });
    }

    if (action === 'save-best-times') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const parsed = parseBestTimes(body.raw || '');
      if (!Object.keys(parsed.times).length) return res.status(200).json({ ok: false, error: 'Could not read any times — paste the block exactly as the prompt gives it (one line per network, like "youtube: Wednesday 16:00").' });
      if (!parsed.updated) parsed.updated = new Date().toISOString().slice(0, 10);
      await ghSave(BEST_TIMES_FILE, function () { return JSON.stringify(parsed, null, 2); }, 'Save Metricool best times ' + parsed.updated);
      return res.status(200).json({ ok: true, times: parsed.times, updated: parsed.updated });
    }

    if (action === 'undo-plan-month') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const month = (body.month || '').toString();
      if (!month) return res.status(400).json({ ok: false, error: 'Missing month' });
      const used = await usedSetLower();
      var removedSkus = [];
      await ghSave(CARDS_FILE, function (content) {
        var data = parseCards(content);
        Object.keys(data.custom).forEach(function (sku) {
          var rec = data.custom[sku] || {};
          if (rec.planMonth === month && !used[(sku || '').toUpperCase()]) {
            delete data.custom[sku]; // remove the pushed card only if the video isn't made yet
            removedSkus.push(sku);
          }
        });
        return JSON.stringify(data, null, 2);
      }, 'Undo plan cards ' + month);
      await ghSave(PLAN_FILE, function (content) {
        var plan = { months: {} };
        if (content) { try { plan = JSON.parse(content); if (!plan.months) plan.months = {}; } catch (e) { plan = { months: {} }; } }
        delete plan.months[month];
        return JSON.stringify(plan, null, 2);
      }, 'Remove monthly plan ' + month);
      return res.status(200).json({ ok: true, removedSkus: removedSkus });
    }

    if (action === 'lookup-sku') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString().trim();
      if (!sku) return res.status(400).json({ ok: false, error: 'Type a print-files SKU first' });
      const edges = await shopifyByTagOrSku('metafield:custom.sku_for_print_files:' + sku, 1);
      if (!edges.length) return res.status(200).json({ ok: false, error: 'No product found for "' + sku + '"' });
      const card = nodeToCard(edges[0].node, sku);
      const used = await usedSetLower();
      return res.status(200).json({ ok: true, used: !!used[(card.sku || '').toUpperCase()], product: card });
    }

    function isAWA(v) { return /about\s*wall\s*art/i.test(String(v || '')); } // About Wall Art vendor only

    if (action === 'suggest-products') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var collections = Array.isArray(body.collections) ? body.collections.filter(Boolean) : [];
      var limit = Math.min(parseInt(body.limit, 10) || 8, 100);
      if (!collections.length) collections = ['framed-wall-pictures-for-living-room']; // clean framed-art fallback pool
      const domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) return res.status(500).json({ ok: false, error: 'Shopify not configured' });
      var cq = collections.map(function (h) { return 'handle:' + h; }).join(' OR ');
      const gq = 'query($q:String!,$n:Int!){ collections(first:8, query:$q){ nodes{ handle products(first:$n){ nodes{ title handle vendor onlineStoreUrl featuredImage{url} room:metafield(namespace:"custom",key:"room_type"){value} skumf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } } } }';
      const sr = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', {
        method: 'POST', headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gq, variables: { q: cq, n: 100 } })
      });
      if (!sr.ok) return res.status(sr.status).json({ ok: false, error: 'Shopify error ' + sr.status });
      const sd = await sr.json();
      const cols = (sd && sd.data && sd.data.collections && sd.data.collections.nodes) || [];
      const used = await usedSetLower();
      var seen = {}, out = [];
      cols.forEach(function (col) {
        ((col.products && col.products.nodes) || []).forEach(function (n) {
          if (!isAWA(n.vendor)) return;
          var sku = (n.skumf && n.skumf.value) || '';
          if (!sku || seen[sku.toUpperCase()] || used[sku.toUpperCase()]) return;
          seen[sku.toUpperCase()] = 1;
          var room = ''; try { var arr = JSON.parse((n.room && n.room.value) || '[]'); room = (arr[0] || '').toString().split(',')[0].trim(); } catch (e) { room = (n.room && n.room.value) || ''; }
          out.push({ sku: sku, title: n.title || '', handle: n.handle || '', url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), image: (n.featuredImage && n.featuredImage.url) || '', room: room });
        });
      });
      for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = out[i]; out[i] = out[j]; out[j] = t; }
      return res.status(200).json({ ok: true, products: out.slice(0, limit) });
    }

    if (action === 'hydrate-skus') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var skus = Array.isArray(body.skus) ? body.skus.filter(Boolean).slice(0, 200) : [];
      if (!skus.length) return res.status(200).json({ ok: true, products: [] });
      const domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) return res.status(500).json({ ok: false, error: 'Shopify not configured' });
      var q = skus.map(function (s) { return 'metafield:custom.sku_for_print_files:' + s; }).join(' OR ');
      const gq = 'query($q:String!,$n:Int!){ products(first:$n, query:$q){ nodes{ title handle vendor onlineStoreUrl featuredImage{url} room:metafield(namespace:"custom",key:"room_type"){value} skumf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } }';
      const sr = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', {
        method: 'POST', headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gq, variables: { q: q, n: Math.min(skus.length, 250) } })
      });
      if (!sr.ok) return res.status(sr.status).json({ ok: false, error: 'Shopify error ' + sr.status });
      const sd = await sr.json();
      const nodes = (sd && sd.data && sd.data.products && sd.data.products.nodes) || [];
      const used = await usedSetLower();
      var out = [];
      nodes.forEach(function (n) {
        if (!isAWA(n.vendor)) return;
        var sku = (n.skumf && n.skumf.value) || '';
        if (!sku || used[sku.toUpperCase()]) return; // only UNUSED Tab 1 cards
        var room = ''; try { var arr = JSON.parse((n.room && n.room.value) || '[]'); room = (arr[0] || '').toString().split(',')[0].trim(); } catch (e) { room = (n.room && n.room.value) || ''; }
        out.push({ sku: sku, title: n.title || '', handle: n.handle || '', url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), image: (n.featuredImage && n.featuredImage.url) || '', room: room });
      });
      return res.status(200).json({ ok: true, products: out });
    }

    if (action === 'metricool-file') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const month = (body.month || '').toString();
      const posts = Array.isArray(body.posts) ? body.posts : [];
      if (!posts.length) return res.status(400).json({ ok: false, error: 'No posts selected' });

      // Metricool import template header (94 columns)
      var H = ['Text', 'Date', 'Time', 'Draft', 'Facebook', 'Twitter/X', 'LinkedIn', 'GBP', 'Instagram', 'Pinterest', 'TikTok', 'Youtube', 'Threads', 'Bluesky'];
      for (var pi = 1; pi <= 10; pi++) H.push('Picture Url ' + pi);
      for (var ali = 1; ali <= 10; ali++) H.push('Alt text picture ' + ali);
      H = H.concat(['Document title', 'Shortener', 'Video Thumbnail Url', 'Video Cover Frame', 'Twitter/X Can reply', 'Twitter/X Type', 'Twitter/X Poll Duration minutes', 'Twitter/X Poll Option 1', 'Twitter/X Poll Option 2', 'Twitter/X Poll Option 3', 'Twitter/X Poll Option 4', 'Pinterest Board', 'Pinterest Pin Title', 'Pinterest Pin Link', 'Pinterest Pin New Format', 'Instagram Post Type', 'Instagram Show Reel On Feed', 'Youtube Video Title', 'Youtube Video Type', 'Youtube Video Privacy', 'Youtube video for kids', 'Youtube Video Category', 'Youtube Video Tags', 'Youtube playlist', 'GBP Post Type', 'Facebook Post Type', 'Facebook Title', 'First Comment Text', 'TikTok Title', 'TikTok disable comments', 'TikTok disable duet', 'TikTok disable stitch', 'TikTok Post Privacy', 'TikTok Branded Content', 'TikTok Your Brand', 'TikTok Auto Add Music', 'TikTok Photo Cover Index', 'TikTok musicId', 'TikTok music title', 'TikTok music author', 'TikTok music previewUrl', 'TikTok music thumbnailUrl', 'TikTok music soundVolume', 'TikTok music originalVolume', 'TikTok music startMillis', 'TikTok music endMillis', 'TikTok Ai generated content', 'LinkedIn Type', 'LinkedIn Poll Question', 'LinkedIn Poll Option 1', 'LinkedIn Poll Option 2', 'LinkedIn Poll Option 3', 'LinkedIn Poll Option 4', 'LinkedIn Poll Duration', 'LinkedIn Show link preview', 'LinkedIn Images as Carousel', 'Threads Reply Control', 'Threads Is Spoiler', 'Threads Post Type', 'Brand name']);
      var BOOLC = { 'Draft': 1, 'Facebook': 1, 'Twitter/X': 1, 'LinkedIn': 1, 'GBP': 1, 'Instagram': 1, 'Pinterest': 1, 'TikTok': 1, 'Youtube': 1, 'Threads': 1, 'Bluesky': 1, 'Shortener': 1, 'Pinterest Pin New Format': 1, 'Instagram Show Reel On Feed': 1, 'Youtube video for kids': 1, 'TikTok disable comments': 1, 'TikTok disable duet': 1, 'TikTok disable stitch': 1, 'TikTok Branded Content': 1, 'TikTok Your Brand': 1, 'TikTok Auto Add Music': 1, 'TikTok Ai generated content': 1, 'LinkedIn Show link preview': 1, 'LinkedIn Images as Carousel': 1, 'Threads Is Spoiler': 1 };
      function cell(col, val) { if (BOOLC[col]) return val === true ? 'true' : 'false'; if (val === undefined || val === null || val === '') return ''; return '"' + String(val).replace(/"/g, '""') + '"'; }
      function rowLine(o) { return H.map(function (h) { return cell(h, o[h]); }).join(','); }

      // ---- BLOG half of each day: source, matching, boards ----
      var BLOG_BASE = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/';
      var SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN, SHOP_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
      var EDU_BOARD = 'Home Decor Ideas & Interior Styling Tips';
      var BOARD_MAP = [
        ['bathroom', 'Bathroom Decor'], ['nursery', 'Nursery & Kids Decor'], ['kids', 'Nursery & Kids Decor'],
        ['bedroom', 'Bedroom Decor'], ['kitchen', 'Kitchen Decor'], ['dining', 'Dining Room Decor'],
        ['home office', 'Home Office Decor'], ['office', 'Home Office Decor'], ['hallway', 'Hallway Decor'],
        ['entryway', 'Hallway Decor'], ['living room', 'Living Room Decor'], ['tv room', 'Living Room Decor'],
        ['boho', 'Boho Decor'], ['bohemian', 'Boho Decor'], ['coastal', 'Coastal Decor'], ['farmhouse', 'Farmhouse Decor'],
        ['scandi', 'Scandi Decor'], ['japandi', 'Japandi Decor'], ['japanese', 'Zen Decor'], ['asian', 'Zen Decor'],
        ['zen', 'Zen Decor'], ['cherry blossom', 'Zen Decor'], ['warm minimalism', 'Minimalism Decor'], ['minimal', 'Minimalism Decor'],
        ['mid century', 'Mid Century Decor'], ['mid-century', 'Mid Century Decor'], ['industrial', 'Industrial Decor'],
        ['old money', 'Old Money Decor'], ['moroccan', 'Moroccan Decor'], ['mediterranean', 'Mediterranean Decor'],
        ['tropical', 'Tropical Decor'], ['dark and moody', 'Dark and Moody Home Decor'], ['dark moody', 'Dark and Moody Home Decor'],
        ['moody', 'Dark and Moody Home Decor'], ['gallery wall', 'Gallery Wall Ideas'], ['biophilic', 'Biophilic Design'],
        ['plants', 'Biophilic Design'], ['black and white', 'Black & White Decor'], ['christian', 'Christian Decor'],
        ['islamic', 'Islamic Decor'], ['christmas', 'Christmas Decor'], ['wildlife', 'Wildlife Decor'], ['masculine', 'Masculine Decor'],
        ['transitional', 'Transitional Decor'], ['eclectic', 'Eclectic Decor'], ['french country', 'French Country Decor'],
        ['cottage', 'Country Cottage Decor'], ['pet', 'Pet Decor'], ['outdoor', 'Outdoor Decor'], ['fireplace', 'Fireplace Decor'],
        ['home bar', 'Home Bar Decor'], ['games room', 'Games Room Decor'], ['laundry', 'Laundry Room Decor'],
        ['dressing room', 'Dressing Room Decor'], ['coffee', 'Coffee House Design'], ['breakfast nook', 'Breakfast Nook Decor'],
        ['contemporary', 'Contemporary Decor']
      ];
      // board match uses the blog's own tags/title — hyphens normalised to spaces so "living-room-decor" matches "living room"
      function boardForText(t) { t = (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '); for (var bi = 0; bi < BOARD_MAP.length; bi++) { if (t.indexOf(BOARD_MAP[bi][0]) >= 0) return BOARD_MAP[bi][1]; } return ''; }
      function artText(a) { return ((a.title || '') + ' ' + (a.handle || '') + ' ' + (Array.isArray(a.tags) ? a.tags.join(' ') : (a.tags || ''))).toLowerCase(); }
      async function usedBlogSetLower() {
        var gh = await ghGet(USEDBLOG_FILE); var set = {};
        if (gh.content) { try { (JSON.parse(gh.content).used || []).forEach(function (x) { set[(x.handle || '').toLowerCase()] = 1; }); } catch (e) {} }
        return set;
      }
      // real Shopify featured-image URL for a product handle (used when the plan image is a base64 blob)
      async function productImageByHandle(h) {
        if (!h || !SHOP_DOMAIN || !SHOP_TOKEN) return '';
        try {
          var gq = 'query($q:String!){ products(first:1, query:$q){ edges{ node{ featuredImage{ url } } } } }';
          var r = await fetch('https://' + SHOP_DOMAIN + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': SHOP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq, variables: { q: 'handle:' + h } }) });
          if (!r.ok) return '';
          var d = await r.json();
          var e = (d && d.data && d.data.products && d.data.products.edges) || [];
          return (e[0] && e[0].node && e[0].node.featuredImage && e[0].node.featuredImage.url) || '';
        } catch (e) { return ''; }
      }
      // Search the store's blog for LIVE articles matching a phrase (relevance-ranked by Shopify).
      async function shopArticles(qextra, n) {
        if (!SHOP_DOMAIN || !SHOP_TOKEN) return [];
        var q = 'blog_id:93572858142' + (qextra ? (' ' + qextra) : '');
        var gq = 'query($q:String!,$n:Int!){ articles(first:$n, query:$q){ edges{ node{ title handle publishedAt isPublished image{url} tags } } } }';
        var r = await fetch('https://' + SHOP_DOMAIN + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': SHOP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq, variables: { q: q, n: n } }) });
        if (!r.ok) return [];
        var d = await r.json();
        var edges = (d && d.data && d.data.articles && d.data.articles.edges) || [];
        var now = Date.now();
        return edges.map(function (e) { return e.node; }).filter(function (a) { return a.handle && a.isPublished && a.publishedAt && new Date(a.publishedAt).getTime() <= now; });
      }
      // first meaningful theme word from the product title (drops generic wall-art words)
      function themeKeyword(title) {
        var stop = { art: 1, arts: 1, prints: 1, print: 1, set: 1, wall: 1, framed: 1, pictures: 1, picture: 1, poster: 1, posters: 1, decor: 1, canvas: 1, room: 1, home: 1 };
        var ws = (title || '').toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3 && !stop[w]; });
        return ws[0] || '';
      }
      // MATCH 1 (video -> blog): an UNUSED blog matching the video's theme; else any unused. Never a used one.
      async function chooseBlog(post, usedSet, batchUsed, lastTopic) {
        function unusedOf(list) { return list.filter(function (a) { var h = (a.handle || '').toLowerCase(); return !usedSet[h] && !batchUsed[h]; }); }
        var room = (post.room || '').toLowerCase();
        var kw = themeKeyword(post.title);
        var tries = [(kw + ' ' + room).trim(), room, kw];
        for (var ti = 0; ti < tries.length; ti++) {
          if (!tries[ti]) continue;
          var un = unusedOf(await shopArticles(tries[ti], 25));
          if (un.length) {
            if (room) { var pref = un.filter(function (a) { return artText(a).replace(/[^a-z0-9]+/g, ' ').indexOf(room) >= 0; }); if (pref.length) return pref[0]; }
            return un[0];
          }
        }
        var all = unusedOf(await shopArticles('', 50));
        if (!all.length) return null;
        var alt = all.filter(function (a) { var b = boardForText(artText(a)); return b && b !== lastTopic; });
        return (alt[0] || all[0]);
      }

      var usedBlogSet = await usedBlogSetLower();
      var batchBlogUsed = {};
      var lastBlogTopic = '';

      var out = [H.join(',')];
      var usedToMark = [];
      var blogUsedToMark = [];

      // Phase 1 — assign each post an UNUSED blog sequentially (keeps dedup + topic alternation correct; fast, just Shopify searches).
      for (var ai = 0; ai < posts.length; ai++) {
        var bpk = await chooseBlog(posts[ai], usedBlogSet, batchBlogUsed, lastBlogTopic);
        posts[ai]._blog = bpk || null;
        if (bpk) { batchBlogUsed[(bpk.handle || '').toLowerCase()] = 1; lastBlogTopic = boardForText(artText(bpk)) || lastBlogTopic; }
      }

      // one Anthropic call -> parsed JSON (throws on http/parse error)
      async function callAI(prompt, maxTok) {
        var r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('AI ' + r.status);
        var d = await r.json();
        var t = (d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
        var m = t.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : t);
      }

      // build ONE post's rows (its video + its blog). The video and blog AI calls run in parallel.
      // Cap a caption to a platform character limit (Metricool counts the whole Text cell).
      // Prefer cutting at a word boundary; drops trailing hashtags first on video rows (link sits before them).
      function trimTo(text, limit) {
        text = String(text == null ? '' : text);
        if (text.length <= limit) return text;
        var cut = text.slice(0, limit);
        var sp = cut.lastIndexOf(' ');
        if (sp > limit * 0.6) cut = cut.slice(0, sp);
        return cut.replace(/\s+$/, '');
      }
      // Cap a caption that has a link appended after it — trim the CAPTION so caption+link fits (link never cut).
      function trimWithLink(caption, suffix, limit) {
        caption = String(caption == null ? '' : caption);
        suffix = String(suffix == null ? '' : suffix);
        var room = limit - suffix.length; if (room < 0) room = 0;
        return trimTo(caption, room) + suffix;
      }
      // Copy a blog's featured image into the tool's own Drive folder and return a STABLE public link,
      // so optimising the Shopify blog later (which changes its image URL) never breaks the scheduled post.
      var SOCIAL_DRIVE = process.env.EDU_DRIVE_URL;
      var SOCIAL_IMG_FOLDER = '1TVn11XySWBWd941f-Ip_nTkIrQnwFWMQ';
      async function copyImageToDrive(imgUrl, name) {
        if (!imgUrl || !SOCIAL_DRIVE) return '';
        try {
          var jurl = imgUrl + (imgUrl.indexOf('?') >= 0 ? '&' : '?') + 'format=jpg';
          var ir = await fetch(jurl);
          if (!ir.ok) return '';
          var b64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
          var up = await fetch(SOCIAL_DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', folderId: SOCIAL_IMG_FOLDER, name: ((name || 'blog').replace(/[^a-z0-9\-]/gi, '-').slice(0, 80)) + '.jpg', mime: 'image/jpeg', dataBase64: b64 }) });
          if (!up.ok) return '';
          var ud = await up.json();
          return (ud && ud.ok && ud.id) ? ('https://drive.google.com/uc?export=download&id=' + ud.id) : '';
        } catch (e) { return ''; }
      }

      async function buildPost(p) {
        var sku = (p.sku || '').toString();
        var title = (p.title || '').toString();
        var url = (p.url || ('https://aboutwallart.com/products/' + (p.handle || ''))).toString();
        var room = (p.room || '').toString();
        var image = (p.image || '').toString();
        var video = (p.videoLink || '').toString();
        var date = (p.date || '').toString();
        var camp = 'vid-' + sku.toLowerCase();
        var board = room ? (room + ' Decor') : 'Home Decor';
        var shop = function (src, med) { return url + '?utm_source=' + src + (med ? ('&utm_medium=' + med) : '') + '&utm_campaign=' + camp; };
        var blog = p._blog;
        var rows = [];

        var instr = 'You write organic social captions for a wall-art product video (a reel) in the About Wall Art voice: warm, friendly home-decor advisor, UK spelling, NOT salesy, never words like elevate, delve, showcase, dive, beacon. Product: "' + title + '"' + (room ? (' — room: ' + room) : '') + '. It is a framed set, ready to hang.\n' +
          'Write ONE caption per platform in this exact style (use the shop links EXACTLY as given, placed before any hashtags):\n' +
          '- twitter: one short punchy hook line, then " Shop → ' + shop('twitter', '') + '", then 1 hashtag. Under 260 characters total.\n' +
          '- facebook: 2 to 3 warm sentences (why it works in the room; framed and ready to hang), then " Shop the set → ' + shop('facebook', 'video') + '", then 3 hashtags.\n' +
          '- youtube: one short warm line, then " Shop the set → ' + shop('youtube', 'video') + '", then "#shorts" and 3 lowercase hashtags.\n' +
          '- threads: one short warm line, then " Shop the set → ' + shop('threads', 'video') + '", then 5 lowercase hashtags.\n' +
          '- pinterest: keyword-rich and descriptive, 3 to 4 sentences a decorator would search, NO link, end "See more wall art ideas at About Wall Art." then 5 lowercase hashtags.\n' +
          '- instagram: warm 3 to 4 sentences ("here is why I love it", framed and ready to hang, "tap Our Content Hub in my bio"), then a blank line, then about 25 lowercase hashtags. NO link.\n' +
          'Also give: facebookTitle (max 40 chars), youtubeTitle (max 90 chars, ending " #shorts"), pinterestTitle (max 90 chars), alt (one short line describing the product styled in the room).\n' +
          'Return ONLY strict JSON, no markdown: {"twitter":"","facebook":"","youtube":"","threads":"","pinterest":"","instagram":"","facebookTitle":"","youtubeTitle":"","pinterestTitle":"","alt":""}';

        var binstr = null;
        if (blog) {
          binstr = 'You write organic social copy for a home-decor BLOG article in the About Wall Art voice: warm, friendly UK-English advisor, NOT salesy, never words like elevate delve showcase dive beacon. Blog title: "' + (blog.title || '') + '". Write copy that makes people want to read it.\n' +
            'Return ONLY strict JSON, no markdown, with these keys:\n' +
            '- linkedin: professional but warm, 3 to 6 short paragraphs (up to ~2000 chars), a home-styling / workspace angle. NO link, NO hashtags.\n' +
            '- facebook: 2 to 3 warm sentences about the blog. NO link, NO hashtags.\n' +
            '- threads: one or two short lines, then 5 lowercase hashtags. NO link.\n' +
            '- instagram: warm 3 to 4 sentences, then "Tap Our Content Hub in my bio for the full guide.", then a blank line, then about 25 to 30 lowercase hashtags. NO link.\n' +
            '- gmb: a full, informative Google Business description of about 900 to 1200 characters pulling real value from the blog. NO link, NO hashtags.\n' +
            '- pinterestA: keyword-rich descriptive Pinterest description a decorator would search, about 500 to 700 characters. NO link.\n' +
            '- pinterestB: a DIFFERENT keyword-rich Pinterest description, about 500 to 700 characters. NO link.\n' +
            '- pinterestTitle: max 90 characters.\n' +
            '- alt: one short line describing a styled interior for this blog.\n' +
            'Return ONLY: {"linkedin":"","facebook":"","threads":"","instagram":"","gmb":"","pinterestA":"","pinterestB":"","pinterestTitle":"","alt":""}';
        }

        var pair = await Promise.all([callAI(instr, 2000), binstr ? callAI(binstr, 3000).catch(function () { return null; }) : Promise.resolve(null)]);
        var caps = pair[0]; var bc = pair[1];
        var alt = caps.alt || (title + ' styled in a ' + room + ' room');

        // No video thumbnail — leave it empty so Metricool uses the video's own FIRST FRAME as the cover.
        var mk = function (net) { var o = { Date: date, Draft: false, Shortener: true, 'Picture Url 1': video, 'Alt text picture 1': alt, 'Video Thumbnail Url': '' }; o[net] = true; return o; };
        var rTw = mk('Twitter/X'); rTw.Time = '10:00:00'; rTw['Twitter/X Type'] = 'POST'; rTw.Text = trimTo(caps.twitter, 280); rows.push(rowLine(rTw));
        var rFb = mk('Facebook'); rFb.Time = '10:00:00'; rFb['Facebook Post Type'] = 'REEL'; rFb['Facebook Title'] = caps.facebookTitle || title; rFb.Text = trimTo(caps.facebook, 2000); rows.push(rowLine(rFb));
        var rYt = mk('Youtube'); rYt.Time = '10:00:00'; rYt['Youtube Video Title'] = caps.youtubeTitle || title; rYt['Youtube Video Type'] = 'SHORT'; rYt['Youtube Video Privacy'] = 'PUBLIC'; rYt.Text = trimTo(caps.youtube, 4900); rows.push(rowLine(rYt));
        var rTh = mk('Threads'); rTh.Time = '11:00:00'; rTh['Threads Reply Control'] = 'EVERYONE'; rTh['Threads Post Type'] = 'POST'; rTh.Text = trimTo(caps.threads, 500); rows.push(rowLine(rTh));
        var rPi = mk('Pinterest'); rPi.Time = '11:00:00'; rPi['Pinterest Board'] = board; rPi['Pinterest Pin Title'] = caps.pinterestTitle || title; rPi['Pinterest Pin Link'] = shop('pinterest', 'video'); rPi.Text = trimTo(caps.pinterest, 500); rows.push(rowLine(rPi));
        var rIg = mk('Instagram'); rIg.Time = '11:00:00'; rIg.Draft = true; rIg['Instagram Post Type'] = 'REEL'; rIg['Instagram Show Reel On Feed'] = true; rIg.Text = trimTo(caps.instagram, 2200); rows.push(rowLine(rIg));

        var usedB = null;
        if (blog && bc) {
          var bh = blog.handle;
          var bTitle = blog.title || '';
          var bImg = (blog.image && blog.image.url) || '';
          if (bImg.indexOf('data:') === 0) bImg = '';
          // freeze a public copy of the featured image in Drive (stable — survives blog re-optimisation)
          var driveImg = bImg ? await copyImageToDrive(bImg, bh) : '';
          var gmbImg;
          if (driveImg) { bImg = driveImg; gmbImg = driveImg; }
          else { gmbImg = bImg ? (bImg + (bImg.indexOf('?') >= 0 ? '&' : '?') + 'format=jpg') : ''; }
          var bUrl = BLOG_BASE + bh;
          var blink = function (src) { return bUrl + '?utm_source=' + src + '&utm_medium=blog&utm_campaign=' + bh; };
          var topicBoard = boardForText(artText(blog));
          var balt = bc.alt || bTitle;
          var gmbText = (bc.gmb || bTitle).slice(0, 1400).replace(/\s+$/, '') + '\n\nRead more → ' + blink('gmb');
          if (gmbText.length > 1500) gmbText = gmbText.slice(0, 1500);
          var mkb = function (net, img) { var o = { Date: date, Draft: false, Shortener: true, 'Picture Url 1': img || bImg, 'Alt text picture 1': balt }; o[net] = true; return o; };
          var bFb = mkb('Facebook'); bFb.Time = '12:00:00'; bFb['Facebook Post Type'] = 'POST'; bFb.Text = trimWithLink(bc.facebook || bTitle, '\n\nRead more → ' + blink('facebook'), 2000); rows.push(rowLine(bFb));
          var bIg = mkb('Instagram'); bIg.Time = '13:00:00'; bIg['Instagram Post Type'] = 'POST'; bIg.Text = trimTo(bc.instagram || bTitle, 2200); rows.push(rowLine(bIg));
          var bTh = mkb('Threads'); bTh.Time = '13:00:00'; bTh['Threads Reply Control'] = 'EVERYONE'; bTh['Threads Post Type'] = 'POST'; bTh.Text = trimWithLink(bc.threads || bTitle, '\n\nRead more → ' + blink('threads'), 500); rows.push(rowLine(bTh));
          var pboard1 = topicBoard || EDU_BOARD;
          var bP1 = mkb('Pinterest'); bP1.Time = '13:00:00'; bP1['Pinterest Board'] = pboard1; bP1['Pinterest Pin Title'] = bc.pinterestTitle || bTitle; bP1['Pinterest Pin Link'] = blink('pinterest'); bP1.Text = trimTo(bc.pinterestA || bTitle, 500); rows.push(rowLine(bP1));
          if (pboard1 !== EDU_BOARD) { var bP2 = mkb('Pinterest'); bP2.Time = '13:05:00'; bP2['Pinterest Board'] = EDU_BOARD; bP2['Pinterest Pin Title'] = bc.pinterestTitle || bTitle; bP2['Pinterest Pin Link'] = blink('pinterest'); bP2.Text = trimTo(bc.pinterestB || bc.pinterestA || bTitle, 500); rows.push(rowLine(bP2)); }
          var bLi = mkb('LinkedIn'); bLi.Time = '17:00:00'; bLi['LinkedIn Type'] = 'POST'; bLi.Text = trimWithLink(bc.linkedin || bTitle, '\n\nRead more → ' + blink('linkedin'), 3000); rows.push(rowLine(bLi));
          var bGb = mkb('GBP', gmbImg); bGb.Time = '17:00:00'; bGb['GBP Post Type'] = 'publication'; bGb.Text = gmbText; rows.push(rowLine(bGb));
          usedB = { handle: bh, title: bTitle, usedDate: date };
        }

        return { rows: rows, usedV: { sku: sku, name: title, room: room, usedMonth: month }, usedB: usedB };
      }

      // Phase 2 — build all posts IN PARALLEL (max 6 at once), order preserved.
      async function mapLimit(arr, limit, fn) {
        var resArr = new Array(arr.length); var idx = 0;
        async function worker() { while (idx < arr.length) { var i = idx++; resArr[i] = await fn(arr[i]); } }
        var ws = []; var n = Math.min(limit, arr.length); for (var w = 0; w < n; w++) ws.push(worker());
        await Promise.all(ws); return resArr;
      }

      var built;
      try { built = await mapLimit(posts, 6, buildPost); }
      catch (e) { return res.status(200).json({ ok: false, error: 'Caption AI error — ' + (e && e.message ? e.message : 'try again') }); }
      built.forEach(function (b) {
        b.rows.forEach(function (rw) { out.push(rw); });
        usedToMark.push(b.usedV);
        if (b.usedB) blogUsedToMark.push(b.usedB);
      });

      var csv = '﻿' + out.join('\r\n') + '\r\n';

      if (usedToMark.length) {
        await ghSave(USED_FILE, function (content) {
          var doc = { used: [] };
          if (content) { try { doc = JSON.parse(content); if (!Array.isArray(doc.used)) doc.used = []; } catch (e) { doc = { used: [] }; } }
          usedToMark.forEach(function (u) { if (!doc.used.some(function (x) { return (x.sku || '').toUpperCase() === u.sku.toUpperCase(); })) doc.used.push(u); });
          return JSON.stringify(doc, null, 2);
        }, 'Mark used from Metricool file');
      }

      if (blogUsedToMark.length) {
        await ghSave(USEDBLOG_FILE, function (content) {
          var doc = { used: [] };
          if (content) { try { doc = JSON.parse(content); if (!Array.isArray(doc.used)) doc.used = []; } catch (e) { doc = { used: [] }; } }
          blogUsedToMark.forEach(function (u) { if (!doc.used.some(function (x) { return (x.handle || '').toLowerCase() === u.handle.toLowerCase(); })) doc.used.push(u); });
          return JSON.stringify(doc, null, 2);
        }, 'Mark blogs used from Metricool file');
      }

      await ghSave(PLAN_FILE, function (content) {
        var plan = { months: {} };
        if (content) { try { plan = JSON.parse(content); if (!plan.months) plan.months = {}; } catch (e) { plan = { months: {} }; } }
        posts.forEach(function (p) {
          var sku = (p.sku || '').toString(); var newDate = (p.date || '').toString(); var newMonth = newDate.slice(0, 7);
          Object.keys(plan.months).forEach(function (mkk) {
            var days = plan.months[mkk].days || [];
            for (var i = 0; i < days.length; i++) {
              if ((days[i].sku || '') === sku) {
                days[i].sent = true; days[i].videoLink = (p.videoLink || ''); if (newDate) days[i].date = newDate;
                if (newMonth && newMonth !== mkk) {
                  var day = days.splice(i, 1)[0];
                  if (!plan.months[newMonth]) plan.months[newMonth] = { updated: new Date().toISOString(), days: [] };
                  plan.months[newMonth].days.push(day);
                }
                break;
              }
            }
          });
        });
        return JSON.stringify(plan, null, 2);
      }, 'Mark plan posts sent for Metricool');

      return res.status(200).json({ ok: true, csv: csv, count: posts.length });
    }

    // ---- FIX BROKEN BLOG IMAGES (Part 3) — read-only, self-contained (cannot affect metricool-file) ----
    // A Metricool post freezes the blog's featured-image URL at build time. If she re-uploads that blog's
    // featured image later (SEO optimisation) Shopify gives it a NEW url and the old one 404s -> "No image".
    // This finds the already-scheduled blog posts whose image was replaced AFTER the plan was built and
    // rebuilds JUST those, with the featured image frozen to a stable public Drive copy, into a mini CSV.
    if (action === 'fix-blog-images') {
      var fbBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var fbMonth = (fbBody.month || '').toString();
      if (!/^\d{4}-\d{2}$/.test(fbMonth)) return res.status(400).json({ ok: false, error: 'Pick a month first.' });

      // 1 — the tool's own record of every scheduled blog + its scheduled date, for this month
      var ubGh = await ghGet(USEDBLOG_FILE);
      var scheduled = [];
      if (ubGh.content) { try { scheduled = (JSON.parse(ubGh.content).used || []).filter(function (x) { return x && x.handle && (x.usedDate || '').slice(0, 7) === fbMonth; }); } catch (e) { scheduled = []; } }
      if (!scheduled.length) return res.status(200).json({ ok: true, count: 0, fixed: [], csv: '', message: 'No scheduled blogs recorded for ' + fbMonth + '.' });

      // 2 — when the plan for this month was built (image replaced AFTER this = broken). Missing build date -> flag nothing.
      var planGh = await ghGet(PLAN_FILE);
      var builtMs = Infinity;
      if (planGh.content) { try { var pm = (JSON.parse(planGh.content).months || {})[fbMonth]; if (pm && pm.updated) builtMs = new Date(pm.updated).getTime(); } catch (e) {} }

      var FB_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN, FB_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
      async function fbArticle(h) {
        if (!FB_DOMAIN || !FB_TOKEN) return null;
        try {
          var gq = 'query($q:String!){ articles(first:3, query:$q){ edges{ node{ handle title isPublished image{url} tags } } } }';
          var r = await fetch('https://' + FB_DOMAIN + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': FB_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq, variables: { q: 'blog_id:93572858142 handle:' + h } }) });
          if (!r.ok) return null;
          var d = await r.json();
          var edges = (d && d.data && d.data.articles && d.data.articles.edges) || [];
          for (var i = 0; i < edges.length; i++) { if (((edges[i].node.handle) || '').toLowerCase() === h.toLowerCase()) return edges[i].node; }
          return (edges[0] && edges[0].node) || null;
        } catch (e) { return null; }
      }
      function fbImgMs(u) { var m = String(u || '').match(/[?&]v=(\d+)/); return m ? parseInt(m[1], 10) * 1000 : 0; }

      // 3 — detect broken: current featured-image version newer than the plan build time
      var brokenList = [];
      for (var si = 0; si < scheduled.length; si++) {
        var scn = scheduled[si];
        var node = await fbArticle(scn.handle);
        if (!node || !node.image || !node.image.url) continue; // can't check -> leave alone
        var imgMs = fbImgMs(node.image.url);
        if (imgMs && imgMs > builtMs) brokenList.push({ handle: scn.handle, title: node.title || scn.title || scn.handle, date: scn.usedDate, node: node });
      }
      if (!brokenList.length) return res.status(200).json({ ok: true, count: 0, fixed: [], csv: '', message: 'No broken images found for ' + fbMonth + '.' });

      // ---- rebuild JUST the broken blogs — mirrors metricool-file's blog half exactly (isolated copies) ----
      var FBH = ['Text', 'Date', 'Time', 'Draft', 'Facebook', 'Twitter/X', 'LinkedIn', 'GBP', 'Instagram', 'Pinterest', 'TikTok', 'Youtube', 'Threads', 'Bluesky'];
      for (var fpi = 1; fpi <= 10; fpi++) FBH.push('Picture Url ' + fpi);
      for (var fai = 1; fai <= 10; fai++) FBH.push('Alt text picture ' + fai);
      FBH = FBH.concat(['Document title', 'Shortener', 'Video Thumbnail Url', 'Video Cover Frame', 'Twitter/X Can reply', 'Twitter/X Type', 'Twitter/X Poll Duration minutes', 'Twitter/X Poll Option 1', 'Twitter/X Poll Option 2', 'Twitter/X Poll Option 3', 'Twitter/X Poll Option 4', 'Pinterest Board', 'Pinterest Pin Title', 'Pinterest Pin Link', 'Pinterest Pin New Format', 'Instagram Post Type', 'Instagram Show Reel On Feed', 'Youtube Video Title', 'Youtube Video Type', 'Youtube Video Privacy', 'Youtube video for kids', 'Youtube Video Category', 'Youtube Video Tags', 'Youtube playlist', 'GBP Post Type', 'Facebook Post Type', 'Facebook Title', 'First Comment Text', 'TikTok Title', 'TikTok disable comments', 'TikTok disable duet', 'TikTok disable stitch', 'TikTok Post Privacy', 'TikTok Branded Content', 'TikTok Your Brand', 'TikTok Auto Add Music', 'TikTok Photo Cover Index', 'TikTok musicId', 'TikTok music title', 'TikTok music author', 'TikTok music previewUrl', 'TikTok music thumbnailUrl', 'TikTok music soundVolume', 'TikTok music originalVolume', 'TikTok music startMillis', 'TikTok music endMillis', 'TikTok Ai generated content', 'LinkedIn Type', 'LinkedIn Poll Question', 'LinkedIn Poll Option 1', 'LinkedIn Poll Option 2', 'LinkedIn Poll Option 3', 'LinkedIn Poll Option 4', 'LinkedIn Poll Duration', 'LinkedIn Show link preview', 'LinkedIn Images as Carousel', 'Threads Reply Control', 'Threads Is Spoiler', 'Threads Post Type', 'Brand name']);
      var FBBOOL = { 'Draft': 1, 'Facebook': 1, 'Twitter/X': 1, 'LinkedIn': 1, 'GBP': 1, 'Instagram': 1, 'Pinterest': 1, 'TikTok': 1, 'Youtube': 1, 'Threads': 1, 'Bluesky': 1, 'Shortener': 1, 'Pinterest Pin New Format': 1, 'Instagram Show Reel On Feed': 1, 'Youtube video for kids': 1, 'TikTok disable comments': 1, 'TikTok disable duet': 1, 'TikTok disable stitch': 1, 'TikTok Branded Content': 1, 'TikTok Your Brand': 1, 'TikTok Auto Add Music': 1, 'TikTok Ai generated content': 1, 'LinkedIn Show link preview': 1, 'LinkedIn Images as Carousel': 1, 'Threads Is Spoiler': 1 };
      function fbCell(col, val) { if (FBBOOL[col]) return val === true ? 'true' : 'false'; if (val === undefined || val === null || val === '') return ''; return '"' + String(val).replace(/"/g, '""') + '"'; }
      function fbRow(o) { return FBH.map(function (h) { return fbCell(h, o[h]); }).join(','); }

      var FB_BLOG_BASE = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/';
      var FB_EDU_BOARD = 'Home Decor Ideas & Interior Styling Tips';
      var FB_BOARD_MAP = [
        ['bathroom', 'Bathroom Decor'], ['nursery', 'Nursery & Kids Decor'], ['kids', 'Nursery & Kids Decor'],
        ['bedroom', 'Bedroom Decor'], ['kitchen', 'Kitchen Decor'], ['dining', 'Dining Room Decor'],
        ['home office', 'Home Office Decor'], ['office', 'Home Office Decor'], ['hallway', 'Hallway Decor'],
        ['entryway', 'Hallway Decor'], ['living room', 'Living Room Decor'], ['tv room', 'Living Room Decor'],
        ['boho', 'Boho Decor'], ['bohemian', 'Boho Decor'], ['coastal', 'Coastal Decor'], ['farmhouse', 'Farmhouse Decor'],
        ['scandi', 'Scandi Decor'], ['japandi', 'Japandi Decor'], ['japanese', 'Zen Decor'], ['asian', 'Zen Decor'],
        ['zen', 'Zen Decor'], ['cherry blossom', 'Zen Decor'], ['warm minimalism', 'Minimalism Decor'], ['minimal', 'Minimalism Decor'],
        ['mid century', 'Mid Century Decor'], ['mid-century', 'Mid Century Decor'], ['industrial', 'Industrial Decor'],
        ['old money', 'Old Money Decor'], ['moroccan', 'Moroccan Decor'], ['mediterranean', 'Mediterranean Decor'],
        ['tropical', 'Tropical Decor'], ['dark and moody', 'Dark and Moody Home Decor'], ['dark moody', 'Dark and Moody Home Decor'],
        ['moody', 'Dark and Moody Home Decor'], ['gallery wall', 'Gallery Wall Ideas'], ['biophilic', 'Biophilic Design'],
        ['plants', 'Biophilic Design'], ['black and white', 'Black & White Decor'], ['christian', 'Christian Decor'],
        ['islamic', 'Islamic Decor'], ['christmas', 'Christmas Decor'], ['wildlife', 'Wildlife Decor'], ['masculine', 'Masculine Decor'],
        ['transitional', 'Transitional Decor'], ['eclectic', 'Eclectic Decor'], ['french country', 'French Country Decor'],
        ['cottage', 'Country Cottage Decor'], ['pet', 'Pet Decor'], ['outdoor', 'Outdoor Decor'], ['fireplace', 'Fireplace Decor'],
        ['home bar', 'Home Bar Decor'], ['games room', 'Games Room Decor'], ['laundry', 'Laundry Room Decor'],
        ['dressing room', 'Dressing Room Decor'], ['coffee', 'Coffee House Design'], ['breakfast nook', 'Breakfast Nook Decor'],
        ['contemporary', 'Contemporary Decor']
      ];
      function fbBoardFor(t) { t = (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '); for (var bi = 0; bi < FB_BOARD_MAP.length; bi++) { if (t.indexOf(FB_BOARD_MAP[bi][0]) >= 0) return FB_BOARD_MAP[bi][1]; } return ''; }
      function fbArtText(a) { return ((a.title || '') + ' ' + (a.handle || '') + ' ' + (Array.isArray(a.tags) ? a.tags.join(' ') : (a.tags || ''))).toLowerCase(); }
      function fbTrimTo(text, limit) { text = String(text == null ? '' : text); if (text.length <= limit) return text; var cut = text.slice(0, limit); var sp = cut.lastIndexOf(' '); if (sp > limit * 0.6) cut = cut.slice(0, sp); return cut.replace(/\s+$/, ''); }
      function fbTrimLink(caption, suffix, limit) { caption = String(caption == null ? '' : caption); suffix = String(suffix == null ? '' : suffix); var room = limit - suffix.length; if (room < 0) room = 0; return fbTrimTo(caption, room) + suffix; }
      async function fbCallAI(prompt, maxTok) {
        var r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('AI ' + r.status);
        var d = await r.json();
        var t = (d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
        var m = t.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : t);
      }
      var FB_SOCIAL_DRIVE = process.env.EDU_DRIVE_URL;
      var FB_IMG_FOLDER = '1TVn11XySWBWd941f-Ip_nTkIrQnwFWMQ';
      async function fbCopyImg(imgUrl, name) {
        if (!imgUrl || !FB_SOCIAL_DRIVE) return '';
        try {
          var jurl = imgUrl + (imgUrl.indexOf('?') >= 0 ? '&' : '?') + 'format=jpg';
          var ir = await fetch(jurl);
          if (!ir.ok) return '';
          var b64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
          var up = await fetch(FB_SOCIAL_DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', folderId: FB_IMG_FOLDER, name: ((name || 'blog').replace(/[^a-z0-9\-]/gi, '-').slice(0, 80)) + '.jpg', mime: 'image/jpeg', dataBase64: b64 }) });
          if (!up.ok) return '';
          var ud = await up.json();
          return (ud && ud.ok && ud.id) ? ('https://drive.google.com/uc?export=download&id=' + ud.id) : '';
        } catch (e) { return ''; }
      }

      async function fbBuildBlogRows(blog, date) {
        var rows = [];
        var binstr = 'You write organic social copy for a home-decor BLOG article in the About Wall Art voice: warm, friendly UK-English advisor, NOT salesy, never words like elevate delve showcase dive beacon. Blog title: "' + (blog.title || '') + '". Write copy that makes people want to read it.\n' +
          'Return ONLY strict JSON, no markdown, with these keys:\n' +
          '- linkedin: professional but warm, 3 to 6 short paragraphs (up to ~2000 chars), a home-styling / workspace angle. NO link, NO hashtags.\n' +
          '- facebook: 2 to 3 warm sentences about the blog. NO link, NO hashtags.\n' +
          '- threads: one or two short lines, then 5 lowercase hashtags. NO link.\n' +
          '- instagram: warm 3 to 4 sentences, then "Tap Our Content Hub in my bio for the full guide.", then a blank line, then about 25 to 30 lowercase hashtags. NO link.\n' +
          '- gmb: a full, informative Google Business description of about 900 to 1200 characters pulling real value from the blog. NO link, NO hashtags.\n' +
          '- pinterestA: keyword-rich descriptive Pinterest description a decorator would search, about 500 to 700 characters. NO link.\n' +
          '- pinterestB: a DIFFERENT keyword-rich Pinterest description, about 500 to 700 characters. NO link.\n' +
          '- pinterestTitle: max 90 characters.\n' +
          '- alt: one short line describing a styled interior for this blog.\n' +
          'Return ONLY: {"linkedin":"","facebook":"","threads":"","instagram":"","gmb":"","pinterestA":"","pinterestB":"","pinterestTitle":"","alt":""}';
        var bc = await fbCallAI(binstr, 3000).catch(function () { return null; });
        if (!bc) return rows;
        var bh = blog.handle;
        var bTitle = blog.title || '';
        var bImg = (blog.image && blog.image.url) || '';
        if (bImg.indexOf('data:') === 0) bImg = '';
        var driveImg = bImg ? await fbCopyImg(bImg, bh) : '';
        var gmbImg;
        if (driveImg) { bImg = driveImg; gmbImg = driveImg; }
        else { gmbImg = bImg ? (bImg + (bImg.indexOf('?') >= 0 ? '&' : '?') + 'format=jpg') : ''; }
        var bUrl = FB_BLOG_BASE + bh;
        var blink = function (src) { return bUrl + '?utm_source=' + src + '&utm_medium=blog&utm_campaign=' + bh; };
        var topicBoard = fbBoardFor(fbArtText(blog));
        var balt = bc.alt || bTitle;
        var gmbText = (bc.gmb || bTitle).slice(0, 1400).replace(/\s+$/, '') + '\n\nRead more → ' + blink('gmb');
        if (gmbText.length > 1500) gmbText = gmbText.slice(0, 1500);
        var mkb = function (net, img) { var o = { Date: date, Draft: false, Shortener: true, 'Picture Url 1': img || bImg, 'Alt text picture 1': balt }; o[net] = true; return o; };
        var bFb = mkb('Facebook'); bFb.Time = '12:00:00'; bFb['Facebook Post Type'] = 'POST'; bFb.Text = fbTrimLink(bc.facebook || bTitle, '\n\nRead more → ' + blink('facebook'), 2000); rows.push(fbRow(bFb));
        var bIg = mkb('Instagram'); bIg.Time = '13:00:00'; bIg['Instagram Post Type'] = 'POST'; bIg.Text = fbTrimTo(bc.instagram || bTitle, 2200); rows.push(fbRow(bIg));
        var bTh = mkb('Threads'); bTh.Time = '13:00:00'; bTh['Threads Reply Control'] = 'EVERYONE'; bTh['Threads Post Type'] = 'POST'; bTh.Text = fbTrimLink(bc.threads || bTitle, '\n\nRead more → ' + blink('threads'), 500); rows.push(fbRow(bTh));
        var pboard1 = topicBoard || FB_EDU_BOARD;
        var bP1 = mkb('Pinterest'); bP1.Time = '13:00:00'; bP1['Pinterest Board'] = pboard1; bP1['Pinterest Pin Title'] = bc.pinterestTitle || bTitle; bP1['Pinterest Pin Link'] = blink('pinterest'); bP1.Text = fbTrimTo(bc.pinterestA || bTitle, 500); rows.push(fbRow(bP1));
        if (pboard1 !== FB_EDU_BOARD) { var bP2 = mkb('Pinterest'); bP2.Time = '13:05:00'; bP2['Pinterest Board'] = FB_EDU_BOARD; bP2['Pinterest Pin Title'] = bc.pinterestTitle || bTitle; bP2['Pinterest Pin Link'] = blink('pinterest'); bP2.Text = fbTrimTo(bc.pinterestB || bc.pinterestA || bTitle, 500); rows.push(fbRow(bP2)); }
        var bLi = mkb('LinkedIn'); bLi.Time = '17:00:00'; bLi['LinkedIn Type'] = 'POST'; bLi.Text = fbTrimLink(bc.linkedin || bTitle, '\n\nRead more → ' + blink('linkedin'), 3000); rows.push(fbRow(bLi));
        var bGb = mkb('GBP', gmbImg); bGb.Time = '17:00:00'; bGb['GBP Post Type'] = 'publication'; bGb.Text = gmbText; rows.push(fbRow(bGb));
        return rows;
      }

      // build broken blogs in parallel (max 4 at once), order preserved
      async function fbMapLimit(arr, limit, fn) {
        var resArr = new Array(arr.length); var idx = 0;
        async function worker() { while (idx < arr.length) { var i = idx++; resArr[i] = await fn(arr[i]); } }
        var ws = []; var n = Math.min(limit, arr.length); for (var w = 0; w < n; w++) ws.push(worker());
        await Promise.all(ws); return resArr;
      }

      var fbBuilt;
      try { fbBuilt = await fbMapLimit(brokenList, 4, function (b) { return fbBuildBlogRows(b.node, b.date); }); }
      catch (e) { return res.status(200).json({ ok: false, error: 'Caption builder error — ' + (e && e.message ? e.message : 'try again') }); }

      var fbOut = [FBH.join(',')];
      var fixed = [];
      for (var bi2 = 0; bi2 < brokenList.length; bi2++) {
        var rws = fbBuilt[bi2] || [];
        if (rws.length) { rws.forEach(function (r) { fbOut.push(r); }); fixed.push({ handle: brokenList[bi2].handle, title: brokenList[bi2].title, date: brokenList[bi2].date }); }
      }
      if (!fixed.length) return res.status(200).json({ ok: false, error: 'Found broken images but the caption builder failed — try again.' });
      var fbCsv = '﻿' + fbOut.join('\r\n') + '\r\n';
      return res.status(200).json({ ok: true, count: fixed.length, fixed: fixed, csv: fbCsv });
    }

    if (action === 'reel-links') {
      // Fetches the SKU -> Google Drive video-link map from the Apps Script web app
      // (runs as mae@aboutwallart.com, read-only on the REELS folder). Node's fetch
      // follows the 302 redirect to googleusercontent.com automatically.
      var REELS_URL = 'https://script.google.com/macros/s/AKfycbxPm9nrwHLCFFmGBieplcyMm6vysgWTNRBiBGEwHvvk3UA3YVnyfCTE4BjtTfCAAuhZeQ/exec';
      var REELS_KEY = 'awa-reels-2026';
      try {
        var rl = await fetch(REELS_URL + '?key=' + REELS_KEY);
        if (!rl.ok) return res.status(200).json({ ok: false, error: 'Drive link fetch failed: ' + rl.status, links: {} });
        var rld = await rl.json();
        return res.status(200).json({ ok: true, links: (rld && rld.links) ? rld.links : {} });
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message, links: {} });
      }
    }

    if (action === 'add-to-schedule') {
      // Adds the chosen videos to the Schedule tab's list (social-schedule.json videos[]) so TikTok cards appear.
      // Fast, no AI. Deduped by SKU. Captions are still written per-card in the Schedule tab.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var sposts = Array.isArray(body.posts) ? body.posts : [];
      if (!sposts.length) return res.status(400).json({ ok: false, error: 'No posts selected' });
      function fmtSchedDate(iso) {
        var dd = new Date((iso || '') + 'T00:00:00');
        if (isNaN(dd.getTime())) return (iso || '');
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return days[dd.getDay()] + ' ' + dd.getDate() + ' ' + mons[dd.getMonth()];
      }
      var added = 0;
      await ghSave(SCHEDULE_FILE, function (content) {
        added = 0;
        var sched = { videos: [], state: {}, savedCaptions: {} };
        if (content) { try { var pp = JSON.parse(content); sched.videos = pp.videos || []; sched.state = pp.state || {}; sched.savedCaptions = pp.savedCaptions || {}; } catch (e) { sched = { videos: [], state: {}, savedCaptions: {} }; } }
        sposts.forEach(function (po) {
          var s = (po.sku || '').toString();
          if (!s) return;
          if (sched.videos.some(function (v) { return (v.sku || '').toUpperCase() === s.toUpperCase(); })) return;
          sched.videos.push({
            id: 'vid-' + s.toLowerCase(), sku: s, date: fmtSchedDate(po.date), room: (po.room || ''),
            name: (po.title || ''), title: (po.title || ''), handle: (po.handle || ''),
            url: (po.url || ('https://aboutwallart.com/products/' + (po.handle || ''))),
            image: (po.image || ''), campaign: 'vid-' + s.toLowerCase(), captions: {}
          });
          added++;
        });
        return JSON.stringify(sched, null, 2);
      }, 'Add videos to schedule (TikTok cards)');
      return res.status(200).json({ ok: true, added: added });
    }

    if (action === 'refresh-titles') {
      // Returns { handle: currentTitle } from the live store so the Schedule tab shows titles that match Shopify.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var handles = Array.isArray(body.handles) ? body.handles.filter(Boolean) : [];
      if (!handles.length) return res.status(200).json({ ok: true, titles: {} });
      var domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) return res.status(200).json({ ok: false, titles: {} });
      var uniq = Array.from(new Set(handles));
      var titles = {};
      for (var i = 0; i < uniq.length; i += 30) {
        var chunk = uniq.slice(i, i + 30);
        var q = chunk.map(function (h) { return 'handle:' + h; }).join(' OR ');
        var gq = 'query($q:String!){ products(first:250, query:$q){ edges{ node{ handle title } } } }';
        try {
          var r = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq, variables: { q: q } }) });
          if (!r.ok) continue;
          var d = await r.json();
          ((d && d.data && d.data.products && d.data.products.edges) || []).forEach(function (e) { if (e.node && e.node.handle) titles[e.node.handle] = e.node.title; });
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, titles: titles });
    }

    // ================= EDUCATIONAL VIDEO TAB — Part 1 (source + product pickers) =================
    const USEDVIDBLOG_FILE = 'data/used-video-blogs.json';
    const EDU_HUB_HANDLE = 'free-interior-design-education';
    const EDU_BLOG_BASE = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/';
    const PRODUCT_FIELDS = 'title handle vendor onlineStoreUrl featuredImage{url} room:metafield(namespace:"custom",key:"room_type"){value} skumf:metafield(namespace:"custom",key:"sku_for_print_files"){value}';

    async function shopGql(query, variables) {
      const domain = process.env.SHOPIFY_STORE_DOMAIN, stoken = process.env.SHOPIFY_ACCESS_TOKEN;
      if (!domain || !stoken) throw new Error('Shopify not configured');
      const r = await fetch('https://' + domain + '/admin/api/2025-01/graphql.json', {
        method: 'POST', headers: { 'X-Shopify-Access-Token': stoken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, variables: variables || {} })
      });
      if (!r.ok) throw new Error('Shopify error ' + r.status);
      return r.json();
    }
    async function usedVideoBlogSet() {
      const gh = await ghGet(USEDVIDBLOG_FILE);
      var set = {};
      if (gh.content) { try { (JSON.parse(gh.content).used || []).forEach(function (x) { var h = ((x && x.handle) || x || '').toString().toLowerCase(); if (h) set[h] = 1; }); } catch (e) {} }
      return set;
    }
    const EDU_INDEX_FILE = 'data/edu-video-index.json';
    function decodeEnt(s) { return String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&#x26;/gi, '&'); }
    // index of saved educational videos: { videos: { handle: {done, videoTitle, savedAt} } }
    async function eduIndex() {
      const gh = await ghGet(EDU_INDEX_FILE);
      var vids = {};
      if (gh.content) { try { vids = (JSON.parse(gh.content).videos) || {}; } catch (e) {} }
      return vids;
    }
    // also list saved edu-video-*.json files directly, so videos saved before the index existed still show as done
    async function eduSavedFiles() {
      var set = {};
      try {
        var r = await fetch('https://api.github.com/repos/' + REPO + '/contents/data', { headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' } });
        if (r.ok) { var arr = await r.json(); if (Array.isArray(arr)) arr.forEach(function (f) { var m = /^edu-video-(.+)\.json$/.exec((f && f.name) || ''); if (m && m[1] !== 'index') set[m[1].toLowerCase()] = 1; }); }
      } catch (e) {}
      return set;
    }
    function currentSeason() {
      var m = new Date().getMonth() + 1;
      if (m >= 3 && m <= 5) return 'spring';
      if (m >= 6 && m <= 8) return 'summer';
      if (m >= 9 && m <= 11) return 'autumn';
      return 'winter';
    }
    var SEASON_WORDS = {
      spring: ['spring', 'fresh', 'pastel', 'floral', 'botanical', 'bright', 'airy', 'renewal', 'garden', 'green', 'blossom'],
      summer: ['summer', 'coastal', 'tropical', 'beach', 'boho', 'botanical', 'bright', 'airy', 'mediterranean', 'nautical', 'garden', 'greenery', 'palm', 'sea'],
      autumn: ['autumn', 'fall', 'cosy', 'cozy', 'warm', 'amber', 'layered', 'rustic', 'earthy', 'harvest', 'moody'],
      winter: ['winter', 'cosy', 'cozy', 'fireplace', 'festive', 'christmas', 'hygge', 'warm', 'snug', 'candle']
    };
    function seasonMatch(text, season) {
      text = (text || '').toLowerCase();
      var ws = SEASON_WORDS[season] || [];
      for (var i = 0; i < ws.length; i++) { if (text.indexOf(ws[i]) >= 0) return true; }
      return false;
    }
    function looksEducational(text) {
      return /how to|how-to|\bideas\b|\bguide\b|\btips\b|ways to|styling|decorat|choosing|choose|arrange|arrang|hang|layout|inspiration|trend/i.test(text || '');
    }
    function themeWord(text) {
      var stop = { the: 1, and: 1, for: 1, with: 1, your: 1, home: 1, wall: 1, art: 1, arts: 1, print: 1, prints: 1, decor: 1, room: 1, ideas: 1, guide: 1, tips: 1, how: 1, into: 1, that: 1, from: 1, ways: 1, style: 1, styling: 1 };
      var ws = (text || '').toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3 && !stop[w]; });
      return ws[0] || '';
    }

    if (action === 'get-used-video-blogs') {
      const gh = await ghGet(USEDVIDBLOG_FILE);
      var usedv = [];
      if (gh.content) { try { usedv = (JSON.parse(gh.content).used) || []; } catch (e) {} }
      return res.status(200).json({ ok: true, used: usedv });
    }

    if (action === 'edu-sources') {
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify not configured' });
      const usedB = await usedVideoBlogSet();
      const season = currentSeason();
      const savedIdx = await eduIndex(); // { handle: {done, videoTitle, savedAt} }
      const savedFiles = await eduSavedFiles(); // handles that have an edu-video-<handle>.json
      function markSaved(o) {
        var h = (o.handle || '').toLowerCase();
        var sv = savedIdx[h];
        var hasFile = !!savedFiles[h];
        o.saved = !!sv || hasFile;
        o.done = sv ? !!sv.done : hasFile; // index wins (respects Undo); otherwise a bare saved file = done
        o.videoTitle = (sv && sv.videoTitle) || ''; // shown on the card + searchable
        return o;
      }

      // ---- marketing-calendar-driven seasonality (data/marketing-occasions.json) ----
      var occAll = [];
      try { var go = await ghGet(OCC_FILE); if (go.content) { occAll = (JSON.parse(go.content).occasions) || []; } } catch (e) { occAll = []; }
      var today = new Date();
      function mmddDate(mmdd, y) { var p = (mmdd || '').split('-'); if (p.length < 2) return null; return new Date(y, parseInt(p[0], 10) - 1, parseInt(p[1], 10)); }
      function occActive(o, leadDays) {
        var w = o.window || {}; var s = w.start || o.date2026 || ''; var e = w.end || o.date2026 || '';
        if (!s || !e) return false;
        var horizon = new Date(today.getTime() + leadDays * 86400000);
        for (var y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
          var sd = mmddDate(s, y), ed = mmddDate(e, y);
          if (!sd || !ed) continue;
          if (ed < sd) ed = mmddDate(e, y + 1);
          if (sd <= horizon && ed >= today) return true;
        }
        return false;
      }
      // synonyms triggered by words in the occasion name/relevance (matched against BLOG titles/tags)
      var OCC_SYN = [
        [/islam|eid|ramadan/i, ['islam', 'islamic', 'muslim', 'arabic', 'calligraphy', 'ramadan', 'eid', 'moroccan', 'mosque']],
        [/lunar|chinese new year/i, ['chinese', 'japanese', 'asian', 'chinoiserie', 'oriental', 'zen', 'cherry blossom', 'crane']],
        [/christmas|advent|nativity/i, ['christmas', 'festive', 'nordic', 'scandi', 'winter', 'xmas', 'noel']],
        [/easter|spring/i, ['spring', 'floral', 'pastel', 'blossom', 'botanical', 'fresh']],
        [/valentine/i, ['romantic', 'love', 'pink', 'heart', 'couple']],
        [/halloween|october/i, ['dark', 'moody', 'gothic', 'autumn', 'spooky', 'black']],
        [/summer|coastal|beach/i, ['coastal', 'tropical', 'beach', 'summer', 'nautical', 'sea', 'boho', 'palm']],
        [/autumn|fall|harvest/i, ['autumn', 'warm', 'amber', 'earthy', 'rustic', 'cosy', 'layered']],
        [/winter|hygge|cosy/i, ['winter', 'cosy', 'hygge', 'fireplace', 'warm', 'candle', 'snug']],
        [/wildlife|animal|safari/i, ['wildlife', 'animal', 'safari', 'jungle', 'botanical']],
        [/mother|father|family/i, ['family', 'gift']],
        [/wellness|yoga|meditation|mindful/i, ['calm', 'zen', 'wellness', 'minimal', 'serene']]
      ];
      function stopword(w) { return { the: 1, and: 1, for: 1, with: 1, your: 1, home: 1, art: 1, into: 1, that: 1, from: 1, this: 1, have: 1, has: 1, are: 1, you: 1, our: 1, day: 1, week: 1, new: 1, get: 1, all: 1, more: 1, people: 1, room: 1, rooms: 1, decor: 1 }[w]; }
      function occKeywords(o) {
        var set = {};
        var base = ((o.name || '') + ' ' + (o.relevance || '')).toLowerCase();
        base.split(/[^a-z]+/).forEach(function (w) { if (w.length > 3 && !stopword(w)) set[w] = 1; });
        OCC_SYN.forEach(function (pair) { if (pair[0].test((o.name || '') + ' ' + (o.relevance || ''))) pair[1].forEach(function (k) { set[k] = 1; }); });
        return Object.keys(set);
      }
      var activeOcc = occAll.filter(function (o) { return occActive(o, 45); }).map(function (o) { return { name: o.name || '', keys: occKeywords(o) }; });
      function matchOccasion(text) {
        text = (text || '').toLowerCase();
        for (var i = 0; i < activeOcc.length; i++) {
          var ks = activeOcc[i].keys;
          for (var j = 0; j < ks.length; j++) { if (ks[j].length > 2 && text.indexOf(ks[j]) >= 0) return activeOcc[i].name; }
        }
        return '';
      }
      function firstImg(html) { var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || ''); return m ? m[1] : ''; }

      // 1) unused educational blog articles (LIVE)
      var blogs = [];
      try {
        var ad = await shopGql('query($q:String!,$n:Int!){ articles(first:$n, query:$q, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ title handle publishedAt isPublished image{url} tags } } } }', { q: 'blog_id:93572858142', n: 120 });
        var now = Date.now();
        var aedges = (ad && ad.data && ad.data.articles && ad.data.articles.edges) || [];
        blogs = aedges.map(function (e) { return e.node; }).filter(function (a) {
          if (!a.handle || !a.isPublished || !a.publishedAt) return false;
          if (new Date(a.publishedAt).getTime() > now) return false;
          if (usedB[a.handle.toLowerCase()]) return false;
          return looksEducational((a.title || '') + ' ' + (Array.isArray(a.tags) ? a.tags.join(' ') : ''));
        }).map(function (a) {
          var txt = (a.title || '') + ' ' + (a.handle || '') + ' ' + (Array.isArray(a.tags) ? a.tags.join(' ') : '');
          var occ = matchOccasion(txt);
          return markSaved({ type: 'blog', handle: a.handle, title: a.title || a.handle, url: EDU_BLOG_BASE + a.handle, image: (a.image && a.image.url) || '', publishedAt: a.publishedAt, occasion: occ, seasonMatch: !!occ });
        });
      } catch (e) { blogs = []; }

      // 2) education hub PAGES — ONLY the "Comprehensive Design Guides" section (the resource cards),
      //    NOT the interactive tools / calculators / quizzes below it. Uses each card's curated image.
      var pages = [];
      try {
        var pr = await fetch('https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/api/2025-01/pages.json?limit=250&fields=id,title,handle,body_html', { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } });
        if (pr.ok) {
          var pjson = await pr.json();
          var hub = (pjson.pages || []).filter(function (p) { return (p.handle || '').toLowerCase() === EDU_HUB_HANDLE; })[0];
          var hb = (hub && hub.body_html) || '';
          // slice the guides section only: from "Comprehensive Design Guides" heading to the tools section
          var gi = hb.search(/Comprehensive Design Guides/i);
          var ti = hb.search(/class=["']tools-section/i);
          var slice = (gi >= 0) ? hb.slice(gi, ti > gi ? ti : hb.length) : '';
          // each guide = one .resource-card with an <img ... src> and a /pages/<handle> link + <h3> title
          var cards = slice.split(/class=["']resource-card["']/i).slice(1);
          var seenp = {};
          cards.forEach(function (card) {
            var hm = /\/pages\/([a-z0-9\-]+)/i.exec(card); if (!hm) return;
            var h = hm[1].toLowerCase();
            if (h === EDU_HUB_HANDLE || usedB[h] || seenp[h]) return;
            seenp[h] = 1;
            var im = /<img[^>]+src=["']([^"']+)["']/i.exec(card);
            var tm = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(card);
            var title = tm ? decodeEnt(tm[1].replace(/<[^>]+>/g, '').trim()) : h;
            var occ = matchOccasion(title + ' ' + h);
            pages.push(markSaved({ type: 'page', handle: h, title: title, url: 'https://aboutwallart.com/pages/' + h, image: im ? decodeEnt(im[1]) : '', occasion: occ, seasonMatch: !!occ }));
          });
        }
      } catch (e) { pages = []; }

      // sort: not-done first, then seasonal matches first (done items sink to the bottom)
      function srt(a, b) { if (!!a.done !== !!b.done) return a.done ? 1 : -1; return (b.seasonMatch ? 1 : 0) - (a.seasonMatch ? 1 : 0); }
      blogs.sort(srt); pages.sort(srt);
      // ALL saved/made videos for the "Already made" tab (not published) + the "Published / scheduled" tab.
      // published = the video was marked used (manual publish) or built into a Metricool file.
      var made = []; var seenMade = {};
      function isPub(h, sv) { return !!usedB[(h || '').toLowerCase()] || !!(sv && sv.published); }
      Object.keys(savedIdx || {}).forEach(function (h) {
        var sv = savedIdx[h] || {}; var typ = sv.sourceType || 'blog'; seenMade[h] = 1;
        made.push({ type: typ, handle: h, title: sv.videoTitle || h, saved: true, done: !!sv.done, published: isPub(h, sv), videoTitle: sv.videoTitle || '', url: (typ === 'page' ? 'https://aboutwallart.com/pages/' + h : EDU_BLOG_BASE + h), image: '' });
      });
      Object.keys(savedFiles || {}).forEach(function (h) {
        if (seenMade[h]) return;
        made.push({ type: 'blog', handle: h, title: h, saved: true, done: true, published: isPub(h, null), videoTitle: '', url: EDU_BLOG_BASE + h, image: '' });
      });
      made.sort(function (a, b) { return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()); });
      return res.status(200).json({ ok: true, season: season, activeOccasions: activeOcc.map(function (o) { return o.name; }), blogs: blogs, pages: pages, made: made });
    }

    if (action === 'edu-products') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sourceType = (body.sourceType || 'blog').toString();
      const handle = (body.handle || '').toString().trim();
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing source handle' });
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify not configured' });

      var bodyHtml = '', productGids = [], sourceTitle = handle, sourceTags = [], featuredImage = '';
      if (sourceType === 'page') {
        try {
          var pr2 = await fetch('https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/api/2025-01/pages.json?limit=250&fields=id,title,handle,body_html', { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } });
          if (pr2.ok) { var pj2 = await pr2.json(); var pg2 = (pj2.pages || []).filter(function (p) { return (p.handle || '').toLowerCase() === handle.toLowerCase(); })[0]; if (pg2) { bodyHtml = pg2.body_html || ''; sourceTitle = pg2.title || handle; } }
        } catch (e) {}
      } else {
        try {
          var ad2 = await shopGql('query($q:String!){ articles(first:5, query:$q){ edges{ node{ handle title tags body image{url} ctl:metafield(namespace:"custom",key:"blog_products_list"){value} } } } }', { q: 'blog_id:93572858142 handle:' + handle });
          var a2 = (ad2 && ad2.data && ad2.data.articles && ad2.data.articles.edges) || [];
          var nodes2 = a2.map(function (e) { return e.node; });
          var art = nodes2.filter(function (n) { return (n.handle || '').toLowerCase() === handle.toLowerCase(); })[0] || nodes2[0];
          if (art) {
            bodyHtml = art.body || '';
            sourceTitle = art.title || handle;
            sourceTags = art.tags || [];
            featuredImage = (art.image && art.image.url) || '';
            try { var pl = JSON.parse((art.ctl && art.ctl.value) || '[]'); if (Array.isArray(pl)) productGids = pl; } catch (e) {}
          }
        } catch (e) {}
      }

      var products = [], seen = {};
      function pushNode(n, fallbackSku) {
        if (!n || !isAWA(n.vendor)) return;
        var c = nodeToCard(n, fallbackSku);
        if (!c.handle || seen[c.handle.toLowerCase()]) return;
        seen[c.handle.toLowerCase()] = 1;
        delete c.tags;
        products.push(c);
      }

      // product handles found in the source body
      var hset = {}, m3, re3 = /\/products\/([a-z0-9\-]+)/gi;
      while ((m3 = re3.exec(bodyHtml))) { hset[m3[1].toLowerCase()] = 1; }
      var bodyHandles = Object.keys(hset);
      try {
        for (var i3 = 0; i3 < bodyHandles.length; i3 += 30) {
          var chunk3 = bodyHandles.slice(i3, i3 + 30);
          var q3 = chunk3.map(function (h) { return 'handle:' + h; }).join(' OR ');
          var pd3 = await shopGql('query($q:String!){ products(first:100, query:$q){ nodes{ ' + PRODUCT_FIELDS + ' } } }', { q: q3 });
          ((pd3 && pd3.data && pd3.data.products && pd3.data.products.nodes) || []).forEach(function (n) { pushNode(n); });
        }
      } catch (e) {}

      // Complete-the-Look products (by GID)
      if (productGids.length) {
        try {
          var nd3 = await shopGql('query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { ' + PRODUCT_FIELDS + ' } } }', { ids: productGids.slice(0, 30) });
          ((nd3 && nd3.data && nd3.data.nodes) || []).forEach(function (n) { pushNode(n); });
        } catch (e) {}
      }

      // top up to at least 5 with theme-matched products — PAGES ONLY.
      // Blogs must use ONLY the products inserted in the blog (body links + Complete-the-Look),
      // plus any she adds herself — never auto-proposed ones.
      if (sourceType === 'page' && products.length < 5) {
        var word = themeWord((sourceTitle || '') + ' ' + (Array.isArray(sourceTags) ? sourceTags.join(' ') : ''));
        if (word) {
          try {
            var td3 = await shopGql('query($q:String!){ products(first:40, query:$q){ nodes{ ' + PRODUCT_FIELDS + ' } } }', { q: 'title:*' + word + '*' });
            ((td3 && td3.data && td3.data.products && td3.data.products.nodes) || []).forEach(function (n) { if (products.length < 10) pushNode(n); });
          } catch (e) {}
        }
      }

      // --- REUSABLE BODY IMAGES: each body <img> + the H2/H3 it sits under + its TRUE shape ---
      function _imgSize(buf) {
        if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
        if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
        if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
          var fmt = buf.toString('ascii', 12, 16);
          if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
          if (fmt === 'VP8L') { var b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]; return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }; }
          if (fmt === 'VP8X') return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
        }
        if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
          var o = 2;
          while (o < buf.length - 8) {
            if (buf[o] !== 0xFF) { o++; continue; }
            var mk = buf[o + 1];
            if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
            o += 2 + buf.readUInt16BE(o + 2);
          }
        }
        return null;
      }
      function _ratioBucket(w, h) { var r = w / h; if (r >= 0.9 && r <= 1.1) return 'square'; if (r >= 1.45 && r <= 1.55) return '3:2'; if (r >= 1.7 && r <= 1.85) return '16:9'; return 'other'; }
      // which body images are LINKED to a product? (image wrapped in <a href=".../products/HANDLE">)
      // That image IS that product → tag it with the product's SKU (so it maps to that product's scene).
      var _prodByHandle = {}; products.forEach(function (p) { if (p && p.handle) _prodByHandle[p.handle.toLowerCase()] = p; });
      var _imgToProd = {}, _linkedHandles = {};
      try {
        var _aRe = /<a\s+[^>]*?href="[^"]*?\/products\/([a-z0-9\-]+)[^"]*?"[^>]*>([\s\S]*?)<\/a>/gi, _ma;
        while ((_ma = _aRe.exec(bodyHtml))) {
          var _hh2 = (_ma[1] || '').toLowerCase(), _inner = _ma[2] || '';
          var _mi2, _iRe2 = /<img[^>]+src=["']([^"']+)["']/gi;
          while ((_mi2 = _iRe2.exec(_inner))) { var _pp2 = _prodByHandle[_hh2]; if (_pp2) { _imgToProd[_mi2[1]] = _pp2; _linkedHandles[_hh2] = 1; } }
        }
      } catch (e) {}
      var bodyImages = [];
      try {
        var _heads = [], _mH, _headRe = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
        while ((_mH = _headRe.exec(bodyHtml))) { _heads.push({ pos: _mH.index, text: _mH[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim() }); }
        function _headingFor(pos) { var h = ''; for (var i = 0; i < _heads.length; i++) { if (_heads[i].pos < pos) h = _heads[i].text; else break; } return h; }
        var _srcs = [], _mI, _imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi, _seenImg = {};
        while ((_mI = _imgRe.exec(bodyHtml))) { var _u = _mI[1]; if (_u && !_seenImg[_u]) { _seenImg[_u] = 1; _srcs.push({ url: _u, heading: _headingFor(_mI.index) }); } }
        _srcs = _srcs.slice(0, 20);
        bodyImages = await Promise.all(_srcs.map(async function (it) {
          var ratio = 'other', wh = null;
          try { var ir = await fetch(it.url); var ib = Buffer.from(await ir.arrayBuffer()); wh = _imgSize(ib); if (wh) ratio = _ratioBucket(wh.w, wh.h); } catch (e) {}
          var _lp = _imgToProd[it.url] || null; // this body image is linked to a product
          return { url: it.url, heading: it.heading, ratio: ratio, reuse: (ratio === '3:2' || ratio === '16:9'), width: wh ? wh.w : 0, height: wh ? wh.h : 0, isProduct: !!_lp, sku: _lp ? (_lp.sku || '') : '' };
        }));
      } catch (e) {}

      // Add a product card ONLY for products NOT already shown as a linked image in the body
      // (a product linked-as-image in the body is already represented — don't repeat it).
      // NOT pre-ticked (she picks per video length).
      try {
        var _prodImgs = products.filter(function (p) { return p && p.image && !_linkedHandles[(p.handle || '').toLowerCase()]; }).map(function (p) { return { url: p.image, heading: p.title || '(product)', sku: p.sku || '' }; });
        var _pdone = await Promise.all(_prodImgs.map(async function (it) {
          var ratio = 'square', wh = null;
          try { var ir = await fetch(it.url); var ib = Buffer.from(await ir.arrayBuffer()); wh = _imgSize(ib); if (wh) ratio = _ratioBucket(wh.w, wh.h); } catch (e) {}
          return { url: it.url, heading: it.heading, ratio: ratio, reuse: (ratio === '3:2' || ratio === '16:9'), width: wh ? wh.w : 0, height: wh ? wh.h : 0, isProduct: true, sku: it.sku };
        }));
        bodyImages = bodyImages.concat(_pdone);
      } catch (e) {}

      return res.status(200).json({ ok: true, sourceTitle: sourceTitle, products: products, bodyImages: bodyImages, featuredImage: featuredImage });
    }

    if (action === 'edu-generate') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sourceType = (body.sourceType || 'blog').toString();
      const handle = (body.handle || '').toString().trim();
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing source handle' });
      var seconds = parseInt(body.seconds, 10); if (isNaN(seconds)) seconds = 150;
      seconds = Math.max(60, Math.min(240, seconds));
      var targetScenes = Math.max(10, Math.min(30, Math.round(seconds / 8)));
      var selProducts = Array.isArray(body.products) ? body.products.filter(function (p) { return p && (p.title || p.sku); }).slice(0, 12) : [];

      // fetch the source's real content (never invent)
      var srcTitle = handle, srcBody = '', srcTags = [];
      if (sourceType === 'page') {
        try {
          var pr3 = await fetch('https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/api/2025-01/pages.json?limit=250&fields=id,title,handle,body_html', { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } });
          if (pr3.ok) { var pj3 = await pr3.json(); var pg3 = (pj3.pages || []).filter(function (p) { return (p.handle || '').toLowerCase() === handle.toLowerCase(); })[0]; if (pg3) { srcTitle = pg3.title || handle; srcBody = pg3.body_html || ''; } }
        } catch (e) {}
      } else {
        try {
          var ag = await shopGql('query($q:String!){ articles(first:5, query:$q){ edges{ node{ handle title tags body } } } }', { q: 'blog_id:93572858142 handle:' + handle });
          var an = ((ag && ag.data && ag.data.articles && ag.data.articles.edges) || []).map(function (e) { return e.node; });
          var art3 = an.filter(function (n) { return (n.handle || '').toLowerCase() === handle.toLowerCase(); })[0] || an[0];
          if (art3) { srcTitle = art3.title || handle; srcBody = art3.body || ''; srcTags = art3.tags || []; }
        } catch (e) {}
      }
      var plain = (srcBody || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
      // FULL section outline (every H2/H3 heading, in order) so the script covers the WHOLE blog,
      // not just the first 5,000 letters — keeps it cheap while never missing a section.
      var _oh = [], _moh, _ohre = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
      while ((_moh = _ohre.exec(srcBody || ''))) { var _oht = _moh[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim(); if (_oht) _oh.push(_oht); }
      var outline = _oh.length ? _oh.map(function (h, i) { return (i + 1) + '. ' + h; }).join('\n') : '(no headings found)';
      var topic = ((srcTitle || '') + ' ' + (Array.isArray(srcTags) ? srcTags.join(' ') : '')).toLowerCase();
      var prodList = selProducts.map(function (p, i) { return (i + 1) + '. sku "' + (p.sku || '') + '" — "' + (p.title || '') + '"'; }).join('\n');
      // images she ticked to reuse (from Step 1 preview) + the featured/title image
      var reuseImgs = Array.isArray(body.reuseImages) ? body.reuseImages.filter(function (x) { return x && x.url; }).slice(0, 40) : [];
      var prodReuse = reuseImgs.filter(function (x) { return x.sku; });   // any ticked image carrying a SKU → its product scene (matched by SKU)
      var bodyReuse = reuseImgs.filter(function (x) { return !x.sku; });  // plain blog photos → matched to scenes by heading
      var featured = (body.featured && body.featured.url && body.featured.use) ? body.featured : null;
      var reuseList = bodyReuse.length ? bodyReuse.map(function (im, i) { return (i + 1) + '. [' + (im.reuse ? 'USE AS-IS' : 'REMAKE to 16:9') + '] under heading "' + (im.heading || '(none)') + '" — ' + im.url; }).join('\n') : '(none)';

      var OUTRO = [
        "Did you know styling your home doesn't have to be guesswork?",
        "We've built a free set of Home Decor tools and styling guides…",
        "From colour theory and design principles to gallery wall layouts and art sizing. Download them all from our site!",
        "Find all you need to transform your home into a calming oasis!",
        "Happy Decorating!"
      ];

      var prompt =
        'You are writing a short educational home-decor video for About Wall Art, based on the REAL blog/page content provided. Two deliverables: a SCRIPT and matching IMAGE PROMPTS.\n\n' +
        'SOURCE TITLE: "' + srcTitle + '"\n' +
        'SOURCE CONTENT (use this, never invent facts):\n"""' + plain + '"""\n\n' +
        'FULL SECTION OUTLINE — every heading in the blog/page, in order. The video MUST cover these sections; do NOT skip any and do NOT drift into generic advice about the topic:\n' + outline + '\n\n' +
        'SELECTED PRODUCTS (use ONLY these). Create ONE product scene for EACH selected product — every selected product must appear exactly once as a product scene (kind:"product", its "productSku" set):\n' + (prodList || '(none)') + '\n\n' +
        'REUSED IMAGES (already-made photos from the blog — place each on the ONE scene that matches its heading; never repeat one):\n' + reuseList + '\n\n' +
        'SCRIPT RULES (this voice is everything — follow it exactly):\n' +
        '- Write like a CASUAL, FRIENDLY home-decor advisor chatting to a friend — warm, human, first-person. Short spoken bursts and FRAGMENTS, not tidy polished sentences. Casual openers ("Okay —", "You know that feeling when…", "Here\'s the thing…"), the odd verbal tick ("you know?", "right?"), and REAL personal asides ("honestly, one of my favourites", "a little tip I love:", "trust me —"). Use "…" for a natural trailing pause. Calm and friendly, NEVER salesy or poetic-brochure.\n' +
        '- ★ EMOTIONS: add an ElevenLabs voice tag in [square brackets] to guide how a line is spoken, using ONLY these seven: [warmly] [gently] [softly] [curious] [excited] [laughs] [sighs]. Put the tag at the very START of the line (or right before the phrase it colours). Use them SPARINGLY — roughly one every few scenes, only where the feeling is genuine; NOT on every line. Keep the mood calm and friendly. NEVER use any other tag (no [shouts], [gunshot], etc.).\n' +
        '- Emphasis: occasionally put the ONE key word of a line in CAPITALS (e.g. "start with just ONE wall"). Never shout a whole line.\n' +
        '- UK spelling. NEVER use: elevate, delve, showcase, dive, beacon, embrace, unleash, "in conclusion", "look no further".\n' +
        '- ONE line per scene — a single short spoken burst, no line breaks inside a scene. About ' + targetScenes + ' content scenes.\n' +
        '- Scene text must come from the source content and COVER THE WHOLE OUTLINE above, in order. Set videoTitle to the blog\'s REAL title (it carries the SEO keyword) — do NOT invent a keyword-less hook, and do NOT put any [tag] on the videoTitle.\n' +
        '- Do NOT write the closing/outro — it is appended automatically.\n\n' +
        'IMAGE RULES — for EACH scene set "use", "kind", "reuseUrl", "productSku", "image":\n' +
        '- "use": "reuse" if a REUSED IMAGE marked USE AS-IS matches this scene\'s heading (put its url in "reuseUrl", leave "image" empty — no prompt needed). "remake" if a REUSED IMAGE marked REMAKE matches (put its url in "reuseUrl" and write "image" as instructions to extend that same photo to 16:9). Otherwise "generate" (write a fresh "image" prompt). Attach each reused image to ONE best-matching scene only.\n' +
        '- EVERY scene must end up with an image (reused or generated) so the WHOLE script is covered — like before.\n' +
        '- ★ The image must show EXACTLY what THIS scene\'s line says — the specific room, object, action, colour, number or step named in the text. NEVER a generic decor shot.\n' +
        '- ★ FULL BLEED, ALWAYS: every image must FILL THE ENTIRE 16:9 FRAME, edge to edge. NEVER add black, white or BLURRED bars, blocks or bands on the top, bottom or sides; no letterboxing or pillarboxing. The scene fills the whole frame.\n' +
        '- ★ EDITORIAL LOOK — EVERY image (hero, photo AND product): make it look like a high-end interior-design MAGAZINE (Architectural Digest / Kinfolk / Elle Decoration) — art-directed, beautifully styled, cohesive and ASPIRATIONAL, a room someone would want to buy into. Natural directional daylight, soft shadows, premium finish; layered and considered. The framed wall art is the FOCAL POINT and its colours MUST echo the room\'s palette (matching, never clashing). NEVER a bland empty room with one sofa and a random mismatched print; NO generic stock-photo look, no clutter, no dated or corporate furniture. Keep the whole palette CALM and MUTED — soft, tonal, low-saturation art and decor; the wall art is NEVER loud or overly colourful, unless a scene must specifically prove a colour point.\n' +
        '- ★ STYLE: default to SCANDI-MINIMAL / JAPANDI, UNLESS this scene\'s topic is clearly about a different interior style — then style the room authentically in THAT style at the same editorial quality (don\'t force Scandi onto a scene about another look). SCANDI-MINIMAL — palette: warm white, soft grey, pale oak, muted beige, black accents, hints of sage or dusty blue; materials: light oak/ash wood, linen, wool, ceramic, matte-black metal, jute; objects: low linen sofa, wool or sheepskin throw, woven baskets, ceramic vases with dried pampas/grasses, stacked books, a simple lamp, an olive or rubber plant. JAPANDI — palette: warm taupe, clay, muted terracotta, charcoal, deep brown, off-white, black; materials: light-and-dark wood contrast, rattan or bamboo, stoneware, linen, paper, matte black; objects: low wooden furniture, floor cushions, wabi-sabi handmade pottery, a single-stem or ikebana arrangement, textured throws, a bonsai.\n' +
        '- "kind": "infographic" ONLY when the scene is a genuinely VISUAL idea — a COMPARISON, before/after, proportion, measurement, or steps. For plain tips/lists use "kind":"photo" instead (a normal scene + the caption), NEVER a text-list "infographic". When it IS an infographic, the "image" prompt MUST be this shape: "A clean minimal educational infographic on a plain WHITE background, photoreal, all text solid BLACK. Leave a LARGE empty white margin across the whole TOP (about the top fifth) — the title must NEVER touch the top edge; put a short centred title just below that top margin. Below it a VISUAL comparison — e.g. two real photos side by side with only TWO short labels (no paragraphs, minimal words). Leave the entire BOTTOM QUARTER completely blank white (a subtitle is placed there). Keep ALL text and content inside the central area with generous air top and bottom, nothing near any edge. High resolution, no watermarks." "kind":"product" for wall-art / finishing-touch scenes (set "productSku" from the list). The product "image" prompt MUST say: USE THE EXACT product photo provided (it is pasted into the AI chat) and extend its sides NATURALLY to fill 16:9 (never stretch or distort), keep the real framed art the clear focus, FULL BLEED, and ADD a user — or several users — naturally in the room enjoying the space (varied, realistic people; never covering the framed art). Do not distort or replace the existing photo — only widen it and add the people. "kind":"photo" for everything else.\n' +
        '- PHOTO scenes: photoreal, high-resolution EDITORIAL interior photography exactly as described above (styled, aspirational, cohesive palette, wall art matching the room), NO text/logos/watermarks. A person present by default; a COUPLE (a man and a woman) for bedroom/romantic, a CHILD or BABY with a parent for nursery/kids, FRIENDS for entertaining, a FAMILY INCLUDING OLDER RELATIVES for festive. Vary ethnicity genuinely (a real mix, not always white). Do NOT depict gay, lesbian or transgender couples. COLOUR/MATERIAL scenes: the person is actively CHOOSING — holding/comparing swatches or samples.\n' +
        '- Also write a single "hero" paragraph for scene 1: the opening/thumbnail shot inspired by the source (ONE strong scene — it becomes 5 variations, same room/styling/composition, only the person or their position changes).\n\n' +
        'Return ONLY strict JSON, no markdown:\n' +
        '{"videoTitle":"...","hero":"...","scenes":[{"text":"...","use":"generate","kind":"photo","reuseUrl":"","productSku":"","image":"..."}]}';

      var ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] })
      });
      if (!ar.ok) {
        var aerr = await ar.text();
        if (ar.status === 401 || ar.status === 402 || ar.status === 429 || /credit|quota|insufficient|billing|balance/i.test(aerr)) {
          return res.status(200).json({ ok: false, error: '❌ Couldn\'t write the script — your Claude API credits/quota look used up. Top up and try again.' });
        }
        return res.status(ar.status).json({ ok: false, error: 'Claude error: ' + aerr });
      }
      var ad4 = await ar.json();
      var txt = (ad4.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      var jm = txt.match(/\{[\s\S]*\}/); var parsed;
      try { parsed = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not read the AI output — try again.', raw: txt.slice(0, 600) }); }

      var videoTitle = (srcTitle || parsed.videoTitle || '').toString().trim(); // use the blog's REAL title so the video keeps the blog's SEO keyword (she can edit it in the tool)
      var hero = (parsed.hero || '').toString().trim();
      var scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      var skuTitle = {}; selProducts.forEach(function (p) { if (p.sku) skuTitle[p.sku.toUpperCase()] = p.title || ''; });
      // attach each product's REAL photo to its product scene (by SKU) so the generated image matches the
      // actual product — not a generic invented one. Every selected product's own photo is used; a ticked
      // section-3 product photo overrides it.
      var prodBySku = {};
      selProducts.forEach(function (p) { if (p.sku && p.image) prodBySku[p.sku.toUpperCase()] = p.image; });
      prodReuse.forEach(function (im) { if (im.sku && im.url) prodBySku[im.sku.toUpperCase()] = im.url; });
      scenes.forEach(function (s) {
        var sk = (s && s.productSku ? s.productSku : '').toString().toUpperCase();
        if (sk && prodBySku[sk]) { s.use = 'remake'; s.reuseUrl = prodBySku[sk]; s.kind = 'product'; }
      });
      // ★ The TOOL is authoritative on shape, NOT the AI: a reused BLOG image that is square/odd MUST be
      // remade (gets an "extend to 16:9" prompt); one already 16:9/3:2 is used as-is. This fixes the AI
      // mislabelling squares as "use as-is" (which skipped their prompt AND wrongly auto-saved them un-remade).
      var reuseShape = {};
      bodyReuse.forEach(function (im) { if (im && im.url) reuseShape[im.url] = !!im.reuse; }); // true = as-is, false = remake
      scenes.forEach(function (s) {
        if (!s || s.kind === 'product') return;
        var ru = (s.reuseUrl || '').toString();
        if (ru && Object.prototype.hasOwnProperty.call(reuseShape, ru)) { s.use = reuseShape[ru] ? 'reuse' : 'remake'; }
      });

      // SCRIPT text = title + one phrase per scene + the fixed 5 outro lines
      var scriptLines = [videoTitle];
      scenes.forEach(function (s) { var t = (s && s.text ? s.text : '').toString().trim(); if (t) scriptLines.push(t); });
      var scriptText = scriptLines.join('\n\n') + '\n\n' + OUTRO.join('\n\n');

      // IMAGE-PROMPT output = numbered scenes ONLY (the brief lives in her Shopify AI skill).
      // Scene 1 = the hero (5 variations of the SAME shot). Every scene is [16:9] (landscape video);
      // product scenes keep the square art faithful but get EXTENDED to 16:9, and add → product = "…".
      function _pad2(n) { return n < 10 ? '0' + n : '' + n; }
      var heroLine;
      if (featured && featured.url) {
        heroLine = '01. [16:9] TITLE IMAGE — 5 OPTIONS — USE THIS EXACT BLOG FEATURED PHOTO and extend the sides naturally to FILL 16:9 (never stretch or distort), FULL BLEED. Keep the existing scene; if there is NO person in the photo, ADD one person naturally in the room; if a person is already there, keep them (do not add extra objects or change the scene). Make 5 variations (only the person / their position and the widened sides differ). PHOTO: ' + featured.url;
      } else {
        heroLine = '01. [16:9] MAIN HERO IMAGE — 5 OPTIONS (5 variations of this SAME shot: same room, styling and composition; change only the person or their position). ' + hero;
      }
      // Prompt lines are numbered by SCENE/PHOTO slot. A scene that reuses a blog image AS-IS gets NO
      // prompt (a skipped number simply means that slot is a reused blog image the tool provides).
      var lines = [heroLine];
      var num = 2;
      scenes.forEach(function (s) {
        var use = (s && s.use ? s.use : 'generate').toString();
        var kind = (s && s.kind ? s.kind : 'photo').toString();
        var reuseUrl = (s && s.reuseUrl ? s.reuseUrl : '').toString().trim();
        if (use === 'reuse' && reuseUrl) { num++; return; }
        var isProd = kind === 'product' && s && s.productSku && skuTitle[(s.productSku || '').toUpperCase()];
        var tag = kind === 'infographic' ? '[16:9][INFOGRAPHIC]' : '[16:9]';
        var line = _pad2(num) + '. ' + tag + ' ';
        if (use === 'remake' && reuseUrl) {
          if (kind === 'product') {
            // PRODUCT photo: widen to 16:9 AND add people (the AI ignores people unless told)
            line += 'USE THIS EXACT PRODUCT PHOTO and extend the sides naturally to FILL 16:9 (never stretch or distort), FULL BLEED, and ADD a user — or several users — naturally in the room enjoying the space (varied, realistic people; never covering the framed art). Do not distort or replace the photo — only widen it and add the people: ' + reuseUrl;
          } else {
            // BLOG image: extend-ONLY — no people, no scene, nothing else added (avoids weird invented people)
            line += 'USE THIS EXACT PHOTO and extend the sides naturally to FILL 16:9 (never stretch or distort), FULL BLEED — do NOT add or change anything else: no extra people, no new objects, no different scene, just widen the existing image to fit: ' + reuseUrl;
          }
          lines.push(line); num++; return;
        }
        line += ((s && s.image ? s.image : '').toString().trim());
        if (isProd) line += ' → product = "' + skuTitle[(s.productSku || '').toUpperCase()] + '"';
        lines.push(line);
        num++;
      });
      var imagePromptBlock = lines.join('\n');
      // copyable batches for Shopify AI: hero alone first, then fill each batch up to <10,000 characters
      var promptBatches = [lines[0]];
      var _cur = '';
      for (var bi = 1; bi < lines.length; bi++) {
        var _ln = lines[bi];
        if (_cur && (_cur.length + 1 + _ln.length) > 9500) { promptBatches.push(_cur); _cur = _ln; }
        else { _cur = _cur ? (_cur + '\n' + _ln) : _ln; }
      }
      if (_cur) promptBatches.push(_cur);

      var payload = {
        blogHandle: handle, sourceType: sourceType, blogTitle: srcTitle,
        blogUrl: (sourceType === 'page' ? 'https://aboutwallart.com/pages/' + handle : EDU_BLOG_BASE + handle),
        videoTitle: videoTitle, seconds: seconds, sceneCount: scenes.length,
        script: scriptText, hero: hero, scenes: scenes, outro: OUTRO,
        imagePromptBlock: imagePromptBlock, promptBatches: promptBatches, products: selProducts,
        featured: featured, reuseImages: reuseImgs
      };
      return res.status(200).json({ ok: true, videoTitle: videoTitle, script: scriptText, imagePromptBlock: imagePromptBlock, promptBatches: promptBatches, sceneCount: scenes.length, payload: payload });
    }

    if (action === 'edu-save-reused') {
      // Create a Drive folder named after the video (inside "Images to make videos") and save the
      // REUSE-AS-IS blog images into it, each named with its scene/photo number (03.jpg …), so they
      // sit in the right slots. She then adds the generated images + the mp3 into the same folder.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var EDU_PARENT_FOLDER = '1nsqMmrzYQoMZfUOMuls2cQmubcOz36RV'; // My Drive › EDUCATIONAL VIDEOS › Images to make videos
      var DRIVE = process.env.EDU_DRIVE_URL;
      if (!DRIVE) return res.status(500).json({ ok: false, error: 'The Drive helper is not set up (EDU_DRIVE_URL missing).' });
      var vTitle = (body.videoTitle || 'Untitled video').toString().trim() || 'Untitled video';
      var handle = (body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      var reused = Array.isArray(body.reused) ? body.reused.filter(function (x) { return x && x.url && x.slot; }) : [];
      function _pad2s(n) { n = parseInt(n, 10) || 0; return n < 10 ? '0' + n : '' + n; }
      // 1) create the folder
      var folderId = '', folderUrl = '';
      try {
        var cf = await fetch(DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-folder', parentId: EDU_PARENT_FOLDER, name: vTitle }) });
        var cj = await cf.json();
        if (!cj || !cj.ok || !cj.id) return res.status(200).json({ ok: false, error: 'Could not create the folder. Re-deploy the Drive helper (it needs the new folder-create step). ' + ((cj && cj.error) || '') });
        folderId = cj.id; folderUrl = cj.url || ('https://drive.google.com/drive/folders/' + cj.id);
      } catch (e) { return res.status(200).json({ ok: false, error: 'Could not reach the Drive helper: ' + e.message }); }
      // 2) download each reused image and upload it into the folder with its slot number
      var saved = 0, failed = [];
      for (var i = 0; i < reused.length; i++) {
        var it = reused[i];
        try {
          var ir = await fetch(it.url);
          var buf = Buffer.from(await ir.arrayBuffer());
          var clean = it.url.split('?')[0];
          var ext = (clean.split('.').pop() || 'jpg').toLowerCase(); if (ext.length > 4 || ext.indexOf('/') >= 0) ext = 'jpg';
          var mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
          var nm = _pad2s(it.slot) + '.' + ext;
          var up = await fetch(DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', folderId: folderId, name: nm, mime: mime, dataBase64: buf.toString('base64') }) });
          var uj = await up.json();
          if (uj && uj.ok) saved++; else failed.push(nm);
        } catch (e) { failed.push(_pad2s(it.slot)); }
      }
      // remember the folder on the saved video so it's still there when she reopens it later
      if (handle) {
        try {
          var ex = await ghGet('data/edu-video-' + handle + '.json');
          if (ex.content) {
            var pp = JSON.parse(ex.content); pp.driveFolderId = folderId; pp.driveFolderUrl = folderUrl;
            await ghSave('data/edu-video-' + handle + '.json', function () { return JSON.stringify(pp, null, 2); }, 'Save Drive folder ' + handle);
          }
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, folderId: folderId, folderUrl: folderUrl, saved: saved, total: reused.length, failed: failed });
    }

    if (action === 'edu-voiceover') {
      // Make the ElevenLabs voiceover from the SAVED script and drop voiceover.mp3 into the video's Drive folder.
      // Voice = Serena (British, Friendly Ad). Model = Eleven v3. Stability = Natural (0.5) so the [audio tags] work.
      // The spoken text = videoTitle + every scene line (WITH its [tags]) + the 5 fixed outro lines — same order the
      // render's timing uses, so the audio and the on-screen scenes line up. The render strips the tags for captions.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const handle = (body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });
      var EL_KEY = process.env.ELEVENLABS_KEY;
      if (!EL_KEY) return res.status(200).json({ ok: false, error: 'The voiceover is not set up (ELEVENLABS_KEY missing).' });
      var DRIVE = process.env.EDU_DRIVE_URL;
      if (!DRIVE) return res.status(200).json({ ok: false, error: 'The Drive helper is not set up (EDU_DRIVE_URL missing).' });
      var VOICE_ID = '1YfmfuouRyRwVbpAZP7R'; // Serena — British, Friendly Ad
      const gh = await ghGet('data/edu-video-' + handle + '.json');
      if (!gh.content) return res.status(200).json({ ok: false, error: 'Save the video first (step 2), then make the voiceover.' });
      var p = {};
      try { p = JSON.parse(gh.content); } catch (e) { return res.status(200).json({ ok: false, error: 'Saved file unreadable' }); }
      var folderId = (body.folderId || '').toString().trim() || (p.driveFolderId || '').toString().trim();
      if (!folderId) return res.status(200).json({ ok: false, error: 'Create the Drive folder first (step 3), or paste the folder link.' });
      // build the spoken script (keep the [tags] — they are the voice cues for ElevenLabs)
      var parts = [];
      var vt = (p.videoTitle || '').toString().trim(); if (vt) parts.push(vt);
      (Array.isArray(p.scenes) ? p.scenes : []).forEach(function (s) { var t = (s && s.text ? s.text : '').toString().trim(); if (t) parts.push(t); });
      (Array.isArray(p.outro) ? p.outro : []).forEach(function (o) { var t = (o || '').toString().trim(); if (t) parts.push(t); });
      var scriptText = parts.join('\n\n');
      if (!scriptText) return res.status(200).json({ ok: false, error: 'The saved script is empty — generate and save it first.' });
      // ElevenLabs v3 handles up to ~5,000 characters per request. Her scripts are ~3,400 so it is one call;
      // if a script is ever longer, split it at paragraph breaks and join the mp3 pieces.
      var chunks = [];
      if (scriptText.length <= 5000) { chunks = [scriptText]; }
      else {
        var paras = scriptText.split('\n\n'); var cur = '';
        paras.forEach(function (pp) { if (cur && (cur.length + 2 + pp.length) > 4800) { chunks.push(cur); cur = pp; } else { cur = cur ? (cur + '\n\n' + pp) : pp; } });
        if (cur) chunks.push(cur);
      }
      async function ttsChunk(text) {
        var r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + VOICE_ID + '?output_format=mp3_44100_128', {
          method: 'POST',
          headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json', 'accept': 'audio/mpeg' },
          body: JSON.stringify({ text: text, model_id: 'eleven_v3', voice_settings: { stability: 0.5, use_speaker_boost: true } })
        });
        if (!r.ok) {
          var et = await r.text();
          if (r.status === 401 || r.status === 402 || r.status === 429 || /credit|quota|insufficient|balance|payment|limit/i.test(et)) {
            throw new Error('❌ Couldn\'t make the voiceover — your ElevenLabs credits/quota look used up. Top up and try again.');
          }
          throw new Error('ElevenLabs error ' + r.status + ': ' + et.slice(0, 200));
        }
        return Buffer.from(await r.arrayBuffer());
      }
      try {
        var bufs = [];
        for (var ci = 0; ci < chunks.length; ci++) { bufs.push(await ttsChunk(chunks[ci])); }
        var mp3 = Buffer.concat(bufs);
        var up = await fetch(DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', folderId: folderId, name: 'voiceover.mp3', mime: 'audio/mpeg', dataBase64: mp3.toString('base64') }) });
        var uj = await up.json();
        if (!uj || !uj.ok) return res.status(200).json({ ok: false, error: 'Made the voiceover but could not save it to Drive: ' + ((uj && uj.error) || 'upload failed') });
        return res.status(200).json({ ok: true, folderId: folderId, folderUrl: 'https://drive.google.com/drive/folders/' + folderId, fileUrl: uj.url || '', chars: scriptText.length });
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message });
      }
    }

    if (action === 'edu-save') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const p = body.payload || {};
      const handle = (p.blogHandle || body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing blog handle' });
      p.savedAt = new Date().toISOString();
      p.done = true;
      var efile = 'data/edu-video-' + handle + '.json';
      await ghSave(efile, function () { return JSON.stringify(p, null, 2); }, 'Save educational video ' + handle);
      // update the lightweight index so the source picker can grey/sort saved ones without reading every file
      await ghSave(EDU_INDEX_FILE, function (content) {
        var idx = { videos: {} };
        if (content) { try { idx = JSON.parse(content); if (!idx.videos) idx.videos = {}; } catch (e) { idx = { videos: {} }; } }
        idx.videos[handle] = { done: true, videoTitle: p.videoTitle || '', sourceType: p.sourceType || 'blog', savedAt: p.savedAt };
        return JSON.stringify(idx, null, 2);
      }, 'Index educational video ' + handle);
      return res.status(200).json({ ok: true, file: efile });
    }

    if (action === 'edu-get') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const handle = ((req.query && req.query.handle) || body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });
      const gh = await ghGet('data/edu-video-' + handle + '.json');
      if (!gh.content) return res.status(200).json({ ok: false, error: 'No saved video for ' + handle });
      var payload = {};
      try { payload = JSON.parse(gh.content); } catch (e) { return res.status(200).json({ ok: false, error: 'Saved file unreadable' }); }
      return res.status(200).json({ ok: true, payload: payload });
    }

    // ---- "Already made" / "Published" cards: read each saved video's own image (lazy — fired when the tab opens).
    //      Falls back to the source blog/page's live image when the saved file has none. ----
    if (action === 'edu-made-images') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var items = Array.isArray(body.items) ? body.items
        : (Array.isArray(body.handles) ? body.handles.map(function (h) { return { handle: h, type: 'blog' }; }) : []);
      items = items.filter(function (it) { return it && it.handle; }).map(function (it) { return { handle: (it.handle || '').toString().toLowerCase(), type: (it.type === 'page' ? 'page' : 'blog') }; }).slice(0, 300);
      var images = {};
      function firstImgOf(html) { var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || ''); return m ? m[1].replace(/&amp;/g, '&') : ''; }
      // pass 1 — read each saved file
      async function fromFile(it) {
        try {
          var gh = await ghGet('data/edu-video-' + it.handle + '.json');
          if (!gh.content) return;
          var p = JSON.parse(gh.content);
          var img = (p.featured && p.featured.url) || p.featuredImage || '';
          if (!img && Array.isArray(p.reuseImages)) { for (var i = 0; i < p.reuseImages.length; i++) { if (p.reuseImages[i] && p.reuseImages[i].url) { img = p.reuseImages[i].url; break; } } }
          if (!img && Array.isArray(p.scenes)) { for (var j = 0; j < p.scenes.length; j++) { var u = p.scenes[j] && p.scenes[j].reuseUrl; if (u) { img = u; break; } } }
          if (img) images[it.handle] = img;
        } catch (e) {}
      }
      var fi = 0;
      async function fworker() { while (fi < items.length) { var i = fi++; await fromFile(items[i]); } }
      var fws = []; for (var fw = 0; fw < Math.min(6, items.length); fw++) fws.push(fworker());
      await Promise.all(fws);
      // pass 2 — fall back to the source's own live image for any still missing
      var missBlogs = items.filter(function (it) { return !images[it.handle] && it.type !== 'page'; });
      var missPages = items.filter(function (it) { return !images[it.handle] && it.type === 'page'; });
      if (missBlogs.length && process.env.SHOPIFY_STORE_DOMAIN) {
        try {
          for (var b = 0; b < missBlogs.length; b += 20) {
            var chunk = missBlogs.slice(b, b + 20);
            var q = 'blog_id:93572858142 (' + chunk.map(function (it) { return 'handle:' + it.handle; }).join(' OR ') + ')';
            var ad = await shopGql('query($q:String!){ articles(first:50, query:$q){ edges{ node{ handle image{url} } } } }', { q: q });
            ((ad && ad.data && ad.data.articles && ad.data.articles.edges) || []).forEach(function (e) { var n = e.node; if (n && n.handle && n.image && n.image.url) images[n.handle.toLowerCase()] = n.image.url; });
          }
        } catch (e) {}
      }
      if (missPages.length && process.env.SHOPIFY_STORE_DOMAIN) {
        try {
          var pr = await fetch('https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/api/2025-01/pages.json?limit=250&fields=handle,body_html', { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } });
          if (pr.ok) { var pj = await pr.json(); var byH = {}; (pj.pages || []).forEach(function (pg) { byH[(pg.handle || '').toLowerCase()] = pg.body_html || ''; }); missPages.forEach(function (it) { var im = firstImgOf(byH[it.handle]); if (im) images[it.handle] = im; }); }
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, images: images });
    }

    // ---- The NOT-yet-published educational-video pool (for the monthly calendar: 1/week) ----
    if (action === 'edu-pool') {
      var savedIdxP = await eduIndex();       // { handle: {done, videoTitle, sourceType, savedAt} }
      var savedFilesP = await eduSavedFiles(); // handles with an edu-video-<handle>.json
      var publishedP = await usedVideoBlogSet(); // handles already published (edu-mark-used / edu-metricool)
      // Hide videos already scheduled (built into a Metricool file) for a DIFFERENT month than the one being planned.
      // Keeps the current month's ones in the pool so re-downloading that month's file never loses them.
      var otherMonthP = {};
      var targetMonthP = ((req.query && req.query.month) || '').toString();
      if (/^\d{4}-\d{2}$/.test(targetMonthP)) {
        var qGhP = await ghGet('data/edu-publish-queue.json');
        if (qGhP.content) { try {
          var qvP = (JSON.parse(qGhP.content).videos) || [];
          var inTargetP = {}, inOtherP = {};
          qvP.forEach(function (v) { var h = (v.handle || '').toLowerCase(); var mo = (v.liveAt || '').slice(0, 7); if (!h || !mo) return; if (mo === targetMonthP) inTargetP[h] = 1; else inOtherP[h] = 1; });
          Object.keys(inOtherP).forEach(function (h) { if (!inTargetP[h]) otherMonthP[h] = 1; });
        } catch (e) {} }
      }
      var pool = [], seenP = {};
      function pushPool(h, meta) {
        h = (h || '').toLowerCase(); if (!h || seenP[h] || publishedP[h] || otherMonthP[h]) return; seenP[h] = 1;
        var typ = (meta && meta.sourceType) || 'blog';
        pool.push({ handle: h, title: (meta && meta.videoTitle) || h, videoTitle: (meta && meta.videoTitle) || '', sourceType: typ, savedAt: (meta && meta.savedAt) || '', url: (typ === 'page' ? 'https://aboutwallart.com/pages/' + h : EDU_BLOG_BASE + h) });
      }
      Object.keys(savedIdxP || {}).forEach(function (h) { pushPool(h, savedIdxP[h] || {}); });
      Object.keys(savedFilesP || {}).forEach(function (h) { pushPool(h, {}); });
      pool.sort(function (a, b) { return (a.savedAt || '').localeCompare(b.savedAt || ''); }); // oldest saved first (publish the ones waiting longest)
      // flag which ones already have a YouTube pack (small pool → read each file)
      var poolI = 0;
      async function poolPack() { while (poolI < pool.length) { var i = poolI++; try { var gh = await ghGet('data/edu-video-' + pool[i].handle + '.json'); if (gh.content) { var pp = JSON.parse(gh.content); pool[i].hasPack = !!(pp.youtube && pp.youtube.title); } } catch (e) {} } }
      var poolWs = []; for (var pk = 0; pk < Math.min(6, pool.length); pk++) poolWs.push(poolPack());
      await Promise.all(poolWs);
      return res.status(200).json({ ok: true, pool: pool, count: pool.length });
    }

    // ---- Build a Metricool import file to PUBLISH educational videos from their Drive link ----
    // YouTube long-form (VIDEO) + the networks she ticks, each at its best time. Marks each published
    // so the monthly calendar never offers it again. Reuses the same 94-column Metricool template.
    if (action === 'edu-metricool') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var vids = Array.isArray(body.videos) ? body.videos : [];
      var nets = Array.isArray(body.networks) ? body.networks.map(function (n) { return (n || '').toString().toLowerCase(); }) : [];
      var allowPartial = !!body.allowPartial; // true = don't pause for missing links, just skip them
      if (!vids.length) return res.status(400).json({ ok: false, error: 'No videos selected' });
      if (!nets.length) return res.status(400).json({ ok: false, error: 'Tick at least one network to publish to' });
      var wantYt = nets.indexOf('youtube') >= 0;

      // 94-column Metricool template (same as the metricool-file action)
      var H = ['Text', 'Date', 'Time', 'Draft', 'Facebook', 'Twitter/X', 'LinkedIn', 'GBP', 'Instagram', 'Pinterest', 'TikTok', 'Youtube', 'Threads', 'Bluesky'];
      for (var pi = 1; pi <= 10; pi++) H.push('Picture Url ' + pi);
      for (var ali = 1; ali <= 10; ali++) H.push('Alt text picture ' + ali);
      H = H.concat(['Document title', 'Shortener', 'Video Thumbnail Url', 'Video Cover Frame', 'Twitter/X Can reply', 'Twitter/X Type', 'Twitter/X Poll Duration minutes', 'Twitter/X Poll Option 1', 'Twitter/X Poll Option 2', 'Twitter/X Poll Option 3', 'Twitter/X Poll Option 4', 'Pinterest Board', 'Pinterest Pin Title', 'Pinterest Pin Link', 'Pinterest Pin New Format', 'Instagram Post Type', 'Instagram Show Reel On Feed', 'Youtube Video Title', 'Youtube Video Type', 'Youtube Video Privacy', 'Youtube video for kids', 'Youtube Video Category', 'Youtube Video Tags', 'Youtube playlist', 'GBP Post Type', 'Facebook Post Type', 'Facebook Title', 'First Comment Text', 'TikTok Title', 'TikTok disable comments', 'TikTok disable duet', 'TikTok disable stitch', 'TikTok Post Privacy', 'TikTok Branded Content', 'TikTok Your Brand', 'TikTok Auto Add Music', 'TikTok Photo Cover Index', 'TikTok musicId', 'TikTok music title', 'TikTok music author', 'TikTok music previewUrl', 'TikTok music thumbnailUrl', 'TikTok music soundVolume', 'TikTok music originalVolume', 'TikTok music startMillis', 'TikTok music endMillis', 'TikTok Ai generated content', 'LinkedIn Type', 'LinkedIn Poll Question', 'LinkedIn Poll Option 1', 'LinkedIn Poll Option 2', 'LinkedIn Poll Option 3', 'LinkedIn Poll Option 4', 'LinkedIn Poll Duration', 'LinkedIn Show link preview', 'LinkedIn Images as Carousel', 'Threads Reply Control', 'Threads Is Spoiler', 'Threads Post Type', 'Brand name']);
      var BOOLC = { 'Draft': 1, 'Facebook': 1, 'Twitter/X': 1, 'LinkedIn': 1, 'GBP': 1, 'Instagram': 1, 'Pinterest': 1, 'TikTok': 1, 'Youtube': 1, 'Threads': 1, 'Bluesky': 1, 'Shortener': 1, 'Pinterest Pin New Format': 1, 'Instagram Show Reel On Feed': 1, 'Youtube video for kids': 1, 'TikTok disable comments': 1, 'TikTok disable duet': 1, 'TikTok disable stitch': 1, 'TikTok Branded Content': 1, 'TikTok Your Brand': 1, 'TikTok Auto Add Music': 1, 'TikTok Ai generated content': 1, 'LinkedIn Show link preview': 1, 'LinkedIn Images as Carousel': 1, 'Threads Is Spoiler': 1 };
      function cellE(col, val) { if (BOOLC[col]) return val === true ? 'true' : 'false'; if (val === undefined || val === null || val === '') return ''; return '"' + String(val).replace(/"/g, '""') + '"'; }
      function rowLineE(o) { return H.map(function (h) { return cellE(h, o[h]); }).join(','); }

      // best times (day + HH:MM) -> HH:MM:SS per network
      var btGh = await ghGet(BEST_TIMES_FILE);
      var BT = {}; if (btGh.content) { try { BT = (JSON.parse(btGh.content).times) || {}; } catch (e) { BT = {}; } }
      function timeFor(net) {
        var v = BT[net] || ''; var m = /(\d{1,2}):(\d{2})/.exec(v);
        if (!m) { var def = { youtube: '16:00', facebook: '10:00', instagram: '11:00', linkedin: '17:00', tiktok: '18:00', twitter: '10:00', pinterest: '20:00', threads: '12:00', gbp: '10:00' }; var d = def[net] || '10:00'; return d + ':00'; }
        var hh = ('0' + m[1]).slice(-2); return hh + ':' + m[2] + ':00';
      }

      var DRIVE = process.env.EDU_DRIVE_URL;
      function driveIdFrom(u) {
        var m = /\/folders\/([-\w]{20,})/.exec(u); if (m) return { type: 'folder', id: m[1] };
        m = /\/file\/d\/([-\w]{20,})/.exec(u) || /[?&]id=([-\w]{20,})/.exec(u) || /\/d\/([-\w]{20,})/.exec(u);
        if (m) return { type: 'file', id: m[1] };
        return null;
      }
      async function mp4InFolder(folderId) {
        if (!folderId || !DRIVE) return '';
        try {
          var r = await fetch(DRIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', folderId: folderId }) });
          if (!r.ok) return '';
          var d = await r.json(); var files = (d && d.files) || [];
          var vid = files.filter(function (f) { var n = (f.name || '').toLowerCase(); return (f.mime === 'video/mp4') || /\.(mp4|mov|m4v)$/.test(n); })[0];
          return vid ? ('https://drive.google.com/uc?export=download&id=' + vid.id) : '';
        } catch (e) { return ''; }
      }
      // Resolve a video's media link. A pasted link can be a Drive FOLDER link (find the 1 mp4 in it) or a
      // FILE link. Returns { link, folderId } — folderId set when discovered from a pasted folder link (to save back).
      async function resolveVideo(folderId, pasted) {
        if (pasted && /^https?:\/\//i.test(pasted)) {
          var ex = driveIdFrom(pasted);
          if (ex && ex.type === 'folder') { var l = await mp4InFolder(ex.id); return { link: l, folderId: l ? ex.id : '' }; }
          if (ex && ex.type === 'file') { return { link: 'https://drive.google.com/uc?export=download&id=' + ex.id, folderId: '' }; }
          return { link: pasted, folderId: '' };
        }
        if (folderId) { return { link: await mp4InFolder(folderId), folderId: '' }; }
        return { link: '', folderId: '' };
      }

      async function eduCaps(vTitle, blogUrl, wantNets) {
        var list = wantNets.filter(function (n) { return n !== 'youtube'; });
        if (!list.length) return {};
        var SHOP = 'https://aboutwallart.com';
        var prompt = 'Write warm, friendly UK-English social captions for an EDUCATIONAL home-decor video by About Wall Art (a calm home-styling advisor voice, NOT salesy, never words like elevate delve showcase dive beacon). Video title: "' + vTitle + '"' + (blogUrl ? ('. Full written guide: ' + blogUrl) : '') + '.\n' +
          'Return ONLY strict JSON with a key for EACH of these networks: ' + list.join(', ') + '.\n' +
          '- facebook: 2 to 3 warm sentences about what the video teaches' + (blogUrl ? (', then " Full guide → ' + blogUrl + '"') : '') + ', then 3 hashtags.\n' +
          '- instagram: warm 3 to 4 sentences, then "Tap the link in my bio for the full guide.", then a blank line, then about 20 lowercase hashtags. NO link.\n' +
          '- linkedin: professional but warm, 3 to 5 short paragraphs on the styling idea' + (blogUrl ? (', end with "Full guide: ' + blogUrl + '"') : '') + '. NO hashtags.\n' +
          '- twitter: one short punchy line' + (blogUrl ? (', then " Watch/read → ' + blogUrl + '"') : '') + ', then 1 hashtag. Under 260 characters.\n' +
          '- threads: one or two short warm lines, then 5 lowercase hashtags. NO link.\n' +
          '- pinterest: keyword-rich descriptive text a decorator would search, 3 to 4 sentences, then 5 lowercase hashtags. NO link.\n' +
          '- gbp: a full informative Google Business post of about 900 to 1200 characters on the styling topic. NO hashtags.\n' +
          '- tiktok: one short warm hook line about the tip. ABSOLUTELY NO link and NO call-to-action (no "shop", no "link in bio", no "watch on…"). Just the hook, then 3 lowercase hashtags.\n' +
          'Return ONLY the JSON object.';
        try {
          var r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
          if (!r.ok) { var et = await r.text(); if (r.status === 401 || r.status === 402 || r.status === 429 || /credit|quota|insufficient|billing|balance/i.test(et)) throw new Error('CREDITS'); throw new Error('AI ' + r.status); }
          var d = await r.json(); var t = (d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
          var mm = t.match(/\{[\s\S]*\}/); return JSON.parse(mm ? mm[0] : t);
        } catch (e) { if (e.message === 'CREDITS') throw e; return {}; }
      }
      function trimE(s, n) { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n); }

      // Ask the Python engine to bake the title card into the video's Drive folder + return a public link,
      // so the Metricool file uses a clean branded thumbnail (never the black first frame).
      var SELF = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || '');
      async function eduThumb(folderId, handle) {
        if (!folderId) return '';
        try {
          var r = await fetch(SELF + '/api/edu-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edu-thumbnail', folderId: folderId, handle: handle }) });
          if (!r.ok) return '';
          var d = await r.json();
          return (d && d.ok && d.thumbUrl) ? d.thumbUrl : '';
        } catch (e) { return ''; }
      }
      // A scheduled London wall-clock time -> the exact UTC instant (handles BST vs GMT).
      function londonToUTCISO(dateStr, hhmmss) {
        var p = (dateStr || '').split('-'); var t = (hhmmss || '16:00:00').split(':');
        var y = +p[0], mo = +p[1], d = +p[2], H = +t[0], Mi = +t[1] || 0;
        if (!y || !mo || !d) return '';
        function lastSunday(year, month) { var dt = new Date(Date.UTC(year, month + 1, 0)); dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); return dt.getUTCDate(); }
        var bstStart = Date.UTC(y, 2, lastSunday(y, 2), 1), bstEnd = Date.UTC(y, 9, lastSunday(y, 9), 1);
        var localAsUTC = Date.UTC(y, mo - 1, d, H, Mi);
        var off = (localAsUTC >= bstStart && localAsUTC < bstEnd) ? 1 : 0;
        return new Date(localAsUTC - off * 3600000).toISOString();
      }
      const EDU_QUEUE_FILE = 'data/edu-publish-queue.json';

      var rows = [H.join(',')];
      var publishedHandles = [];
      var queueAdds = [];
      var problems = [];

      // ---- PHASE 1: resolve each video's pack + Drive link (cheap). Classify; collect any needing a link. ----
      var items = [];
      var needLinks = [];
      for (var vi = 0; vi < vids.length; vi++) {
        var v = vids[vi] || {};
        var handle = (v.handle || '').toString().toLowerCase().replace(/[^a-z0-9\-]/g, '');
        var date = (v.date || '').toString();
        if (!handle || !date) { problems.push('A video is missing its handle or date.'); continue; }
        var gh = await ghGet('data/edu-video-' + handle + '.json');
        if (!gh.content) { problems.push(handle + ': not saved yet.'); continue; }
        var p = {}; try { p = JSON.parse(gh.content); } catch (e) { problems.push(handle + ': saved file unreadable.'); continue; }
        var vTitle = (p.videoTitle || p.blogTitle || handle).toString();
        var yt = p.youtube || null;
        if (wantYt && (!yt || !yt.title)) { problems.push(vTitle + ': generate its YouTube pack first (step 7).'); continue; }
        var rv = await resolveVideo(p.driveFolderId || '', v.driveLink || '');
        if (!rv.link) {
          if (!allowPartial) needLinks.push({ handle: handle, title: vTitle });
          else problems.push(vTitle + ': no video found in its Drive folder.');
          continue;
        }
        var saveFolder = '';
        if (rv.folderId && !p.driveFolderId) { p.driveFolderId = rv.folderId; saveFolder = rv.folderId; } // remember it
        items.push({ handle: handle, date: date, p: p, vTitle: vTitle, blogUrl: (p.blogUrl || '').toString(), yt: yt, link: rv.link, saveFolder: saveFolder });
      }

      // Pause and ask for the Drive link(s) — unless she already chose to skip them.
      if (needLinks.length && !allowPartial) {
        return res.status(200).json({ ok: false, needLinks: needLinks });
      }

      // ---- PHASE 2: build each ready video (captions + thumbnail + rows). ----
      for (var it = 0; it < items.length; it++) {
        var item = items[it];
        var handle = item.handle, date = item.date, p = item.p, vTitle = item.vTitle, blogUrl = item.blogUrl, yt = item.yt, link = item.link;
        // remember a newly-discovered Drive folder so we never ask for it again
        if (item.saveFolder) { try { await ghSave('data/edu-video-' + handle + '.json', (function (pp) { return function () { return JSON.stringify(pp, null, 2); }; })(p), 'Remember Drive folder ' + handle); } catch (e) {} }
        var alt = vTitle;
        var caps;
        try { caps = await eduCaps(vTitle, blogUrl, nets); }
        catch (e) { if (e.message === 'CREDITS') return res.status(200).json({ ok: false, error: '❌ Couldn\'t write the captions — your Claude API credits/quota look used up. Top up and try again.' }); caps = {}; }

        var thumb = wantYt ? await eduThumb(p.driveFolderId || '', handle) : '';
        var mk = function (net) { var o = { Date: date, Draft: false, Shortener: true, 'Picture Url 1': link, 'Alt text picture 1': alt, 'Video Thumbnail Url': thumb }; o[net] = true; return o; };
        if (wantYt) {
          var rY = mk('Youtube'); rY.Time = timeFor('youtube');
          rY['Youtube Video Title'] = trimE(yt.title || vTitle, 100); rY['Youtube Video Type'] = 'VIDEO'; rY['Youtube Video Privacy'] = 'PUBLIC';
          rY['Youtube video for kids'] = false; rY['Youtube Video Category'] = yt.category || 'Howto & Style';
          rY['Youtube Video Tags'] = yt.tags || ''; rY['Youtube playlist'] = yt.playlist || '';
          rY.Text = trimE(yt.description || vTitle, 4900); rows.push(rowLineE(rY));
        }
        if (nets.indexOf('facebook') >= 0) { var rF = mk('Facebook'); rF.Time = timeFor('facebook'); rF['Facebook Post Type'] = 'POST'; rF['Facebook Title'] = trimE(vTitle, 40); rF.Text = trimE(caps.facebook || vTitle, 2000); rows.push(rowLineE(rF)); }
        if (nets.indexOf('instagram') >= 0) { var rI = mk('Instagram'); rI.Time = timeFor('instagram'); rI.Draft = true; rI['Instagram Post Type'] = 'POST'; rI.Text = trimE(caps.instagram || vTitle, 2200); rows.push(rowLineE(rI)); }
        if (nets.indexOf('linkedin') >= 0) { var rL = mk('LinkedIn'); rL.Time = timeFor('linkedin'); rL['LinkedIn Type'] = 'POST'; rL.Text = trimE(caps.linkedin || vTitle, 3000); rows.push(rowLineE(rL)); }
        if (nets.indexOf('twitter') >= 0) { var rT = mk('Twitter/X'); rT.Time = timeFor('twitter'); rT['Twitter/X Type'] = 'POST'; rT.Text = trimE(caps.twitter || vTitle, 280); rows.push(rowLineE(rT)); }
        if (nets.indexOf('threads') >= 0) { var rH = mk('Threads'); rH.Time = timeFor('threads'); rH['Threads Reply Control'] = 'EVERYONE'; rH['Threads Post Type'] = 'POST'; rH.Text = trimE(caps.threads || vTitle, 500); rows.push(rowLineE(rH)); }
        if (nets.indexOf('pinterest') >= 0) { var rP = mk('Pinterest'); rP.Time = timeFor('pinterest'); rP['Pinterest Board'] = 'Home Decor Ideas & Interior Styling Tips'; rP['Pinterest Pin Title'] = trimE(vTitle, 90); rP['Pinterest Pin Link'] = blogUrl || 'https://aboutwallart.com'; rP.Text = trimE(caps.pinterest || vTitle, 500); rows.push(rowLineE(rP)); }
        if (nets.indexOf('gbp') >= 0) { var rG = mk('GBP'); rG.Time = timeFor('gbp'); rG['GBP Post Type'] = 'publication'; rG.Text = trimE(caps.gbp || vTitle, 1500); rows.push(rowLineE(rG)); }
        if (nets.indexOf('tiktok') >= 0) { var rK = mk('TikTok'); rK.Time = timeFor('tiktok'); rK['TikTok Title'] = trimE(vTitle, 90); rK['TikTok Post Privacy'] = 'PUBLIC_TO_EVERYONE'; rK['TikTok Ai generated content'] = true; rK.Text = trimE(caps.tiktok || vTitle, 2000); rows.push(rowLineE(rK)); }

        publishedHandles.push({ handle: handle, title: vTitle });
        if (wantYt) { queueAdds.push({ handle: handle, title: vTitle, blogUrl: blogUrl, youtubeUrl: '', liveAt: londonToUTCISO(date, timeFor('youtube')), addedAt: new Date().toISOString() }); }
      }

      if (publishedHandles.length === 0) {
        return res.status(200).json({ ok: false, error: (problems[0] || 'Nothing could be published.'), problems: problems });
      }

      var csvE = '﻿' + rows.join('\r\n') + '\r\n';

      // NOTE: building the file does NOT mark anything done. She marks each video herself (edu-mark-used)
      // AFTER she has uploaded the file to Metricool, so a rebuild never loses videos.

      // add each YouTube-scheduled video to the reminder queue (the weekly email script reads this)
      if (queueAdds.length) {
        await ghSave(EDU_QUEUE_FILE, function (content) {
          var q = { videos: [] };
          if (content) { try { q = JSON.parse(content); if (!Array.isArray(q.videos)) q.videos = []; } catch (e) { q = { videos: [] }; } }
          queueAdds.forEach(function (a) { if (!q.videos.some(function (x) { return (x.handle || '') === a.handle && (x.liveAt || '') === a.liveAt; })) q.videos.push(a); });
          return JSON.stringify(q, null, 2);
        }, 'Queue educational videos for blog-link reminder');
      }

      return res.status(200).json({ ok: true, csv: csvE, count: publishedHandles.length, built: publishedHandles, published: publishedHandles.map(function (u) { return u.title; }), problems: problems });
    }

    if (action === 'edu-image') {
      // Fetch a blog/product image server-side and return its bytes, so the page can put it on the
      // clipboard (the browser can't fetch the Shopify CDN directly — cross-site block). She then
      // pastes it straight into the Shopify AI chat.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      var url = (body.url || '').toString().trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Bad image link' });
      try {
        var ir = await fetch(url);
        if (!ir.ok) return res.status(200).json({ ok: false, error: 'Could not fetch the image (' + ir.status + ')' });
        var ct = ir.headers.get('content-type') || 'image/jpeg';
        var buf = Buffer.from(await ir.arrayBuffer());
        return res.status(200).json({ ok: true, mime: ct, dataBase64: buf.toString('base64') });
      } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
    }

    // (removed 19 Jul 2026: the old 'edu-canva-file' action — superseded by "Make the video".)

    if (action === 'edu-undo') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const handle = (body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });
      // un-mark done (keep the saved data so it can still be reopened)
      await ghSave(EDU_INDEX_FILE, function (content) {
        var idx = { videos: {} };
        if (content) { try { idx = JSON.parse(content); if (!idx.videos) idx.videos = {}; } catch (e) { idx = { videos: {} }; } }
        if (idx.videos[handle]) idx.videos[handle].done = false;
        return JSON.stringify(idx, null, 2);
      }, 'Un-mark educational video ' + handle);
      // also flip the flag inside the saved file (best-effort)
      try {
        var f = 'data/edu-video-' + handle + '.json';
        var cur = await ghGet(f);
        if (cur.content) { var pj = JSON.parse(cur.content); pj.done = false; await ghSave(f, function () { return JSON.stringify(pj, null, 2); }, 'Un-mark done ' + handle); }
      } catch (e) {}
      return res.status(200).json({ ok: true });
    }

    if (action === 'edu-youtube-pack') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const handle = (body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });
      const gh = await ghGet('data/edu-video-' + handle + '.json');
      if (!gh.content) return res.status(200).json({ ok: false, error: 'Save the video first.' });
      var p = {};
      try { p = JSON.parse(gh.content); } catch (e) { return res.status(200).json({ ok: false, error: 'Saved file unreadable' }); }
      var blogUrl = p.blogUrl || '';
      var vTitle = p.videoTitle || p.blogTitle || '';
      var products = Array.isArray(p.products) ? p.products : [];
      var prodList = products.map(function (x) { return ((x.title || '') + ' — ' + (x.url || '')).trim(); }).filter(function (s) { return s && s !== '—'; });

      var SOCIALS = 'Instagram: https://instagram.com/aboutwallart\nTikTok: https://tiktok.com/@aboutwallart\nPinterest: https://www.pinterest.com/aboutwallartstore\nFacebook: https://facebook.com/aboutwallart\nLinkedIn: https://www.linkedin.com/company/about-wall-art\nThreads: https://www.threads.net/@aboutwallart\nX: https://x.com/about_wall';
      var HUB = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration';
      var FREE = 'https://aboutwallart.com/pages/free-interior-design-education';
      var SHOP = 'https://aboutwallart.com';

      var aiPrompt =
        'Write YouTube metadata for an educational home-decor video by About Wall Art (warm, friendly UK-English advisor voice; NOT salesy; never words like elevate, delve, showcase, dive, beacon).\n' +
        'Video is based on this content: title "' + vTitle + '"' + (blogUrl ? (', source ' + blogUrl) : '') + '.\n' +
        'Return ONLY strict JSON: {"title":"...","hook":"...","tags":"tag1, tag2","hashtags":"#one #two #three"}\n' +
        '- title: leads with the search keyword + a light hook, MAX 70 characters, truthful (no clickbait).\n' +
        '- hook: one warm keyword-rich opening line for the description (shows before "Show more").\n' +
        '- tags: 8 to 12 comma-separated topic keywords.\n' +
        '- hashtags: 3 to 5 lowercase hashtags.';
      var ai = {};
      var ar = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content: aiPrompt }] }) });
      if (!ar.ok) {
        var yerr = await ar.text();
        // if Claude ran out of credits, show a clear error instead of a flat, non-AI pack
        if (ar.status === 401 || ar.status === 402 || ar.status === 429 || /credit|quota|insufficient|billing|balance/i.test(yerr)) {
          return res.status(200).json({ ok: false, error: '❌ Couldn\'t write the YouTube pack — your Claude API credits/quota look used up. Top up and try again.' });
        }
        return res.status(200).json({ ok: false, error: 'Claude error: ' + yerr.slice(0, 200) });
      }
      try { var adj = await ar.json(); var t = (adj.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n'); var mm = t.match(/\{[\s\S]*\}/); ai = JSON.parse(mm ? mm[0] : t); } catch (e) { ai = {}; }

      var title = (ai.title || vTitle || '').toString().slice(0, 70);
      var hook = (ai.hook || '').toString();
      var tags = (ai.tags || '').toString();
      var hashtags = (ai.hashtags || '').toString();
      var filename = ((title || vTitle).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'educational-video') + '.mp4';

      var d = [];
      if (hook) d.push(hook);
      d.push('Every print arrives framed and ready to hang.');
      d.push('');
      if (blogUrl) d.push('📖 Read the full guide: ' + blogUrl);
      d.push('🖼️ Shop wall art: ' + SHOP);
      d.push('📚 Free design guides & tools: ' + FREE);
      d.push('🎨 More home styling ideas: ' + HUB);
      if (prodList.length) { d.push(''); d.push('Featured in this video:'); prodList.forEach(function (l) { d.push('• ' + l); }); }
      d.push(''); d.push('Follow us:'); d.push(SOCIALS);
      if (hashtags) { d.push(''); d.push(hashtags); }
      var description = d.join('\n');

      var youtube = {
        filename: filename, title: title, description: description, tags: tags,
        category: 'Howto & Style', playlist: 'Home Decor Ideas & Interior Styling Tips',
        endScreen: 'End screen: 1 playlist + 1 subscribe. Add a playlist card ~0:30 (message + teaser max 30 chars each). Visibility: Public.',
        thumbnailNote: 'Thumbnail: in Adobe Express, open your hero scene → Download → JPG. That is your YouTube thumbnail (no separate grab needed).',
        checklist: [
          'Audience → "No, it\'s not made for kids".',
          'Show more → AI use → "Yes" (the scenes and the people are AI-generated).',
          'Show more → Category → "Howto & Style".',
          'Show more → Tags → paste the Tags above.',
          'Show more → Video language → leave "Not set". Do NOT pick a language — the captions are burned into the video, and selecting a language makes YouTube auto-add its own captions on top of them.',
          'Show more → keep "Allow embedding" ON and "Publish to subscriptions feed and notify subscribers" ON.',
          'Subtitles → skip (captions are burned into the video).',
          'End screen → "Import from latest video" → Save.',
          'Cards → add 1 Playlist card ("Home Decor Ideas & Interior Styling Tips") at ~0:30, with teaser "More home styling ideas". (Link card → skip until the channel is YPP-approved.)',
          'Quiz → skip.',
          'Thumbnail → export your hero scene from Adobe Express as a JPG.',
          'Visibility → Schedule for your weekly slot (e.g. Sunday 9:30am UK), one video per week; or Public now for the very first.'
        ]
      };
      p.youtube = youtube; p.savedAt = new Date().toISOString();
      await ghSave('data/edu-video-' + handle + '.json', function () { return JSON.stringify(p, null, 2); }, 'YouTube pack ' + handle);
      return res.status(200).json({ ok: true, youtube: youtube });
    }

    if (action === 'edu-mark-used') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const handle = (body.handle || '').toString().trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
      const youtubeUrl = (body.youtubeUrl || '').toString().trim();
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });
      var title = '', vTitle = '';
      try {
        var g = await ghGet('data/edu-video-' + handle + '.json');
        if (g.content) { var pp = JSON.parse(g.content); title = pp.blogTitle || ''; vTitle = pp.videoTitle || ''; pp.youtubeUrl = youtubeUrl; pp.done = true; await ghSave('data/edu-video-' + handle + '.json', function () { return JSON.stringify(pp, null, 2); }, 'Add YouTube URL ' + handle); }
      } catch (e) {}
      await ghSave(USEDVIDBLOG_FILE, function (content) {
        var doc = { used: [] };
        if (content) { try { doc = JSON.parse(content); if (!Array.isArray(doc.used)) doc.used = []; } catch (e) { doc = { used: [] }; } }
        if (!doc.used.some(function (x) { return (x.handle || '').toLowerCase() === handle; })) {
          doc.used.push({ handle: handle, title: title, videoTitle: vTitle, youtubeUrl: youtubeUrl, usedDate: new Date().toISOString().slice(0, 10), status: 'done' });
        }
        return JSON.stringify(doc, null, 2);
      }, 'Mark blog used (educational video) ' + handle);
      return res.status(200).json({ ok: true });
    }

    // ===== LinkedIn Newsletter tab (v9.7) — month-based, additive, self-contained =====
    if (action === 'linkedin-plan' || action === 'linkedin-blogs' || action === 'linkedin-used' || action === 'linkedin-mark-sent' || action === 'linkedin-cover' || action === 'linkedin-generate') {
      const LI_USED = 'data/used-linkedin-blogs.json';
      const LI_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN, LI_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
      const liBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      async function liUsedList() {
        const gh = await ghGet(LI_USED);
        if (gh.content) { try { const d = JSON.parse(gh.content); return Array.isArray(d.used) ? d.used : []; } catch (e) {} }
        return [];
      }
      async function liShopify(gq, vars) {
        const r = await fetch('https://' + LI_DOMAIN + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': LI_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq, variables: vars }) });
        return r.json();
      }
      async function liCallAI(prompt, maxTok) {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('AI ' + r.status);
        const j = await r.json();
        return (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      }
      const LI_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      function liYM(s) { return (s || '').slice(0, 7); }
      function liTuesdays(ym) {
        const p = ym.split('-'); const y = +p[0], m = +p[1]; const out = [];
        const d = new Date(Date.UTC(y, m - 1, 1));
        while (d.getUTCMonth() === m - 1) { if (d.getUTCDay() === 2) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
        return out;
      }
      async function liAvailBlogs() {
        const usedH = new Set((await liUsedList()).map(function (u) { return u.handle; }));
        const gq = 'query($q:String!,$n:Int!){ articles(first:$n, sortKey:PUBLISHED_AT, reverse:true, query:$q){ edges{ node{ title handle isPublished image{url} tags } } } }';
        const j = await liShopify(gq, { q: 'blog_id:93572858142 published_status:published', n: 60 });
        const edges = ((((j || {}).data || {}).articles || {}).edges) || [];
        return edges.map(function (e) { return e.node; }).filter(function (n) { return n && n.isPublished !== false && !usedH.has(n.handle); }).map(function (n) { return { handle: n.handle, title: n.title, image: (n.image && n.image.url) || '', tags: n.tags || [] }; });
      }
      function liVarietyPick(avail, need) {
        const picks = []; const seen = new Set();
        for (const b of avail) { const t = (b.tags[0] || 'misc'); if (!seen.has(t)) { seen.add(t); picks.push(b); } if (picks.length >= need) break; }
        if (picks.length < need) { for (const b of avail) { if (picks.indexOf(b) < 0) picks.push(b); if (picks.length >= need) break; } }
        return picks;
      }

      // --- month plan: upcoming months with how many newsletters each still needs + complete flag ---
      if (action === 'linkedin-plan') {
        const used = await liUsedList();
        const now = new Date(); const todayStr = now.toISOString().slice(0, 10);
        const cy = now.getUTCFullYear(), cm = now.getUTCMonth();
        const months = [];
        for (let i = 0; i < 8; i++) {
          const dt = new Date(Date.UTC(cy, cm + i, 1));
          const ym = dt.toISOString().slice(0, 7);
          const tues = liTuesdays(ym);
          const doneEntries = used.filter(function (u) { return liYM(u.date) === ym; });
          const doneDates = doneEntries.map(function (u) { return u.date; });
          const openTues = tues.filter(function (t) { return doneDates.indexOf(t) < 0 && t >= todayStr; });
          months.push({ month: ym, label: LI_MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear(), need: openTues.length, complete: openTues.length === 0, used: doneEntries.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }) });
        }
        return res.status(200).json({ ok: true, months: months });
      }

      // --- blogs needed for one month, each paired with the next open Tuesday date ---
      if (action === 'linkedin-blogs') {
        const ym = liBody.month || new Date().toISOString().slice(0, 7);
        const used = await liUsedList();
        const todayStr = new Date().toISOString().slice(0, 10);
        const doneDates = used.filter(function (u) { return liYM(u.date) === ym; }).map(function (u) { return u.date; });
        const openTues = liTuesdays(ym).filter(function (t) { return doneDates.indexOf(t) < 0 && t >= todayStr; });
        const avail = await liAvailBlogs();
        const need = openTues.length;
        const picks = liVarietyPick(avail, need).map(function (b, i) { return Object.assign({}, b, { slotDate: openTues[i] }); });
        const takenH = new Set(picks.map(function (p) { return p.handle; }));
        const alts = avail.filter(function (b) { return !takenH.has(b.handle); }).slice(0, 8);
        return res.status(200).json({ ok: true, month: ym, need: need, slots: openTues, picks: picks, alts: alts });
      }

      if (action === 'linkedin-used') {
        return res.status(200).json({ ok: true, used: await liUsedList() });
      }

      // --- record a blog as scheduled for its date, so it is never reused ---
      if (action === 'linkedin-mark-sent') {
        const h = liBody.handle, ti = liBody.title || '', dat = liBody.date || new Date().toISOString().slice(0, 10);
        if (!h) return res.status(200).json({ ok: false, error: 'Missing handle' });
        await ghSave(LI_USED, function (content) {
          let d = { used: [] };
          if (content) { try { d = JSON.parse(content); if (!Array.isArray(d.used)) d.used = []; } catch (e) { d = { used: [] }; } }
          d.used = d.used.filter(function (u) { return u.handle !== h; });
          d.used.push({ handle: h, title: ti, date: dat });
          return JSON.stringify(d, null, 2);
        }, 'LinkedIn newsletter scheduled: ' + h + ' @ ' + dat);
        return res.status(200).json({ ok: true });
      }

      // --- cover image: 16:9 centre-crop via Shopify's own CDN transform, returned as base64 for a clean SEO-named download ---
      if (action === 'linkedin-cover') {
        let u = liBody.url || '';
        if (!u) return res.status(200).json({ ok: false, error: 'Missing url' });
        u = u.replace(/([?&])(width|height|crop)=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/([?&])&+/g, '$1');
        u += (u.indexOf('?') >= 0 ? '&' : '?') + 'width=1200&height=675&crop=center';
        const r = await fetch(u);
        if (!r.ok) return res.status(200).json({ ok: false, error: 'Image fetch ' + r.status });
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type') || 'image/png';
        return res.status(200).json({ ok: true, dataUrl: 'data:' + ct + ';base64,' + buf.toString('base64') });
      }

      // --- generate the full newsletter from one published blog ---
      if (action === 'linkedin-generate') {
        const h = liBody.handle;
        if (!h) return res.status(200).json({ ok: false, error: 'Missing handle' });
        const gq = 'query($q:String!){ articles(first:1, query:$q){ edges{ node{ title handle isPublished image{url altText} body } } } }';
        const j = await liShopify(gq, { q: 'blog_id:93572858142 handle:' + h });
        const node = ((((((j || {}).data || {}).articles || {}).edges) || [])[0] || {}).node;
        if (!node) return res.status(200).json({ ok: false, error: 'Blog not found' });
        if (node.isPublished === false) return res.status(200).json({ ok: false, error: 'That blog is not published — only published blogs are used.' });
        const srcBody = node.body || '';
        const coverUrl = (node.image && node.image.url) || '';
        const topic = (node.title || '').replace(/["<>]/g, '');
        const prompt = '<blog>\n' + srcBody + '\n</blog>\n\n' +
          'You are Mae, an interior-design consultant writing About Wall Art\'s LinkedIn NEWSLETTER "The Modern Sanctuary" for an audience of INTERIOR DESIGNERS. Rewrite the blog above into a ~1200-1400 word LinkedIn newsletter. The blog topic is: "' + topic + '".\n' +
          'RULES:\n' +
          '- Warm, first-person, plain UK-English advisor voice, designer-to-designer. Genuinely rewrite it (do NOT reuse the blog sentences). Never use the words: elevate, delve, showcase, dive, seamless, curated, tapestry, "in conclusion", boasts, nestled.\n' +
          '- Keep EVERY image and EVERY product from the blog, IN THE SAME ORDER, reusing the EXACT same src and href values. Never invent or change a URL.\n' +
          '- On EVERY <img> you output, add a data-cap="..." attribute holding a short caption for THAT SPECIFIC image. SECTION image: describe what is actually shown and the point of its section, staying strictly within this blog\'s topic ("' + topic + '") — NEVER name a different design style than the blog is about. PRODUCT image: the product\'s name only.\n' +
          '- Each PRODUCT in the source is an <a href="...aboutwallart.com/products/..."> wrapping an <img>, followed by a SHOP HERE link. Reproduce each as: the <img> (keeping its data-cap) wrapped in its product <a target="_blank" rel="noopener">, then on its own line <p style="margin:8px 0 30px;font-weight:700;text-align:center;"><a href="PRODUCT_URL" target="_blank" rel="noopener">SHOP HERE &#8594;</a></p>.\n' +
          '- Use <h2> for section headings, <p> for paragraphs, <ul><li> for lists. No inline styles except the SHOP HERE line above. No <html>/<head>/<body> tags.\n' +
          '- Summarise heavy tables and room-by-room detail briefly and push the full detail to the blog link.\n' +
          '- End the body with <p><a href="https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/' + h + '" target="_blank" rel="noopener">read the full guide on our site &#8594;</a></p> then one short question to the designers.\n\n' +
          'OUTPUT EXACTLY in this format, using these exact markers and NOTHING else:\n' +
          '###TITLE###\n(a NEW SEO title, clearly different wording from the blog title so it does not compete with the blog on Google)\n' +
          '###COVERCAPTION###\n(one engaging line for the cover image, about this blog\'s topic)\n' +
          '###ANNOUNCEMENT###\n(2 to 3 short sentences that go out as the newsletter email/announcement)\n' +
          '###HASHTAGS###\n(5 relevant hashtags separated by spaces, each starting with #)\n' +
          '###BODY###\n(the full newsletter body HTML, every <img> carrying its own data-cap)\n###END###';
        let raw = await liCallAI(prompt, 6000);
        function seg(a, b) { const i = raw.indexOf(a); if (i < 0) return ''; const s = i + a.length; let e = b ? raw.indexOf(b, s) : raw.length; if (e < 0) e = raw.length; return raw.slice(s, e).trim(); }
        const data = {
          seoTitle: seg('###TITLE###', '###COVERCAPTION###'),
          coverCaption: seg('###COVERCAPTION###', '###ANNOUNCEMENT###'),
          announcement: seg('###ANNOUNCEMENT###', '###HASHTAGS###'),
          hashtags: seg('###HASHTAGS###', '###BODY###'),
          bodyHtml: seg('###BODY###', '###END###'),
          coverUrl: coverUrl, handle: h, blogTitle: node.title || '', scheduleDate: liBody.date || ''
        };
        if (!data.bodyHtml) return res.status(200).json({ ok: false, error: 'Generation came back empty — please try again.' });
        return res.status(200).json({ ok: true, data: data });
      }
    }

    /* ===== CONTENT BOARD tab (v9.8) — monthly follow-up board, self-contained ===== */
    if (action === 'board-summary' || action === 'board-manual-get' || action === 'board-manual-set') {
      const B_PLAN = 'data/social-plan.json', B_VSTATE = 'data/social-video-state.json',
            B_UBLOG = 'data/used-blogs.json', B_EDU = 'data/edu-publish-queue.json',
            B_LI = 'data/used-linkedin-blogs.json', B_MANUAL = 'data/content-board-manual.json';
      const B_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN, B_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
      const bBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      async function bJson(fp) { const g = await ghGet(fp); if (g.content) { try { return JSON.parse(g.content); } catch (e) {} } return null; }

      if (action === 'board-manual-get') {
        const m = await bJson(B_MANUAL);
        return res.status(200).json({ ok: true, manual: (m && m.months) || {} });
      }

      if (action === 'board-manual-set') {
        const month = (bBody.month || '').toString(), key = (bBody.key || '').toString(), value = !!bBody.value;
        if (!month || !key) return res.status(200).json({ ok: false, error: 'Missing month/key' });
        await ghSave(B_MANUAL, function (content) {
          let d = { months: {} };
          if (content) { try { d = JSON.parse(content); if (!d.months) d.months = {}; } catch (e) { d = { months: {} }; } }
          if (!d.months[month]) d.months[month] = {};
          d.months[month][key] = value;
          return JSON.stringify(d, null, 2);
        }, 'Board manual ' + key + ' ' + month + '=' + value);
        return res.status(200).json({ ok: true });
      }

      // board-summary — per month, each task row's {done,total} from the real records
      const plan = (await bJson(B_PLAN)) || { months: {} };
      const vstate = (await bJson(B_VSTATE)) || {};
      const ublog = (((await bJson(B_UBLOG)) || {}).used) || [];
      const eduV = (((await bJson(B_EDU)) || {}).videos) || [];
      const liUsed = (((await bJson(B_LI)) || {}).used) || [];
      const manual = (((await bJson(B_MANUAL)) || {}).months) || {};
      // Publish product videos reads the uploader's own record (written automatically on every push).
      const sqLogRaw = await bJson('data/sq-video-log.json'); const sqLog = Array.isArray(sqLogRaw) ? sqLogRaw : [];
      // Blog creation reads LIVE from Shopify (published_status:any so future-SCHEDULED blogs count too).
      async function bBlogCounts() {
        const map = {};
        if (!B_DOMAIN || !B_TOKEN) return map;
        const gq = 'query{ articles(first:250, sortKey:PUBLISHED_AT, reverse:true, query:"blog_id:93572858142 published_status:any"){ edges{ node{ publishedAt } } } }';
        try {
          const r = await fetch('https://' + B_DOMAIN + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': B_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gq }) });
          if (!r.ok) return map;
          const d = await r.json();
          const edges = ((((d || {}).data || {}).articles || {}).edges) || [];
          edges.forEach(function (e) { const pm = (((e.node || {}).publishedAt) || '').slice(0, 7); if (pm) map[pm] = (map[pm] || 0) + 1; });
        } catch (e) {}
        return map;
      }
      const blogCounts = await bBlogCounts();

      function bYM(s) { return (s || '').slice(0, 7); }
      function bWeekdayCount(y, m, dow) { let c = 0; const d = new Date(Date.UTC(y, m - 1, 1)); while (d.getUTCMonth() === m - 1) { if (d.getUTCDay() === dow) c++; d.setUTCDate(d.getUTCDate() + 1); } return c; }
      function bDaysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

      const now = new Date();
      const curYM = now.toISOString().slice(0, 7);
      const nextYM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
      const monthSet = {};
      Object.keys(plan.months || {}).forEach(function (k) { monthSet[k] = 1; });
      monthSet[curYM] = 1; monthSet[nextYM] = 1;
      const months = Object.keys(monthSet).sort();

      const result = months.map(function (M) {
        const parts = M.split('-'); const Y = +parts[0], Mo = +parts[1];
        const days = ((plan.months[M] || {}).days) || [];
        const planN = days.length;
        let cvDone = 0; days.forEach(function (d) { const s = (d.sku || '').toString(); if (s && vstate['gen' + s + '_prompt']) cvDone++; });
        let reelDone = 0; days.forEach(function (d) { if (d.sent) reelDone++; });
        let blogDone = ublog.filter(function (x) { return bYM(x.usedDate) === M; }).length; if (planN && blogDone > planN) blogDone = planN;
        const eduDone = eduV.filter(function (v) { return bYM(v.liveAt) === M; }).length;
        const eduN = bWeekdayCount(Y, Mo, 3) || bWeekdayCount(Y, Mo, 1);
        const liDone = liUsed.filter(function (u) { return bYM(u.date) === M; }).length;
        const liN = bWeekdayCount(Y, Mo, 2);
        const blogTotal = bDaysInMonth(Y, Mo);
        let blogMadeDone = blogCounts[M] || 0; if (blogMadeDone > blogTotal) blogMadeDone = blogTotal;
        let pubVidDone = sqLog.filter(function (x) { return bYM(x.sentAt) === M; }).length; if (planN && pubVidDone > planN) pubVidDone = planN;
        const man = manual[M] || {};
        return {
          month: M, planN: planN,
          rows: {
            createVideos: { done: cvDone, total: planN },
            reels: { done: reelDone, total: planN },
            blogs: { done: blogDone, total: planN },
            igTag: { manual: true, done: man['ig-tag'] ? 1 : 0, total: 1 },
            tiktokPost: { manual: true, done: man['tiktok-posttag'] ? 1 : 0, total: 1 },
            edu: { done: eduDone, total: eduN },
            linkedin: { done: liDone, total: liN },
            blogCreation: { done: blogMadeDone, total: blogTotal },
            publishVideos: { done: pubVidDone, total: planN }
          }
        };
      });
      return res.status(200).json({ ok: true, months: result });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
