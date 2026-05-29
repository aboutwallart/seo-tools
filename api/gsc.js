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
        rowLimit: 5000
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
      const keyword = req.query.keyword || req.body?.keyword || '';
      if (!keyword) throw new Error('keyword param required');
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: ['date', 'query'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'query',
            operator: 'equals',
            expression: keyword.toLowerCase()
          }]
        }],
        rowLimit: 500
      });

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

    } else {
      // Default: overview
      data = await gscQuery(accessToken, siteUrl, {
        startDate: start,
        endDate: end,
        dimensions: [],
        rowLimit: 1
      });
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
