// api/etsy.js — AWA ETSY backend (OAuth + Tab 1 NEW PRODUCT)  ·  v0.27
// v0.27 (2026-10-18): new action tab1-suggest-seeds — Claude proposes 12-15 Etsy search seed phrases from the product
//   images + style, to add to the seeds before the Apify search (replaces doing it by hand in Gemini).
// v0.25 (2026-10-18): family batch — tab1-generate accepts siblingTitles; when present, the prompt tells the AI the
//   titles already used by family siblings and that this title MUST be clearly different (no SEO cannibalisation).
// v0.23 (2026-10-18): FIX — clean-apply PATCH now hits /shops/{shop_id}/listings/{id} (was /listings/{id} -> Etsy
//   "Resource not found"). updateListing is shop-scoped. (Front also removes the leftover workbook promo intro.)
// v0.21 (2026-10-18): Clean-listings logic (front) now removes whole PARAGRAPHS that contain off-platform content
//   (external link / email / ★★ / social / promo phrase), order-independent, and a second scan verifies 0 remain.
//   Backend tab-clean-list / tab-clean-apply unchanged (list + PATCH description + GitHub backup).
// v0.20 (2026-10-18): URGENT off-platform cleanup — removed the bitly/social/email lines from the fixed description
//   (Etsy "no off-platform" policy); new actions tab-clean-list + tab-clean-apply to strip that footer from ALL existing
//   listings (backs up each original description to data/etsy-desc-backup.json first). Also: Shopify load brings ALL
//   product images (removed the 20 cap, query first:50) so the photo picker can choose which to send.
// v0.19 (2026-10-17): whole UI translated to English + user-facing backend messages in English; photo picker in the
//   edit step (max 20, untick extras when a listing has more than 20 photos — only the ticked ones are sent).
// v0.18 (2026-10-17): description voice = advice not art-description (NPG gold-standard: everyday-verb opening, keyword
//   woven in, first-person adviser, never describe what's visible, banned flowery phrasing); related links show the
//   title on its own line with the URL below; structured "Materials" attribute auto-set to Acrylic/Paper/Wood (front).
// v0.17 (2026-10-17): Sent items — a FAILED delete no longer removes the item from the list (keeps it on refresh);
//   store the featured image with each sent item so the Sent tab can show a collapsed row that expands to a preview.
// v0.16 (2026-10-17): FIX regression — attributes send value_ids AND values again (Etsy requires both), with the
//   display text cleaned ("5:7 (ISO ratio)" -> "5:7") so aspect ratio isn't "malformed". Description voice = a real
//   friendly decor adviser (short natural sentences; banned catalogue/novel phrasing like "a sense of", "drama"...).
//   Added listings_d scope so Sent items "Borrar" can delete a draft (RECONNECT once after deploy to grant it).
// v0.15 (2026-10-17): title has NO colours (colours only in attributes); attributes sent with value_ids ONLY (fixes
//   "5:7 malformed" aspect ratio); friendlier fixed-text links (related listings show their title, one per line);
//   Sent Items stored in GitHub (list/add/delete actions) for the Sent tab. Front: Craft/attrs as removable pills +
//   "add" menu, "Can be personalized" preselected Yes, Sent Items tab + reset after send.
// v0.14 (2026-10-17): Batch A — #3 keywords balanced order (drop impossible, near-dead last); #4 tags REWRITTEN to <=20
//   before the UI shows them; #5 AI writes only the top of the description + fixed footer (section name/link + 4 random
//   related listings) appended at publish; #8 is_personalizable ON; #10 personalisation text box "Personalise your item"
//   (+£5, optional) via the personalization endpoint. (#6 Craft / #7 aspect ratio 5:7 auto-sent from the front.)
// v0.13 (2026-10-17): 4 publish fixes (never let Etsy reject a publish):
//   1. Materials sanitised to letters/numbers/spaces only + cleaned default list (no hyphen/gsm/museum).
//   2. Tags FORCED to <=20 chars (truncate at a word boundary) instead of rejecting the publish.
//   3. Variations: send the COMPLETE Frame x Size matrix — present combos enabled+priced, missing combos disabled.
//   4. Attribute value_ids coerced to positive integers; invalid ones dropped (fixes "5:7 malformed" aspect ratio).
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
const SCOPES = 'listings_r listings_w listings_d shops_r'; // listings_d = delete (needed to remove a draft from Sent items)
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';


// ================= TAB 1 DATA (from handovers/AWA-ETSY-project-2026-10-12.md) =================
const SHOP_ID = '25023670', TAXONOMY = '1029', READINESS = '1410830180137', SHIPPING = '113487783584', RETURNS = '1082803901616';
const APIFY_ACTOR = 'A5KKVgfRFWo268Ggi'; // axlymxp
// #14: Sent Items are stored in GitHub (shows on every computer; never localStorage).
const REPO = 'aboutwallart/seo-tools';
const SENT_PATH = 'data/etsy-sent-items.json';
const CLEAN_BACKUP_PATH = 'data/etsy-desc-backup.json'; // original descriptions, saved before the one-time off-platform cleanup
function ghHeaders() { return { 'Authorization': 'token ' + process.env.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'awa-etsy' }; }
async function ghGet(path) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path + '?ref=main&t=' + Date.now(), { headers: ghHeaders() });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error('GitHub get failed: ' + (await r.text()));
  const j = await r.json();
  return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}
async function ghPut(path, content, sha, message) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    method: 'PUT', headers: ghHeaders(),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha: sha || undefined, branch: 'main' })
  });
  if (!r.ok) { const t = await r.text(); const e = new Error('GitHub put failed: ' + t); e.status = r.status; throw e; }
  return true;
}
async function readSent() { try { const f = await ghGet(SENT_PATH); if (f.content) { const j = JSON.parse(f.content); return { items: Array.isArray(j) ? j : (j.items || []), sha: f.sha }; } } catch (e) {} return { items: [], sha: null }; }
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
const MATERIALS_DEFAULT = ['Perspex', 'Wrapped canvas', 'Satin photo paper', 'MDF frame', 'Fade resistant pigment inks'];
// Etsy Materials accept letters, numbers and spaces only (a hyphen -> "invalid characters").
// Sanitise each one: replace anything else with a space, collapse spaces, trim, cap at 45 chars.
function sanitizeMaterial(s) { return String(s || '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 45); }
// Force an Etsy tag to <=20 chars: trim, and if too long cut at the last space that still fits, else hard cut.
function clampTag(s) { var t = String(s || '').replace(/\s+/g, ' ').trim(); if (t.length <= 20) return t; var cut = t.slice(0, 20); var sp = cut.lastIndexOf(' '); return (sp >= 10 ? cut.slice(0, sp) : cut).trim(); }
// #4: guarantee every tag is <=20 chars by REWRITING (not cutting) the long ones with the AI, before the UI shows them.
async function ensureTagsUnder20(out) {
  for (let pass = 0; pass < 3; pass++) {
    const tags = Array.isArray(out.tags) ? out.tags.map(t => String(t || '').replace(/\s+/g, ' ').trim()) : [];
    out.tags = tags;
    const long = tags.filter(t => t.length > 20);
    if (!long.length) return;
    const ok = tags.filter(t => t.length > 0 && t.length <= 20);
    const fixPrompt = 'These Etsy tags are over 20 characters: ' + JSON.stringify(long) + '. For EACH, write a REPLACEMENT that keeps the same meaning and is a real Etsy search phrase (a descriptor + a wall-art synonym), MAXIMUM 20 characters INCLUDING SPACES. Never cut a word mid-way — rephrase with a shorter synonym instead. All replacements must be unique, lowercase, and must NOT duplicate any of these existing tags: ' + JSON.stringify(ok) + '. Return ONLY JSON: {"replacements":[{"old":"<old tag>","new":"<new tag, 20 chars or fewer>"}]}';
    let rep = [];
    try { const fix = await claudeJSON([{ type: 'text', text: fixPrompt }], 800); rep = Array.isArray(fix.replacements) ? fix.replacements : []; } catch (e) { /* keep going; final clamp guards */ }
    const map = {};
    rep.forEach(r => { if (r && r.old != null && r.new != null) map[String(r.old)] = String(r.new).replace(/\s+/g, ' ').trim(); });
    out.tags = tags.map(t => (t.length > 20 && map[t] && map[t].length <= 20 ? map[t] : t));
  }
  // last-resort guard (should never fire after 3 rewrite passes): clamp so the UI never shows a tag over 20.
  out.tags = (out.tags || []).map(t => clampTag(String(t || '')));
}
// #5: the common footer appended under every listing description. {SECTION}/{SECTION_LINK}/{RELATED} are filled at publish.
const SHOP_URL_NAME = 'AboutWallArt';
const FIXED_DESCRIPTION = [
  'Details:',
  '* Printed on premium satin photo paper (280gsm) for exceptional colour and clarity — wrapped canvas option also available.',
  '* We use fade-resistant pigment inks for bright colour that won\'t fade in sunlight.',
  '* For indoor use only.',
  '* White mounts are not included.',
  '* Choose your prints on their own, or add a frame in black, white or oak — so your set arrives ready to hang, with no hunting for frames to fit the size.',
  '',
  'About the frames:',
  '* Our frames come with a hanger and a strut, for freestanding or wall-hanging displays (landscape or portrait).',
  '* Made with a clear perspex front (for safety) and a matt-painted MDF frame, with a sturdy MDF backboard and strut.',
  '* Please note: the size you choose is the print size that fits the frame, not the overall outer size.',
  '',
  'Personalisation:',
  '* I can adapt the print to any size you wish.',
  '* I can also add a quote of your choice. Just message me!',
  '',
  'Care:',
  'If your print gathers any dust, wipe it gently with a clean, dry cloth.',
  '',
  'Packaging:',
  'All prints are delivered in protective packaging — A4 in a board envelope, A3 and above in a strong postal tube.',
  '',
  'FREE UK POSTAGE — we aim to ship all orders within 1-3 business days.',
  '',
  'Thank you for visiting and supporting our small business!',
  '',
  'See more in our {SECTION} collection:',
  '{SECTION_LINK}',
  '',
  'You may also like:',
  '{RELATED}',
  '',
  'AboutWallArt is a registered trademark. All rights reserved. Colours may vary slightly depending on your screen settings.',
  '',
  'Mae',
  'AboutWallArt'
].join('\n');
// Build the fixed footer with the Etsy section name/link + up to 4 random OTHER listings from the same section.
async function buildFixedDescription(call, sectionId, sectionTitle, excludeListingId) {
  let sectionLink = sectionId ? ('https://www.etsy.com/shop/' + SHOP_URL_NAME + '?section_id=' + sectionId) : ('https://www.etsy.com/shop/' + SHOP_URL_NAME);
  let related = '';
  if (sectionId) {
    try {
      const r = await call('/shops/' + SHOP_ID + '/listings/active?limit=100');
      const all = (r.json && r.json.results) || [];
      const inSection = all.filter(l => String(l.shop_section_id) === String(sectionId) && String(l.listing_id) !== String(excludeListingId));
      // shuffle, take up to 4
      for (let i = inSection.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = inSection[i]; inSection[i] = inSection[j]; inSection[j] = t; }
      // #17: one per line, with the listing TITLE in front of the link so buyers read what it is (not just an id).
      related = inSection.slice(0, 4).map(l => {
        const t = String(l.title || '').split('|')[0].trim();
        return (t ? '• ' + t + '\n' : '') + 'https://www.etsy.com/listing/' + l.listing_id;
      }).join('\n\n');
    } catch (e) { /* best effort: leave related empty */ }
  }
  return FIXED_DESCRIPTION
    .replace('{SECTION}', sectionTitle || 'About Wall Art')
    .replace('{SECTION_LINK}', sectionLink)
    .replace('{RELATED}', related);
}

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
  const gq = 'query($q:String!){ products(first:1, query:$q){ nodes{ id title handle tags productType descriptionHtml images(first:50){nodes{url}} collections(first:60){nodes{id title}} variants(first:100){nodes{sku price selectedOptions{name value}}} room:metafield(namespace:"custom",key:"room_type"){value} col:metafield(namespace:"custom",key:"primary_colour"){value} } } }';
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
    images: (n.images.nodes || []).map(i => i.url),
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
  if (!KEY) { res.status(500).json({ ok: false, error: 'ETSY_KEYSTRING is not set in Vercel' }); return; }

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
      if (!sku) { res.status(400).json({ ok: false, error: 'Missing SKU' }); return; }
      const p = await loadProduct(sku);
      if (!p) { res.status(404).json({ ok: false, error: 'No product found with print-files SKU = ' + sku }); return; }
      res.status(200).json({ ok: true, product: p });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-keywords') {
    try {
      const seeds = String(q.seeds || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 15);
      if (!seeds.length) { res.status(400).json({ ok: false, error: 'Missing seeds' }); return; }
      const r = await runApify(seeds);
      const rows = r.items.filter(x => !x.is_seed).map(x => ({
        keyword: x.keyword, seed: x.seed_keyword, competing: x.competing_listings_count, level: x.competition_level,
        min: x.min_price, max: x.max_price, avg: x.avg_price, median: x.median_price
      })).filter(x => x.keyword);
      // #3: balance demand/competition. Dedupe, drop the impossible (huge competition), push the near-dead (~0 listings)
      // to the bottom, and show medium-low competition first (every keyword is a real Etsy autosuggest search).
      const NEAR_DEAD = 10, IMPOSSIBLE = 100000;
      const seen = new Set(); const kept = [];
      rows.forEach(x => { const k = normT(x.keyword); if (!seen.has(k)) { seen.add(k); kept.push(x); } });
      const uniq = kept
        .map(x => ({ x, c: (x.competing == null ? Infinity : Number(x.competing)) }))
        .filter(o => o.c <= IMPOSSIBLE)
        .sort((a, b) => { const ad = a.c < NEAR_DEAD, bd = b.c < NEAR_DEAD; if (ad !== bd) return ad ? 1 : -1; return a.c - b.c; })
        .map(o => o.x);
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
        ...((b.siblingTitles || []).length ? [
          '', 'FAMILY — AVOID SEO CANNIBALISATION: this product is part of a family that shares the same keywords. These titles are ALREADY used by its siblings:',
          (b.siblingTitles || []).map(t => '- ' + t).join('\n'),
          'Your title MUST be clearly DIFFERENT from every title above — lead with a different keyword and use different phrasing, not a reordering of the same words. They must not compete with each other in search.'
        ] : []),
        '', 'RULES — follow exactly:',
        '1) TITLE: max 140 chars, Title Case (NOT all caps), long but readable, keyword-rich WITHOUT stuffing/repeating. Lead with the keyword that best says WHAT it is. Include the room. Do NOT put any colour words in the title (no "white", "black", "blue"...) — colours go ONLY in the attributes/SEO, never in the title. Position of keywords does not affect ranking.',
        '2) TAGS: EXACTLY 13, all UNIQUE, lowercase, never the same combination twice, no spelling mistakes. Each tag = a descriptor (use the keyword data) + a wall-art synonym as the noun. Spread these 10 synonyms across DIFFERENT tags (each used about once): wall art, art prints, wall decor, wall hangings, wall prints, canvas prints, wall pictures, wall posters, canvas art, art decor. Cover the 7 tag types across the 13: 1 descriptive (what it is) 2 materials/technique 3 for whom (gifts) 4 occasion 5 solution (empty wall...) 6 style (era/palette + what it is) 7 size. Do not repeat exact category/attribute names as a tag (a multi-word tag that contains them is fine). CRITICAL LENGTH RULE: every tag MUST be 20 characters or fewer INCLUDING SPACES. Count the characters of each tag before returning it. If a tag would be over 20, REWRITE it with a shorter synonym (e.g. "scandinavian wall art" = 21 -> "scandi wall art"; "nordic landscape decor" = 22 -> "nordic landscape"); NEVER return a tag over 20 and NEVER cut a word mid-way.',
        '3) DESCRIPTION: write ONLY the TOP part (about 120-170 words, 2 short paragraphs); a fixed block with materials/shipping/care/personalisation is added automatically BELOW, so do NOT write any of that. THIS IS ADVICE, NOT A DESCRIPTION OF THE ART — the buyer can already SEE the art in the photos, so NEVER describe what is visible (the scene, subject, colours, composition, figures, textures). Instead tell them what the photos do NOT show: what it adds to a room, the mood it creates, who and which rooms it suits, and real practical advice (how to style it; how to hang a set of 3 — same height, even gap of about 5-8 cm, centre around eye level ~145-150 cm). OPENING: begin the FIRST sentence with an everyday verb people actually say (Add, Bring, Give, Picture, Imagine, Hang, Make, Turn — vary it per product, never the same verb every time) with the keyword woven in NATURALLY; NEVER a keyword fragment followed by a dash. VOICE: a very warm, friendly UK interior-decor adviser talking to ONE person, first person (I/we), conversational, human, practical; short, varied, natural sentences; UK spelling. If it reads like AI or a spec sheet, it has FAILED. BANNED, never use: "a sense of", "evokes", "a feeling of", "drama", "dramatic", "a cohesive story", "tells a story", "rendered in", "punctuated by", "journey", "whisper", "dance", "symphony", "statement piece", "gracing", "adorn", "elevate", or stacks of flowery adjectives. Plain text, no headings.',
        '4) WORDING: "art prints" is OK in title/description/tags. The word "poster"/"posters" ONLY in tags (never title/description). NEVER write "digital print" or "digital download". Say "perspex", never "acrylic". Never say "hand-painted".',
        '5) ATTRIBUTES: choose from the EXACT option lists below (copy the option text exactly). Only include a property if it clearly applies. Several values allowed only where the property is multi-valued (Occasion, Holiday, Room, Subject may take more than one if truly relevant, else one).',
        optLines,
        '', 'Return ONLY JSON: {"title":"...","tags":["13 tags"],"description":"...","attributes":{"<property name>":["<option>", ...]},"notes":"one short line about anything uncertain"}'
      ].join('\n');
      const content = [];
      (p.images || []).slice(0, 3).forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
      content.push({ type: 'text', text: prompt });
      const out = await claudeJSON(content, 4000);
      await ensureTagsUnder20(out); // #4: rewrite (not cut) any tag over 20 chars BEFORE the UI shows it
      res.status(200).json({ ok: true, listing: out });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // Seed suggestions (before Apify): Claude proposes search seed phrases from the product + images.
  if (q.action === 'tab1-suggest-seeds' && req.method === 'POST') {
    try {
      const b = req.body || {}; const p = b.product || {};
      const prompt = [
        'You suggest Etsy SEARCH SEED phrases for About Wall Art (UK). The product is a SET OF 3 wall art pieces. Look at the images to understand the real subject, style and mood.',
        '',
        'PRODUCT:',
        'Title: ' + (p.title || ''), 'Style(s): ' + (b.styles || []).join(', '), 'Room: ' + (b.rooms || []).join(', '), 'Colours: ' + (p.colours || []).join(', '),
        '',
        'Suggest 12-15 SHORT seed phrases a shopper would TYPE into Etsy search to find art like this. Rules: 2-4 words each, lowercase, each MUST end with a wall-art noun ("wall art", "wall decor", "art prints" or "wall prints"). Base them on the subject / style / mood — NOT the room and NOT colours (those are handled separately in SEO). No duplicates, no punctuation.',
        '', 'Return ONLY JSON: {"seeds":["phrase", ...]}'
      ].join('\n');
      const content = [];
      (p.images || []).slice(0, 3).forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
      content.push({ type: 'text', text: prompt });
      const out = await claudeJSON(content, 800);
      const seeds = (out.seeds || []).map(s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
      res.status(200).json({ ok: true, seeds: seeds });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // #14: Sent Items list (GitHub-backed) — read + append. Delete lives in the Etsy actions (needs the Etsy call).
  if (q.action === 'tab1-sent-list') {
    try { const s = await readSent(); res.status(200).json({ ok: true, items: s.items }); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'tab1-sent-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.listing_id) { res.status(400).json({ ok: false, error: 'Missing listing_id' }); return; }
      const s = await readSent();
      const item = { listing_id: String(b.listing_id), sku: String(b.sku || ''), title: String(b.title || ''), section: String(b.section || ''), image: String(b.image || ''), ts: Date.now() };
      const items = [item].concat(s.items.filter(x => String(x.listing_id) !== item.listing_id)); // newest first, no dup
      await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: sent ' + item.sku + ' (' + item.listing_id + ')');
      res.status(200).json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (!at && !rt) { res.status(401).json({ ok: false, error: 'Not connected. Click "Connect Etsy" first.' }); return; }

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
    if (typeof r.json !== 'function') return { status: r.status, json: { error: 'Etsy session expired. Click Reconnect.' } };
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
        out.sampleListing = 'No active listing found (status ' + lst.status + ')';
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
      // FIX 2: force every tag to <=20 chars (never reject the publish) + drop empties/duplicates, max 13.
      const tags = [];
      for (const raw of (b.tags || [])) { const c = clampTag(raw); if (c && !tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c); if (tags.length >= 13) break; }
      const variants = (b.variants || []).filter(v => v.frame && v.size && v.price > 0);
      if (!title || title.length > 140) { finish(400, { ok: false, error: 'Title empty or over 140 characters' }); return; }
      if (!variants.length) { finish(400, { ok: false, error: 'No variants with a price' }); return; }
      const minPrice = Math.min.apply(null, variants.map(v => Number(v.price)));
      // #5: AI writes the TOP of the description; append the fixed footer (section name/link + related listings) under it.
      const fixedFooter = await buildFixedDescription(call, b.section_id, b.section_title, null);
      const description = (String(b.description || '').trim() + '\n\n' + fixedFooter).trim();
      const form = new URLSearchParams({
        quantity: '25', title, description, price: minPrice.toFixed(2),
        who_made: 'i_did', when_made: 'made_to_order', taxonomy_id: TAXONOMY, type: 'physical',
        shipping_profile_id: SHIPPING, return_policy_id: RETURNS, readiness_state_id: READINESS,
        should_auto_renew: 'false', is_supply: 'false', is_personalizable: 'true' // #8: personalisation ON
      });
      if (tags.length) form.set('tags', tags.join(','));
      // FIX 1: sanitise materials to letters/numbers/spaces only (a hyphen = Etsy "invalid characters"), unique, max 13.
      const mats = [...new Set((b.materials || []).map(sanitizeMaterial).filter(Boolean))].slice(0, 13);
      if (mats.length) form.set('materials', mats.join(','));
      if (b.section_id) form.set('shop_section_id', String(b.section_id));
      const cr = await call('/shops/' + SHOP_ID + '/listings', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const lid = cr.json && cr.json.listing_id;
      steps.push({ step: 'create draft', status: cr.status, listing_id: lid, error: cr.status >= 300 ? cr.json : undefined });
      if (!lid) { finish(200, { ok: false, steps, error: 'Couldn\'t create the draft' }); return; }

      // FIX 3: Etsy demands the COMPLETE matrix of every Frame x Size value in use.
      // Build the full cartesian: present combos enabled with their price; missing combos disabled (min price placeholder).
      const frames = [...new Set(variants.map(v => String(v.frame)))];
      const sizes = [...new Set(variants.map(v => String(v.size)))];
      const priceOf = {};
      variants.forEach(v => { priceOf[String(v.frame) + '||' + String(v.size)] = Number(v.price); });
      const products = [];
      frames.forEach(fr => sizes.forEach(sz => {
        const has = Object.prototype.hasOwnProperty.call(priceOf, fr + '||' + sz);
        products.push({
          sku: String(b.sku || ''),
          property_values: [
            { property_id: 513, property_name: 'Frame', value_ids: [], values: [fr], scale_id: null },
            { property_id: 514, property_name: 'Size', value_ids: [], values: [sz], scale_id: null }
          ],
          offerings: [{ price: has ? priceOf[fr + '||' + sz] : minPrice, quantity: 25, is_enabled: has, readiness_state_id: Number(READINESS) }]
        });
      }));
      const invBody = { products, price_on_property: [513, 514], quantity_on_property: [], sku_on_property: [] };
      const inv = await call('/listings/' + lid + '/inventory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invBody) });
      steps.push({ step: 'variations + prices', status: inv.status, count: products.length, enabled: variants.length, error: inv.status >= 300 ? inv.json : undefined });

      const attrs = Array.isArray(b.attributes) ? b.attributes : [];
      for (const a of attrs) {
        // Etsy requires BOTH value_ids AND values. Clean the display text (e.g. "5:7 (ISO ratio)" -> "5:7") so the
        // value isn't rejected as "malformed", but keep value_ids 1:1 with values.
        const ids = (a.value_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!a.property_id || !ids.length) continue;
        const vals = (a.values || []).map(v => String(v).replace(/\s*\([^)]*\)\s*$/, '').trim());
        const f = new URLSearchParams({ value_ids: ids.join(','), values: vals.join(',') });
        const pr = await call('/shops/' + SHOP_ID + '/listings/' + lid + '/properties/' + a.property_id, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        steps.push({ step: 'attribute ' + (a.name || a.property_id), status: pr.status, error: pr.status >= 300 ? pr.json : undefined });
      }
      // #10: personalisation text box with a +£5 add-on (optional) — buyer asks for a custom size or a quote.
      const persoBody = { personalization_questions: [{
        question_text: 'Personalise your item',
        instructions: 'Tell us a custom size or a quote to add. Leave blank when no customisation is required',
        question_type: 'text_input', required: false, add_on_price: 5.00, max_allowed_characters: 256
      }] };
      const perso = await call('/shops/' + SHOP_ID + '/listings/' + lid + '/personalization?supports_multiple_personalization_questions=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persoBody) });
      steps.push({ step: 'personalisation', status: perso.status, error: perso.status >= 300 ? perso.json : undefined });
      const failed = steps.filter(s => s.status >= 300);
      finish(200, { ok: !failed.length, listing_id: lid, steps, failed: failed.length });
      return;
    }

    // upload ONE image (from Shopify CDN) to the draft
    if (q.action === 'tab1-image' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id || !b.url) { finish(400, { ok: false, error: 'Missing listing_id or url' }); return; }
      if (!/^https:\/\/cdn\.shopify\.com\//.test(String(b.url))) { finish(400, { ok: false, error: 'The image must come from cdn.shopify.com' }); return; }
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

    // #14: delete a sent draft — removes it from Etsy AND from the GitHub list.
    if (q.action === 'tab1-sent-delete' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id) { finish(400, { ok: false, error: 'Missing listing_id' }); return; }
      const del = await call('/listings/' + b.listing_id, { method: 'DELETE' });
      const ok = del.status < 300 || del.status === 404;
      const s = await readSent();
      let items = s.items;
      // only remove from the list when Etsy actually deleted it — a failed delete must NOT lose the item.
      if (ok) { items = s.items.filter(x => String(x.listing_id) !== String(b.listing_id)); try { await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: delete ' + b.listing_id); } catch (e) {} }
      finish(200, { ok, status: del.status, items, error: ok ? undefined : del.json });
      return;
    }

    // ---- Clean listings: list all active+draft listings with their descriptions (for the off-platform cleanup) ----
    if (q.action === 'tab-clean-list') {
      const out = [];
      for (const state of ['active', 'draft']) {
        let offset = 0;
        for (let page = 0; page < 60; page++) {
          const r = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset);
          const results = (r.json && r.json.results) || [];
          results.forEach(l => out.push({ listing_id: l.listing_id, title: l.title, description: l.description || '', state }));
          if (results.length < 100) break;
          offset += 100;
        }
      }
      finish(200, { ok: true, count: out.length, listings: out });
      return;
    }
    // ---- Clean listings: apply new descriptions (backs up each original to GitHub first) ----
    if (q.action === 'tab-clean-apply' && req.method === 'POST') {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items : []; // [{listing_id, original, description}]
      if (!items.length) { finish(400, { ok: false, error: 'No items' }); return; }
      const bk = await ghGet(CLEAN_BACKUP_PATH);
      let backup = {}; try { if (bk.content) backup = JSON.parse(bk.content); } catch (e) {}
      const results = [];
      for (const it of items) {
        try {
          if (it.original != null && !(String(it.listing_id) in backup)) backup[String(it.listing_id)] = String(it.original);
          const f = new URLSearchParams({ description: String(it.description || '') });
          const up = await call('/shops/' + SHOP_ID + '/listings/' + it.listing_id, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
          results.push({ listing_id: it.listing_id, status: up.status, error: up.status >= 300 ? up.json : undefined });
        } catch (e) { results.push({ listing_id: it.listing_id, error: String(e.message || e) }); }
      }
      try { await ghPut(CLEAN_BACKUP_PATH, JSON.stringify(backup, null, 2), bk.sha, 'AWA ETSY: backup descriptions before cleanup (' + items.length + ')'); } catch (e) {}
      const failed = results.filter(r => r.error || (r.status && r.status >= 300));
      finish(200, { ok: !failed.length, updated: results.length - failed.length, failed: failed.length, results });
      return;
    }

    res.status(400).json({ ok: false, error: 'Unknown action: ' + q.action });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
