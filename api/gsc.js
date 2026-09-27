// gsc.js — 2026-09-27: refresh-opportunities now ALSO builds data/gsc-performing-keywords.json — queries
//   you already get CLICKS on (impr>=30, clicks>=1) + the page that ranks for each (a [page,query] pull),
//   for the "Ya rankeás — capturá más" panel in the Product + Blog tools. Same intent cache, one AI pass.
// gsc.js — 2026-09-26: added `refresh-opportunities` (daily cron) — saves high-impression/low-click
//   queries, AI-classified product vs blog (cached), for the Social / New Product / Blog tools.
const https = require('https');

/* ================= GSC opportunity keywords (for Social / New Product / Blog tools) =================
   "Opportunity" = a query with lots of impressions but few clicks (low CTR): you appear in Google but
   aren't clicked. Brand queries are excluded. Each is classified once by AI as 'product' (commercial)
   or 'blog' (informational); the classification is cached so only brand-new keywords are ever sent to
   the AI. Refreshed daily by a cron. ============================================================= */
const GH_OPP_REPO = 'aboutwallart/seo-tools';
const OPP_LIST_PATH = 'data/gsc-opportunity-keywords.json';   // the ranked, classified list tools read
const OPP_CACHE_PATH = 'data/gsc-keyword-intent-cache.json';  // keyword -> 'product'|'blog' (grows over time)
const OPP_MIN_IMPRESSIONS = 30, OPP_MAX_CTR = 0.02, OPP_TOP_N = 150;

// "Performing" list (separate from the low-CTR opportunities above): queries you ALREADY get clicks on
// but haven't necessarily locked to a page. Surfaced in the "Ya rankeás — capturá más" panel so Mae can
// either lock a top-ranking one to its page (→ Money Page Doctor to optimise) or build a new page for it.
// The ranking URL comes from a [page,query] pull; the "is this keyword/URL locked?" checks are done by
// the CONSUMER tools (they read the registry — gsc.js stays pure GSC data).
const PERFORMING_LIST_PATH = 'data/gsc-performing-keywords.json';
const PERFORMING_MIN_IMPRESSIONS = 30, PERFORMING_MIN_CLICKS = 1, PERFORMING_TOP_N = 300;
function computePerforming(queryRows, pageQueryRows) {
  const brand = /about\s*wall\s*art|aboutwallart/i;
  // Best-ranking page per query: lowest average position wins (tie → most impressions on that page).
  const pageByQuery = {};
  (pageQueryRows || []).forEach(r => {
    const page = r.keys && r.keys[0], q = r.keys && r.keys[1];
    if (!page || !q) return;
    const pos = r.position || 999, impr = r.impressions || 0;
    const cur = pageByQuery[q];
    if (!cur || pos < cur.pos || (pos === cur.pos && impr > cur.impr)) pageByQuery[q] = { url: page, pos, impr };
  });
  return (queryRows || [])
    .map(r => ({ keyword: (r.keys && r.keys[0]) || '', impressions: Math.round(r.impressions || 0), clicks: Math.round(r.clicks || 0), ctr: r.ctr || 0, position: Math.round((r.position || 0) * 10) / 10 }))
    .filter(r => r.keyword && !brand.test(r.keyword) && r.impressions >= PERFORMING_MIN_IMPRESSIONS && r.clicks >= PERFORMING_MIN_CLICKS)
    .map(r => ({ ...r, rankingUrl: (pageByQuery[r.keyword] && pageByQuery[r.keyword].url) || null }))
    .sort((a, b) => (a.position - b.position) || (b.clicks - a.clicks)) // best rank first (top-6 float up), then most clicks
    .slice(0, PERFORMING_TOP_N);
}

async function ghGetFile(path) {
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_OPP_REPO}/contents/${path}`, {
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return { sha: null, json: null };
    const j = await r.json();
    let parsed = null;
    try { parsed = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8')); } catch (e) { parsed = null; }
    return { sha: j.sha || null, json: parsed };
  } catch (e) { return { sha: null, json: null }; }
}
async function ghPutFile(path, obj, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_OPP_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error('GitHub write failed: ' + r.status + ' ' + t.slice(0, 200)); }
  return true;
}
function computeOpportunities(rows) {
  const brand = /about\s*wall\s*art|aboutwallart/i;
  return (rows || [])
    .map(r => ({ keyword: (r.keys && r.keys[0]) || '', impressions: Math.round(r.impressions || 0), clicks: Math.round(r.clicks || 0), ctr: r.ctr || 0, position: Math.round((r.position || 0) * 10) / 10 }))
    .filter(r => r.keyword && !brand.test(r.keyword) && r.impressions >= OPP_MIN_IMPRESSIONS && r.ctr <= OPP_MAX_CTR)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, OPP_TOP_N);
}
// Classify ONLY brand-new keywords (never seen before) via one AI call -> { keyword: 'product'|'blog' }.
async function classifyNewIntents(newKeywords) {
  if (!newKeywords.length) return {};
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const prompt = 'You classify search keywords for a UK wall-art & home-decor shop (About Wall Art). '
    + 'For each keyword decide the searcher\'s intent:\n'
    + '- "product" = commercial / buying intent (they want to buy wall art, e.g. "boho wall art set of 3", "living room canvas prints").\n'
    + '- "blog" = informational intent (how-to, ideas, meaning, tips, guides, e.g. "how to hang wall art", "cherry blossom meaning").\n'
    + 'Return ONLY a JSON object mapping each keyword EXACTLY as given to "product" or "blog". No other text.\n\n'
    + 'Keywords:\n' + newKeywords.map(k => '- ' + k).join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Claude API error ' + r.status + ': ' + t.slice(0, 200)); }
  const data = await r.json();
  let txt = (data.content && Array.isArray(data.content)) ? data.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
  txt = txt.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const m = txt.match(/\{[\s\S]*\}/);
  let obj = {};
  try { obj = m ? JSON.parse(m[0]) : {}; } catch (e) { obj = {}; }
  const out = {};
  newKeywords.forEach(k => { const v = (obj[k] || '').toString().toLowerCase(); out[k] = (v === 'blog') ? 'blog' : 'product'; }); // default to product if unclear
  return out;
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // Step 1: Get a fresh access token using the refresh token
    const accessToken = await getAccessToken();

    // Step 2: Read which action is requested
    const { action, startDate, endDate, urls } = req.method === 'POST'
      ? req.body
      : req.query;

    const siteUrl = 'sc-domain:aboutwallart.com';

    // Default date range: last 28 days
    const end = endDate || getTodayDate();
    const start = startDate || getDateDaysAgo(28);

    let data;

    if (action === 'overview') {
      // High level metrics: total clicks, impressions, CTR, avg position
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: [],
        rowLimit: 1
      });
    } else if (action === 'monthly') {
      // Monthly breakdown for historical view (last 12 months)
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['date'],
        rowLimit: 500
      });
    } else if (action === 'queries') {
      // All queries with impressions — for content optimization ideas
      const qLimit = Math.min(parseInt(req.query.limit) || 1000, 25000);
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['query'],
        rowLimit: qLimit
      });
    } else if (action === 'pages') {
      // Top pages by clicks
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['page'],
        rowLimit: 5000
      });
    } else if (action === 'page-query') {
      // Page + query combined — for content optimizations.
      // Optional country filter (e.g. country=gbr) → UK-only positions for the winner / locked-keyword logic.
      const pqCountry = (req.method === 'POST' ? req.body : req.query).country;
      const pqParams = {
        startDate: start,
        endDate: end,
        dimensions: ['page', 'query'],
        rowLimit: 25000
      };
      if (pqCountry) {
        pqParams.dimensionFilterGroups = [{
          filters: [{ dimension: 'country', operator: 'equals', expression: String(pqCountry).toLowerCase() }]
        }];
      }
      data = await gscQuery(accessToken, siteUrl, pqParams);
    } else if (action === 'page-keywords') {
      // All queries for a specific page URL — bypasses 25k global limit
      const pageUrl = req.query.pageUrl || '';
      if (!pageUrl) throw new Error('pageUrl param required');
      const fullUrl = pageUrl.startsWith('http') ? pageUrl : `https://aboutwallart.com${pageUrl}`;
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['query'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            operator: 'equals',
            expression: fullUrl
          }]
        }],
        rowLimit: 25000
      });
    } else if (action === 'keyword-page') {
      // Find ranking page(s) for a specific keyword — used by Keyword Rankings Without URL tab
      const keyword = req.query.keyword || '';
      if (!keyword) throw new Error('keyword param required');
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['page', 'query'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'query',
            operator: 'equals',
            expression: keyword.toLowerCase()
          }]
        }],
        rowLimit: 10
      });

    } else if (action === 'device') {
      // Device breakdown
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['device'],
        rowLimit: 10
      });
    } else if (action === 'blog-tracking') {
      // Performance of specific URLs (for blog tracking)
      // Pass urls as comma-separated string
      const urlList = urls ? urls.split(',') : [];
      const results = [];
      for (const url of urlList) {
        const result = await gscQuery(accessToken, siteUrl, {
          startDate: start,
          endDate: end,
          dimensions: ['page'],
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              operator: 'equals',
              expression: url.trim()
            }]
          }],
          rowLimit: 1
        });
        results.push({ url: url.trim(), data: result });
      }
      data = results;
    } else if (action === 'keyword-monthly') {
      // Monthly impressions + clicks for an exact keyword — for Keyword Tracker growth chart
      // Uses dimensions: ['date'] with exact query filter so GSC aggregates daily totals
      const keyword = req.query.keyword || req.body?.keyword || '';
      if (!keyword) throw new Error('keyword param required');
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['date'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'query',
            operator: 'equals',
            expression: keyword.toLowerCase()
          }]
        }],
        rowLimit: 500
      });

    } else if (action === 'ga4-traffic-breakdown') {
      // GA4 traffic breakdown by page path and month — for suspicious traffic stacked chart
      const propertyId = process.env.GA4_PROPERTY_ID;
      if (!propertyId) throw new Error('GA4_PROPERTY_ID not configured');

      const ga4Body = {
        dateRanges: [{ startDate: getDateDaysAgo(365), endDate: getTodayDate() }],
        dimensions: [{ name: 'yearMonth' }, { name: 'pagePath' }],
        metrics: [{ name: 'sessions' }, { name: 'bounceRate' }, { name: 'engagedSessions' }],
        limit: 5000
      };
      data = await ga4Query(accessToken, propertyId, ga4Body);

    } else if (action === 'ga4-suspicious') {
      // GA4 suspicious traffic — sessions with 0 engaged sessions (bounced) per month
      const propertyId = process.env.GA4_PROPERTY_ID;
      if (!propertyId) throw new Error('GA4_PROPERTY_ID not configured');

      const ga4Body = {
        dateRanges: [{ startDate: getDateDaysAgo(365), endDate: getTodayDate() }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'engagedSessions' }
        ],
        limit: 20
      };
      data = await ga4Query(accessToken, propertyId, ga4Body);

    } else if (action === 'ga4-llm') {
      // GA4 LLM Traffic — referral sessions from AI tools
      const propertyId = process.env.GA4_PROPERTY_ID;
      if (!propertyId) throw new Error('GA4_PROPERTY_ID not configured');

      const days = parseInt(req.query.days || '90');
      const ga4End = getTodayDate();
      const ga4Start = getDateDaysAgo(days);

      const llmSources = [
        'chat.openai.com','chatgpt.com','perplexity.ai','claude.ai',
        'gemini.google.com','copilot.microsoft.com','you.com','phind.com','poe.com'
      ];

      const ga4Body = {
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'sessionSource' }, { name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
        dimensionFilter: {
          orGroup: {
            expressions: llmSources.map(source => ({
              filter: {
                fieldName: 'sessionSource',
                stringFilter: { matchType: 'CONTAINS', value: source.replace('www.','').split('.')[0] }
              }
            }))
          }
        },
        limit: 1000
      };

      data = await ga4Query(accessToken, propertyId, ga4Body);

    } else if (action === 'ga4-social') {
      // GA4 Social Traffic — sessions by social platform + date
      const propertyId = process.env.GA4_PROPERTY_ID;
      if (!propertyId) throw new Error('GA4_PROPERTY_ID not configured');

      const days = parseInt(req.query.days || '365');
      const ga4End = getTodayDate();
      const ga4Start = getDateDaysAgo(days);

      const socialSources = ['facebook','instagram','pinterest','tiktok','youtube','twitter','t.co','x.com','linkedin'];

      const ga4Body = {
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'sessionSource' }, { name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
        dimensionFilter: {
          orGroup: {
            expressions: socialSources.map(source => ({
              filter: {
                fieldName: 'sessionSource',
                stringFilter: { matchType: 'CONTAINS', value: source }
              }
            }))
          }
        },
        limit: 5000
      };
      data = await ga4Query(accessToken, propertyId, ga4Body);

    } else if (action === 'ga4-social-pages') {
      // GA4 Social Traffic — sessions by social platform + landing page
      const propertyId = process.env.GA4_PROPERTY_ID;
      if (!propertyId) throw new Error('GA4_PROPERTY_ID not configured');

      const days = parseInt(req.query.days || '90');
      const ga4End = getTodayDate();
      const ga4Start = getDateDaysAgo(days);

      const socialSources = ['facebook','instagram','pinterest','tiktok','youtube','twitter','t.co','x.com','linkedin'];

      const ga4Body = {
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'sessionSource' }, { name: 'pagePath' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
        dimensionFilter: {
          orGroup: {
            expressions: socialSources.map(source => ({
              filter: {
                fieldName: 'sessionSource',
                stringFilter: { matchType: 'CONTAINS', value: source }
              }
            }))
          }
        },
        limit: 5000
      };
      data = await ga4Query(accessToken, propertyId, ga4Body);

    } else if (action === 'reindex-batch') {
      // Daily re-indexing email batch — returns formatted email HTML for today's batch
      const pagesData = await gscQuery(accessToken, siteUrl, {
        startDate: getDateDaysAgo(90),
        endDate: getTodayDate(),
        dimensions: ['page'],
        rowLimit: 150
      });

      const allPages = (pagesData.rows || [])
        .map(r => r.keys[0])
        .filter(url => !url.includes('?') && !url.includes('#'));

      const batchSize = 10;
      const totalBatches = Math.ceil(allPages.length / batchSize);

      // Calculate which batch based on days since campaign start (2026-06-07)
      const campaignStart = new Date('2026-06-07T00:00:00Z');
      const now = new Date();
      const dayIndex = Math.max(0, Math.floor((now - campaignStart) / (1000 * 60 * 60 * 24)));
      const batchIndex = dayIndex % totalBatches;
      const batchStart = batchIndex * batchSize;
      const batchUrls = allPages.slice(batchStart, batchStart + batchSize);
      const dayNumber = dayIndex + 1;

      // GSC URL Inspection deep link base
      const gscBase = 'https://search.google.com/search-console/inspect?resource_id=sc-domain:aboutwallart.com&id=';

      // Build URL table rows
      const urlRowsHtml = batchUrls.map((url, i) => {
        const shortPath = url.replace('https://aboutwallart.com', '') || '/';
        return `
          <tr>
            <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#888;border-bottom:1px solid #f0f0f0;white-space:nowrap;">${batchStart + i + 1}</td>
            <td style="padding:10px 16px;font-size:13px;color:#1a1a1a;border-bottom:1px solid #f0f0f0;word-break:break-all;font-family:monospace;">${url}</td>
          </tr>`;
      }).join('');

      const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">

    <div style="background:#1a1a1a;padding:24px 32px;">
      <div style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">aboutwallart.com — SEO Recovery</div>
      <div style="color:#fff;font-size:20px;font-weight:700;">🔍 Daily Re-indexing Reminder</div>
      <div style="color:#888;font-size:13px;margin-top:8px;">Day ${dayNumber} &nbsp;·&nbsp; Batch ${batchIndex + 1} of ${totalBatches} &nbsp;·&nbsp; URLs ${batchStart + 1}–${batchStart + batchUrls.length}</div>
    </div>

    <div style="padding:20px 32px;border-bottom:1px solid #f0f0f0;background:#fffbeb;">
      <div style="font-size:13px;color:#92400e;line-height:1.6;">
        <strong>Why you're doing this:</strong> 173,314 pages were deindexed after an anti-fraud app damaged your metadata in April 2026. Google needs to re-crawl each page to restore rankings. You can request re-indexing for up to 10–15 URLs per day — this email gives you today's batch in priority order (highest traffic first).
      </div>
    </div>

    <div style="padding:24px 32px;">
      <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:16px;">Today's ${batchUrls.length} URLs to submit</div>
      <div style="margin-bottom:16px;">
        <a href="https://search.google.com/search-console/inspect?resource_id=sc-domain:aboutwallart.com" style="background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600;">Open GSC URL Inspection →</a>
        <span style="font-size:12px;color:#888;margin-left:12px;">Then copy each URL below and paste into the inspection bar</span>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9f9f9;">
            <th style="padding:10px 16px;font-size:11px;font-weight:600;color:#888;text-align:left;text-transform:uppercase;border-bottom:1px solid #e5e5e5;">#</th>
            <th style="padding:10px 16px;font-size:11px;font-weight:600;color:#888;text-align:left;text-transform:uppercase;border-bottom:1px solid #e5e5e5;">URL — copy and paste into GSC</th>
          </tr>
        </thead>
        <tbody>${urlRowsHtml}</tbody>
      </table>
    </div>

    <div style="padding:0 32px 24px;">
      <div style="background:#f9f9f9;border-radius:8px;padding:20px 24px;border:1px solid #e5e5e5;">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;">📋 How to request re-indexing (takes ~5 minutes)</div>
        <ol style="margin:0;padding-left:20px;color:#555;font-size:13px;line-height:2.2;">
          <li>Click <strong>"Open in GSC →"</strong> next to the first URL above</li>
          <li>Google Search Console opens with that URL already loaded</li>
          <li>Wait for the inspection to complete (5–10 seconds)</li>
          <li>Click the <strong>"Request indexing"</strong> button</li>
          <li>Wait for the confirmation: <em>"Indexing requested"</em></li>
          <li>Close that tab and move to the next URL</li>
          <li>Repeat for all ${batchUrls.length} URLs — done!</li>
        </ol>
        <div style="margin-top:14px;padding:12px 16px;background:#fff;border-radius:6px;border:1px solid #e5e5e5;font-size:12px;color:#888;">
          ⚠️ <strong>Google's daily limit is 10–15 requests.</strong> Don't submit more than this in one day — it won't speed things up and may trigger a rate limit. Tomorrow's email will automatically send the next batch.
        </div>
      </div>
    </div>

    <div style="padding:0 32px 24px;text-align:center;">
      <div style="font-size:13px;color:#888;">
        Track your progress in the <strong>🔧 Technical Health</strong> tab of your
        <a href="https://tools.aboutwallart.com/easy-seo-report.html" style="color:#1a1a1a;font-weight:600;">SEO Report Tool</a>
      </div>
    </div>

    <div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #e5e5e5;text-align:center;">
      <div style="font-size:11px;color:#aaa;">Sent automatically every day at 8am London · aboutwallart.com SEO Report</div>
    </div>

  </div>
</body>
</html>`;

      data = {
        emailSubject: `🔍 Re-indexing Day ${dayNumber}: ${batchUrls.length} URLs to submit today`,
        emailHtml,
        dayNumber,
        batchIndex,
        batchStart,
        totalBatches,
        batchUrls
      };

    } else if (action === 'refresh-opportunities') {
      // Daily job: pull queries, keep the high-impression/low-click ones, classify NEW ones with AI
      // (cached), and save the ranked, classified list for the Social / New Product / Blog tools.
      const qrows = (await gscQuery(accessToken, siteUrl, {
        startDate: start, endDate: end, dimensions: ['query'], rowLimit: 25000
      })).rows || [];
      const opps = computeOpportunities(qrows);
      // Extra [page,query] pull so the performing list knows WHICH page ranks for each keyword.
      const pqrows = (await gscQuery(accessToken, siteUrl, {
        startDate: start, endDate: end, dimensions: ['page', 'query'], rowLimit: 25000
      })).rows || [];
      const performing = computePerforming(qrows, pqrows);

      const cacheFile = await ghGetFile(OPP_CACHE_PATH);
      const cache = (cacheFile.json && typeof cacheFile.json === 'object') ? cacheFile.json : {};
      // Classify NEW keywords from BOTH lists in one pass (cached — nothing re-sent to the AI twice).
      const allKw = [...new Set([...opps.map(o => o.keyword), ...performing.map(o => o.keyword)])];
      const unknown = allKw.filter(k => !(k in cache));
      let classifiedNow = 0;
      if (unknown.length) {
        const fresh = await classifyNewIntents(unknown);
        Object.keys(fresh).forEach(k => { cache[k] = fresh[k]; });
        classifiedNow = Object.keys(fresh).length;
        await ghPutFile(OPP_CACHE_PATH, cache, cacheFile.sha, `GSC intent cache +${classifiedNow}`);
      }
      const keywords = opps.map(o => Object.assign({}, o, { intent: cache[o.keyword] || 'product' }));
      const listFile = await ghGetFile(OPP_LIST_PATH);
      await ghPutFile(OPP_LIST_PATH, {
        updatedAt: new Date().toISOString(), window: { start, end },
        count: keywords.length,
        productCount: keywords.filter(k => k.intent === 'product').length,
        blogCount: keywords.filter(k => k.intent === 'blog').length,
        keywords
      }, listFile.sha, `GSC opportunities refresh (${keywords.length})`);

      // Write the performing list (with each keyword's intent + ranking URL).
      const perfKeywords = performing.map(o => Object.assign({}, o, { intent: cache[o.keyword] || 'product' }));
      const perfFile = await ghGetFile(PERFORMING_LIST_PATH);
      await ghPutFile(PERFORMING_LIST_PATH, {
        updatedAt: new Date().toISOString(), window: { start, end },
        count: perfKeywords.length,
        productCount: perfKeywords.filter(k => k.intent === 'product').length,
        blogCount: perfKeywords.filter(k => k.intent === 'blog').length,
        keywords: perfKeywords
      }, perfFile.sha, `GSC performing refresh (${perfKeywords.length})`);

      data = { refreshed: true, total: keywords.length, performingTotal: perfKeywords.length, newlyClassified: classifiedNow,
        productCount: keywords.filter(k => k.intent === 'product').length,
        blogCount: keywords.filter(k => k.intent === 'blog').length };
    } else {
      // Default: overview
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: [],
        rowLimit: 1
      });
    }

    // For reindex-batch, return flat response so Make.com can access fields directly
    if (action === 'reindex-batch') {
      res.status(200).json(data);
      return;
    }
    res.status(200).json({ success: true, data });

  } catch (error) {
    console.error('GSC API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── Helper: Get fresh access token from refresh token ───────────────────────
async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GSC_CLIENT_ID,
    client_secret: process.env.GSC_CLIENT_SECRET,
    refresh_token: process.env.GSC_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    const reqHttp = https.request(options, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error('No access token in response: ' + body));
          }
        } catch (e) {
          reject(new Error('Failed to parse token response: ' + body));
        }
      });
    });

    reqHttp.on('error', reject);
    reqHttp.write(params.toString());
    reqHttp.end();
  });
}

// ─── Helper: Query GSC Search Analytics API ──────────────────────────────────
async function gscQuery(accessToken, siteUrl, body) {
  const encodedSite = encodeURIComponent(siteUrl);
  const path = `/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;

  return new Promise((resolve, reject) => {
    const postBody = JSON.stringify(body);

    const options = {
      hostname: 'www.googleapis.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postBody)
      }
    };

    const reqHttp = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Failed to parse GSC response: ' + data));
        }
      });
    });

    reqHttp.on('error', reject);
    reqHttp.write(postBody);
    reqHttp.end();
  });
}

// ─── Helper: Query GA4 Data API ───────────────────────────────────────────────
async function ga4Query(accessToken, propertyId, body) {
  const path = `/v1beta/properties/${propertyId}:runReport`;
  return new Promise((resolve, reject) => {
    const postBody = JSON.stringify(body);
    const options = {
      hostname: 'analyticsdata.googleapis.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postBody)
      }
    };
    const reqHttp = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse GA4 response: ' + data));
        }
      });
    });
    reqHttp.on('error', reject);
    reqHttp.write(postBody);
    reqHttp.end();
  });
}

// ─── Helper: Date utilities ───────────────────────────────────────────────────
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
