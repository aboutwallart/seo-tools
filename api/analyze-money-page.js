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
    const { pageUrl, keyword, ubersuggestImage } = req.body;

    if (!pageUrl || !keyword) {
      return res.status(400).json({ error: 'Missing pageUrl or keyword' });
    }

    const startTime = Date.now();
    console.log(`[Money Page] Analyzing: ${pageUrl} for keyword: "${keyword}"`);
    if (ubersuggestImage) {
      console.log('[Money Page] Ubersuggest screenshot provided - will analyze keyword opportunities');
    }

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

    // Step 4: Analyze content gaps
    console.log('[Money Page] Step 4: Analyzing content gaps...');
    const contentGaps = analyzeContentGaps(yourPageData, competitorData);
    console.log(`[Money Page] ✓ Found ${contentGaps.missingH2s.length} missing H2s, ${contentGaps.missingKeywords.length} missing keywords`);

    // Step 5: Get Claude analysis
    console.log('[Money Page] Step 5: Getting AI recommendations... (~20 sec)');
    const analysis = await getClaudeAnalysis(yourPageData, competitorData, keyword, searchResults.userPosition, ubersuggestImage, contentGaps);
    console.log(`[Money Page] ✓ AI analysis complete! Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Return results
    return res.status(200).json({
      userPosition: searchResults.userPosition,
      yourPage: yourPageData,
      competitors: competitorData,
      contentGaps: contentGaps,
      analysis: analysis
    });

  } catch (error) {
    console.error('[Money Page] Error:', error.message);
    console.error('[Money Page] Stack:', error.stack);
    
    // Return a user-friendly error
    return res.status(500).json({ 
      error: error.message || 'Analysis failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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

  // NEW: Detect CTAs (Call-to-Actions)
  const ctaPatterns = [
    /buy now/gi, /shop now/gi, /add to cart/gi, /get started/gi,
    /order now/gi, /purchase/gi, /subscribe/gi, /sign up/gi,
    /learn more/gi, /discover/gi, /explore/gi, /view details/gi
  ];
  const ctas = [];
  ctaPatterns.forEach(pattern => {
    const matches = textLower.match(pattern);
    if (matches) {
      matches.forEach(match => {
        if (!ctas.includes(match)) ctas.push(match);
      });
    }
  });

  // NEW: Detect Trust Signals
  const trustSignals = [];
  if (/money.?back guarantee|satisfaction guaranteed|risk.?free/gi.test(textLower)) {
    trustSignals.push('Money-back guarantee');
  }
  if (/free shipping|free delivery/gi.test(textLower)) {
    trustSignals.push('Free shipping');
  }
  if (/\d+[\+\s]*(reviews?|ratings?|customers?|testimonials?)/gi.test(textLower)) {
    const reviewMatch = textLower.match(/(\d+[\+\s]*(?:reviews?|ratings?|customers?))/i);
    if (reviewMatch) trustSignals.push(`Customer reviews: ${reviewMatch[1]}`);
  }
  if (/secure checkout|ssl|encrypted|safe payment/gi.test(textLower)) {
    trustSignals.push('Secure checkout');
  }
  if (/\d+.?year warranty|lifetime warranty/gi.test(textLower)) {
    trustSignals.push('Warranty mentioned');
  }

  // NEW: Detect Urgency/Scarcity
  const urgencySignals = [];
  if (/limited time|limited offer|expires|hurry|last chance/gi.test(textLower)) {
    urgencySignals.push('Limited time offer');
  }
  if (/only \d+ left|low stock|selling fast|almost gone/gi.test(textLower)) {
    urgencySignals.push('Stock scarcity');
  }
  if (/\d+% off|save \d+|discount|sale/gi.test(textLower)) {
    urgencySignals.push('Discount/Sale');
  }

  // NEW: Extract potential secondary keywords (2-4 word phrases appearing multiple times)
  const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
  const phrases = [];
  const textWords = cleanText.split(' ');
  
  // Extract 2-word and 3-word phrases
  for (let i = 0; i < textWords.length - 2; i++) {
    const twoWord = `${textWords[i]} ${textWords[i + 1]}`;
    const threeWord = `${textWords[i]} ${textWords[i + 1]} ${textWords[i + 2]}`;
    
    if (twoWord.length > 5 && !twoWord.includes(keywordLower)) {
      phrases.push(twoWord);
    }
    if (threeWord.length > 8 && !threeWord.includes(keywordLower)) {
      phrases.push(threeWord);
    }
  }

  // Count phrase frequency and get top 10
  const phraseCounts = {};
  phrases.forEach(phrase => {
    phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
  });
  
  const topPhrases = Object.entries(phraseCounts)
    .filter(([phrase, count]) => count >= 2) // Must appear at least twice
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  // NEW: Detect AI Optimization Elements
  const aiOptimization = {
    hasBrandBlock: false,
    hasComparisonSnippet: false,
    hasFAQSchema: false
  };

  // Check for brand/about block with authority signals (anywhere on page)
  // This includes "about us", authority statements, UK-based, founded date, guarantees
  if (/about us|who we are|our story|why choose|founded|established|based in|uk.?based|leading|trusted|since \d{4}|guarantee/gi.test(textLower)) {
    aiOptimization.hasBrandBlock = true;
  }

  // Check for comparison/definition snippets
  if (/what is|what are|vs\s|versus|compared to|difference between|types of|kinds of/gi.test(textLower)) {
    aiOptimization.hasComparisonSnippet = true;
  }

  // Check for FAQ schema
  if (html.includes('FAQPage') || html.includes('"@type":"Question"')) {
    aiOptimization.hasFAQSchema = true;
  }

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
    images,
    ctas,
    trustSignals,
    urgencySignals,
    topPhrases,
    aiOptimization
  };
}

// Analyze content gaps between user's page and competitors
function analyzeContentGaps(yourPage, competitors) {
  if (!competitors || competitors.length === 0) {
    return { missingH2s: [], missingKeywords: [], missingTrustSignals: [], missingCTAs: [] };
  }

  // 1. Find missing H2 sections
  const yourH2s = yourPage.h2.map(h => h.toLowerCase());
  const competitorH2s = {};
  
  competitors.forEach(comp => {
    comp.h2.forEach(h2 => {
      const h2Lower = h2.toLowerCase();
      if (!competitorH2s[h2Lower]) {
        competitorH2s[h2Lower] = { text: h2, count: 0 };
      }
      competitorH2s[h2Lower].count++;
    });
  });

  // Find H2s that competitors have but user doesn't (appeared in 2+ competitors)
  const missingH2s = Object.values(competitorH2s)
    .filter(h2 => h2.count >= 2 && !yourH2s.some(userH2 => userH2.includes(h2.text.toLowerCase().substring(0, 20))))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 2. Find missing secondary keywords (phrases competitors use but you don't)
  const yourPhrases = new Set(yourPage.topPhrases.map(p => p.phrase));
  const competitorPhrases = {};

  competitors.forEach(comp => {
    comp.topPhrases.forEach(phraseObj => {
      if (!yourPhrases.has(phraseObj.phrase)) {
        if (!competitorPhrases[phraseObj.phrase]) {
          competitorPhrases[phraseObj.phrase] = { phrase: phraseObj.phrase, count: 0, totalUses: 0 };
        }
        competitorPhrases[phraseObj.phrase].count++;
        competitorPhrases[phraseObj.phrase].totalUses += phraseObj.count;
      }
    });
  });

  const missingKeywords = Object.values(competitorPhrases)
    .filter(p => p.count >= 2) // In 2+ competitors
    .sort((a, b) => b.totalUses - a.totalUses)
    .slice(0, 5);

  // 3. Find missing trust signals
  const yourTrustSignals = new Set(yourPage.trustSignals.map(s => s.toLowerCase()));
  const competitorTrustSignals = {};

  competitors.forEach(comp => {
    comp.trustSignals.forEach(signal => {
      const signalLower = signal.toLowerCase();
      if (!yourTrustSignals.has(signalLower)) {
        if (!competitorTrustSignals[signalLower]) {
          competitorTrustSignals[signalLower] = { text: signal, count: 0 };
        }
        competitorTrustSignals[signalLower].count++;
      }
    });
  });

  const missingTrustSignals = Object.values(competitorTrustSignals)
    .filter(s => s.count >= 2)
    .sort((a, b) => b.count - a.count);

  // 4. Find missing CTAs
  const yourCTAs = new Set(yourPage.ctas.map(c => c.toLowerCase()));
  const competitorCTAs = {};

  competitors.forEach(comp => {
    comp.ctas.forEach(cta => {
      const ctaLower = cta.toLowerCase();
      if (!yourCTAs.has(ctaLower)) {
        if (!competitorCTAs[ctaLower]) {
          competitorCTAs[ctaLower] = { text: cta, count: 0 };
        }
        competitorCTAs[ctaLower].count++;
      }
    });
  });

  const missingCTAs = Object.values(competitorCTAs)
    .filter(c => c.count >= 2)
    .sort((a, b) => b.count - a.count);

  // 5. Find missing AI optimization elements
  const missingAIOptimization = [];
  
  if (!yourPage.aiOptimization.hasFAQSchema) {
    const competitorsWithFAQ = competitors.filter(c => c.aiOptimization.hasFAQSchema).length;
    if (competitorsWithFAQ >= 2) {
      missingAIOptimization.push({
        element: 'FAQ Schema',
        count: competitorsWithFAQ,
        priority: 'high'
      });
    }
  }

  if (!yourPage.aiOptimization.hasBrandBlock) {
    const competitorsWithBrand = competitors.filter(c => c.aiOptimization.hasBrandBlock).length;
    if (competitorsWithBrand >= 2) {
      missingAIOptimization.push({
        element: 'Brand/Authority Block',
        count: competitorsWithBrand,
        priority: 'high'
      });
    }
  }

  if (!yourPage.aiOptimization.hasComparisonSnippet) {
    const competitorsWithComparison = competitors.filter(c => c.aiOptimization.hasComparisonSnippet).length;
    if (competitorsWithComparison >= 2) {
      missingAIOptimization.push({
        element: 'Comparison/Definition Snippet',
        count: competitorsWithComparison,
        priority: 'medium'
      });
    }
  }

  return {
    missingH2s,
    missingKeywords,
    missingTrustSignals,
    missingCTAs,
    missingAIOptimization
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
async function getClaudeAnalysis(yourPage, competitors, keyword, userPosition = null, ubersuggestImage = null, contentGaps = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found');
  }

  const prompt = buildAnalysisPrompt(yourPage, competitors, keyword, userPosition, ubersuggestImage, contentGaps);

  try {
    // Build content array - include image if provided
    const contentArray = [];
    
    if (ubersuggestImage) {
      contentArray.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: ubersuggestImage
        }
      });
    }
    
    contentArray.push({
      type: 'text',
      text: prompt
    });

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
          content: contentArray
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error('[Claude] API Error:', data.error);
      throw new Error(data.error.message || 'Claude API error');
    }

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error('[Claude] Invalid response structure:', JSON.stringify(data).substring(0, 500));
      throw new Error('Invalid Claude API response structure');
    }

    const analysisText = data.content[0].text.trim();
    console.log('[Claude] Analysis length:', analysisText.length, 'chars');
    console.log('[Claude] Analysis preview (first 500 chars):', analysisText.substring(0, 500));
    console.log('[Claude] Analysis preview (last 500 chars):', analysisText.substring(analysisText.length - 500));
    console.log('[Claude] Contains code fence?', analysisText.includes('```'));
    console.log('[Claude] Contains script tag?', analysisText.includes('<script'));
    
    // Return as plain text markdown (no JSON parsing needed)
    return {
      markdown: analysisText
    };

  } catch (error) {
    console.error('[Claude] Error:', error.message);
    console.error('[Claude] Stack:', error.stack);
    throw error;
  }
}

// Build the prompt for Claude with OpenAI-style actionable format
function buildAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, hasUbersuggestImage = false, contentGaps = null) {
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

  // Ubersuggest section
  const ubersuggestSection = hasUbersuggestImage ? `

UBERSUGGEST DATA PROVIDED:
Analyze the screenshot above and extract:
- Current keyword: "${keyword}"
- All alternative keywords shown with their search volume and difficulty scores
- Recommend if user should SWAP to a better keyword (higher volume + lower difficulty)
- List 3-5 secondary keywords to naturally include in content

Add this section BEFORE the main recommendations:

📊 KEYWORD OPPORTUNITY ANALYSIS

Current: "${keyword}" (Volume: [X] | Difficulty: [Y])
${userPosition ? `Currently ranking: Position ${userPosition}` : 'Not ranking in top 10'}

[Either:]
✅ KEEP CURRENT KEYWORD - Best opportunity
[Or:]
🔄 SWAP TO: "[better keyword]" (Volume: [X] | Difficulty: [Y])
Reason: [One line why it's better]

Secondary keywords to include:
- [keyword] (Volume: [X])
- [keyword] (Volume: [X])
- [keyword] (Volume: [X])

---

` : '';

  // Content gaps section
  const contentGapsSection = contentGaps ? `

CONTENT GAP ANALYSIS (what competitors have that you're missing):

Missing H2 Sections (found in ${competitors.length} competitors):
${contentGaps.missingH2s.length > 0 
  ? contentGaps.missingH2s.map(h2 => `- "${h2.text}" (in ${h2.count}/${competitors.length} competitors)`).join('\n')
  : '- None significant'}

Missing Secondary Keywords (competitors use frequently):
${contentGaps.missingKeywords.length > 0
  ? contentGaps.missingKeywords.map(kw => `- "${kw.phrase}" (used ${kw.totalUses}x across ${kw.count} competitors)`).join('\n')
  : '- None significant'}

Missing Trust Signals:
${contentGaps.missingTrustSignals.length > 0
  ? contentGaps.missingTrustSignals.map(ts => `- ${ts.text} (in ${ts.count}/${competitors.length} competitors)`).join('\n')
  : '- None significant'}

Missing CTAs:
${contentGaps.missingCTAs.length > 0
  ? contentGaps.missingCTAs.map(cta => `- "${cta.text}" (in ${cta.count}/${competitors.length} competitors)`).join('\n')
  : '- None significant'}

Missing AI Optimization Elements:
${contentGaps.missingAIOptimization && contentGaps.missingAIOptimization.length > 0
  ? contentGaps.missingAIOptimization.map(ai => `- ${ai.element} (in ${ai.count}/${competitors.length} competitors) [${ai.priority} priority]`).join('\n')
  : '- None significant'}

IMPORTANT: Incorporate these gaps into your recommendations. Prioritize adding missing H2 sections and trust signals that appear in ALL competitors.

FOR AI OPTIMIZATION GAPS - YOU MUST PROVIDE EXACT TEXT:
- FAQ Schema: Say "Use Kickstart to generate FAQ schema for '${keyword}' with 8-10 questions"
- Brand/Authority Block: Write ONE comprehensive block to add at page bottom (4-5 sentences including: UK-based, founded 2020, "design and produce our own wall art items in-house", 500+ customer reviews with 4.8/5 rating, FREE fast UK delivery, international shipping available, 14-day return policy). Must establish authority AND provide brand info in same block.
- Comparison Snippet: Write full "What is ${keyword}" or "${keyword} vs [alternative]" paragraph (3-4 sentences) with blog link and black button CTA

` : '';

  return `You are an SEO expert. Give ACTIONABLE, COPY-PASTE READY instructions. NO explanations. NO options. ONE clear action per item.

${positionContext}

TARGET KEYWORD: "${keyword}"
${ubersuggestSection}
${contentGapsSection}

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

EXAMPLE FOR SCHEMA (do NOT write code, just this instruction):
7. Add FAQ Schema
Use Kickstart to generate FAQ schema for "${keyword}" with 6-10 questions

EXAMPLES FOR CONTENT GAPS (must provide FULL text for every gap):

If gap shows missing H2 "Customer Reviews":
8. Add H2: "Customer Reviews" 
Add after "Product Features" section:
Use exactly this:

## Customer Reviews

Our customers love their ${keyword}! With over 500 verified 5-star reviews, we're proud to be the top choice. Read real customer experiences and see why thousands choose us for their ${keyword} needs.

If gap shows missing trust signal:
9. Add Trust Signal Block
Add after product description:
Use exactly this:

✓ 30-Day Money-Back Guarantee
✓ Free Shipping Over $50
✓ Secure Checkout

If gap shows missing keyword "art prints":
10. Add Keyword "art prints"
Add new paragraph after H2 "[specify which H2]":
Use exactly this:

[Full 3-4 sentence paragraph naturally using "art prints" 2-3 times]

If gap shows missing "Brand/Authority Block":
11. Add Brand/Authority Block
Add at the bottom of the page (before footer):
Use exactly this:

## About [Brand Name]

Founded in 2020, we're the UK's leading specialist in wall art and home decor. As a trusted, UK-based company, we design and produce our own unique wall art items in-house. Rated 4.8/5 stars from over 500+ verified customer reviews, we offer free fast UK delivery, international shipping, secure checkout, and back every purchase with our hassle-free 14-day return policy. Experience the [Brand Name] difference today.

🟡 DO NEXT (after core fixes)

[Same format]

✅ FINAL CHECK

Make sure:
• [Item] ✔
• [Item] ✔

RULES:
- Use action verbs: Add, Replace, Remove, Delete
- Write FULL text for titles/meta/H1/paragraphs
- For schema: Give instruction to use Kickstart (e.g., "Use Kickstart to generate FAQ schema for '[keyword]' with 6-10 questions")
- If keyword density too high (above ${avgCompKeywordDensity}%), say "Reduce keyword uses from ${yourPage.keywordOccurrences} to [X]"
- List specific H2s to add/remove
- NO "you could" - direct commands only
- NO explanations of why
- Plain text output, NOT JSON
- Be specific and copy-paste ready
- NEVER write placeholder text like "..." or "content here" - write the ACTUAL content

CRITICAL FOR CONTENT GAPS:
- For EVERY missing H2 in the content gaps: write the EXACT H2 text to add + a full 2-3 sentence paragraph for that section
- For EVERY missing keyword: write a complete paragraph that naturally includes it 2-3 times
- For EVERY missing trust signal: write the exact trust signal text (e.g., "✓ 30-Day Money-Back Guarantee" or "★★★★★ Rated 4.8/5 from 500+ customers")
- If gaps show missing CTAs: write the exact button/link text (e.g., "Shop [Keyword] Now →")
- Prioritize gaps that appear in ALL ${competitors.length} competitors first`;
}

// Helper: sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
