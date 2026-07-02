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
        'You write prompts for Kling AI image-to-video (image-to-video, about ' + seconds + ' seconds, vertical 9:16 reel).\n' +
        'You are given a START frame and an END frame for a wall-art product.\n' +
        'Product: "' + title + '"' + (room ? (' — room: ' + room) : '') + '.\n\n' +
        'Write ONE rich, detailed Kling prompt as a single flowing paragraph (about 150-210 words). Match the EXACT structure, specificity and phrasing of this gold-standard example — but describe what YOU actually see in the two supplied images:\n\n' +
        'GOLD-STANDARD EXAMPLE:\n' +
        '"The video features three men in their 30s in smart-casual clothes, same faces, same hair, same outfits throughout, sitting around a table in a moody games room on poker night. The video opens with them mid-game, holding cards, focused and grinning, the set of 3 pop prints (darts, aces, chess king) clearly visible on the wall behind them. Naturally and at a completely normal human pace, they transition into a big win/lose moment — one throwing his arms up, the others reacting and laughing, the wall art prints prominently visible behind them. Throughout the video they move naturally between these two moments — playing, reacting, laughing, leaning back — in a lively relaxed games-room rhythm. Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. They stay visible in frame at all times. The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible. Lighting: warm moody low light with a pendant over the table. Mood: fun, confident, masculine games-room lifestyle. Style: premium editorial home lifestyle."\n\n' +
        'Your prompt MUST include, in this order:\n' +
        '1. Who is in the frame: describe the person/people EXACTLY as in the images (number, approx age, clothing) and state "same faces, same hair, same outfits throughout".\n' +
        '2. The OPENING moment = the START image, and NAME the specific artwork on the wall as seen (e.g. subject of the prints), "clearly visible on the wall behind them".\n' +
        '3. "Naturally and at a completely normal human pace, they transition into" the SECOND moment = the END image, describing it, "the wall art prints prominently visible".\n' +
        '4. "Throughout the video they move naturally between these two moments" — list the beats — in a [room-appropriate] rhythm.\n' +
        '5. "Lip movement and natural facial expressions throughout. All movement completely natural and human — no slow motion, no floaty movement. They stay visible in frame at all times."\n' +
        '6. "The camera performs a very slow smooth dolly-in throughout, keeping the wall art prints sharp and visible."\n' +
        '7. "Lighting:" (from the image) "Mood:" (fitting the room) "Style: premium editorial home lifestyle."\n' +
        'Describe ONLY what is plausibly in the two images — never invent objects, people or art that are not there. If no person is visible, describe natural ambient motion (light, fabric, steam, a hand entering) instead, keeping every other rule.\n\n' +
        'Also write on-screen text (feeling only, NO product name, UK spelling, not salesy, no words like elevate/delve/showcase): one POETIC line and one RELATABLE line, each under 8 words.\n\n' +
        'Return ONLY strict JSON, no markdown: {"kling_prompt":"...","onscreen_poetic":"...","onscreen_relatable":"..."}';

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
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: content }] })
      });
      if (!ar.ok) return res.status(ar.status).json({ ok: false, error: 'Claude error: ' + (await ar.text()) });
      var ad = await ar.json();
      var txt = (ad.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      var jm = txt.match(/\{[\s\S]*\}/);
      var parsed = {};
      try { parsed = JSON.parse(jm ? jm[0] : txt); } catch (e) { return res.status(200).json({ ok: false, error: 'Could not parse AI output', raw: txt }); }
      return res.status(200).json({ ok: true, kling_prompt: parsed.kling_prompt || '', onscreen_poetic: parsed.onscreen_poetic || '', onscreen_relatable: parsed.onscreen_relatable || '' });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
