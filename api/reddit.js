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
          
          // Extract updated date
          const updatedMatch = entry.match(/<updated>(.*?)<\/updated>/);
          const updated = updatedMatch ? updatedMatch[1] : '';
          
          // Only include posts that look like questions
          if (title && (title.includes('?') || title.toLowerCase().includes('how') || 
              title.toLowerCase().includes('what') || title.toLowerCase().includes('where') || 
              title.toLowerCase().includes('why') || title.toLowerCase().includes('which'))) {
            
            allPosts.push({
              title,
              content: content.substring(0, 500), // First 500 chars of content
              subreddit,
              link,
              updated
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching ${subreddit}:`, error.message);
        // Continue with other subreddits even if one fails
      }
    }

    if (allPosts.length === 0) {
      console.log('⚠️ No question posts found in any subreddit');
      return res.status(200).json({ 
        response: JSON.stringify({ questions: [] }),
        raw: { message: "No question posts found" }
      });
    }

    console.log(`✅ Collected ${allPosts.length} question posts from ${subreddits.length} subreddits`);
    console.log(`📝 Sample posts:`, allPosts.slice(0, 3).map(p => p.title));

    // Prepare data for OpenAI
    const postsText = allPosts.map((post, i) => 
      `${i + 1}. [r/${post.subreddit}] ${post.title}\n   ${post.content.substring(0, 200)}`
    ).join('\n\n');

    const prompt = `You are analyzing Reddit posts about "${niche}". Below are question posts from home decor subreddits.

Return ONLY valid JSON (no markdown, no text before/after):

${postsText}

CRITICAL FILTERING RULES:
1. ONLY select questions that CONTAIN the words "${niche}" in the question title or content
2. If the question does NOT mention "${niche}", DO NOT include it - NO EXCEPTIONS
3. Return ONLY the TOP 10 questions with the HIGHEST estimated search volumes
4. DO NOT try to interpret or infer - the question MUST literally contain "${niche}"

Return this exact JSON format:
{
  "questions": [
    {"title": "Question text?", "keyword": "extracted keyword phrase", "source": "Reddit", "volume": 500, "subreddit": "SubredditName"}
  ]
}

For the "keyword" field: extract the main keyword phrase from each question by removing question words (how, what, why, when, where, who, should, can, do) and leading filler words (to, a, an, the, is, are), but keep filler words between content words.

Estimate realistic monthly search volumes (100-5000 range). MANDATORY: Every question MUST contain "${niche}". Return ONLY the 10 questions with highest search volumes - reject any question that doesn't contain "${niche}".`;

    console.log(`🤖 Calling OpenAI with ${allPosts.length} posts to filter for "${niche}"...`);

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Cheap model - 100x less than Claude
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI API error:", errorText);
      return res.status(openaiResponse.status).json({ 
        error: "OpenAI API Error",
        details: errorText
      });
    }

    const data = await openaiResponse.json();
    
    // Extract text from response
    let responseText = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      responseText = data.choices[0].message.content;
    }
    
    // Clean response - remove markdown code fences
    let cleanResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    console.log(`📊 OpenAI raw response length: ${responseText.length} chars`);
    
    // Try to find JSON object in the text
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[0];
    }
    
    // Parse and log questions count
    try {
      const parsed = JSON.parse(cleanResponse);
      console.log(`✅ OpenAI returned ${parsed.questions?.length || 0} questions`);
      if (parsed.questions?.length > 0) {
        console.log(`📝 Sample questions:`, parsed.questions.slice(0, 2).map(q => q.title));
      }
    } catch (e) {
      console.log(`⚠️ Could not parse OpenAI response`);
    }
    
    return res.status(200).json({ 
      response: cleanResponse,
      raw: data 
    });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      message: error.message
    });
  }
}
