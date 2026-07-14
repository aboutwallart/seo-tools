// shopify-video.js — v1.2 (14 Jul 2026)
// v1.2: (1) manual SKU fixes are saved to data/sq-video-overrides.json and re-applied on
//       every load (action 'manual-match'). (2) push accepts a `replace` flag that first
//       removes any existing video(s) on the product, then pushes the new one.
// v1.1: "sent" state comes ONLY from the github log (videos pushed by this tool), verified
//       against the live product. A pre-existing/different video is left alone (2 videos).
// Backend for the Shopify Video Uploader tool.
// Pushes square videos from the Google Drive folder "SHOPIFY SQ VIDEOS" to the
// correct Shopify product as a Video, placed at position 2. No local storage.
//
// Actions:
//   GET  ?action=list                                   -> list Drive videos, match to products, sent-state
//   GET  ?action=match&sku=XXX                          -> match one (manually typed) SKU to a product
//   POST { action:'push', fileId, fileName, productId } -> download from Drive, upload as VIDEO, move to slot 2
//   POST { action:'undo', productId, videoId }          -> remove that video from the product (resend later)
//
// Matching: video filename -> SKU (everything before the first space, UPPERCASED) ->
//           product whose variant-SKU prefix matches, verified by the custom.sku_for_print_files metafield.
//           (Shopify silently ignores a direct metafield search, so we match on the variant SKU prefix.)
//
// Drive access: a Google Apps Script web app over the "SHOPIFY SQ VIDEOS" folder (runs as mae).
//   >>> After you deploy the script, paste its /exec URL into SQ_VIDEOS_URL below
//       (or set a Vercel env var SQ_VIDEOS_URL). <<<

const SQ_VIDEOS_URL = process.env.SQ_VIDEOS_URL || 'https://script.google.com/macros/s/AKfycbzpuelyoe4gnuQa1zZsuPOcYWWRjNyvjf-L9ECm_J5EVH2-WJQF7wo9jI2mPbI4HtO1/exec';
const SQ_VIDEOS_KEY = process.env.SQ_VIDEOS_KEY || 'awa-sqvideos-2026';

const REPO = 'aboutwallart/seo-tools';
const LOG_FILE = 'data/sq-video-log.json';
const OVERRIDES_FILE = 'data/sq-video-overrides.json'; // saved manual SKU fixes (fileId -> sku)
const API_VERSION = '2025-01';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!shopifyDomain || !accessToken) return res.status(500).json({ ok: false, error: 'Shopify credentials not configured' });

  const gqlUrl = `https://${shopifyDomain}/admin/api/${API_VERSION}/graphql.json`;

  async function shopify(query, variables) {
    const r = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query, variables })
    });
    const d = await r.json();
    if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
    return d.data;
  }

  // ---- GitHub "sent" log (missing file = empty log, self-healing) ----
  async function logGet() {
    if (!GITHUB_TOKEN) return { entries: [], sha: null };
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${LOG_FILE}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return { entries: [], sha: null };
    const d = await r.json();
    let entries = [];
    try { entries = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) { entries = []; }
    if (!Array.isArray(entries)) entries = [];
    return { entries, sha: d.sha };
  }
  async function logPut(entries, sha, message) {
    if (!GITHUB_TOKEN) return;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${LOG_FILE}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(entries, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
    });
  }

  // ---- Saved manual SKU fixes (survive reloads): [{fileId, fileName, sku}] ----
  async function overridesGet() {
    if (!GITHUB_TOKEN) return { arr: [], map: {}, sha: null };
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDES_FILE}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return { arr: [], map: {}, sha: null };
    const d = await r.json();
    let arr = [];
    try { arr = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const map = {};
    arr.forEach(o => { if (o && o.fileId && o.sku) map[o.fileId] = String(o.sku).toUpperCase(); });
    return { arr, map, sha: d.sha };
  }
  async function overridesPut(arr, sha, message) {
    if (!GITHUB_TOKEN) return;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDES_FILE}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(arr, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
    });
  }

  function skuFromName(name) {
    return String(name || '').split(' ')[0].replace(/\.[^.]+$/, '').trim().toUpperCase();
  }

  // Match a SKU -> product via variant-SKU prefix, verified by the print-SKU metafield.
  async function matchSku(sku) {
    const data = await shopify(`
      query($q: String!) {
        products(first: 10, query: $q) {
          edges { node {
            id title handle onlineStoreUrl
            metafield(namespace: "custom", key: "sku_for_print_files") { value }
            media(first: 50) { edges { node { mediaContentType ... on Video { id status } } } }
          } }
        }
      }`, { q: `sku:${sku}` });
    const nodes = ((data.products && data.products.edges) || []).map(e => e.node);
    let node = nodes.find(n => n.metafield && String(n.metafield.value).trim().toUpperCase() === sku);
    if (!node && nodes.length === 1) node = nodes[0]; // single unambiguous hit
    if (!node) return null;
    const videos = node.media.edges.map(e => e.node).filter(n => n.mediaContentType === 'VIDEO');
    return {
      productId: node.id,
      title: node.title,
      handle: node.handle,
      url: node.onlineStoreUrl || `https://aboutwallart.com/products/${node.handle}`,
      metafieldSku: node.metafield ? node.metafield.value : null,
      hasVideo: videos.length > 0,      // product has ANY video (informational)
      videoIds: videos.map(v => v.id)   // all video ids currently on the product
    };
  }

  async function driveDownload(fileId) {
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { redirect: 'follow' });
    if (!r.ok) throw new Error('Drive download failed: ' + r.status);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }

  async function getVideos(productId) {
    const d = await shopify(`query($id:ID!){ product(id:$id){ media(first:50){ edges{ node{ mediaContentType ... on Video { id status } } } } } }`, { id: productId });
    return d.product.media.edges.map(e => e.node).filter(n => n.mediaContentType === 'VIDEO');
  }

  async function waitReady(productId, videoId, tries) {
    tries = tries || 20;
    for (let i = 0; i < tries; i++) {
      const v = (await getVideos(productId)).find(x => x.id === videoId);
      if (v && v.status === 'READY') return true;
      if (v && v.status === 'FAILED') return false;
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  }

  const action = (req.query && req.query.action) || (req.body && req.body.action);

  try {
    // -------------------------------------------------- LIST
    if (action === 'list') {
      if (!SQ_VIDEOS_URL || SQ_VIDEOS_URL.indexOf('PASTE_') === 0) {
        return res.status(200).json({ ok: false, error: 'Drive script not configured yet — deploy the Apps Script and set SQ_VIDEOS_URL.' });
      }
      let dj;
      try {
        const dr = await fetch(`${SQ_VIDEOS_URL}?key=${encodeURIComponent(SQ_VIDEOS_KEY)}`, { redirect: 'follow' });
        dj = await dr.json();
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'Could not reach the Drive script: ' + e.message });
      }
      if (!dj || !dj.ok) return res.status(200).json({ ok: false, error: (dj && dj.error) || 'Drive script returned not-ok' });

      const files = dj.files || [];
      const { entries } = await logGet();
      const logBySku = {};
      entries.forEach(e => { logBySku[e.sku] = e; });
      const { map: overrides } = await overridesGet();

      const videos = [];
      for (const f of files) {
        const sku = overrides[f.id] || skuFromName(f.name); // saved manual fix wins
        let match = null, matchError = null;
        try { match = await matchSku(sku); } catch (e) { matchError = e.message; }
        const logEntry = logBySku[sku] || null;
        // "Sent" = pushed via THIS tool (github log) AND that exact video still exists on the product.
        const sentViaTool = !!(logEntry && logEntry.videoId && match && match.videoIds.includes(logEntry.videoId));
        videos.push({
          fileId: f.id,
          fileName: f.name,
          sku,
          thumbnail: `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`,
          matched: !!match,
          product: match ? { id: match.productId, title: match.title, handle: match.handle, url: match.url } : null,
          sentViaTool,
          videoId: logEntry ? logEntry.videoId : null,       // OUR pushed video (for undo)
          productHasVideo: match ? match.hasVideo : false,   // any pre-existing video (info only)
          sentAt: sentViaTool ? logEntry.sentAt : null,
          matchError
        });
      }
      return res.status(200).json({ ok: true, count: videos.length, videos });
    }

    // -------------------------------------------------- MATCH (manual SKU)
    if (action === 'match') {
      const sku = String((req.query && req.query.sku) || '').trim().toUpperCase();
      if (!sku) return res.status(400).json({ ok: false, error: 'Missing sku' });
      const match = await matchSku(sku);
      const { entries } = await logGet();
      const logEntry = entries.find(e => e.sku === sku) || null;
      const sentViaTool = !!(logEntry && logEntry.videoId && match && match.videoIds.includes(logEntry.videoId));
      return res.status(200).json({
        ok: true, sku, matched: !!match,
        product: match ? { id: match.productId, title: match.title, handle: match.handle, url: match.url } : null,
        sentViaTool,
        videoId: logEntry ? logEntry.videoId : null,
        productHasVideo: match ? match.hasVideo : false
      });
    }

    // -------------------------------------------------- MANUAL MATCH (saved)
    if (action === 'manual-match') {
      const { fileId, fileName } = req.body || {};
      const sku = String((req.body && req.body.sku) || '').trim().toUpperCase();
      if (!fileId || !sku) return res.status(400).json({ ok: false, error: 'Missing fileId or sku' });
      const match = await matchSku(sku);
      if (!match) return res.status(200).json({ ok: true, matched: false, sku });
      // Persist the fix so it survives reloads (keyed by the Drive file id).
      try {
        const { arr, sha } = await overridesGet();
        const filtered = arr.filter(o => o.fileId !== fileId);
        filtered.push({ fileId, fileName: fileName || '', sku });
        await overridesPut(filtered, sha, `SQ sku fix: ${sku}`);
      } catch (e) { /* best-effort */ }
      const { entries } = await logGet();
      const logEntry = entries.find(e => e.sku === sku) || null;
      const sentViaTool = !!(logEntry && logEntry.videoId && match.videoIds.includes(logEntry.videoId));
      return res.status(200).json({
        ok: true, matched: true, sku,
        product: { id: match.productId, title: match.title, handle: match.handle, url: match.url },
        sentViaTool, videoId: logEntry ? logEntry.videoId : null, productHasVideo: match.hasVideo
      });
    }

    // -------------------------------------------------- PUSH
    if (action === 'push') {
      const { fileId, fileName, productId, replace } = req.body || {};
      if (!fileId || !productId) return res.status(400).json({ ok: false, error: 'Missing fileId or productId' });

      // 1) download bytes (do this BEFORE any deletion, so a failed download changes nothing)
      const buf = await driveDownload(fileId);
      const head = buf.slice(0, 16).toString('latin1');
      if (head.indexOf('ftyp') === -1) {
        return res.status(200).json({ ok: false, error: 'Drive did not return a valid MP4 (got a warning/HTML page?). Check the folder is shared "Anyone with the link → Viewer".' });
      }
      const size = buf.length;

      // 1b) REPLACE: remove any video(s) already on the product first
      if (replace) {
        const existing = await getVideos(productId);
        if (existing.length) {
          await shopify(`mutation del($mediaIds:[ID!]!, $productId:ID!){ productDeleteMedia(mediaIds:$mediaIds, productId:$productId){ deletedMediaIds mediaUserErrors{ field message } } }`,
            { mediaIds: existing.map(v => v.id), productId });
        }
      }

      // 2) staged upload slot
      const staged = await shopify(`
        mutation staged($input:[StagedUploadInput!]!){
          stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } }
        }`, { input: [{ resource: 'VIDEO', filename: fileName || 'video.mp4', mimeType: 'video/mp4', fileSize: String(size), httpMethod: 'POST' }] });
      const sErr = staged.stagedUploadsCreate.userErrors;
      if (sErr && sErr.length) return res.status(200).json({ ok: false, error: sErr[0].message });
      const tgt = staged.stagedUploadsCreate.stagedTargets[0];

      // 3) upload the bytes to Shopify storage (params first, file LAST)
      const form = new FormData();
      tgt.parameters.forEach(p => form.append(p.name, p.value));
      form.append('file', new Blob([buf], { type: 'video/mp4' }), fileName || 'video.mp4');
      const up = await fetch(tgt.url, { method: 'POST', body: form });
      if (!(up.status === 201 || up.status === 204)) {
        const t = await up.text().catch(() => '');
        return res.status(200).json({ ok: false, error: 'Upload to Shopify storage failed (' + up.status + '): ' + t.slice(0, 300) });
      }

      // 4) attach as VIDEO media
      const created = await shopify(`
        mutation create($productId:ID!, $media:[CreateMediaInput!]!){
          productCreateMedia(productId:$productId, media:$media){ media{ ... on Video { id status } mediaContentType } mediaUserErrors{ field message } }
        }`, { productId, media: [{ originalSource: tgt.resourceUrl, mediaContentType: 'VIDEO', alt: fileName || '' }] });
      const cErr = created.productCreateMedia.mediaUserErrors;
      if (cErr && cErr.length) return res.status(200).json({ ok: false, error: cErr[0].message });
      const videoId = created.productCreateMedia.media[0].id;

      // 5) wait until processed, then move to position 2 (index 1)
      const ready = await waitReady(productId, videoId);
      await shopify(`
        mutation reorder($id:ID!, $moves:[MoveInput!]!){ productReorderMedia(id:$id, moves:$moves){ mediaUserErrors{ field message } } }
      `, { id: productId, moves: [{ id: videoId, newPosition: '1' }] });

      // 6) verify it is really on the product in Shopify
      const present = (await getVideos(productId)).some(v => v.id === videoId);

      // 7) record it (undo record)
      try {
        const { entries, sha } = await logGet();
        const sku = skuFromName(fileName);
        const filtered = entries.filter(e => e.sku !== sku);
        filtered.push({ sku, fileId, fileName, productId, videoId, sentAt: new Date().toISOString() });
        await logPut(filtered, sha, `SQ video sent: ${sku}`);
      } catch (e) { /* log is best-effort */ }

      return res.status(200).json({ ok: true, videoId, ready, verified: present });
    }

    // -------------------------------------------------- UNDO
    if (action === 'undo') {
      const { productId, videoId } = req.body || {};
      if (!productId || !videoId) return res.status(400).json({ ok: false, error: 'Missing productId or videoId' });
      const del = await shopify(`
        mutation del($mediaIds:[ID!]!, $productId:ID!){
          productDeleteMedia(mediaIds:$mediaIds, productId:$productId){ deletedMediaIds mediaUserErrors{ field message } }
        }`, { mediaIds: [videoId], productId });
      const dErr = del.productDeleteMedia.mediaUserErrors;
      if (dErr && dErr.length) return res.status(200).json({ ok: false, error: dErr[0].message });
      try {
        const { entries, sha } = await logGet();
        const filtered = entries.filter(e => e.videoId !== videoId);
        await logPut(filtered, sha, `SQ video undo: ${productId}`);
      } catch (e) { /* best-effort */ }
      return res.status(200).json({ ok: true, deleted: del.productDeleteMedia.deletedMediaIds });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message || String(err) });
  }
};
