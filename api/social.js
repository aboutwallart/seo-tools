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
          var bUrl = BLOG_BASE + bh;
          var blink = function (src) { return bUrl + '?utm_source=' + src + '&utm_medium=blog&utm_campaign=' + bh; };
          var topicBoard = boardForText(artText(blog));
          var balt = bc.alt || bTitle;
          var gmbText = (bc.gmb || bTitle).slice(0, 1400).replace(/\s+$/, '') + '\n\nRead more → ' + blink('gmb');
          if (gmbText.length > 1500) gmbText = gmbText.slice(0, 1500);
          var gmbImg = bImg ? (bImg + (bImg.indexOf('?') >= 0 ? '&' : '?') + 'format=jpg') : '';
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
        var ad = await shopGql('query($q:String!,$n:Int!){ articles(first:$n, query:$q){ edges{ node{ title handle publishedAt isPublished image{url} tags } } } }', { q: 'blog_id:93572858142', n: 120 });
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
      return res.status(200).json({ ok: true, season: season, activeOccasions: activeOcc.map(function (o) { return o.name; }), blogs: blogs, pages: pages });
    }

    if (action === 'edu-products') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sourceType = (body.sourceType || 'blog').toString();
      const handle = (body.handle || '').toString().trim();
      if (!handle) return res.status(400).json({ ok: false, error: 'Missing source handle' });
      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) return res.status(500).json({ ok: false, error: 'Shopify not configured' });

      var bodyHtml = '', productGids = [], sourceTitle = handle, sourceTags = [];
      if (sourceType === 'page') {
        try {
          var pr2 = await fetch('https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/api/2025-01/pages.json?limit=250&fields=id,title,handle,body_html', { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN } });
          if (pr2.ok) { var pj2 = await pr2.json(); var pg2 = (pj2.pages || []).filter(function (p) { return (p.handle || '').toLowerCase() === handle.toLowerCase(); })[0]; if (pg2) { bodyHtml = pg2.body_html || ''; sourceTitle = pg2.title || handle; } }
        } catch (e) {}
      } else {
        try {
          var ad2 = await shopGql('query($q:String!){ articles(first:5, query:$q){ edges{ node{ handle title tags body ctl:metafield(namespace:"custom",key:"blog_products_list"){value} } } } }', { q: 'blog_id:93572858142 handle:' + handle });
          var a2 = (ad2 && ad2.data && ad2.data.articles && ad2.data.articles.edges) || [];
          var nodes2 = a2.map(function (e) { return e.node; });
          var art = nodes2.filter(function (n) { return (n.handle || '').toLowerCase() === handle.toLowerCase(); })[0] || nodes2[0];
          if (art) {
            bodyHtml = art.body || '';
            sourceTitle = art.title || handle;
            sourceTags = art.tags || [];
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

      // top up to at least 5 with theme-matched products
      if (products.length < 5) {
        var word = themeWord((sourceTitle || '') + ' ' + (Array.isArray(sourceTags) ? sourceTags.join(' ') : ''));
        if (word) {
          try {
            var td3 = await shopGql('query($q:String!){ products(first:40, query:$q){ nodes{ ' + PRODUCT_FIELDS + ' } } }', { q: 'title:*' + word + '*' });
            ((td3 && td3.data && td3.data.products && td3.data.products.nodes) || []).forEach(function (n) { if (products.length < 10) pushNode(n); });
          } catch (e) {}
        }
      }

      return res.status(200).json({ ok: true, sourceTitle: sourceTitle, products: products });
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
      var topic = ((srcTitle || '') + ' ' + (Array.isArray(srcTags) ? srcTags.join(' ') : '')).toLowerCase();
      var prodList = selProducts.map(function (p, i) { return (i + 1) + '. sku "' + (p.sku || '') + '" — "' + (p.title || '') + '"'; }).join('\n');

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
        'SELECTED PRODUCTS (use ONLY these, on the wall-art / finishing-touches scenes; one product per such scene):\n' + (prodList || '(none)') + '\n\n' +
        'SCRIPT RULES (the voice is everything):\n' +
        '- Warm, human, first-person home-decor advisor talking to a friend. Personal little asides and gentle tips ("my favourite style", "a little tip I love", "if you\'re forgetful like me", "take care not to..."). Calm, plain-spoken, NEVER salesy or poetic-brochure.\n' +
        '- UK spelling. NEVER use: elevate, delve, showcase, dive, beacon, embrace, unleash, "in conclusion", "look no further".\n' +
        '- ONE short phrase per scene (max ~2 short lines each). About ' + targetScenes + ' content scenes.\n' +
        '- Scene text must come from the source content; the FIRST field videoTitle is a warm question or hook (e.g. "How to...?").\n' +
        '- Do NOT write the closing/outro — it is appended automatically.\n\n' +
        'IMAGE PROMPT RULES (one per scene; each ILLUSTRATES its own scene text — educational, never an unrelated action):\n' +
        '- Photoreal lifestyle photography, high resolution, soft natural daylight, airy and calm, bright minimalist base with the blog\'s style details, NO text/logos/watermarks.\n' +
        '- People: a person present by default; use a COUPLE (a man and a woman) for bedroom/romantic scenes, a CHILD or BABY with a parent or both parents for nursery/kids scenes, FRIENDS for entertaining/social scenes, and a FAMILY INCLUDING OLDER RELATIVES for festive/occasion scenes. Vary ethnicity genuinely across the set (a real mix, not always white). Do NOT depict gay, lesbian or transgender couples.\n' +
        '- COLOUR or MATERIAL scenes: the person is actively CHOOSING — holding/comparing swatches, palettes or material samples.\n' +
        '- PRODUCT scenes (wall art / finishing touches): set "aspect":"square" and "productSku" to the chosen product\'s sku from the list; the image places the real framed art faithfully on the wall, the person in plain neutral clothing, the art stays the focus.\n' +
        '- All other scenes: "aspect":"16:9", "productSku":"".\n' +
        '- Also write a single "hero" paragraph for scene 1: the opening/thumbnail shot inspired by the source. (Scene 1 is later generated as 5 VARIATIONS of this SAME shot — same room, styling and composition; only the person or their position changes — so describe ONE strong scene, not several different ones.)\n\n' +
        'Return ONLY strict JSON, no markdown:\n' +
        '{"videoTitle":"...","hero":"...","scenes":[{"text":"...","aspect":"16:9","productSku":"","image":"..."}]}';

      var ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] })
      });
      if (!ar.ok) return res.status(ar.status).json({ ok: false, error: 'Claude error: ' + (await ar.text()) });
      var ad4 = await ar.json();
      var txt = (ad4.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      var jm = txt.match(/\{[\s\S]*\}/); var parsed;
      try { parsed = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not read the AI output — try again.', raw: txt.slice(0, 600) }); }

      var videoTitle = (parsed.videoTitle || srcTitle || '').toString().trim();
      var hero = (parsed.hero || '').toString().trim();
      var scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      var skuTitle = {}; selProducts.forEach(function (p) { if (p.sku) skuTitle[p.sku.toUpperCase()] = p.title || ''; });

      // SCRIPT text = title + one phrase per scene + the fixed 5 outro lines
      var scriptLines = [videoTitle];
      scenes.forEach(function (s) { var t = (s && s.text ? s.text : '').toString().trim(); if (t) scriptLines.push(t); });
      var scriptText = scriptLines.join('\n\n') + '\n\n' + OUTRO.join('\n\n');

      // IMAGE-PROMPT output = numbered scenes ONLY (the brief lives in her Shopify AI skill).
      // Scene 1 = the hero (5 variations of the SAME shot). Product scenes tagged [SQUARE] → product = "…".
      var lines = ['1. [16:9] MAIN HERO IMAGE — 5 OPTIONS (5 variations of this SAME shot: same room, styling and composition; change only the person or their position). ' + hero];
      var num = 2;
      scenes.forEach(function (s) {
        var isProd = s && s.productSku && skuTitle[(s.productSku || '').toUpperCase()];
        var aspect = (isProd || (s && s.aspect === 'square')) ? '[SQUARE]' : '[16:9]';
        var line = num + '. ' + aspect + ' ' + ((s && s.image ? s.image : '').toString().trim());
        if (isProd) line += ' → product = "' + skuTitle[(s.productSku || '').toUpperCase()] + '"';
        lines.push(line);
        num++;
      });
      var imagePromptBlock = lines.join('\n');
      // small copyable batches for Shopify AI: hero alone, then groups of 3
      var promptBatches = [lines[0]];
      for (var bi = 1; bi < lines.length; bi += 3) { promptBatches.push(lines.slice(bi, bi + 3).join('\n')); }

      var payload = {
        blogHandle: handle, sourceType: sourceType, blogTitle: srcTitle,
        blogUrl: (sourceType === 'page' ? 'https://aboutwallart.com/pages/' + handle : EDU_BLOG_BASE + handle),
        videoTitle: videoTitle, seconds: seconds, sceneCount: scenes.length,
        script: scriptText, hero: hero, scenes: scenes, outro: OUTRO,
        imagePromptBlock: imagePromptBlock, promptBatches: promptBatches, products: selProducts
      };
      return res.status(200).json({ ok: true, videoTitle: videoTitle, script: scriptText, imagePromptBlock: imagePromptBlock, promptBatches: promptBatches, sceneCount: scenes.length, payload: payload });
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
      try {
        var ar = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content: aiPrompt }] }) });
        if (ar.ok) { var adj = await ar.json(); var t = (adj.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n'); var mm = t.match(/\{[\s\S]*\}/); ai = JSON.parse(mm ? mm[0] : t); }
      } catch (e) { ai = {}; }

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
        thumbnailNote: 'Thumbnail: in Adobe Express, open your hero scene → Download → JPG. That is your YouTube thumbnail (no separate grab needed).'
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

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
