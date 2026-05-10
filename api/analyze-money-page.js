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

    // Step 1: Find competitors using SerpAPI and check user position
    console.log('[Money Page] Step 1: Finding competitors... (~10 sec)');
    const searchResults = await findCompetitors(keyword, pageUrl);
    console.log(`[Money Page] ✓ User position: ${searchResults.userPosition || 'Not in top 10'} | Found ${searchResults.competitors.length} competitors (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    if (searchResults.competitors.length === 0) {
      return res.status(500).json({ error: 'Could not find competitors' });
    }

    // Step 2: Analyze your page
    console.log('[Money Page] Step 2: Analyzing your page... (~15 sec)');
    const yourPageData = await analyzePage(pageUrl, keyword, true); // true = get PageSpeed
    console.log(`[Money Page] ✓ Your page analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 3: Analyze competitors
    console.log('[Money Page] Step 3: Analyzing 3 competitors... (~15 sec)');
    const competitorData = [];
    for (let i = 0; i < Math.min(3, searchResults.competitors.length); i++) {
      const comp = searchResults.competitors[i];
      console.log(`[Money Page]   - Analyzing position ${comp.position}: ${comp.url}`);
      const data = await analyzePage(comp.url, keyword);
      if (data) {
        competitorData.push({
          position: comp.position,
          ...data
        });
      }
    }
    console.log(`[Money Page] ✓ All competitors analyzed (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // Step 4: Get Claude analysis
    console.log('[Money Page] Step 4: Getting AI recommendations... (~20 sec)');
    const analysis = await getClaudeAnalysis(yourPageData, competitorData, keyword, searchResults.userPosition);
    console.log(`[Money Page] ✓ AI analysis complete! Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Return results
    return res.status(200).json({
      userPosition: searchResults.userPosition,
      yourPage: yourPageData,
      competitors: competitorData,
      analysis: analysis
    });

  } catch (error) {
    console.error('[Money Page] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Find top competitors using SerpAPI and check user's position
async function findCompetitors(keyword, userUrl) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const organicResults = data.organic_results || [];
    
    // Normalize URLs for comparison
    const normalizeUrl = (url) => {
      return url.toLowerCase()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '');
    };
    
    const normalizedUserUrl = normalizeUrl(userUrl);
    let userPosition = null;
    const competitors = [];

    organicResults.forEach((result, index) => {
      const position = index + 1;
      const resultUrl = result.link;
      const normalizedResultUrl = normalizeUrl(resultUrl);

      // Check if this is the user's page
      if (normalizedResultUrl === normalizedUserUrl || normalizedResultUrl.startsWith(normalizedUserUrl)) {
        userPosition = position;
        console.log(`[SerpAPI] Found user's page at position ${position}`);
      }

      // Collect top 3 that aren't the user's page
      if (position <= 3 && normalizedResultUrl !== normalizedUserUrl) {
        competitors.push({
          position: position,
          title: result.title,
          url: resultUrl
        });
      }
    });

    // If user is in top 3, get position 4 to have 3 competitors
    if (userPosition && userPosition <= 3 && competitors.length < 3) {
      for (let i = 3; i < organicResults.length && competitors.length < 3; i++) {
        const result = organicResults[i];
        const normalizedResultUrl = normalizeUrl(result.link);
        if (normalizedResultUrl !== normalizedUserUrl) {
          competitors.push({
            position: i + 1,
            title: result.title,
            url: result.link
          });
        }
      }
    }

    console.log(`[SerpAPI] Found ${competitors.length} competitors. User position: ${userPosition || 'Not in top 10'}`);
    
    return {
      userPosition: userPosition,
      competitors: competitors.slice(0, 3)
    };

  } catch (error) {
    console.error('[SerpAPI] Error:', error);
    return { userPosition: null, competitors: [] };
  }
}

// Analyze a single page
async function analyzePage(url, keyword, fetchPageSpeed = false) {
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

    // Get PageSpeed scores if requested (only for user's page)
    if (fetchPageSpeed) {
      console.log('[PageSpeed] Fetching mobile and desktop scores...');
      const [mobile, desktop] = await Promise.all([
        getPageSpeedScore(url, 'mobile'),
        getPageSpeedScore(url, 'desktop')
      ]);
      
      return {
        ...seoData,
        speedMobile: mobile,
        speedDesktop: desktop
      };
    }

    // NO PageSpeed for competitors - saves time
    return {
      ...seoData,
      speedMobile: 'N/A',
      speedDesktop: 'N/A'
    };

  } catch (error) {
    console.error(`[Analyze] Error analyzing ${url}:`, error);
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
async function getClaudeAnalysis(yourPage, competitors, keyword, userPosition = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found');
  }

  const prompt = buildAnalysisPrompt(yourPage, competitors, keyword, userPosition);

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
    
    // Return as plain text markdown (no JSON parsing needed)
    return {
      markdown: analysisText
    };

  } catch (error) {
    console.error('[Claude] Error:', error);
    throw error;
  }
}

// Build the prompt for Claude with OpenAI-style actionable format
function buildAnalysisPrompt(yourPage, competitors, keyword, userPosition = null) {
  const avgCompWordCount = competitors.length > 0 
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
    : 0;

  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2)
    : 0;

  // Position context
  const positionContext = userPosition 
    ? (userPosition === 1 
        ? `User is #1 for "${keyword}". Give defensive recommendations.`
        : `User is position ${userPosition} for "${keyword}".`)
    : `User is not in top 10 for "${keyword}".`;

  return `You are an SEO expert. Give ACTIONABLE, COPY-PASTE READY instructions. NO explanations. NO options. ONE clear action per item.

${positionContext}

TARGET KEYWORD: "${keyword}"

YOUR PAGE:
- Title: ${yourPage.title} (${yourPage.title.length} chars)
- Meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- H2 headings: ${yourPage.h2.slice(0, 10).join(', ') || 'None'}
- H2 count: ${yourPage.h2.length}
- Word count: ${yourPage.wordCount}
- Keyword uses: ${yourPage.keywordOccurrences}
- Keyword density: ${yourPage.keywordDensity}%
- PageSpeed Mobile: ${yourPage.speedMobile}

COMPETITORS (avg):
- Word count: ${avgCompWordCount}
- Keyword density: ${avgCompKeywordDensity}%

${competitors.map((comp) => `Position ${comp.position}: ${comp.wordCount} words, ${comp.keywordDensity}% density, ${comp.h2.length} H2s`).join('\n')}

FORMAT EXACTLY LIKE THIS:

🔴 DO THESE FIRST (in exact order)

1. [Action Verb] [What]
Use exactly this:
[FULL REPLACEMENT TEXT]

2. [Action] [What]
Delete these H2s:
- [heading]

Add these H2s:
- [heading]

CRITICAL FOR SCHEMA: When recommending schema markup, provide COMPLETE JSON-LD code ready to paste into Custom Liquid. Example format:

10. Add schema markup — paste this JSON-LD block into the head section of your page:
Use exactly this:

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What are the best celebration gifts?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Complete answer text here..."
      }
    },
    {
      "@type": "Question",
      "name": "How do I choose celebration gifts?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Complete answer text here..."
      }
    }
  ]
}
</script>

[Continue with more numbered items]

🟡 DO NEXT (after core fixes)

[Same format]

✅ FINAL CHECK

Make sure:
• [Item] ✔
• [Item] ✔

RULES:
- Use action verbs: Add, Replace, Remove, Delete
- Write FULL text for titles/meta/H1/paragraphs
- For schema: provide COMPLETE working JSON-LD code with real content
- Include 6-10 FAQ questions in schema with full answers based on the keyword
- If keyword density too high (above ${avgCompKeywordDensity}%), say "Reduce keyword uses from ${yourPage.keywordOccurrences} to [X]"
- List specific H2s to add/remove
- NO "you could" - direct commands only
- NO explanations of why
- Plain text output, NOT JSON
- Be specific and copy-paste ready`;
}

// Helper: sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
