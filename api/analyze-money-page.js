// Money Page Optimizer Backend API
// Handles SerpAPI, PageSpeed, web scraping, and Claude analysis

const SERPAPI_KEY = "68107cf15dd25fd2db81f5a708ac339958c1d555334338a971e8d501653711c4";
const PAGESPEED_KEY = "AIzaSyDZBj1f-ZEcBys8T5ldt3quwCYCFjlyq5U";

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pageUrl, keyword } = req.body;

    if (!pageUrl || !keyword) {
      return res.status(400).json({ error: 'Missing pageUrl or keyword' });
    }

    const startTime = Date.now();
    console.log(`[Money Page] Analyzing: ${pageUrl} for keyword: "${keyword}"`);

    // Step 1: Find competitors using SerpAPI
    console.log('[Money Page] Step 1: Finding competitors... (~10 sec)');
    const competitors = await findCompetitors(keyword);
    console.log(`[Money Page] ✓ Found ${competitors.length} competitors (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    if (competitors.length === 0) {
      return res.status(500).json({ error: 'Could not find competitors' });
    }

    // Step 2: Analyze your page
    console.log('[Money Page] Step 2: Analyzing your page... (~15 sec)');
    const yourPageData = await analyzePage(pageUrl, keyword);
    console.log(`[Money Page] ✓ Your page analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 3: Analyze competitors
    console.log('[Money Page] Step 3: Analyzing 3 competitors... (~15 sec)');
    const competitorData = [];
    for (let i = 0; i < Math.min(3, competitors.length); i++) {
      const data = await analyzePage(competitors[i].url, keyword);
      if (data) {
        competitorData.push(data);
      }
    }
    console.log(`[Money Page] ✓ All competitors analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 4: Get Claude analysis
    console.log('[Money Page] Step 4: Getting AI recommendations... (~20 sec)');
    const recommendations = await getClaudeAnalysis(yourPageData, competitorData, keyword);
    console.log(`[Money Page] ✓ AI analysis complete! Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Return results
    return res.status(200).json({
      yourPage: yourPageData,
      competitors: competitorData,
      recommendations: recommendations
    });

  } catch (error) {
    console.error('[Money Page] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Find top competitors using SerpAPI
async function findCompetitors(keyword) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const organicResults = data.organic_results || [];
    const competitors = organicResults.slice(0, 4).map(result => ({
      title: result.title,
      url: result.link
    }));

    console.log(`[SerpAPI] Found ${competitors.length} competitors`);
    return competitors;

  } catch (error) {
    console.error('[SerpAPI] Error:', error);
    return [];
  }
}

// Analyze a single page
async function analyzePage(url, keyword) {
  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const html = await response.text();

    // Extract SEO data
    const seoData = extractSEOData(html, url, keyword);

    // NO PageSpeed for competitors - only YOUR page gets speed scores
    // This saves time and prevents timeout
    return {
      ...seoData,
      speedMobile: 'N/A',
      speedDesktop: 'N/A'
    };

  } catch (error) {
    console.error(`[Analyze Competitor] Error analyzing ${url}:`, error);
    return null;
  }
}

// Extract SEO data from HTML
function extractSEOData(html, url, keyword) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const metaDescription = metaMatch ? metaMatch[1].trim() : '';

  // Extract H1
  const h1Matches = html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [];
  const h1 = h1Matches.map(m => m.replace(/<\/?h1[^>]*>/gi, '').trim());

  // Extract H2
  const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
  const h2 = h2Matches.map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim());

  // Extract H3
  const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];
  const h3 = h3Matches.map(m => m.replace(/<\/?h3[^>]*>/gi, '').trim());

  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Word count
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Keyword count and density
  const keywordLower = keyword.toLowerCase();
  const textLower = text.toLowerCase();
  const keywordOccurrences = (textLower.match(new RegExp(keywordLower, 'g')) || []).length;
  const keywordDensity = wordCount > 0 ? ((keywordOccurrences / wordCount) * 100).toFixed(2) : 0;

  // Count links
  const internalLinks = (html.match(/<a[^>]*href=["'][^"']*["'][^>]*>/gi) || []).length;
  const externalLinks = (html.match(/<a[^>]*href=["']https?:\/\/[^"']*["'][^>]*>/gi) || []).length;

  // Count images
  const images = (html.match(/<img[^>]*>/gi) || []).length;

  return {
    url,
    title,
    metaDescription,
    h1,
    h2,
    h3,
    wordCount,
    keywordOccurrences,
    keywordDensity: parseFloat(keywordDensity),
    internalLinks,
    externalLinks,
    images
  };
}

// Get PageSpeed score
async function getPageSpeedScore(url, strategy) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PAGESPEED_KEY}&strategy=${strategy}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    const score = data.lighthouseResult?.categories?.performance?.score;
    return score ? Math.round(score * 100) : 'N/A';

  } catch (error) {
    console.error(`[PageSpeed] Error for ${url}:`, error);
    return 'N/A';
  }
}

// Get Claude analysis
async function getClaudeAnalysis(yourPage, competitors, keyword) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found');
  }

  const prompt = buildAnalysisPrompt(yourPage, competitors, keyword);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const analysisText = data.content[0].text.trim();
    
    // Remove markdown code blocks if present
    let cleanText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Parse the JSON response from Claude
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error('[Claude] JSON parse error:', parseError.message);
        console.error('[Claude] Failed JSON (first 500 chars):', jsonMatch[0].substring(0, 500));
        
        // Return fallback response
        return {
          high: [{
            title: "Analysis Error - Invalid JSON",
            description: "Claude returned malformed JSON. Try analyzing again.",
            current: "N/A",
            recommended: "N/A",
            why: "Technical parsing error"
          }],
          medium: [],
          low: []
        };
      }
    }

    throw new Error('Could not find JSON in Claude response');

  } catch (error) {
    console.error('[Claude] Error:', error);
    throw error;
  }
}

// Build the prompt for Claude
function buildAnalysisPrompt(yourPage, competitors, keyword) {
  const avgCompWordCount = competitors.length > 0 
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
    : 0;

  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2)
    : 0;

  return `You are an SEO expert analyzing a money page for competitive optimization.

TARGET KEYWORD: "${keyword}"

YOUR PAGE DATA:
- URL: ${yourPage.url}
- Title: ${yourPage.title} (${yourPage.title.length} chars)
- Meta Description: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'None'}
- H2 count: ${yourPage.h2.length}
- H3 count: ${yourPage.h3.length}
- Word count: ${yourPage.wordCount}
- Keyword occurrences: ${yourPage.keywordOccurrences}
- Keyword density: ${yourPage.keywordDensity}%
- PageSpeed Mobile: ${yourPage.speedMobile}
- PageSpeed Desktop: ${yourPage.speedDesktop}

COMPETITOR AVERAGE:
- Word count: ${avgCompWordCount}
- Keyword density: ${avgCompKeywordDensity}%

COMPETITOR DETAILS:
${competitors.map((comp, i) => `
Competitor ${i + 1}:
- Title: ${comp.title}
- Meta: ${comp.metaDescription || 'Missing'}
- H1: ${comp.h1.join(', ') || 'None'}
- Word count: ${comp.wordCount}
- Keyword density: ${comp.keywordDensity}%
- PageSpeed Mobile: ${comp.speedMobile}
`).join('\n')}

Analyze the gaps and provide prioritized recommendations.

CRITICAL: Return ONLY valid JSON. NO markdown, NO code blocks, NO explanations.

JSON FORMATTING RULES (MUST FOLLOW):
1. Use double quotes for all strings
2. Escape quotes inside strings with backslash: \\"
3. NO line breaks inside string values
4. NO trailing commas
5. Keep each field value on ONE line

{
  "high": [
    {
      "title": "Action title",
      "description": "What to do",
      "current": "Current state (if applicable)",
      "recommended": "Recommended change",
      "why": "Why this matters"
    }
  ],
  "medium": [...],
  "low": [...]
}

HIGH priority: Critical SEO issues (missing/poor title, meta, H1, extreme keyword issues, no CTA)
MEDIUM priority: Significant improvements (word count optimization, heading structure, page speed)
LOW priority: Nice-to-haves (minor optimizations, polish)

Focus on actionable, specific recommendations. Be direct and clear.`;
}

// Helper: sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
