// api/etsy.js — AWA ETSY backend (OAuth + Tab 1 NEW PRODUCT)  ·  v0.12
// v0.12 (2026-10-13): TAB 1 built. Removed test actions (test-draft, apify-compare, apify-seedtest).
//   Kept OAuth (auth/status/tokenExchange/call) + diagnose. New actions:
//   tab1-load (Shopify product by custom.sku_for_print_files + By Room/Style/Colour from mega-menu + variants),
//   tab1-keywords (Apify axlymxp, ONE batched run, <=15 seeds), tab1-generate (Claude: title, 13 tags, description, attributes),
//   tab1-meta (Etsy: shop sections + taxonomy 1029 properties), tab1-publish (draft + inventory 513/514 + attributes),
//   tab1-image (uploads ONE Shopify image to the draft). Token refresh now also on 403 + when only refresh token left.
const crypto = require('crypto');

const KEY = process.env.ETSY_KEYSTRING;
const SECRET = process.env.ETSY_SHARED_SECRET;
const APIKEY = KEY + ':' + SECRET; // Etsy wants keystring:shared_secret in x-api-key
const REDIRECT = 'https://tools.aboutwallart.com/api/etsy';
const SCOPES = 'listings_r listings_w shops_r';
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';


// ================= TAB 1 DATA (from handovers/AWA-ETSY-project-2026-10-12.md) =================
const SHOP_ID = '25023670', TAXONOMY = '1029', READINESS = '1410830180137', SHIPPING = '113487783584', RETURNS = '1082803901616';
const APIFY_ACTOR = 'A5KKVgfRFWo268Ggi'; // axlymxp
const WALL_ART_TERMS = ['wall art', 'art prints', 'wall decor', 'wall hangings', 'wall prints', 'canvas prints', 'wall pictures', 'wall posters', 'canvas art', 'art decor'];
const ROOMS = ['Living room', 'Bedroom', 'Nursery', 'Teens', 'Bathroom', 'Kitchen', 'Dining room', 'Hallway', 'Office', 'Laundry room', 'Above fireplace', 'Games room'];
const ROOM_SYN = {
  'Living room': ['living room', 'lounge', 'sitting room', 'family room', 'snug'],
  'Bedroom': ['bedroom', 'above bed', 'over bed'],
  'Nursery': ['nursery', 'baby room', 'playroom', 'kids', 'childrens'],
  'Teens': ['teen', 'teens', 'teenage'],
  'Bathroom': ['bathroom', 'shower room', 'ensuite', 'en-suite', 'powder room', 'washroom', 'toilet'],
  'Kitchen': ['kitchen'],
  'Dining room': ['dining room', 'dining', 'breakfast room'],
  'Hallway': ['hallway', 'entryway', 'entrance', 'foyer', 'corridor', 'staircase'],
  'Office': ['office', 'study', 'workspace'],
  'Laundry room': ['laundry', 'utility room'],
  'Above fireplace': ['above fireplace', 'over fireplace', 'mantel', 'mantelpiece', 'fireplace'],
  'Games room': ['games room', 'game room', 'man cave']
};
const ROOM_TO_ETSY_ROOM = {
  'Living room': ['Entryway', 'Living room'], 'Bedroom': ['Bedroom'], 'Nursery': ['Kids', 'Nursery'], 'Teens': ['Kids'],
  'Bathroom': ['Bathroom', 'Laundry'], 'Kitchen': ['Kitchen & dining'], 'Dining room': ['Entryway', 'Kitchen & dining', 'Living room'],
  'Hallway': ['Entryway', 'Kitchen & dining', 'Living room'], 'Office': ['Office'], 'Laundry room': ['Bathroom', 'Laundry'],
  'Above fireplace': ['Entryway', 'Kitchen & dining', 'Living room'], 'Games room': ['Bar', 'Game room', 'Man cave']
};
const ROOM_TO_SECTION = {
  'Living room': 'Living room Wall Decor', 'Bedroom': 'Above bed Decor', 'Nursery': 'Baby Nursery Wall Decor', 'Teens': 'College Dorm Decor',
  'Bathroom': 'Bathroom Wall Decor', 'Kitchen': 'Kitchen Wall Decor', 'Office': 'Office Decor', 'Laundry room': 'Laundry room Wall Art'
  // Dining room / Hallway / Above fireplace / Games room: no section yet (Tab 4 creates them)
};
// style-owned shop sections (candidates only — Mae chooses). 🔴 style→section pairs are my mapping, not confirmed.
const STYLE_TO_SECTION = { 'Zen': 'Zen Decor', 'Islamic': 'Islamic Wall Art Decor', 'Farmhouse': 'Farmhouse Wall Decor', 'Coastal': 'Beach Themed Wall Decor', 'Christian': 'Modern Christian Art' };
const STYLE_SYN = {
  'Biophilic': ['biophilic', 'botanical', 'floral', 'plants', 'greenery', 'leaves', 'foliage', 'nature'],
  'Farmhouse': ['farmhouse', 'botanical', 'floral', 'rustic', 'country', 'barn'],
  'Shabby chic': ['shabby chic', 'floral', 'romantic'],
  'Vintage': ['vintage'],
  'Japandi': ['japandi', 'relax', 'relaxing', 'calm', 'calming', 'zen', 'japan', 'japanese', 'asian', 'oriental', 'chinese', 'wabi-sabi'],
  'Zen': ['zen', 'buddha', 'buddhist', 'buddhism', 'lotus', 'meditation'],
  'Scandinavian': ['scandinavian', 'scandi', 'nordic', 'forest', 'hygge'],
  'Travel': ['travel', 'map', 'maps', 'world', 'adventure', 'wanderlust'],
  'Christian': ['christian', 'faith', 'bible', 'scripture', 'cross', 'jesus', 'god'],
  'Islamic': ['islamic', 'islam', 'muslim', 'quran', 'arabic', 'arab', 'arabesque'],
  'Minimalism': ['minimalist', 'minimal', 'simple', 'clean'],
  'Masculine': ['masculine', 'male', 'manly', 'bold dark'],
  'Industrial': ['industrial', 'urban', 'loft', 'metal', 'concrete'],
  'Moroccan': ['moroccan', 'morocco', 'marrakech', 'arabesque'],
  'Abstract': ['abstract', 'geometric'],
  'Bohemian': ['bohemian', 'boho', 'hippie'],
  'Coastal': ['coastal', 'beach', 'sea', 'ocean', 'nautical', 'seaside'],
  'Tropical': ['tropical', 'palm', 'jungle', 'exotic'],
  'Wildlife': ['wildlife', 'animals', 'safari'],
  'Sun & moon': ['sun and moon', 'celestial', 'moon', 'stars'],
  'Black & white': ['black and white', 'monochrome'],
  'Coffee': ['coffee', 'coffee house', 'cafe'],
  'Chinoiserie': ['chinoiserie'],
  'Mid century': ['mid century', 'midcentury', 'retro', 'lux', 'luxury'],
  'Mediterranean': ['mediterranean', 'amalfi', 'positano', 'capri', 'cinque terre', 'riviera', 'santorini'],
  'Contemporary': ['contemporary', 'modern'],
  'Maximalism': ['maximalism', 'maximalist'],
  'French country': ['french country', 'provence', 'floral', 'florals', 'bees', 'hives', 'beehive'],
  'Old money': ['map', 'maps', 'earth', 'equestrian', 'horses', 'vintage'],
  'Marble': ['marble'], 'Eclectic': ['eclectic'], 'Country cottage': ['country cottage', 'cottagecore'], 'Preppy': ['preppy'], 'Transitional': ['transitional']
};
const MATERIALS_DEFAULT = ['Perspex', 'Wrapped canvas 260gsm', 'Satin photo paper 280gsm', 'Matte museum art paper 290gsm', 'MDF frame', 'Fade-resistant pigment inks'];

function stripHtml(h) { return String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function normT(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function sizeLabel(v) {
  const m = /^(A\d)\b/i.exec(v); if (m) return m[1].toUpperCase();
  const n = /(\d+)\s*x\s*(\d+)/i.exec(v); return n ? n[1] + 'x' + n[2] : String(v).slice(0, 20);
}
function frameLabel(v) { return String(v).replace(/\s*frame$/i, '').trim(); }
function parseJsonArr(v) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : [String(a)]; } catch { return v ? [String(v)] : []; } }

async function shopGQL(query, variables) {
  const SHOP = process.env.SHOPIFY_STORE_DOMAIN, STOK = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!SHOP || !STOK) throw new Error('Shopify no configurado en Vercel');
  const r = await fetch('https://' + SHOP + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': STOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
// By Room / By Style / By Colour leaves from the site mega-menu (SHOP WALL ART > group > collection leaves)
async function menuGroups() {
  const list = await shopGQL('query{ menus(first:20){ nodes{ id handle } } }');
  const hit = (list.menus.nodes || []).find(m => m.handle === 'new-mega-menu');
  if (!hit) throw new Error('Menú "new-mega-menu" no encontrado');
  const d = await shopGQL('query($id:ID!){ menu(id:$id){ items{ title items{ title resourceId items{ title resourceId } } } } }', { id: hit.id });
  const wa = (d.menu.items || []).find(t => normT(t.title) === 'shop wall art');
  const groups = {}; // 'by room' -> Map(gid -> leaf title)
  ((wa && wa.items) || []).forEach(g => {
    const m = new Map();
    (g.items || []).forEach(l => { if (l.resourceId) m.set(l.resourceId, l.title); });
    groups[normT(g.title)] = m;
  });
  return groups;
}
async function loadProduct(sku) {
  const gq = 'query($q:String!){ products(first:1, query:$q){ nodes{ id title handle tags productType descriptionHtml images(first:25){nodes{url}} collections(first:60){nodes{id title}} variants(first:100){nodes{sku price selectedOptions{name value}}} room:metafield(namespace:"custom",key:"room_type"){value} col:metafield(namespace:"custom",key:"primary_colour"){value} } } }';
  const d = await shopGQL(gq, { q: 'metafield:custom.sku_for_print_files:' + sku });
  const n = d.products.nodes[0];
  if (!n) return null;
  const groups = await menuGroups();
  const col = { room: [], style: [], colour: [], occasion: [] };
  (n.collections.nodes || []).forEach(c => {
    [['room', 'by room'], ['style', 'by style'], ['colour', 'by colour'], ['occasion', 'by occasion']].forEach(([k, g]) => { const m = groups[g]; if (m && m.has(c.id)) col[k].push(m.get(c.id)); });
  });
  const text = normT(n.title + ' ' + (n.tags || []).join(' '));
  // ROOM: By Room collection -> room_type metafield -> words in title/tags
  let rooms = ROOMS.filter(r => col.room.some(x => normT(x).includes(normT(r))));
  let roomFrom = 'colección By Room';
  if (!rooms.length) { rooms = ROOMS.filter(r => parseJsonArr(n.room && n.room.value).some(x => normT(x) === normT(r))); roomFrom = 'metafield room_type'; }
  if (!rooms.length) { rooms = ROOMS.filter(r => ROOM_SYN[r].some(w => text.includes(w))); roomFrom = 'título/tags'; }
  if (!rooms.length) roomFrom = 'no detectado';
  // STYLES: By Style collections + tags/title
  const styles = [];
  Object.keys(STYLE_SYN).forEach(s => {
    const inCol = col.style.some(x => normT(x) === normT(s) || normT(x).includes(normT(s)));
    const inText = text.includes(normT(s));
    if (inCol || inText) styles.push(s);
  });
  const colours = parseJsonArr(n.col && n.col.value);
  // variants: Satin paper + Canvas only (Paper is fixed on Etsy); Frame/Size short labels
  const variants = [];
  (n.variants.nodes || []).forEach(v => {
    const o = {}; v.selectedOptions.forEach(x => { o[x.name] = x.value; });
    const isCanvas = /canvas/i.test(o.Frame || '');
    if (!(isCanvas || /satin/i.test(o.Paper || ''))) return;
    variants.push({ frame: frameLabel(o.Frame || ''), size: sizeLabel(o.Size || ''), price: parseFloat(v.price) });
  });
  return {
    sku, id: n.id, title: n.title, handle: n.handle, tags: n.tags || [], productType: n.productType,
    description: stripHtml(n.descriptionHtml).slice(0, 3000),
    images: (n.images.nodes || []).map(i => i.url).slice(0, 20),
    collections: col, rooms, roomFrom, styles, colours, variants,
    styleSynonyms: STYLE_SYN, wallArtTerms: WALL_ART_TERMS, allRooms: ROOMS,
    roomToEtsyRoom: ROOM_TO_ETSY_ROOM, roomToSection: ROOM_TO_SECTION, styleToSection: STYLE_TO_SECTION, materialsDefault: MATERIALS_DEFAULT
  };
}
async function runApify(seeds) {
  const APIFY = process.env.APIFY_TOKEN;
  if (!APIFY) throw new Error('APIFY_TOKEN no está configurado en Vercel');
  const t0 = Date.now();
  const rr = await fetch('https://api.apify.com/v2/acts/' + APIFY_ACTOR + '/run-sync-get-dataset-items?token=' + APIFY + '&format=json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seedKeywords: seeds, maxKeywordsPerSeed: 25, includeCompetition: true, includeSeedRow: true, country: 'GB', currency: 'GBP' })
  });
  const items = await rr.json();
  if (!Array.isArray(items)) throw new Error('Apify respondió: ' + JSON.stringify(items).slice(0, 300));
  return { items, took_s: Math.round((Date.now() - t0) / 1000), status: rr.status };
}
async function claudeJSON(content, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no está configurado en Vercel');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 4000, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude API: ' + JSON.stringify(d).slice(0, 400));
  const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').replace(/```json\n?/g, '').replace(/```/g, '');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude no devolvió JSON');
  return JSON.parse(m[0]);
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function parseCookies(req) {
  const h = req.headers.cookie || ''; const o = {};
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}

async function tokenExchange(body) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KEY) { res.status(500).json({ ok: false, error: 'ETSY_KEYSTRING no está configurado en Vercel' }); return; }

  const q = req.query || {};
  const ck = parseCookies(req);

  // ---------- OAuth callback (Etsy redirects here with ?code=) ----------
  if (q.code) {
    if (!ck.etsy_state || q.state !== ck.etsy_state) { res.status(400).send('State no coincide. Volvé a conectar.'); return; }
    const ex = await tokenExchange({
      grant_type: 'authorization_code',
      client_id: KEY,
      redirect_uri: REDIRECT,
      code: q.code,
      code_verifier: ck.etsy_cv || ''
    });
    if (!ex.ok) { res.status(400).send('Error al obtener el token: ' + JSON.stringify(ex.json)); return; }
    const at = ex.json.access_token, rt = ex.json.refresh_token, expIn = ex.json.expires_in || 3600;
    res.setHeader('Set-Cookie', [
      cookie('etsy_at', at, expIn),
      cookie('etsy_rt', rt, 60 * 60 * 24 * 80),
      cookie('etsy_cv', '', 0),
      cookie('etsy_state', '', 0)
    ]);
    res.writeHead(302, { Location: '/awa-etsy.html?connected=1' });
    res.end();
    return;
  }

  // ---------- Start OAuth ----------
  if (q.action === 'auth') {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const url = 'https://www.etsy.com/oauth/connect?response_type=code'
      + '&client_id=' + encodeURIComponent(KEY)
      + '&redirect_uri=' + encodeURIComponent(REDIRECT)
      + '&scope=' + encodeURIComponent(SCOPES)
      + '&state=' + state
      + '&code_challenge=' + challenge
      + '&code_challenge_method=S256';
    res.setHeader('Set-Cookie', [cookie('etsy_cv', verifier, 600), cookie('etsy_state', state, 600)]);
    res.writeHead(302, { Location: url });
    res.end();
    return;
  }

  // ---------- Authenticated actions ----------
  let at = ck.etsy_at || '';
  const rt = ck.etsy_rt || '';

  if (q.action === 'status') { res.status(200).json({ ok: true, connected: !!at || !!rt }); return; }

  // ================= TAB 1 — PUBLIC ACTIONS (Shopify / Apify / Claude; no Etsy auth) =================
  if (q.action === 'tab1-load') {
    try {
      const sku = String(q.sku || '').trim();
      if (!sku) { res.status(400).json({ ok: false, error: 'Falta el SKU' }); return; }
      const p = await loadProduct(sku);
      if (!p) { res.status(404).json({ ok: false, error: 'No se encontró un producto con SKU print files = ' + sku }); return; }
      res.status(200).json({ ok: true, product: p });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-keywords') {
    try {
      const seeds = String(q.seeds || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 15);
      if (!seeds.length) { res.status(400).json({ ok: false, error: 'Faltan seeds' }); return; }
      const r = await runApify(seeds);
      const rows = r.items.filter(x => !x.is_seed).map(x => ({
        keyword: x.keyword, seed: x.seed_keyword, competing: x.competing_listings_count, level: x.competition_level,
        min: x.min_price, max: x.max_price, avg: x.avg_price, median: x.median_price
      })).filter(x => x.keyword);
      // unique keywords, ranked: lowest competition first (all come from Etsy autosuggest = real searches)
      const seen = new Set(); const uniq = [];
      rows.sort((a, b) => (a.competing == null ? 1e12 : a.competing) - (b.competing == null ? 1e12 : b.competing)).forEach(x => { const k = normT(x.keyword); if (!seen.has(k)) { seen.add(k); uniq.push(x); } });
      res.status(200).json({ ok: true, seeds, took_s: r.took_s, count: uniq.length, keywords: uniq });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-generate' && req.method === 'POST') {
    try {
      const b = req.body || {}; const p = b.product || {};
      const kws = (b.keywords || []).slice(0, 60).map(k => k.keyword + ' (' + (k.level || '?') + ', ' + (k.competing == null ? '?' : k.competing) + ' listings)').join('\n');
      const optLines = Object.keys(b.options || {}).map(n => '- "' + n + '": ' + (b.options[n] || []).slice(0, 80).join(' | ')).join('\n');
      const prompt = [
        'You write Etsy listings for About Wall Art (UK brand). The product is a SET OF 3 wall art pieces, made to order, printed in the UK, available unframed / framed (black, white, oak) / wrapped canvas, sizes A4-A2 and 20x30 in. Look at the product images to understand the real subject, colours, style and orientation.',
        '',
        'PRODUCT (from our store):',
        'Title: ' + p.title, 'Tags: ' + (p.tags || []).join(', '), 'Room: ' + (b.rooms || []).join(', '), 'Style(s): ' + (b.styles || []).join(', '), 'Colours: ' + (p.colours || []).join(', '),
        'Store description (for facts only, do not copy): ' + (p.description || '').slice(0, 1200),
        '', 'ETSY KEYWORD DATA (real Etsy searches with competition; prefer relevant, lower-competition ones):', kws,
        '', 'RULES — follow exactly:',
        '1) TITLE: max 140 chars, Title Case (NOT all caps), long but readable, keyword-rich WITHOUT stuffing/repeating. Lead with the keyword that best says WHAT it is. Include the room and the main colour. Position of keywords does not affect ranking.',
        '2) TAGS: EXACTLY 13, each <=20 characters, all UNIQUE, lowercase, never the same combination twice, no spelling mistakes. Each tag = a descriptor (use the keyword data) + a wall-art synonym as the noun. Spread these 10 synonyms across DIFFERENT tags (each used about once): wall art, art prints, wall decor, wall hangings, wall prints, canvas prints, wall pictures, wall posters, canvas art, art decor. Cover the 7 tag types across the 13: 1 descriptive (what it is) 2 materials/technique 3 for whom (gifts) 4 occasion 5 solution (empty wall...) 6 style (era/palette + what it is) 7 size. If a phrase is >20 chars split it into searchable chunks. Do not repeat exact category/attribute names as a tag (a multi-word tag that contains them is fine).',
        '3) DESCRIPTION: plain text. Relevant keywords in the FIRST sentences, natural, warm first-person brand voice (UK spelling), do NOT copy the title and do NOT list keywords. Mention: set of 3, printed in the UK on satin photo paper 280gsm, framed options in black/white/oak with perspex, or wrapped canvas, fade-resistant pigment inks, made to order, sizes. 120-220 words.',
        '4) WORDING: "art prints" is OK in title/description/tags. The word "poster"/"posters" ONLY in tags (never title/description). NEVER write "digital print" or "digital download". Say "perspex", never "acrylic". Never say "hand-painted".',
        '5) ATTRIBUTES: choose from the EXACT option lists below (copy the option text exactly). Only include a property if it clearly applies. Several values allowed only where the property is multi-valued (Occasion, Holiday, Room, Subject may take more than one if truly relevant, else one).',
        optLines,
        '', 'Return ONLY JSON: {"title":"...","tags":["13 tags"],"description":"...","attributes":{"<property name>":["<option>", ...]},"notes":"one short line about anything uncertain"}'
      ].join('\n');
      const content = [];
      (p.images || []).slice(0, 3).forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
      content.push({ type: 'text', text: prompt });
      const out = await claudeJSON(content, 4000);
      res.status(200).json({ ok: true, listing: out });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (!at && !rt) { res.status(401).json({ ok: false, error: 'No conectado. Tocá "Conectar con Etsy" primero.' }); return; }

  // call Etsy API with one auto-refresh on 401
  let refreshedCookie = null;
  async function call(path, opts) {
    const doFetch = (tok) => fetch(API + path, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'x-api-key': APIKEY, 'Authorization': 'Bearer ' + tok }, (opts && opts.headers) || {}),
      body: opts && opts.body
    });
    let r = null;
    if (!at && rt) r = { status: 401 };
    else r = await doFetch(at);
    if ((r.status === 401 || r.status === 403) && rt) {
      const ref = await tokenExchange({ grant_type: 'refresh_token', client_id: KEY, refresh_token: rt });
      if (ref.ok && ref.json.access_token) {
        at = ref.json.access_token;
        refreshedCookie = [cookie('etsy_at', at, ref.json.expires_in || 3600), cookie('etsy_rt', ref.json.refresh_token || rt, 60 * 60 * 24 * 80)];
        r = await doFetch(at);
      }
    }
    if (typeof r.json !== 'function') return { status: r.status, json: { error: 'Sesión de Etsy vencida. Tocá Reconectar.' } };
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  }
  function finish(status, payload) {
    if (refreshedCookie) res.setHeader('Set-Cookie', refreshedCookie);
    res.status(status).json(payload);
  }

  try {
    // ----- DIAGNOSE: reads that answer the missing info -----
    if (!q.action || q.action === 'diagnose') {
      const me = await call('/users/me');
      const shopId = me.json && me.json.shop_id;
      const out = { ok: true, me: me.json };
      if (!shopId) { finish(200, Object.assign(out, { note: 'users/me no devolvió shop_id' })); return; }

      const shop = await call('/shops/' + shopId);
      out.shop = { shop_id: shopId, shop_name: shop.json && shop.json.shop_name };

      // one sample active listing WITH its inventory
      const lst = await call('/shops/' + shopId + '/listings/active?limit=1&includes=Inventory');
      const sample = lst.json && lst.json.results && lst.json.results[0];
      if (sample) {
        out.sampleListing = {
          listing_id: sample.listing_id,
          title: sample.title,
          taxonomy_id: sample.taxonomy_id,
          price: sample.price,
          priceFieldsSeen: Object.keys(sample).filter(k => /price/i.test(k))
        };
        // inventory via its own endpoint → variation properties + per-offering prices
        const inv = await call('/listings/' + sample.listing_id + '/inventory');
        const prods = (inv.json && inv.json.products) || [];
        out.inventory = {
          status: inv.status,
          product_count: prods.length,
          variation_properties: prods[0] ? (prods[0].property_values || []).map(p => ({ property_id: p.property_id, name: p.property_name, scale: p.scale_name })) : null,
          sample_products: prods.slice(0, 4).map(p => ({
            sku: p.sku,
            variation: (p.property_values || []).map(v => v.property_name + ': ' + (v.values || []).join('/')),
            offerings: (p.offerings || []).map(o => ({ price: o.price, quantity: o.quantity }))
          }))
        };
        // taxonomy properties (Style / Occasion options) for this listing's category
        if (sample.taxonomy_id) {
          const props = await call('/seller-taxonomy/nodes/' + sample.taxonomy_id + '/properties');
          const allProps = (props.json && props.json.results ? props.json.results : []);
          out.supportsVariations = allProps.filter(p => p.supports_variations).map(p => p.display_name || p.name);
          out.taxonomyProperties = allProps.map(p => ({
            name: p.name,
            display_name: p.display_name,
            is_required: p.is_required,
            supports_variations: p.supports_variations,
            possible_values: (p.possible_values || []).map(v => v.name).slice(0, 60)
          }));
        }
      } else {
        out.sampleListing = 'No se encontró un listing activo (status ' + lst.status + ')';
      }
      finish(200, out);
      return;
    }

    // ----- raw listing read (for deeper look at regional price) -----
    if (q.action === 'listing' && q.listing_id) {
      const l = await call('/listings/' + q.listing_id + '?includes=Inventory');
      finish(200, { ok: true, listing: l.json });
      return;
    }

    // ----- taxonomy properties by id -----
    if (q.action === 'taxonomy' && q.taxonomy_id) {
      const props = await call('/seller-taxonomy/nodes/' + q.taxonomy_id + '/properties');
      finish(200, { ok: true, properties: props.json });
      return;
    }

    // ================= TAB 1 — ETSY ACTIONS =================
    // sections + taxonomy 1029 properties (ids + option lists) for the UI dropdowns
    if (q.action === 'tab1-meta') {
      const sec = await call('/shops/' + SHOP_ID + '/sections');
      const props = await call('/seller-taxonomy/nodes/' + TAXONOMY + '/properties');
      const list = (props.json && props.json.results) || [];
      finish(200, {
        ok: sec.status < 300 && props.status < 300,
        sections: ((sec.json && sec.json.results) || []).map(s => ({ id: s.shop_section_id, title: s.title })),
        properties: list.map(p => ({
          id: p.property_id, name: p.name, display: p.display_name, multi: !!p.is_multivalued, required: !!p.is_required,
          values: (p.possible_values || []).map(v => ({ id: v.value_id, name: v.name }))
        })),
        status: { sections: sec.status, props: props.status }
      });
      return;
    }

    // create DRAFT + inventory (Frame 513 / Size 514, price per combo) + attributes. Images go one-by-one via tab1-image.
    if (q.action === 'tab1-publish' && req.method === 'POST') {
      const b = req.body || {}; const steps = [];
      const title = String(b.title || '').trim();
      const tags = (b.tags || []).map(t => String(t).trim()).filter(Boolean).slice(0, 13);
      const variants = (b.variants || []).filter(v => v.frame && v.size && v.price > 0);
      if (!title || title.length > 140) { finish(400, { ok: false, error: 'Título vacío o de más de 140 caracteres' }); return; }
      if (!variants.length) { finish(400, { ok: false, error: 'No hay variantes con precio' }); return; }
      if (tags.some(t => t.length > 20)) { finish(400, { ok: false, error: 'Hay tags de más de 20 caracteres' }); return; }
      const minPrice = Math.min.apply(null, variants.map(v => Number(v.price)));
      const form = new URLSearchParams({
        quantity: '25', title, description: String(b.description || ''), price: minPrice.toFixed(2),
        who_made: 'i_did', when_made: 'made_to_order', taxonomy_id: TAXONOMY, type: 'physical',
        shipping_profile_id: SHIPPING, return_policy_id: RETURNS, readiness_state_id: READINESS,
        should_auto_renew: 'false', is_supply: 'false', is_personalizable: 'false'
      });
      if (tags.length) form.set('tags', tags.join(','));
      const mats = (b.materials || []).map(String).filter(Boolean);
      if (mats.length) form.set('materials', mats.join(','));
      if (b.section_id) form.set('shop_section_id', String(b.section_id));
      const cr = await call('/shops/' + SHOP_ID + '/listings', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const lid = cr.json && cr.json.listing_id;
      steps.push({ step: 'crear draft', status: cr.status, listing_id: lid, error: cr.status >= 300 ? cr.json : undefined });
      if (!lid) { finish(200, { ok: false, steps, error: 'No se pudo crear el draft' }); return; }

      const invBody = {
        products: variants.map(v => ({
          sku: String(b.sku || ''),
          property_values: [
            { property_id: 513, property_name: 'Frame', value_ids: [], values: [String(v.frame)], scale_id: null },
            { property_id: 514, property_name: 'Size', value_ids: [], values: [String(v.size)], scale_id: null }
          ],
          offerings: [{ price: Number(v.price), quantity: 25, is_enabled: true, readiness_state_id: Number(READINESS) }]
        })),
        price_on_property: [513, 514], quantity_on_property: [], sku_on_property: []
      };
      const inv = await call('/listings/' + lid + '/inventory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invBody) });
      steps.push({ step: 'variaciones + precios', status: inv.status, count: variants.length, error: inv.status >= 300 ? inv.json : undefined });

      const attrs = Array.isArray(b.attributes) ? b.attributes : [];
      for (const a of attrs) {
        if (!a.property_id || !(a.value_ids || []).length) continue;
        const f = new URLSearchParams({ value_ids: a.value_ids.join(','), values: (a.values || []).join(',') });
        const pr = await call('/shops/' + SHOP_ID + '/listings/' + lid + '/properties/' + a.property_id, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        steps.push({ step: 'atributo ' + (a.name || a.property_id), status: pr.status, error: pr.status >= 300 ? pr.json : undefined });
      }
      const failed = steps.filter(s => s.status >= 300);
      finish(200, { ok: !failed.length, listing_id: lid, steps, failed: failed.length });
      return;
    }

    // upload ONE image (from Shopify CDN) to the draft
    if (q.action === 'tab1-image' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id || !b.url) { finish(400, { ok: false, error: 'Falta listing_id o url' }); return; }
      if (!/^https:\/\/cdn\.shopify\.com\//.test(String(b.url))) { finish(400, { ok: false, error: 'La imagen debe venir de cdn.shopify.com' }); return; }
      const ir = await fetch(b.url);
      if (!ir.ok) { finish(200, { ok: false, error: 'No pude bajar la imagen de Shopify (' + ir.status + ')' }); return; }
      const buf = Buffer.from(await ir.arrayBuffer());
      const fd = new FormData();
      fd.append('image', new Blob([buf], { type: ir.headers.get('content-type') || 'image/jpeg' }), 'image-' + (b.rank || 1) + '.jpg');
      fd.append('rank', String(b.rank || 1));
      const up = await call('/shops/' + SHOP_ID + '/listings/' + b.listing_id + '/images', { method: 'POST', body: fd });
      finish(200, { ok: up.status < 300, status: up.status, error: up.status >= 300 ? up.json : undefined });
      return;
    }

    res.status(400).json({ ok: false, error: 'Acción desconocida: ' + q.action });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
