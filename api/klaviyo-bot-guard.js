// klaviyo-bot-guard.js — v1.0 (2 Nov 2026)
// Daily (2x) bot cleanup for Klaviyo. Detects bot sign-ups (fake checkout profiles), puts them in a dated
// segment, SUPPRESSES them (reversible), and emails Mae the segment name + count.
// Runs on Vercel cron — no Claude tokens. Uses the KLAVIYO_KEY already in the environment.
//
// A profile is "suspected" only when ALL of these are true (keeps real customers safe):
//   • has an email            (phone-only profiles don't count for billing, so we ignore them)
//   • email consent = NEVER_SUBSCRIBED   (real sign-ups are SUBSCRIBED)
//   • not already suppressed
//   • never placed an order   (historic_number_of_orders is 0 / empty)
//
// What happens to a suspected profile — two paths:
//   A) BURST (a clear attack): if a run finds BURST_MIN+ suspected in its window, suppress them NOW.
//   B) TRICKLE (a few): add them to a watchlist (data/bot-guard-pending.json) with the date first seen.
//      Each run re-checks watchlist entries that are GRACE_DAYS old: if STILL suspected -> suppress now;
//      if they have since bought or subscribed -> drop from the watchlist, never touched.
// Both paths feed the same dated segment "Suspected bots YYYY-MM-DD day|night".
//
// Endpoints (GET):
//   /api/klaviyo-bot-guard                     -> normal cron run (window = last WINDOW_HOURS), auto slot
//   /api/klaviyo-bot-guard?dry=1               -> preview only: counts + email, NEVER suppresses
//   /api/klaviyo-bot-guard?since=2026-10-29T00:00:00Z  -> one-off backfill: suppress ALL suspected since that date
//   /api/klaviyo-bot-guard?slot=day|night      -> force the slot label
//   /api/klaviyo-bot-guard?action=undo&label=2026-11-02%20day  -> UNSUPPRESS a past run (reverses it)

const KLAVIYO_KEY = process.env.KLAVIYO_KEY;
const REV = '2024-10-15';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'aboutwallart/seo-tools';
const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;   // best-effort email to Mae (via her Apps Script)
const MAE_EMAIL = 'mae@aboutwallart.com';
const LOG_FILE = 'data/bot-guard-log.json';              // every run's summary (newest first, last 60)
const PENDING_FILE = 'data/bot-guard-pending.json';      // trickle watchlist: [{id,email,firstSeen}]
const UNDO_DIR = 'data/bot-guard-undo';                  // emails per run, so a run can be undone

const BURST_MIN = 10;        // this-many suspected in one run = a clear attack -> suppress now
const GRACE_DAYS = 7;        // a trickle profile waits this long; still dormant after -> suppress
const WINDOW_HOURS = 14;     // normal look-back (crons ~12h apart; overlap is deduped by "already suppressed")
const PAGE_SIZE = 100;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lc = s => String(s || '').trim().toLowerCase();

// ---------- Klaviyo ----------
async function kv(path, method, payload) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://a.klaviyo.com' + path, {
      method: method || 'GET',
      headers: { 'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY, 'revision': REV, 'accept': 'application/vnd.api+json', ...(payload ? { 'content-type': 'application/vnd.api+json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined
    });
    if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    return r;
  }
  return fetch('https://a.klaviyo.com' + path, { headers: { 'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY, 'revision': REV, 'accept': 'application/vnd.api+json' } });
}
async function kvJson(path, method, payload) { const r = await kv(path, method, payload); let j = null; try { j = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, json: j }; }

// ---------- GitHub ----------
async function ghGet(path) {
  if (!GITHUB_TOKEN) return { json: null, sha: null };
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } });
  if (!r.ok) return { json: null, sha: null };
  const d = await r.json();
  let json = null; try { json = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')); } catch (e) {}
  return { json, sha: d.sha };
}
async function ghPut(path, obj, message) {
  if (!GITHUB_TOKEN) return false;
  const cur = await ghGet(path);
  const body = { message: message || `bot-guard ${path}`, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
  if (cur.sha) body.sha = cur.sha;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok;
}
async function ghLog(entry) { try { const log = (await ghGet(LOG_FILE)).json || []; log.unshift(entry); await ghPut(LOG_FILE, log.slice(0, 60), 'bot-guard log'); } catch (e) {} }

// best-effort email to Mae through her Google Apps Script webhook (needs the small snippet added there).
async function emailMae(subject, text) {
  if (!SHEETS_WEBHOOK) return false;
  try { const r = await fetch(SHEETS_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'botguard-email', to: MAE_EMAIL, subject, body: text }) }); return r.ok; }
  catch (e) { return false; }
}

// ---------- detection ----------
const BOT_FIELDS = ['email', 'subscriptions.email.marketing.consent', 'subscriptions.email.marketing.suppression', 'predictive_analytics.historic_number_of_orders'].join(',');
function isSuspect(a) {
  const email = (a.email || '').trim();
  if (!email) return false;
  const em = ((a.subscriptions || {}).email || {}).marketing || {};
  if (em.consent !== 'NEVER_SUBSCRIBED') return false;
  if (Array.isArray(em.suppression) && em.suppression.length) return false;
  const orders = (a.predictive_analytics || {}).historic_number_of_orders;
  if (orders != null && Number(orders) > 0) return false;
  return true;
}
// All suspected profiles created after `sinceIso`.
async function findSuspects(sinceIso) {
  const out = []; let cursor = null, pages = 0;
  while (pages < 80) {
    const qs = new URLSearchParams();
    qs.set('filter', `greater-than(created,${sinceIso})`);
    qs.set('sort', 'created');
    qs.set('page[size]', String(PAGE_SIZE));
    qs.set('fields[profile]', BOT_FIELDS);
    qs.set('additional-fields[profile]', 'subscriptions,predictive_analytics');
    if (cursor) qs.set('page[cursor]', cursor);
    const { ok, json } = await kvJson('/api/profiles/?' + qs.toString());
    if (!ok || !json || !Array.isArray(json.data)) break;
    for (const p of json.data) if (isSuspect(p.attributes || {})) out.push({ id: p.id, email: (p.attributes.email || '').trim() });
    cursor = json.links && json.links.next ? new URL(json.links.next).searchParams.get('page[cursor]') : null;
    pages++; if (!cursor) break; await sleep(300);
  }
  return out;
}
// Re-check one watchlist profile. Returns {exists, suspected}.
async function recheck(id) {
  const qs = new URLSearchParams();
  qs.set('fields[profile]', BOT_FIELDS);
  qs.set('additional-fields[profile]', 'subscriptions,predictive_analytics');
  const { ok, status, json } = await kvJson(`/api/profiles/${id}/?` + qs.toString());
  if (status === 404) return { exists: false, suspected: false };
  if (!ok || !json || !json.data) return { exists: true, suspected: false };
  return { exists: true, suspected: isSuspect(json.data.attributes || {}) };
}

// ---------- actions ----------
async function tagBatch(items, label) {
  for (const b of items) { try { await kv(`/api/profiles/${b.id}/`, 'PATCH', { data: { type: 'profile', id: b.id, attributes: { properties: { suspected_bot_batch: label } } } }); } catch (e) {} await sleep(60); }
}
async function createSegment(name, label) {
  const payload = { data: { type: 'segment', attributes: { name, definition: { condition_groups: [ { conditions: [ { type: 'profile-property', property: "properties['suspected_bot_batch']", filter: { type: 'string', operator: 'equals', value: label } } ] } ] } } } };
  const { ok, json } = await kvJson('/api/segments/', 'POST', payload);
  return ok && json && json.data ? json.data.id : null;
}
async function bulkEmailJob(kind, emails) {
  const type = kind === 'undo' ? 'profile-unsuppression-bulk-create-job' : 'profile-suppression-bulk-create-job';
  const path = kind === 'undo' ? '/api/profile-unsuppression-bulk-create-jobs/' : '/api/profile-suppression-bulk-create-jobs/';
  let done = 0; const errors = [];
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const { ok, status, json } = await kvJson(path, 'POST', { data: { type, attributes: { profiles: { data: chunk.map(e => ({ type: 'profile', attributes: { email: e } })) } } } });
    if (ok) done += chunk.length; else errors.push('HTTP ' + status + ' ' + JSON.stringify((json && json.errors) || json).slice(0, 200));
    await sleep(500);
  }
  return { done, errors };
}

module.exports = async (req, res) => {
  try {
    if (!KLAVIYO_KEY) return res.status(500).json({ ok: false, error: 'KLAVIYO_KEY not configured' });
    const q = req.query || {};
    const now = new Date();

    // ----- UNDO a past run -----
    if (q.action === 'undo') {
      const label = String(q.label || '').trim();
      if (!label) return res.status(400).json({ ok: false, error: 'label required, e.g. ?action=undo&label=2026-11-02 day' });
      const rec = (await ghGet(`${UNDO_DIR}/${label.replace(/[^0-9a-z]+/gi, '_')}.json`)).json;
      if (!rec || !Array.isArray(rec.emails) || !rec.emails.length) return res.status(404).json({ ok: false, error: 'No saved emails for that label' });
      const r = await bulkEmailJob('undo', rec.emails);
      await emailMae(`Bot guard: UNDONE "${label}" — ${r.done} unsuppressed`, `Reversed the run "${label}". ${r.done} profiles were put back (unsuppressed). ${r.errors.length ? 'Errors: ' + r.errors.join(' | ') : ''}`);
      return res.status(200).json({ ok: true, undone: r.done, errors: r.errors });
    }

    const dry = q.dry === '1' || q.dry === 'true';
    const isBackfill = !!q.since;
    const slot = (q.slot === 'day' || q.slot === 'night') ? q.slot : (now.getUTCHours() < 15 ? 'day' : 'night');
    const date = now.toISOString().slice(0, 10);
    const label = isBackfill ? `${date} ${slot} backfill` : `${date} ${slot}`;
    const segmentName = `Suspected bots ${label}`;
    const sinceIso = isBackfill ? String(q.since) : new Date(now.getTime() - WINDOW_HOURS * 3600 * 1000).toISOString();

    // 1) suspects in the window
    const found = await findSuspects(sinceIso);
    const isBurst = isBackfill || found.length >= BURST_MIN;

    // watchlist (trickle)
    let pending = (await ghGet(PENDING_FILE)).json;
    if (!Array.isArray(pending)) pending = [];

    const toSuppress = [];                 // [{id,email}]
    const seen = new Set();
    const addSup = it => { const k = lc(it.email); if (k && !seen.has(k)) { seen.add(k); toSuppress.push(it); } };
    let addedToWatch = 0;

    if (isBurst) {
      found.forEach(addSup);
      const fe = new Set(found.map(f => lc(f.email)));
      pending = pending.filter(p => !fe.has(lc(p.email)));   // those are handled now
    } else {
      const have = new Set(pending.map(p => lc(p.email)));
      for (const f of found) if (!have.has(lc(f.email))) { pending.push({ id: f.id, email: f.email, firstSeen: now.toISOString() }); have.add(lc(f.email)); addedToWatch++; }
    }

    // 2) re-check aged watchlist entries (always)
    const cutoff = now.getTime() - GRACE_DAYS * 86400 * 1000;
    const aged = pending.filter(p => new Date(p.firstSeen).getTime() <= cutoff);
    let confirmed = 0, released = 0;
    for (const p of aged) {
      const st = await recheck(p.id);
      if (st.exists && st.suspected) { addSup({ id: p.id, email: p.email }); confirmed++; } else { released++; }
      await sleep(120);
    }
    const agedEmails = new Set(aged.map(p => lc(p.email)));
    pending = pending.filter(p => !agedEmails.has(lc(p.email)));   // aged ones are now resolved

    const emails = toSuppress.map(b => lc(b.email));

    if (dry) {
      await emailMae(`Bot guard DRY RUN — would suppress ${emails.length}`, `DRY RUN, nothing changed.\nWindow since ${sinceIso}.\nSuspects found now: ${found.length} (${isBurst ? 'BURST — would suppress now' : 'trickle — added to watchlist'}).\nWatchlist re-check: ${confirmed} confirmed, ${released} released.\nWould suppress ${emails.length} into "${segmentName}".\nWatchlist size would be ${pending.length}.`);
      return res.status(200).json({ ok: true, dryRun: true, found: found.length, isBurst, wouldSuppress: emails.length, confirmedFromWatch: confirmed, released, watchlist: pending.length });
    }

    // persist the watchlist regardless
    await ghPut(PENDING_FILE, pending, `bot-guard watchlist (${pending.length})`);

    if (emails.length === 0) {
      await ghLog({ at: now.toISOString(), label, since: sinceIso, found: found.length, isBurst, addedToWatch, confirmedFromWatch: confirmed, released, suppressed: 0, watchlist: pending.length, action: 'watch-only' });
      return res.status(200).json({ ok: true, found: found.length, suppressed: 0, addedToWatch, watchlist: pending.length, note: isBurst ? 'Burst window empty.' : 'Nothing to suppress; trickle on watchlist.' });
    }

    // 3) tag -> segment -> suppress
    await tagBatch(toSuppress, label);
    const segmentId = await createSegment(segmentName, label);
    const sup = await bulkEmailJob('suppress', emails);

    await ghPut(`${UNDO_DIR}/${label.replace(/[^0-9a-z]+/gi, '_')}.json`, { label, segmentName, segmentId, at: now.toISOString(), emails }, `bot-guard undo ${label}`);
    await ghLog({ at: now.toISOString(), label, segmentName, segmentId, since: sinceIso, found: found.length, isBurst, addedToWatch, confirmedFromWatch: confirmed, released, suppressed: sup.done, watchlist: pending.length, action: 'suppressed', errors: sup.errors });

    const link = segmentId ? `https://www.klaviyo.com/lists/${segmentId}` : '(segment link unavailable)';
    await emailMae(
      `Bot guard: suppressed ${sup.done} — "${segmentName}"`,
      `Suppressed ${sup.done} suspected bot profiles${isBurst ? ' (burst' : ' (watchlist'}${confirmed ? `, incl. ${confirmed} from the 7-day watchlist` : ''})` + `.\n\n` +
      `Segment: "${segmentName}"\n${link}\n\n` +
      `They are SUPPRESSED (reversible). Open the segment to review.\n` +
      `Watchlist now holds ${pending.length} profiles still inside the 7-day window.\n\n` +
      `To undo this whole run: /api/klaviyo-bot-guard?action=undo&label=${encodeURIComponent(label)}` +
      `${sup.errors.length ? '\n\nErrors: ' + sup.errors.join(' | ') : ''}`
    );

    return res.status(200).json({ ok: true, found: found.length, isBurst, suppressed: sup.done, confirmedFromWatch: confirmed, released, segmentName, segmentId, watchlist: pending.length, errors: sup.errors });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
