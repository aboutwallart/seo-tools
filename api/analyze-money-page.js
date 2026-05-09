// Money Page Optimizer Backend API
const SERPAPI_KEY = "68107cf15dd25fd2db81f5a708ac339958c1d555334338a971e8d501653711c4";
const PAGESPEED_KEY = "AIzaSyDZBj1f-ZEcBys8T5ldt3quwCYCFjlyq5U";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pageUrl, keyword } = req.body;
    if (!pageUrl || !keyword) return res.status(400).json({ error: 'Missing data' });

    const start = Date.now();
    console.log('[1/5] Finding competitors...');
    const competitors = await findCompetitors(keyword);
    if (!competitors.length) return res.status(500).json({ error: 'No competitors found' });

    console.log('[2/5] Analyzing YOUR page SEO...');
    const yourPage = await analyzePage(pageUrl, keyword, false);

    console.log('[3/5] Getting YOUR PageSpeed scores...');
    yourPage.speedMobile = await getPageSpeed(pageUrl, 'mobile');
    await sleep(1000);
    yourPage.speedDesktop = await getPageSpeed(pageUrl, 'desktop');

    console.log('[4/5] Analyzing 3 competitors...');
    const competitorData = [];
    for (let i = 0; i < Math.min(3, competitors.length); i++) {
      const data = await analyzePage(competitors[i].url, keyword, true);
      if (data) competitorData.push(data);
    }

    console.log('[5/5] Getting AI recommendations...');
    const recommendations = await getClaudeAnalysis(yourPage, competitorData, keyword);

    console.log(`✓ Done in ${Math.round((Date.now() - start) / 1000)}s`);
    return res.status(200).json({ yourPage, competitors: competitorData, recommendations });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function findCompetitors(keyword) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.organic_results || []).slice(0, 3).map(r => ({ title: r.title, url: r.link }));
  } catch (e) {
    console.error('SerpAPI error:', e);
    return [];
  }
}

async function analyzePage(url, keyword, isCompetitor) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const data = extractSEO(html, url, keyword);
    
    if (isCompetitor) {
      data.speedMobile = 'N/A';
      data.speedDesktop = 'N/A';
    }
    
    return data;
  } catch (e) {
    console.error(`Error analyzing ${url}:`, e);
    return null;
  }
}

function extractSEO(html, url, keyword) {
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || ['', ''])[1].trim();
  const meta = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || ['', ''])[1].trim();
  
  const h1 = (html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || []).map(m => m.replace(/<\/?h1[^>]*>/gi, '').trim());
  const h2 = (html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || []).map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim());
  const h3 = (html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || []).map(m => m.replace(/<\/?h3[^>]*>/gi, '').trim());
  
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const kwLower = keyword.toLowerCase();
  const kwCount = (text.toLowerCase().match(new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const kwDensity = wordCount > 0 ? ((kwCount / wordCount) * 100).toFixed(2) : 0;
  
  return {
    url, title, metaDescription: meta, h1, h2, h3,
    wordCount, keywordOccurrences: kwCount, keywordDensity: parseFloat(kwDensity),
    internalLinks: (html.match(/<a[^>]*href=/gi) || []).length,
    externalLinks: (html.match(/<a[^>]*href=["']https?:/gi) || []).length,
    images: (html.match(/<img[^>]*>/gi) || []).length
  };
}

async function getPageSpeed(url, strategy) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PAGESPEED_KEY}&strategy=${strategy}`;
    const res = await fetch(apiUrl);
    const data = await res.json();
    const score = data.lighthouseResult?.categories?.performance?.score;
    return score ? Math.round(score * 100) : 'N/A';
  } catch (e) {
    return 'N/A';
  }
}

async function getClaudeAnalysis(yourPage, competitors, keyword) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found');

  const avgWords = competitors.length ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length) : 0;
  const avgDensity = competitors.length ? (competitors.reduce((s, c) => s + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const prompt = `SEO expert analysis for money page.

KEYWORD: "${keyword}"

YOUR PAGE:
- Title: ${yourPage.title} (${yourPage.title.length} chars)
- Meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'None'}
- H2: ${yourPage.h2.length} tags
- Word count: ${yourPage.wordCount}
- Keyword density: ${yourPage.keywordDensity}%
- Speed Mobile: ${yourPage.speedMobile}
- Speed Desktop: ${yourPage.speedDesktop}

COMPETITOR AVG: ${avgWords} words, ${avgDensity}% density

COMPETITORS:
${competitors.map((c, i) => `${i+1}. ${c.title}\n   Words: ${c.wordCount}, Density: ${c.keywordDensity}%`).join('\n')}

Return ONLY valid JSON:
{
  "high": [{"title": "", "description": "", "current": "", "recommended": "", "why": ""}],
  "medium": [...],
  "low": [...]
}

HIGH: Critical (missing title/meta/H1, bad keyword use)
MEDIUM: Important (word count, structure, speed)
LOW: Polish (minor optimizations)`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    
    throw new Error('Could not parse response');
  } catch (e) {
    console.error('Claude error:', e);
    throw e;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
