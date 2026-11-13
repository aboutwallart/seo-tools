// email-snapshot-cleanup.js — v1.0 (13 Nov 2026)
// Monthly cron: deletes OLD email image snapshots (Shopify Files copies created by email.js) so they don't
// pile up forever. SAFE BY DESIGN — a snapshot is deleted only when BOTH are true:
//   1. it was created more than KEEP_DAYS (35) days ago, AND
//   2. its URL is NOT referenced by any campaign that is still SCHEDULED, or was SENT within the last
//      KEEP_DAYS days (we read those campaigns' real HTML, so a live/recent email can never lose an image).
// Snapshots live in data/email-image-snapshots.json (written by email.js). Add ?dry=1 to preview.
// Triggered by the cron in vercel.json.

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const KLAVIYO_KEY = process.env.KLAVIYO_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'aboutwallart/seo-tools';
const API_VERSION = '2025-01';
const KLAVIYO_REV = '2026-10-15';
const SNAP_FILE = 'data/email-image-snapshots.json';
const SUMMARY = 'data/email-snapshot-cleanup-last.json';
const KEEP_DAYS = 35;

async function shopify(query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables })
  });
  const d = await r.json();
  if (d.errors) throw new Error(typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors));
  return d.data;
}
async function kvJson(path) {
  const r = await fetch('https://a.klaviyo.com' + path, { headers: { 'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY, 'revision': KLAVIYO_REV, 'accept': 'application/vnd.api+json' } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { ok: r.ok, status: r.status, json: j };
}
async function ghGet(path) {
  if (!GITHUB_TOKEN) return { json: null, sha: null };
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
  if (!r.ok) return { json: null, sha: null };
  const d = await r.json();
  let json = null; try { json = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) {}
  return { json, sha: d.sha };
}
async function ghPut(path, obj, message, sha) {
  const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2) + '\n').toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub save failed: ' + r.status);
  return true;
}

function imgSrcs(html) {
  const out = []; const re = /<img\b[^>]*\bsrc="([^"]+)"/gi; let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}
async function templateHtml(tid) {
  const t = await kvJson('/api/templates/' + tid + '/?fields%5Btemplate%5D=html');
  return (t.json && t.json.data && t.json.data.attributes && t.json.data.attributes.html) || '';
}
// URLs used by campaigns that must be protected (scheduled, or sent within KEEP_DAYS).
async function protectedUrls(cutoffMs) {
  const protect = new Set();
  async function scan(statusFilter, checkSentRecent) {
    let url = '/api/campaign-messages/?filter=' + encodeURIComponent('equals(status,"' + statusFilter + '")') + '&include=campaign-variations&page%5Bsize%5D=100';
    let pages = 0;
    while (url && pages < 8) {
      const r = await kvJson(url); pages++;
      if (!r.json || !r.json.data) break;
      const tidByMsg = {};
      (r.json.included || []).forEach(v => { try { const mid = v.relationships['campaign-message'].data.id; const tid = v.attributes.definition.details.template_id; if (tid) tidByMsg[mid] = tid; } catch (e) {} });
      for (const msg of r.json.data) {
        if (checkSentRecent) {
          const st = (((msg.attributes || {}).definition || {}).send_options || {}).send_time;
          const ts = st ? Date.parse(st) : NaN;
          if (!ts || isNaN(ts) || ts < cutoffMs) continue; // sent too long ago — not protected
        }
        const tid = tidByMsg[msg.id]; if (!tid) continue;
        try { imgSrcs(await templateHtml(tid)).forEach(u => protect.add(u)); } catch (e) {}
      }
      const next = r.json.links && r.json.links.next;
      url = next ? next.replace('https://a.klaviyo.com', '') : null;
    }
  }
  await scan('scheduled', false);
  await scan('sent', true);
  return protect;
}

module.exports = async (req, res) => {
  const dry = req.query && (req.query.dry === '1' || req.query.dry === 'true');
  if (!STORE || !TOKEN || !KLAVIYO_KEY || !GITHUB_TOKEN) return res.status(500).json({ ok: false, error: 'Missing credentials' });
  try {
    const { json: snapDoc, sha } = await ghGet(SNAP_FILE);
    if (!snapDoc || !snapDoc.byHandle) return res.status(200).json({ ok: true, note: 'No snapshots file yet — nothing to clean.' });
    const now = Date.now();
    const cutoff = now - KEEP_DAYS * 86400000;

    const protect = await protectedUrls(cutoff);

    const toDelete = [];
    Object.keys(snapDoc.byHandle).forEach(h => {
      const s = snapDoc.byHandle[h]; if (!s) return;
      const when = Date.parse(s.lastUsedAt || s.at || 0);
      const old = !when || isNaN(when) ? true : when < cutoff;
      if (old && s.fileId && !protect.has(s.url)) toDelete.push({ handle: h, fileId: s.fileId, url: s.url });
    });

    const summary = { at: new Date().toISOString(), totalSnapshots: Object.keys(snapDoc.byHandle).length, protectedUrls: protect.size, toDelete: toDelete.length, deleted: 0, errors: [] };
    if (dry) return res.status(200).json({ ok: true, dryRun: true, summary, sample: toDelete.slice(0, 10) });

    for (let i = 0; i < toDelete.length; i += 25) {
      const chunk = toDelete.slice(i, i + 25);
      try {
        const d = await shopify('mutation($ids:[ID!]!){ fileDelete(fileIds:$ids){ deletedFileIds userErrors{ message } } }', { ids: chunk.map(x => x.fileId) });
        const okIds = new Set((d.fileDelete && d.fileDelete.deletedFileIds) || []);
        (d.fileDelete && d.fileDelete.userErrors || []).forEach(e => summary.errors.push(e.message));
        chunk.forEach(x => { if (okIds.has(x.fileId)) { delete snapDoc.byHandle[x.handle]; summary.deleted++; } });
      } catch (e) { summary.errors.push(String(e && e.message || e)); }
    }

    if (summary.deleted > 0) await ghPut(SNAP_FILE, snapDoc, 'Email snapshot cleanup: removed ' + summary.deleted + ' old copies', sha);
    try { await ghPut(SUMMARY, summary, 'Email snapshot cleanup summary'); } catch (e) {}
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
