// api/etsy.js — AWA ETSY backend (OAuth + API test harness)  ·  v0.7
// v0.7 (2026-10-12): diagnose taxonomyProperties now includes supports_variations (which Etsy attributes
//   can be used as a non-custom variation — the possible 3rd branch).
// v0.6 (2026-10-12): test-draft title lowercased (Etsy rejects titles with too many all-caps words).
// v0.5 (2026-10-12): create-draft needs readiness_state_id (physical listings). test-draft now reads it
//   from an existing listing's inventory offering and passes it to both the create and the inventory PUT.
// v0.4 (2026-10-12): action=test-draft — creates an INACTIVE draft listing + sets inventory with 3
//   variations (Frame/Size/Paper via custom props 513/514/515, max_variations_supported=3) to confirm
//   Etsy accepts a 3rd variation. Reports every step's raw status/response. Never touches live listings;
//   the draft stays inactive and its id is returned so Mae can delete it.
// v0.3 (2026-10-12): diagnose now fetches the sample listing's INVENTORY via /listings/{id}/inventory
//   (variation properties + per-offering prices → see Frame/Size/Paper structure and whether regional
//   prices live in offerings). includes=Inventory on getListingsByShop returned null, so we fetch it
//   from the inventory endpoint directly.
// v0.2 (2026-10-12): x-api-key header must be "keystring:shared_secret" on EVERY call (keystring alone →
//   403 "Shared secret is required in x-api-key header"). Now sends both.
// v0.1 (2026-10-12): First cut. Etsy Open API v3 OAuth 2.0 (PKCE) + diagnose/taxonomy/test-draft actions
//   to CHECK what the API allows before building the real tool. Token kept in httpOnly cookies (repo is
//   PUBLIC → never store the token in the repo). Write-test creates an INACTIVE draft only, never touches
//   live listings. Needs env: ETSY_KEYSTRING (client id) + ETSY_SHARED_SECRET. Redirect URI: /api/etsy.
const crypto = require('crypto');

const KEY = process.env.ETSY_KEYSTRING;
const SECRET = process.env.ETSY_SHARED_SECRET;
const APIKEY = KEY + ':' + SECRET; // Etsy wants keystring:shared_secret in x-api-key
const REDIRECT = 'https://tools.aboutwallart.com/api/etsy';
const SCOPES = 'listings_r listings_w shops_r';
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

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

  if (!at && !rt) { res.status(401).json({ ok: false, error: 'No conectado. Tocá "Conectar con Etsy" primero.' }); return; }

  // call Etsy API with one auto-refresh on 401
  let refreshedCookie = null;
  async function call(path, opts) {
    const doFetch = (tok) => fetch(API + path, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'x-api-key': APIKEY, 'Authorization': 'Bearer ' + tok }, (opts && opts.headers) || {}),
      body: opts && opts.body
    });
    let r = await doFetch(at);
    if (r.status === 401 && rt) {
      const ref = await tokenExchange({ grant_type: 'refresh_token', client_id: KEY, refresh_token: rt });
      if (ref.ok && ref.json.access_token) {
        at = ref.json.access_token;
        refreshedCookie = [cookie('etsy_at', at, ref.json.expires_in || 3600), cookie('etsy_rt', ref.json.refresh_token || rt, 60 * 60 * 24 * 80)];
        r = await doFetch(at);
      }
    }
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

    // ----- WRITE TEST: create inactive draft + 3 variations (safe; draft only) -----
    if (q.action === 'test-draft') {
      const steps = [];
      const me = await call('/users/me');
      const shopId = me.json && me.json.shop_id;
      steps.push({ step: 'me', status: me.status, shop_id: shopId });
      if (!shopId) { finish(200, { ok: false, steps }); return; }

      const sp = await call('/shops/' + shopId + '/shipping-profiles');
      const shipId = sp.json && sp.json.results && sp.json.results[0] && sp.json.results[0].shipping_profile_id;
      steps.push({ step: 'shipping-profiles', status: sp.status, picked: shipId, count: sp.json && sp.json.count });

      const rp = await call('/shops/' + shopId + '/policies/return');
      const retId = rp.json && rp.json.results && rp.json.results[0] && rp.json.results[0].return_policy_id;
      steps.push({ step: 'return-policies', status: rp.status, picked: retId, count: rp.json && rp.json.count });

      // readiness_state_id (processing profile) — Etsy requires it for physical listings. Grab it from an existing listing.
      let readiness = null;
      const lst0 = await call('/shops/' + shopId + '/listings/active?limit=1');
      const sampleId = lst0.json && lst0.json.results && lst0.json.results[0] && lst0.json.results[0].listing_id;
      if (sampleId) {
        const sinv = await call('/listings/' + sampleId + '/inventory');
        try { readiness = sinv.json.products[0].offerings[0].readiness_state_id; } catch (e) {}
      }
      steps.push({ step: 'readiness', from_listing: sampleId, readiness_state_id: readiness });

      const form = new URLSearchParams({
        quantity: '25',
        title: 'zzz test draft api check - safe to delete',
        description: 'Temporary draft created to test 3 variations via API. Inactive. Safe to delete.',
        price: '30.00',
        who_made: 'i_did',
        when_made: 'made_to_order',
        taxonomy_id: '1029',
        type: 'physical'
      });
      if (shipId) form.set('shipping_profile_id', String(shipId));
      if (retId) form.set('return_policy_id', String(retId));
      if (readiness) form.set('readiness_state_id', String(readiness));
      const cr = await call('/shops/' + shopId + '/listings', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const listingId = cr.json && cr.json.listing_id;
      steps.push({ step: 'create-draft', status: cr.status, listing_id: listingId, error: cr.status >= 300 ? cr.json : undefined });
      if (!listingId) { finish(200, { ok: false, note: 'No se pudo crear el draft (mirá create-draft)', steps }); return; }

      const invBody = {
        products: [
          { sku: '', offerings: [{ price: 30.0, quantity: 25, is_enabled: true, readiness_state_id: readiness || undefined }], property_values: [
            { property_id: 513, property_name: 'Frame', value_ids: [], values: ['Unframed'], scale_id: null },
            { property_id: 514, property_name: 'Size', value_ids: [], values: ['A4'], scale_id: null },
            { property_id: 515, property_name: 'Paper', value_ids: [], values: ['Satin photo paper'], scale_id: null }
          ] },
          { sku: '', offerings: [{ price: 41.0, quantity: 25, is_enabled: true, readiness_state_id: readiness || undefined }], property_values: [
            { property_id: 513, property_name: 'Frame', value_ids: [], values: ['Framed'], scale_id: null },
            { property_id: 514, property_name: 'Size', value_ids: [], values: ['A3'], scale_id: null },
            { property_id: 515, property_name: 'Paper', value_ids: [], values: ['Matte museum art paper'], scale_id: null }
          ] }
        ],
        price_on_property: [], quantity_on_property: [], sku_on_property: []
      };
      const inv = await call('/listings/' + listingId + '/inventory?max_variations_supported=3', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invBody) });
      steps.push({ step: 'set-inventory-3var', status: inv.status, result: inv.status < 300 ? '3 variaciones ACEPTADAS' : inv.json });
      finish(200, { ok: inv.status < 300, three_variations_accepted: inv.status < 300, listing_id_to_delete: listingId, steps });
      return;
    }

    res.status(400).json({ ok: false, error: 'Acción desconocida: ' + q.action });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
