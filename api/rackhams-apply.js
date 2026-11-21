// rackhams-apply.js — v0.2 (21 Nov 2026)
// Writes advert sale-status in Rackhams (Marketplacer). Reversible.
// v0.2: + caps (can my key make a brand/import rule?) + diag (AWA off = vetting vs data error). Both read-only.
//
// Actions (GET, ?action=):
//   probe            -> introspect the publish mutation + show target counts. NO write.
//   test             -> take 1 non-AWA on-sale advert, set OFF, verify, set BACK ON. (proves the method)
//   off              -> dry preview of non-AWA DISPLAYED to take off sale. NO write.
//   off&confirm=1    -> set every non-AWA DISPLAYED advert to published:false. Saves undo to GitHub.
//   on               -> dry preview of AWA NOT_DISPLAYED (minus the 2 mounts) to put on sale. NO write.
//   on&confirm=1     -> set those AWA adverts to published:true. Saves undo to GitHub.
//   undo&file=<path> -> revert a saved undo file (restores each advert's previous published value).
//
// Extra params: ?max=N (cap how many to change this call), ?brand=... (override "mine").
// "onSale" = advert.online === true. My brand = About Wall Art.

const ENDPOINT = 'https://rackhams.marketplacer.com/graphql';
const KEY = process.env.RACKHAMS_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'aboutwallart/seo-tools';
const DEFAULT_BRAND = 'About Wall Art';
const PAGE_SIZE = 100;
const CONCURRENCY = 4;

// The 2 "mounts" to NEVER put on sale (Mae modifies them later). Shopify product IDs + titles.
const EXCLUDE_IDS = new Set(['15641639125372', '15641632178556']);
const EXCLUDE_TITLES = [
  'white picture frame mount ( by unit )',
  'black picture frame mount ( by unit )'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function digits(s) { const m = String(s == null ? '' : s).match(/(\d{6,})/); return m ? m[1] : ''; }

async function mp(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) { throw new Error(`Non-JSON (HTTP ${r.status}): ${text.slice(0, 300)}`); }
  if (d.errors) throw new Error('GraphQL: ' + JSON.stringify(d.errors).slice(0, 500));
  return d.data;
}

const LIST_QUERY = `
query ($first: Int!, $after: String, $status: AdvertStatusEnum) {
  advertsWhere(first: $first, after: $after, status: $status) {
    totalCount
    nodes { id legacyId title published online statusText externalId brand { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const NODE_QUERY = `
query ($id: ID!) {
  node(id: $id) { ... on Advert { id legacyId title published online statusText brand { name } } }
}`;

const NODE_DIAG = `
query ($id: ID!) {
  node(id: $id) { ... on Advert {
    id legacyId title published online displayable statusText
    brand { name }
    catalogRulesErrors { fieldName errorMessage objectId }
  } }
}`;
const NODE_DIAG_FALLBACK = `
query ($id: ID!) {
  node(id: $id) { ... on Advert { id legacyId title published online displayable statusText brand { name } } }
}`;

async function typeInfo(name) {
  const d = await mp(`query ($n: String!) { __type(name: $n) { name kind fields { name } inputFields { name } enumValues { name } } }`, { n: name });
  return d.__type;
}

const MUT = `mutation ($id: ID!, $p: Boolean!) {
  advertPublishedUpdate(input: { id: $id, published: $p }) { __typename }
}`;

async function collect(status) {
  const out = [];
  let after = null, has = true, pages = 0;
  while (has && pages < 400) {
    const d = await mp(LIST_QUERY, { first: PAGE_SIZE, after, status });
    const c = d.advertsWhere;
    for (const n of (c.nodes || [])) out.push(n);
    has = c.pageInfo && c.pageInfo.hasNextPage;
    after = c.pageInfo && c.pageInfo.endCursor;
    pages++;
  }
  return out;
}

async function setPublished(id, published) {
  for (let a = 0; a < 4; a++) {
    try { await mp(MUT, { id, p: published }); return; }
    catch (e) {
      const m = String((e && e.message) || '');
      if (/429|rate|throttl/i.test(m) && a < 3) { await sleep(600 * (a + 1)); continue; }
      throw e;
    }
  }
}

async function runPool(items, worker, concurrency) {
  let i = 0, ok = 0, fail = 0; const failures = [];
  async function next() {
    while (i < items.length) {
      const it = items[i++];
      try { await worker(it); ok++; }
      catch (e) { fail++; if (failures.length < 15) failures.push({ legacyId: it.legacyId, title: it.title, error: String((e && e.message) || e).slice(0, 180) }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, next));
  return { ok, fail, failures };
}

async function ghPut(path, obj, message) {
  if (!GITHUB_TOKEN) return false;
  for (let a = 0; a < 5; a++) {
    let sha = null;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (g.ok) { try { sha = (await g.json()).sha; } catch (e) {} }
    const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
    if (sha) body.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT', headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (r.ok) return true;
    if (![409, 422, 500, 502, 503, 504].includes(r.status)) return false;
    await sleep(400 * (a + 1));
  }
  return false;
}
async function ghGet(path) {
  if (!GITHUB_TOKEN) return null;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
  if (!r.ok) return null;
  try { return JSON.parse(Buffer.from((await r.json()).content, 'base64').toString('utf-8')); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!KEY) return res.status(500).json({ ok: false, error: 'Missing RACKHAMS_API_KEY' });

  const q = req.query || {};
  const action = (q.action || 'probe').toString().toLowerCase();
  const confirm = q.confirm === '1' || q.confirm === 'true';
  const myBrandLc = (q.brand || DEFAULT_BRAND).toString().trim().toLowerCase();
  const max = q.max ? Math.max(1, parseInt(q.max, 10)) : null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const isMine = (n) => n.brand && n.brand.name && n.brand.name.trim().toLowerCase() === myBrandLc;
  const isMount = (n) => {
    const ext = digits(n.externalId);
    if (ext && EXCLUDE_IDS.has(ext)) return true;
    const t = (n.title || '').trim().toLowerCase();
    return EXCLUDE_TITLES.includes(t) || t.includes('picture frame mount');
  };

  try {
    // ---------- PROBE ----------
    if (action === 'probe') {
      const info = {};
      try {
        const d = await mp(`query { __type(name: "AdvertPublishedUpdateMutationInput") { inputFields { name } } }`, {});
        info.inputFields = (d.__type && d.__type.inputFields || []).map(f => f.name);
      } catch (e) { info.inputFields = 'introspection error: ' + e.message; }
      try {
        const d = await mp(`query { __type(name: "AdvertPublishedUpdateMutationPayload") { fields { name } } }`, {});
        info.payloadFields = (d.__type && d.__type.fields || []).map(f => f.name);
      } catch (e) { info.payloadFields = 'introspection error: ' + e.message; }
      const displayed = await collect('DISPLAYED');
      const notDisplayed = await collect('NOT_DISPLAYED');
      const offTargets = displayed.filter(n => !isMine(n));
      const onTargets = notDisplayed.filter(n => isMine(n) && !isMount(n));
      const mountsFound = notDisplayed.concat(displayed).filter(isMount).map(n => ({ legacyId: n.legacyId, title: n.title, externalId: n.externalId, status: n.statusText }));
      return res.status(200).json({
        ok: true, action, mutation: 'advertPublishedUpdate(input:{id,published}) { __typename }', discovered: info,
        offTargets_nonAWA_onSale: offTargets.length,
        onTargets_AWA_offSale_minusMounts: onTargets.length,
        mountsExcluded: mountsFound,
        note: 'NO write. Counts are current live state.'
      });
    }

    // ---------- TEST (1 advert, reversible) ----------
    if (action === 'test') {
      const displayed = await collect('DISPLAYED');
      const target = displayed.find(n => !isMine(n));
      if (!target) return res.status(200).json({ ok: false, error: 'No non-AWA on-sale advert found to test.' });
      const before = (await mp(NODE_QUERY, { id: target.id })).node;
      await setPublished(target.id, false);
      const afterOff = (await mp(NODE_QUERY, { id: target.id })).node;
      await setPublished(target.id, true);
      const afterRestore = (await mp(NODE_QUERY, { id: target.id })).node;
      const worked = afterOff && afterOff.published === false;
      const restored = afterRestore && afterRestore.published === true;
      return res.status(200).json({
        ok: true, action, advert: { legacyId: target.legacyId, title: target.title, brand: target.brand && target.brand.name },
        before: { published: before.published, online: before.online, statusText: before.statusText },
        afterOff: { published: afterOff.published, online: afterOff.online, statusText: afterOff.statusText },
        afterRestore: { published: afterRestore.published, online: afterRestore.online, statusText: afterRestore.statusText },
        mutationWorks: worked, restoredOk: restored,
        verdict: worked && restored ? 'OK — method works and is reversible.' : 'CHECK — unexpected result.'
      });
    }

    // ---------- OFF (non-AWA on sale -> off) ----------
    if (action === 'off') {
      const displayed = await collect('DISPLAYED');
      let targets = displayed.filter(n => !isMine(n));
      const totalTargets = targets.length;
      if (max) targets = targets.slice(0, max);
      if (!confirm) {
        return res.status(200).json({ ok: true, action, dryRun: true, wouldChange: totalTargets, thisCall: targets.length, sample: targets.slice(0, 15).map(n => ({ legacyId: n.legacyId, title: n.title, brand: n.brand && n.brand.name })), note: 'Add &confirm=1 to apply.' });
      }
      await ghPut(`data/rackhams-undo/${ts}-off.json`, { action: 'off', when: ts, restorePublished: true, items: targets.map(n => ({ id: n.id, legacyId: n.legacyId, title: n.title, brand: n.brand && n.brand.name })) }, `Rackhams undo: off ${targets.length}`);
      const r = await runPool(targets, (n) => setPublished(n.id, false), CONCURRENCY);
      const after = await collect('DISPLAYED');
      const remaining = after.filter(n => !isMine(n)).length;
      const summary = { ok: true, action, attempted: targets.length, succeeded: r.ok, failed: r.fail, nonAWA_stillOnSale: remaining, failures: r.failures, undo: `data/rackhams-undo/${ts}-off.json` };
      await ghPut('data/rackhams-last.json', { ...summary, when: ts }, 'Rackhams last run');
      return res.status(200).json(summary);
    }

    // ---------- ON (AWA off sale -> on, minus mounts) ----------
    if (action === 'on') {
      const notDisplayed = await collect('NOT_DISPLAYED');
      let targets = notDisplayed.filter(n => isMine(n) && !isMount(n));
      const totalTargets = targets.length;
      if (max) targets = targets.slice(0, max);
      if (!confirm) {
        return res.status(200).json({ ok: true, action, dryRun: true, wouldChange: totalTargets, thisCall: targets.length, mountsExcluded: notDisplayed.filter(isMount).map(n => ({ legacyId: n.legacyId, title: n.title })), sample: targets.slice(0, 15).map(n => ({ legacyId: n.legacyId, title: n.title })), note: 'Add &confirm=1 to apply.' });
      }
      await ghPut(`data/rackhams-undo/${ts}-on.json`, { action: 'on', when: ts, restorePublished: false, items: targets.map(n => ({ id: n.id, legacyId: n.legacyId, title: n.title })) }, `Rackhams undo: on ${targets.length}`);
      const r = await runPool(targets, (n) => setPublished(n.id, true), CONCURRENCY);
      const afterND = await collect('NOT_DISPLAYED');
      const stillOff = afterND.filter(n => isMine(n) && !isMount(n)).length;
      const summary = { ok: true, action, attempted: targets.length, succeeded: r.ok, failed: r.fail, AWA_stillOffSale: stillOff, note: 'Some may stay offline if the advert is invalid (e.g. missing taxon/vetting).', failures: r.failures, undo: `data/rackhams-undo/${ts}-on.json` };
      await ghPut('data/rackhams-last.json', { ...summary, when: ts }, 'Rackhams last run');
      return res.status(200).json(summary);
    }

    // ---------- UNDO ----------
    if (action === 'undo') {
      const file = (q.file || '').toString();
      if (!file) return res.status(200).json({ ok: false, error: 'Pass &file=data/rackhams-undo/....json' });
      const u = await ghGet(file);
      if (!u || !Array.isArray(u.items)) return res.status(200).json({ ok: false, error: 'Undo file not found or invalid.' });
      const val = u.restorePublished === true;
      const r = await runPool(u.items, (n) => setPublished(n.id, val), CONCURRENCY);
      return res.status(200).json({ ok: true, action, restored: r.ok, failed: r.fail, setPublishedTo: val, failures: r.failures });
    }

    // ---------- CAPS (can my key make an import/brand rule?) ----------
    if (action === 'caps') {
      const out = { ok: true, action, note: 'Read-only. Checks what the API/your key exposes. No write.' };
      const grab = async (fn, key) => { try { out[key] = await fn(); } catch (e) { out[key] = 'error: ' + e.message.slice(0, 200); } };

      await grab(async () => {
        const d = await mp(`query { __schema { queryType { name } mutationType { name } } }`, {});
        return d.__schema;
      }, 'roots');

      await grab(async () => {
        const t = await typeInfo('Mutation');
        const names = (t && t.fields || []).map(f => f.name);
        return names.filter(n => /catalog|rule|import|vendor|brand|publish/i.test(n));
      }, 'mutations_matching');

      await grab(async () => {
        const t = await typeInfo('QueryRoot');
        const t2 = t && t.fields ? t : await typeInfo('Query');
        const names = (t2 && t2.fields || []).map(f => f.name);
        return names.filter(n => /catalog|rule|import|vendor|brand/i.test(n));
      }, 'queries_matching');

      await grab(async () => (await typeInfo('CatalogRulesKeyEnum')).enumValues.map(e => e.name), 'catalogRuleKeys');
      await grab(async () => (await typeInfo('CatalogRulesOperatorEnum')).enumValues.map(e => e.name), 'catalogRuleOperators');
      await grab(async () => (await typeInfo('CatalogRulesOutcomeTypeEnum')).enumValues.map(e => e.name), 'catalogRuleOutcomes');
      await grab(async () => (await typeInfo('CatalogRuleCreateMutationInput')).inputFields.map(f => f.name), 'catalogRuleCreateInput');
      await grab(async () => (await typeInfo('CatalogRuleInput')).inputFields.map(f => f.name), 'catalogRuleInput');

      // Can the key actually READ existing catalog rules? (proves access without writing)
      await grab(async () => {
        const d = await mp(`query { catalogRules(first: 5) { totalCount nodes { id key operator errorMessage } } }`, {});
        return d.catalogRules;
      }, 'catalogRules_liveRead');

      return res.status(200).json(out);
    }

    // ---------- DIAG (why are AWA off? vetting vs data error) ----------
    if (action === 'diag') {
      const sampleN = Math.max(1, Math.min(40, parseInt(q.sample, 10) || 12));
      const nd = await collect('NOT_DISPLAYED');
      const awaOff = nd.filter(n => isMine(n) && !isMount(n));
      const sample = awaOff.slice(0, sampleN);
      const rows = [];
      for (const n of sample) {
        let node;
        try { node = (await mp(NODE_DIAG, { id: n.id })).node; }
        catch (e) { try { node = (await mp(NODE_DIAG_FALLBACK, { id: n.id })).node; node._diagNote = 'catalogRulesErrors unavailable'; } catch (e2) { node = { error: e2.message.slice(0, 150) }; } }
        rows.push({ legacyId: node.legacyId, title: node.title, published: node.published, online: node.online, statusText: node.statusText, catalogRulesErrors: node.catalogRulesErrors || null });
      }
      const withErrors = rows.filter(r => r.catalogRulesErrors && r.catalogRulesErrors.length).length;
      return res.status(200).json({ ok: true, action, awaOffSale_total: awaOff.length, sampled: rows.length, sampleWithCatalogErrors: withErrors, statusTextsSeen: [...new Set(rows.map(r => r.statusText))], sample: rows, note: 'Read-only. "statusText" shows In vetting vs other; catalogRulesErrors lists missing data if any.' });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action. Use probe | caps | diag | test | off | on | undo.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
