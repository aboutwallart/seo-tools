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

  async function ghGet(filePath) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (r.status === 404) return { content: null, sha: null };
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
      const { sha } = await ghGet(FILE);
      await ghPut(FILE, JSON.stringify(state, null, 2), sha, 'Update social video tick-state');
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

      var instructions =
        'You write ONE prompt for Kling AI image-to-video (about ' + seconds + ' seconds, vertical 9:16). You are given a START frame and an END frame for this wall-art product: "' + title + '"' + (room ? (' (room: ' + room + ')') : '') + '.\n\n' +
        'Produce the prompt by FILLING IN the [bracketed] parts of this EXACT template and keeping every other word VERBATIM — same sentences, same order, same connective phrases. Do NOT paraphrase, reorder, shorten or "improve" the wording. Output must be one flowing paragraph with no brackets left:\n\n' +
        'TEMPLATE:\n' +
        '"The video features [the person/people exactly as seen in the images: number, approx age, hair, clothing], same [face/faces], same hair, same [outfit/outfits] throughout, [brief scene/room context]. The video opens with [the START-frame moment], the [name the specific artwork/prints exactly as seen on the wall] clearly visible on the wall behind [her/him/them]. Naturally and at a completely normal human pace, [she/he/they] transition[s] into [the END-frame moment], the wall art prints prominently visible behind [her/him/them]. Throughout the video [she/he/they] move[s] naturally between these two moments — [4-5 short beats] — in a [adjective] [room] rhythm. Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. [She/He/They] stay[s] visible in frame at all times. The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible. Lighting: [describe the light in the images]. Mood: [fitting the room]. Style: premium editorial home lifestyle."\n\n' +
        'GOLD-STANDARD (this is the template filled in for a games-room poker video — match this exactly in structure and phrasing):\n' +
        '"The video features three men in their 30s in smart-casual clothes, same faces, same hair, same outfits throughout, sitting around a table in a moody games room on poker night. The video opens with them mid-game, holding cards, focused and grinning, the set of 3 pop prints (darts, aces, chess king) clearly visible on the wall behind them. Naturally and at a completely normal human pace, they transition into a big win/lose moment — one throwing his arms up, the others reacting and laughing, the wall art prints prominently visible behind them. Throughout the video they move naturally between these two moments — playing, reacting, laughing, leaning back — in a lively relaxed games-room rhythm. Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. They stay visible in frame at all times. The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible. Lighting: warm moody low light with a pendant over the table. Mood: fun, confident, masculine games-room lifestyle. Style: premium editorial home lifestyle."\n\n' +
        'Rules: fill ONLY the brackets, using what you actually SEE in the two images; keep all connective sentences word-for-word; the final sentence MUST be exactly "Style: premium editorial home lifestyle." Never invent people, art or objects that are not in the images. If no person is visible, replace the person with the ambient subject (light, fabric, steam, a hand entering) but keep the same sentence skeleton.\n\n' +
        'Then on-screen text. FIRST think of clearly DIFFERENT angles (a feeling, a relatable everyday thought, a gentle question, a first-person POV, a before/after, a cosy invitation, a quiet-luxury line, a playful line, a seasonal/mood line, a short punchy line). THEN write AT LEAST 10 on-screen text options, each under 8 words, feeling-only, NO product name, UK spelling, not salesy, no words like elevate/delve/showcase. Every option must be genuinely DIFFERENT — never ten versions of the same line; vary the wording, rhythm and angle so she has real choice.\n\n' +
        'Return ONLY strict JSON, no markdown: {"kling_prompt":"...","onscreen":["line 1","line 2", ... at least 10 distinct lines]}';

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
      var onscreen = Array.isArray(parsed.onscreen) ? parsed.onscreen.filter(function (x) { return x && x.toString().trim(); }) : [];
      return res.status(200).json({ ok: true, kling_prompt: parsed.kling_prompt || '', onscreen: onscreen });
    }

    if (action === 'get-cards') {
      const gh = await ghGet(CARDS_FILE);
      var data = { generated: {}, custom: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); data.generated = p.generated || {}; data.custom = p.custom || {}; } catch (e) {} }
      return res.status(200).json({ ok: true, generated: data.generated, custom: data.custom });
    }

    if (action === 'save-card') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      const gh = await ghGet(CARDS_FILE);
      var data = { generated: {}, custom: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); data.generated = p.generated || {}; data.custom = p.custom || {}; } catch (e) {} }
      data.generated[sku] = {
        prompt: body.prompt || '',
        onscreen: Array.isArray(body.onscreen) ? body.onscreen : [],
        seconds: body.seconds || 8,
        startImg: body.startImg || '',
        endImg: body.endImg || '',
        approved: true,
        savedAt: new Date().toISOString()
      };
      await ghPut(CARDS_FILE, JSON.stringify(data, null, 2), gh.sha, 'Save generated card ' + sku);
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
      const gh = await ghGet(CARDS_FILE);
      var data = { generated: {}, custom: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); data.generated = p.generated || {}; data.custom = p.custom || {}; } catch (e) {} }
      data.custom[card.sku] = card;
      await ghPut(CARDS_FILE, JSON.stringify(data, null, 2), gh.sha, 'Add custom card ' + card.sku);
      return res.status(200).json({ ok: true, card: card });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
