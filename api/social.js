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
      await ghPut(CARDS_FILE, JSON.stringify(data, null, 2), gh.sha, 'Save card ' + sku);
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove-card') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const sku = (body.sku || '').toString();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      const gh = await ghGet(CARDS_FILE);
      var data = { generated: {}, custom: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); data.generated = p.generated || {}; data.custom = p.custom || {}; } catch (e) {} }
      delete data.custom[sku];
      delete data.generated[sku];
      await ghPut(CARDS_FILE, JSON.stringify(data, null, 2), gh.sha, 'Remove card ' + sku);
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

    if (action === 'get-schedule') {
      const gh = await ghGet(SCHEDULE_FILE);
      var sched = { videos: [], state: {}, savedCaptions: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); sched.videos = p.videos || []; sched.state = p.state || {}; sched.savedCaptions = p.savedCaptions || {}; } catch (e) {} }
      return res.status(200).json({ ok: true, videos: sched.videos, state: sched.state, savedCaptions: sched.savedCaptions });
    }

    if (action === 'save-schedule') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const gh = await ghGet(SCHEDULE_FILE);
      var sched = { videos: [], state: {}, savedCaptions: {} };
      if (gh.content) { try { var p = JSON.parse(gh.content); sched.videos = p.videos || []; sched.state = p.state || {}; sched.savedCaptions = p.savedCaptions || {}; } catch (e) {} }
      if (body.state && typeof body.state === 'object') { sched.state = body.state; }
      if (body.savedCaptions && typeof body.savedCaptions === 'object') { sched.savedCaptions = body.savedCaptions; }
      await ghPut(SCHEDULE_FILE, JSON.stringify(sched, null, 2), gh.sha, 'Update schedule state');
      return res.status(200).json({ ok: true });
    }

    if (action === 'generate-caption') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const platform = (body.platform || '').toString().toLowerCase();
      const title = (body.title || '').toString().slice(0, 200);
      const room = (body.room || '').toString().slice(0, 60);
      const url = (body.url || '').toString();
      const campaign = (body.campaign || '').toString();
      var rules = {
        instagram: 'Instagram Reel caption: 1-3 short warm sentences + a soft CTA "tap the product tag to shop" (NO url, links do not work on IG). End with 5-8 relevant hashtags.',
        tiktok: 'TikTok caption: casual and short, lower-case is fine, one hook line + "tap to shop" (NO url). End with 3-5 hashtags.',
        facebook: 'Facebook caption: 1-2 warm sentences, then "Shop here → ' + (url ? (url + '?utm_source=facebook&utm_medium=video&utm_campaign=' + campaign) : '[link]') + '". 1-2 hashtags max.',
        x: 'X (Twitter) post: one short punchy line, then the link ' + (url ? (url + '?utm_source=twitter&utm_medium=video&utm_campaign=' + campaign) : '[link]') + '. No hashtags needed.',
        pinterest: 'Pinterest pin description: keyword-rich and descriptive of the look and the room (Pinterest is a search engine), 1-2 sentences a decorator would search for, then a soft CTA. NO url (the pin is already shoppable from the catalogue). 2-4 keyword hashtags.'
      };
      if (!rules[platform]) return res.status(400).json({ ok: false, error: 'Unknown platform: ' + platform });
      var instr =
        'You are a warm, friendly home-decor advisor writing ONE social caption for a wall-art product to post with its styled-in-room video. Product: "' + title + '"' + (room ? (' — room: ' + room) : '') + '.\n' +
        'Voice: like giving a friend genuine decor advice — warm, natural, specific, NOT salesy, UK spelling, no words like elevate/delve/showcase. Make it feel human and inviting.\n' +
        'Platform — ' + rules[platform] + '\n' +
        'Return ONLY strict JSON, no markdown: {"caption":"..."}';
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
      return res.status(200).json({ ok: true, caption: parsed.caption || '' });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
