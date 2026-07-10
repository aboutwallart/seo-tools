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

      var out = [H.join(',')];
      var usedToMark = [];

      for (var mi = 0; mi < posts.length; mi++) {
        var p = posts[mi];
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
        var ar = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: instr }] }) });
        if (!ar.ok) return res.status(ar.status).json({ ok: false, error: 'Caption AI error for ' + sku });
        var ad = await ar.json();
        var txt = (ad.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
        var jm = txt.match(/\{[\s\S]*\}/); var caps = {};
        try { caps = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not parse captions for ' + sku }); }
        var alt = caps.alt || (title + ' styled in a ' + room + ' room');

        var mk = function (net) { var o = { Date: date, Draft: true, Shortener: true, 'Picture Url 1': video, 'Alt text picture 1': alt, 'Video Thumbnail Url': image }; o[net] = true; return o; };
        var rTw = mk('Twitter/X'); rTw.Time = '10:00:00'; rTw['Twitter/X Type'] = 'POST'; rTw.Text = caps.twitter; out.push(rowLine(rTw));
        var rFb = mk('Facebook'); rFb.Time = '10:00:00'; rFb['Facebook Post Type'] = 'REEL'; rFb['Facebook Title'] = caps.facebookTitle || title; rFb.Text = caps.facebook; out.push(rowLine(rFb));
        var rYt = mk('Youtube'); rYt.Time = '10:00:00'; rYt['Youtube Video Title'] = caps.youtubeTitle || title; rYt['Youtube Video Type'] = 'SHORT'; rYt['Youtube Video Privacy'] = 'PUBLIC'; rYt.Text = caps.youtube; out.push(rowLine(rYt));
        var rTh = mk('Threads'); rTh.Time = '11:00:00'; rTh['Threads Reply Control'] = 'EVERYONE'; rTh['Threads Post Type'] = 'POST'; rTh.Text = caps.threads; out.push(rowLine(rTh));
        var rPi = mk('Pinterest'); rPi.Time = '11:00:00'; rPi['Pinterest Board'] = board; rPi['Pinterest Pin Title'] = caps.pinterestTitle || title; rPi['Pinterest Pin Link'] = shop('pinterest', 'video'); rPi.Text = caps.pinterest; out.push(rowLine(rPi));
        var rIg = mk('Instagram'); rIg.Time = '11:00:00'; rIg['Instagram Post Type'] = 'REEL'; rIg['Instagram Show Reel On Feed'] = true; rIg.Text = caps.instagram; out.push(rowLine(rIg));

        usedToMark.push({ sku: sku, name: title, room: room, usedMonth: month });
      }

      var csv = '﻿' + out.join('\r\n') + '\r\n';

      if (usedToMark.length) {
        await ghSave(USED_FILE, function (content) {
          var doc = { used: [] };
          if (content) { try { doc = JSON.parse(content); if (!Array.isArray(doc.used)) doc.used = []; } catch (e) { doc = { used: [] }; } }
          usedToMark.forEach(function (u) { if (!doc.used.some(function (x) { return (x.sku || '').toUpperCase() === u.sku.toUpperCase(); })) doc.used.push(u); });
          return JSON.stringify(doc, null, 2);
        }, 'Mark used from Metricool file');
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

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
