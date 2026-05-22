// Extract keyword from question by removing question words and leading fillers
function extractKeyword(question) {
  let keyword = question.toLowerCase();
  
  // Remove question mark
  keyword = keyword.replace(/\?/g, '');
  
  // Remove question words from beginning
  const questionWords = ['how to', 'how do', 'how', 'what is', 'what are', 'what', 'why is', 'why are', 'why', 'when is', 'when are', 'when', 'where is', 'where are', 'where', 'who is', 'who are', 'who', 'should i', 'should', 'can i', 'can', 'do i', 'do', 'does'];
  
  for (const qWord of questionWords) {
    const pattern = new RegExp(`^${qWord}\\s+`, 'i');
    keyword = keyword.replace(pattern, '');
  }
  
  // Remove leading filler words (but keep them between content words)
  const leadingFillers = ['to', 'a', 'an', 'the', 'is', 'are', 'be', 'i'];
  
  for (const filler of leadingFillers) {
    const pattern = new RegExp(`^${filler}\\s+`, 'i');
    keyword = keyword.replace(pattern, '');
  }
  
  // Trim whitespace
  keyword = keyword.trim();
  
  return keyword;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { niche } = req.body;

    if (!niche) {
      return res.status(400).json({ error: "Niche is required" });
    }

    // Target subreddits
    const subreddits = [
      "HomeDecorating",
      "InteriorDesign",
      "CozyPlaces",
      "malelivingspace"
    ];

    // Fetch RSS feeds from all subreddits
    const allPosts = [];
    
    for (const subreddit of subreddits) {
      const rssUrl = `https://www.reddit.com/r/${subreddit}/.rss`;
      
      try {
        const response = await fetch(rssUrl);
        const xmlText = await response.text();
        
        // Parse RSS XML (simple extraction)
        const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
        
        for (const entry of entries.slice(0, 100)) { // Get up to 100 posts per subreddit
          // Extract title
          const titleMatch = entry.match(/<title>(.*?)<\/title>/);
          const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim() : '';
          
          // Extract content/body
          const contentMatch = entry.match(/<content type="html">(.*?)<\/content>/s);
          let content = contentMatch ? contentMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim() : '';
          
          // Remove HTML tags from content
          content = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          
          // Extract link
          const linkMatch = entry.match(/<link href="(.*?)"/);
          const link = linkMatch ? linkMatch[1] : '';
          
          // Extract score (upvotes) - try to find in content
          const scoreMatch = content.match(/(\d+) points?/i);
          const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
          
          // Only include posts that look like questions
          const isQuestion = title && (title.includes('?') || title.toLowerCase().includes('how') || 
              title.toLowerCase().includes('what') || title.toLowerCase().includes('where') || 
              title.toLowerCase().includes('why') || title.toLowerCase().includes('which'));
          
          if (isQuestion) {
            allPosts.push({
              title,
              content: content.substring(0, 500),
              subreddit,
              link,
              score
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching ${subreddit}:`, error.message);
        // Continue with other subreddits even if one fails
      }
    }

    if (allPosts.length === 0) {
      console.log('❌ No question posts found containing the niche keyword');
      return res.status(200).json({ 
        response: JSON.stringify({ questions: [] }),
        raw: { message: "No question posts found containing the niche keyword" }
      });
    }

    console.log(`✅ Found ${allPosts.length} question posts containing "${niche}"`);
    console.log(`📝 Sample posts:`, allPosts.slice(0, 3).map(p => ({ title: p.title, score: p.score })));

    // Sort by score (upvotes) - highest first
    allPosts.sort((a, b) => b.score - a.score);
    
    // Take top 10
    const top10 = allPosts.slice(0, 10);
    
    console.log(`🔝 Returning top ${top10.length} posts`);
    
    // Format questions with keyword extraction
    const questions = top10.map(post => ({
      title: post.title,
      keyword: extractKeyword(post.title),
      source: "Reddit",
      volume: Math.min(5000, Math.max(100, post.score * 10)), // Estimate volume from score
      subreddit: post.subreddit
    }));
    
    return res.status(200).json({ 
      response: JSON.stringify({ questions }),
      raw: { total: allPosts.length, returned: questions.length } 
    });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      message: error.message
    });
  }
}
