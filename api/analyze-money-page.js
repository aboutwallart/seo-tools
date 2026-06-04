// Money Page Optimizer Backend API
// Handles SerpAPI, PageSpeed, web scraping, and Claude analysis

// analyze-money-page.js — v44.0
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const PAGESPEED_KEY = process.env.GOOGLE_API_KEY;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

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
    const [yourPageData, shopifyContent] = await Promise.all([
      analyzePage(pageUrl, keyword, true),
      fetchShopifyContent(pageUrl)
    ]);
    if (shopifyContent) {
      yourPageData.shopifyId       = shopifyContent.shopifyId;
      yourPageData.shopifyBlogId   = shopifyContent.shopifyBlogId || null;
      yourPageData.shopifyType     = shopifyContent.shopifyType;
      yourPageData.shopifySeoTitle = shopifyContent.seoTitle;
      yourPageData.shopifySeoDesc  = shopifyContent.seoDescription;
      yourPageData.shopifyBodyHtml = shopifyContent.bodyHtml;
      // Prefer Shopify SEO fields over scraped values when available
      if (shopifyContent.seoTitle)       yourPageData.title           = shopifyContent.seoTitle;
      if (shopifyContent.seoDescription) yourPageData.metaDescription = shopifyContent.seoDescription;
      // Re-extract H2s from clean Shopify body HTML — removes theme noise and Liquid variables
      if (shopifyContent.bodyHtml) {
        const cleanH2s = (shopifyContent.bodyHtml.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [])
          .map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim())
          .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);
        if (cleanH2s.length > 0) yourPageData.h2 = cleanH2s;
      }
      // Filter any remaining Liquid variables from scraped H2s
      yourPageData.h2 = yourPageData.h2.filter(h => !h.includes('{{') && !h.includes('}}'));
      console.log(`[Money Page] ✓ Shopify: ${shopifyContent.shopifyType} ID ${shopifyContent.shopifyId}`);
    } else {
      // Even without Shopify, filter Liquid variables from scraped H2s
      yourPageData.h2 = yourPageData.h2.filter(h => !h.includes('{{') && !h.includes('}}'));
      console.warn('[Money Page] Shopify content unavailable — using scraped data');
    }
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
    console.log(`[Money Page] ✓ Found ${contentGaps.missingH2s.length} missing H2s, ${contentGaps.missingAIOptimization.length} missing AI elements`);

    // Step 5: Get Claude analysis
    console.log('[Money Page] Step 5: Getting AI recommendations... (~20 sec)');
    const analysis = await getClaudeAnalysis(yourPageData, competitorData, keyword, searchResults.userPosition, contentGaps);
    console.log(`[Money Page] ✓ AI analysis complete! Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Return results
    return res.status(200).json({
      userPosition: searchResults.userPosition,
      yourPage: yourPageData,
      competitors: competitorData,
      contentGaps: contentGaps,
      analysis: analysis,
      shopify: shopifyContent ? {
        id:      shopifyContent.shopifyId,
        blogId:  shopifyContent.shopifyBlogId || null,
        type:    shopifyContent.shopifyType,
        title:   shopifyContent.seoTitle,
        meta:    shopifyContent.seoDescription
      } : null
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

  // Extract H2 — filter Liquid template variables from Shopify themes
  const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
  const h2 = h2Matches
    .map(m => m.replace(/<\/?h2[^>]*>/gi, '').trim())
    .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);

  // Extract H3 — same filter
  const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];
  const h3 = h3Matches
    .map(m => m.replace(/<\/?h3[^>]*>/gi, '').trim())
    .filter(h => !h.includes('{{') && !h.includes('}}') && h.length > 2);

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

  // Detect AI Optimization Elements
  const aiOptimization = {
    hasBrandBlock: false,
    hasComparisonSnippet: false,
    hasFAQSchema: false,
    hasProductSchema: false,
    hasReviewSchema: false,
    hasBreadcrumbSchema: false,
    hasHowToSchema: false,
    hasTables: false,
    hasLists: false,
    hasRelatedQuestions: false,
    hasAuthor: false,
    hasDates: false,
    hasSummary: false
  };

  // Detect page type from URL
  const urlLower = url.toLowerCase();
  const isBlog = urlLower.includes('/blogs/') || urlLower.includes('/blog/') || urlLower.includes('/articles/');

  // Check for brand/about block with authority signals
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

  // Check for Product schema
  if (html.includes('"@type":"Product"')) {
    aiOptimization.hasProductSchema = true;
  }

  // Check for Review/Rating schema
  if (html.includes('AggregateRating') || html.includes('"@type":"Review"')) {
    aiOptimization.hasReviewSchema = true;
  }

  // Check for Breadcrumb schema
  if (html.includes('BreadcrumbList')) {
    aiOptimization.hasBreadcrumbSchema = true;
  }

  // Check for How-To schema
  if (html.includes('"@type":"HowTo"')) {
    aiOptimization.hasHowToSchema = true;
  }

  // Check for tables
  if (/<table/i.test(html)) {
    aiOptimization.hasTables = true;
  }

  // Check for lists with 3+ items
  const ulMatches = html.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi) || [];
  const olMatches = html.match(/<ol[^>]*>[\s\S]*?<\/ol>/gi) || [];
  const allLists = [...ulMatches, ...olMatches];
  
  for (const list of allLists) {
    const liCount = (list.match(/<li/gi) || []).length;
    if (liCount >= 3) {
      aiOptimization.hasLists = true;
      break;
    }
  }

  // Check for Related Questions section
  if (/people also ask|related questions|you might also like|frequently asked|common questions/gi.test(textLower)) {
    aiOptimization.hasRelatedQuestions = true;
  }

  // Blog-specific checks
  if (isBlog) {
    // Check for author credentials
    if (/written by|author:|by\s+[A-Z][a-z]+\s+[A-Z][a-z]+|posted by/gi.test(text)) {
      aiOptimization.hasAuthor = true;
    }

    // Check for publish/update dates
    if (/published|updated|last modified|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december\s+\d{1,2},?\s+\d{4}/gi.test(text)) {
      aiOptimization.hasDates = true;
    }

    // Check for summary/TL;DR
    if (/tl;?dr|summary|key takeaways|in this article|table of contents/gi.test(textLower)) {
      aiOptimization.hasSummary = true;
    }
  }

  // Calculate AI Visibility Score
  const aiScore = calculateAIScore(aiOptimization, isBlog);

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
    aiOptimization,
    isBlog,
    aiScore
  };
}

// Analyze content gaps between user's page and competitors
function analyzeContentGaps(yourPage, competitors) {
  if (!competitors || competitors.length === 0) {
    return { missingH2s: [], missingAIOptimization: [] };
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

  const missingH2s = Object.values(competitorH2s)
    .filter(h2 => h2.count >= 2 && !yourH2s.some(userH2 => userH2.includes(h2.text.toLowerCase().substring(0, 20))))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 2. Find ALL missing AI optimization elements (ignore competitors)
  const missingAIOptimization = [];
  
  // Core AI elements (always check)
  if (!yourPage.aiOptimization.hasFAQSchema) {
    missingAIOptimization.push({
      element: 'FAQ Schema',
      priority: 'high',
      instruction: 'Use Kickstart to generate FAQ schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasBrandBlock) {
    missingAIOptimization.push({
      element: 'Brand/Authority Block',
      priority: 'high',
      instruction: 'Add full brand block with trust signals'
    });
  }
  
  if (!yourPage.aiOptimization.hasComparisonSnippet) {
    missingAIOptimization.push({
      element: 'Comparison/Definition Snippet',
      priority: 'medium',
      instruction: 'Add "What is [keyword]" paragraph'
    });
  }
  
  if (!yourPage.aiOptimization.hasProductSchema) {
    missingAIOptimization.push({
      element: 'Product Schema',
      priority: 'high',
      instruction: 'Add Product JSON-LD schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasReviewSchema) {
    missingAIOptimization.push({
      element: 'Review/Rating Schema',
      priority: 'medium',
      instruction: 'Add AggregateRating schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasBreadcrumbSchema) {
    missingAIOptimization.push({
      element: 'Breadcrumb Schema',
      priority: 'low',
      instruction: 'Add BreadcrumbList schema'
    });
  }
  
  if (!yourPage.aiOptimization.hasHowToSchema) {
    missingAIOptimization.push({
      element: 'How-To Schema',
      priority: 'low',
      instruction: 'Add HowTo schema if applicable'
    });
  }
  
  if (!yourPage.aiOptimization.hasTables) {
    missingAIOptimization.push({
      element: 'Tables',
      priority: 'medium',
      instruction: 'Add comparison/data tables'
    });
  }
  
  if (!yourPage.aiOptimization.hasLists) {
    missingAIOptimization.push({
      element: 'Lists (3+ items)',
      priority: 'medium',
      instruction: 'Add bullet point or numbered lists'
    });
  }
  
  if (!yourPage.aiOptimization.hasRelatedQuestions) {
    missingAIOptimization.push({
      element: 'Related Questions Section',
      priority: 'high',
      instruction: 'Add "People also ask" or "Related questions" section'
    });
  }
  
  // Blog-specific elements
  if (yourPage.isBlog) {
    if (!yourPage.aiOptimization.hasAuthor) {
      missingAIOptimization.push({
        element: 'Author/Expert Credentials',
        priority: 'medium',
        instruction: 'Add author byline with credentials'
      });
    }
    
    if (!yourPage.aiOptimization.hasDates) {
      missingAIOptimization.push({
        element: 'Publish/Update Dates',
        priority: 'high',
        instruction: 'Add visible publish/update dates'
      });
    }
    
    if (!yourPage.aiOptimization.hasSummary) {
      missingAIOptimization.push({
        element: 'Quick Answer/Summary',
        priority: 'high',
        instruction: 'Add TL;DR or summary at top'
      });
    }
  }

  return {
    missingH2s,
    missingAIOptimization
  };
}

// Calculate AI Visibility Score (1-10)
function calculateAIScore(aiOptimization, isBlog) {
  let score = 0;
  
  // Core elements (1 point each)
  if (aiOptimization.hasFAQSchema) score += 1;
  if (aiOptimization.hasBrandBlock) score += 1;
  if (aiOptimization.hasComparisonSnippet) score += 1;
  if (aiOptimization.hasProductSchema) score += 1;
  if (aiOptimization.hasReviewSchema) score += 1;
  if (aiOptimization.hasRelatedQuestions) score += 1;
  
  // Supporting elements (0.5 points each)
  if (aiOptimization.hasBreadcrumbSchema) score += 0.5;
  if (aiOptimization.hasHowToSchema) score += 0.5;
  if (aiOptimization.hasTables) score += 0.5;
  if (aiOptimization.hasLists) score += 0.5;
  
  // Blog-specific elements (0.5 points each)
  if (isBlog) {
    if (aiOptimization.hasAuthor) score += 0.5;
    if (aiOptimization.hasDates) score += 0.5;
    if (aiOptimization.hasSummary) score += 0.5;
  }
  
  return Math.min(10, score); // Cap at 10
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
async function getClaudeAnalysis(yourPage, competitors, keyword, userPosition = null, contentGaps = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found');

  const prompt = buildAnalysisPrompt(yourPage, competitors, keyword, userPosition, contentGaps);

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
        max_tokens: 7000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Claude API error');
    if (!data.content?.[0]?.text) throw new Error('Invalid Claude API response structure');

    const raw = data.content[0].text.trim();
    console.log('[Claude] Response length:', raw.length, 'chars');

    // Try to parse as structured JSON
    try {
      // Strip markdown code fences if present
      const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(jsonStr);
      console.log('[Claude] ✓ Structured JSON parsed successfully');
      return { structured: parsed };
    } catch (parseErr) {
      console.warn('[Claude] JSON parse failed, falling back to markdown:', parseErr.message);
      return { markdown: raw };
    }

  } catch (error) {
    console.error('[Claude] Error:', error.message);
    throw error;
  }
}

// Build the structured JSON prompt for Claude
function buildAnalysisPrompt(yourPage, competitors, keyword, userPosition = null, contentGaps = null) {
  const avgCompWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length) : 0;
  const avgCompKeywordDensity = competitors.length > 0
    ? (competitors.reduce((sum, c) => sum + c.keywordDensity, 0) / competitors.length).toFixed(2) : 0;

  const positionContext = userPosition
    ? (userPosition === 1 ? `Currently ranking #1 for "${keyword}" — give defensive optimisation advice.`
      : `Currently ranking position ${userPosition} for "${keyword}".`)
    : `Not in top 10 for "${keyword}" — focus on closing gaps vs top 3.`;

  const pageTypeLabel = yourPage.shopifyType === 'product' ? 'product page'
    : yourPage.shopifyType?.includes('collection') ? 'collection page'
    : yourPage.shopifyType === 'article' ? 'blog article'
    : yourPage.shopifyType === 'page' ? 'landing page' : 'page';

  const schemaType = yourPage.shopifyType === 'product' ? 'Product'
    : yourPage.shopifyType?.includes('collection') ? 'CollectionPage'
    : yourPage.shopifyType === 'article' ? 'Article' : 'WebPage';

  const currentDesc = yourPage.shopifyBodyHtml
    ? yourPage.shopifyBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)
    : '';

  const missingH2s = contentGaps?.missingH2s?.length > 0
    ? contentGaps.missingH2s.map(h => `"${h.text}"`).join(', ') : 'None';
  const missingAI = contentGaps?.missingAIOptimization?.length > 0
    ? contentGaps.missingAIOptimization.map(a => `${a.element} [${a.priority}]`).join(', ') : 'None';

  return `You are an expert SEO specialist. Analyse this ${pageTypeLabel} and return ONLY a valid JSON object — no text before or after, no markdown code fences.

CONTEXT:
- Keyword: "${keyword}"
- ${positionContext}
- Page type: ${pageTypeLabel}
- Current title: ${yourPage.title || 'MISSING'} (${(yourPage.title || '').length} chars)
- Current meta: ${yourPage.metaDescription || 'MISSING'} (${yourPage.metaDescription?.length || 0} chars)
- H1: ${yourPage.h1.join(', ') || 'MISSING'}
- Current H2s: ${yourPage.h2.slice(0, 10).join(' | ') || 'None'}
- Word count: ${yourPage.wordCount} (competitor avg: ${avgCompWordCount})
- Keyword density: ${yourPage.keywordDensity}% (competitor avg: ${avgCompKeywordDensity}%)
- Mobile speed: ${yourPage.speedMobile}
${currentDesc ? `- Current description: ${currentDesc}` : ''}

COMPETITORS:
${competitors.map(c => `Position ${c.position}: ${c.wordCount} words, ${c.keywordDensity}% density, H2s: ${c.h2.slice(0, 5).join(' | ') || 'none'}`).join('\n')}

CONTENT GAPS:
- Missing H2 sections: ${missingH2s}
- Missing AI elements: ${missingAI}
- AI Visibility Score: ${yourPage.aiScore}/10

Return this exact JSON structure with real content (no placeholders):

{
  "suggestedTitle": "Optimised SEO title 50-60 chars, keyword near start, UK spelling",
  "suggestedMeta": "Compelling meta description 150-160 chars, keyword included, ends with CTA, UK spelling",
  "suggestedDescription": "2-3 sentences for the Shopify description field. Keyword-rich. AboutWallArt brand voice. UK spelling. No HTML tags.",
  "pageSchema": {
    "@context": "https://schema.org",
    "@type": "${schemaType}",
    "name": "page name",
    "description": "page description",
    "url": "${yourPage.url}"
  },
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Write a real question people search about ${keyword}",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Write a helpful complete answer"
        }
      }
    ]
  },
  "brandBlock": "<h2>About AboutWallArt</h2><p>Founded in 2020, we're the UK's leading specialist in wall art and home decor. As a trusted, UK-based company, we design and produce our own unique wall art items in-house. Rated 4.8/5 stars from over 500+ verified customer reviews, we offer free fast UK delivery, international shipping, secure checkout, and back every purchase with our hassle-free 14-day return policy.</p>",
  "h2Sections": [
    {
      "action": "delete",
      "heading": "Exact H2 text to remove (theme/navigation H2s only)"
    },
    {
      "action": "add",
      "heading": "New H2 heading text",
      "content": "Full 2-3 sentence paragraph for this section. Complete sentences. UK spelling."
    }
  ],
  "aiItems": [
    {
      "element": "Comparison Snippet",
      "content": "Full copy-paste ready paragraph starting with 'What is ${keyword}?'"
    }
  ],
  "otherActions": [
    {
      "priority": "high",
      "action": "Specific actionable instruction"
    }
  ]
}

RULES:
- suggestedTitle: 50-60 chars, keyword near start, include brand or USP
- suggestedMeta: 150-160 chars, keyword, main benefit, CTA (e.g. "Shop now", "Free UK delivery")
- suggestedDescription: plain text only, no HTML, 2-3 sentences, keyword-rich, UK spelling
- pageSchema: write complete valid schema — for products include offers/price range, for collections include numberOfItems, for articles include author/datePublished
- faqSchema: write 6-8 real questions people search about "${keyword}" with full helpful answers
- brandBlock: use EXACTLY the text shown — do not change it
- h2Sections: include ALL missing H2s from content gaps with full paragraph content; mark theme H2s (Recently Viewed, Trending Now etc) as delete
- aiItems: write complete copy-paste ready content for each missing AI element
- otherActions: specific instructions only, UK spelling, no vague advice
- Return ONLY the JSON object — no other text`;
}

// Fetch real content from Shopify API
async function fetchShopifyContent(pageUrl) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    console.warn('[Shopify] Missing credentials');
    return null;
  }

  const headers = { 'X-Shopify-Access-Token': SHOPIFY_TOKEN };
  const base = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01`;
  const path = pageUrl
    .replace(/^https?:\/\/(www\.)?aboutwallart\.com/, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

  try {
    // ── Product ──────────────────────────────────────────────────────────────
    const productMatch = path.match(/^\/products\/([^/?]+)/);
    if (productMatch) {
      const handle = productMatch[1];
      const r = await fetch(`${base}/products.json?handle=${handle}&fields=id,title,body_html`, { headers });
      const d = await r.json();
      const p = d.products?.[0];
      if (!p) return null;
      const meta = await fetchShopifyMetafields(base, `products/${p.id}`, headers);
      return { shopifyId: p.id, shopifyType: 'product', shopifyTitle: p.title, seoTitle: meta.title || p.title, seoDescription: meta.desc || '', bodyHtml: p.body_html || '' };
    }

    // ── Collection ───────────────────────────────────────────────────────────
    const collectionMatch = path.match(/^\/collections\/([^/?]+)/);
    if (collectionMatch) {
      const handle = collectionMatch[1];
      for (const type of ['custom_collections', 'smart_collections']) {
        const r = await fetch(`${base}/${type}.json?handle=${handle}&fields=id,title,body_html`, { headers });
        const d = await r.json();
        const col = d[type]?.[0];
        if (col) {
          const meta = await fetchShopifyMetafields(base, `${type}/${col.id}`, headers);
          return { shopifyId: col.id, shopifyType: type === 'custom_collections' ? 'custom_collection' : 'smart_collection', shopifyTitle: col.title, seoTitle: meta.title || col.title, seoDescription: meta.desc || '', bodyHtml: col.body_html || '' };
        }
      }
      return null;
    }

    // ── Page ─────────────────────────────────────────────────────────────────
    const pageMatch = path.match(/^\/pages\/([^/?]+)/);
    if (pageMatch) {
      const handle = pageMatch[1];
      const r = await fetch(`${base}/pages.json?handle=${handle}&fields=id,title,body_html`, { headers });
      const d = await r.json();
      const pg = d.pages?.[0];
      if (!pg) return null;
      const meta = await fetchShopifyMetafields(base, `pages/${pg.id}`, headers);
      return { shopifyId: pg.id, shopifyType: 'page', shopifyTitle: pg.title, seoTitle: meta.title || pg.title, seoDescription: meta.desc || '', bodyHtml: pg.body_html || '' };
    }

    // ── Blog article ─────────────────────────────────────────────────────────
    const blogMatch = path.match(/^\/blogs\/([^/?]+)\/([^/?]+)/);
    if (blogMatch) {
      const [, blogHandle, articleHandle] = blogMatch;
      const br = await fetch(`${base}/blogs.json?fields=id,handle`, { headers });
      const bd = await br.json();
      const blog = bd.blogs?.find(b => b.handle === blogHandle);
      if (!blog) return null;
      const ar = await fetch(`${base}/blogs/${blog.id}/articles.json?handle=${articleHandle}&fields=id,title,body_html`, { headers });
      const ad = await ar.json();
      const article = ad.articles?.[0];
      if (!article) return null;
      const meta = await fetchShopifyMetafields(base, `blogs/${blog.id}/articles/${article.id}`, headers);
      return { shopifyId: article.id, shopifyBlogId: blog.id, shopifyType: 'article', shopifyTitle: article.title, seoTitle: meta.title || article.title, seoDescription: meta.desc || '', bodyHtml: article.body_html || '' };
    }

    return null;
  } catch (err) {
    console.error('[Shopify] Error:', err.message);
    return null;
  }
}

// Fetch global SEO metafields (title_tag + description_tag) for a Shopify resource
async function fetchShopifyMetafields(base, resourcePath, headers) {
  try {
    const r = await fetch(`${base}/${resourcePath}/metafields.json?namespace=global`, { headers });
    const d = await r.json();
    const fields = d.metafields || [];
    return {
      title: fields.find(m => m.key === 'title_tag')?.value || '',
      desc:  fields.find(m => m.key === 'description_tag')?.value || ''
    };
  } catch {
    return { title: '', desc: '' };
  }
}
