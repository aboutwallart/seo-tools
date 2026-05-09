// Money Page Optimizer Backend API - ChatGPT-style format
const SERPAPI_KEY = "68107cf15dd25fd2db81f5a708ac339958c1d555334338a971e8d501653711c4";
const PAGESPEED_KEY = "AIzaSyDZBj1f-ZEcBys8T5ldt3quwCYCFjlyq5U";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pageUrl, keyword, csvData } = req.body;
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
    const recommendations = await getClaudeAnalysis(yourPage, competitorData, keyword, csvData);

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

  const prompt = `You are an SEO expert. Analyze this money page and give EXACT, ACTIONABLE recommendations.

TARGET KEYWORD: "${keyword}"

YOUR PAGE:
URL: ${yourPage.url}
Title: ${yourPage.title} (${yourPage.title.length} chars)
Meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
H1: ${yourPage.h1.join(', ') || 'MISSING'}
H2s: ${yourPage.h2.length > 0 ? yourPage.h2.slice(0, 5).join(', ') + (yourPage.h2.length > 5 ? '...' : '') : 'None'}
Word count: ${yourPage.wordCount}
Keyword occurrences: ${yourPage.keywordOccurrences}
Keyword density: ${yourPage.keywordDensity}%
PageSpeed Mobile: ${yourPage.speedMobile}
PageSpeed Desktop: ${yourPage.speedDesktop}

COMPETITOR DATA:
Average word count: ${avgWords}
Average keyword density: ${avgDensity}%

Competitor Details:
${competitors.map((c, i) => `${i+1}. Title: ${c.title}
   H1: ${c.h1.join(', ') || 'None'}
   Words: ${c.wordCount}, Density: ${c.keywordDensity}%`).join('\n')}

CRITICAL REQUIREMENTS:
Return ONLY valid JSON. Each recommendation MUST include:
1. EXACT copy to use (word-for-word text)
2. EXACT placement (where to put it)
3. Why it matters

Format EXACTLY like this:
{
  "high": [
    {
      "title": "1. Add H1 Tag",
      "description": "Add this as your ONLY H1 at the top of the page",
      "current": "No H1 found",
      "recommended": "Use exactly this: ${keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} – [Benefit Statement]",
      "why": "H1 is critical for SEO. All competitors have keyword in H1."
    }
  ],
  "medium": [...],
  "low": [...],
  "ai_search": [
    {
      "title": "1. Add Direct Answer Paragraph",
      "description": "Add this paragraph immediately after your H1, before any other content",
      "current": "No direct answer found",
      "recommended": "Add exactly this paragraph:\n\n${keyword.charAt(0).toUpperCase() + keyword.slice(1)} [write 2-3 sentence direct answer that AI can quote]. [Add specific details]. [Include key benefit].",
      "why": "AI search engines prioritize pages with clear, quotable answers at the top. This helps you appear in ChatGPT, Perplexity, and Google SGE results."
    },
    {
      "title": "2. Add FAQ Schema Markup",
      "description": "Add this code to a new Shopify custom liquid section",
      "current": "No schema markup found",
      "recommended": "Create new custom liquid section, paste schema code with FAQ questions and answers from your page",
      "why": "Schema markup helps Google show rich snippets and helps AI engines understand your content structure."
    },
    {
      "title": "3. Add Trust Signals",
      "description": "Add these trust elements to increase conversion and credibility",
      "current": "No trust signals found",
      "recommended": "Add trust elements: Free UK Delivery badge, 30-Day Money Back Guarantee, Secure Checkout badge, Customer review count in header",
      "why": "Trust signals reduce bounce rate and improve conversion - positive SEO signals. AI engines also look for credibility indicators."
    }
  ]
}

PRIORITY RULES:
HIGH: Missing H1, title, meta, broken keyword usage (fix first)
MEDIUM: Word count gaps, H2 structure, content additions
LOW: Minor polish, small optimizations
AI_SEARCH: Special section for AI/LLM optimization (ChatGPT, Perplexity, Google SGE)

For EVERY recommendation:
- Give EXACT copy (not "add keyword to title" but "Use exactly this: [exact title text]")
- Give EXACT placement (not "in intro" but "Add as first paragraph after H1")
- Include keyword naturally in recommended text
- Number each item (1. 2. 3...)

AI SEARCH OPTIMIZATION (ai_search section):
- Direct answer paragraph (quotable 2-3 sentences, exact placement)
- FAQ section with 3-5 Q&As (Question as H3, answer as paragraph, exact copy)
- Schema markup (EXACT JSON-LD code for Shopify custom liquid section)
- Trust signals (EXACT copy and placement)
- Key statistics or data points
- Step-by-step instructions if applicable

For SCHEMA MARKUP - provide:
- Complete JSON-LD code ready to paste into Shopify custom liquid section
- FAQ schema with actual questions/answers from the page
- Product/CollectionPage schema if applicable
- Breadcrumb schema
- Organization schema with brand info

For TRUST SIGNALS - provide:
- EXACT copy for each trust element
- EXACT placement (e.g., "Add to header, right of logo" or "Add above Add to Cart button")
- Examples: delivery promises, guarantees, secure checkout badges, review counts, years in business

DO NOT:
- Say "improve title" - give the EXACT new title
- Say "add keyword to meta" - write the COMPLETE new meta description
- Say "restructure headings" - list EXACT H2s to use
- Be vague about placement - specify EXACTLY where (after H1, under specific H2, etc.)

Return ONLY the JSON object, no other text.

CRITICAL JSON FORMATTING:
- Escape all quotes inside strings with backslash
- No unescaped line breaks (use \\n instead of actual newlines)
- Keep recommended text concise to avoid breaking JSON
- If including code examples, keep them SHORT or reference external docs`;

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
        max_tokens: 6000,
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
