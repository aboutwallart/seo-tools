const https = require('https');

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
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['query'],
        rowLimit: 1000
      });
    } else if (action === 'pages') {
      // Top pages by clicks
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['page'],
        rowLimit: 500
      });
    } else if (action === 'page-query') {
      // Page + query combined — for content optimizations
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['page', 'query'],
        rowLimit: 25000
      });
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
