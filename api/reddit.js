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

    // Search Reddit for the niche keyword across multiple subreddits
    const subreddits = [
      "HomeDecorating",
      "InteriorDesign",
      "CozyPlaces",
      "malelivingspace",
      "DesignMyRoom",
      "AmateurRoomPorn"
    ];

    // Fetch posts by SEARCHING for the niche keyword
    const allPosts = [];
    
    for (const subreddit of subreddits) {
      try {
        // Use Reddit JSON API to search for niche within subreddit
        const searchUrl = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(niche)}&restrict_sr=1&limit=100&sort=top&t=all`;
        
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BlogIdeasBot/1.0)'
          }
        });
        
        if (!response.ok) {
          console.error(`Failed to search ${subreddit}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const posts = data.data?.children || [];
        
        for (const post of posts) {
          const postData = post.data;
          const title = postData.title || '';
          const selftext = postData.selftext || '';
          const link = `https://reddit.com${postData.permalink}`;
          const score = postData.score || 0;
          
          // Only include posts that look like questions
          if (title && (title.includes('?') || title.toLowerCase().includes('how') || 
              title.toLowerCase().includes('what') || title.toLowerCase().includes('where') || 
              title.toLowerCase().includes('why') || title.toLowerCase().includes('which'))) {
            
            allPosts.push({
              title,
              content: selftext.substring(0, 500),
              subreddit,
              link,
              score
            });
          }
        }
      } catch (error) {
        console.error(`Error searching ${subreddit}:`, error.message);
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

    const prompt = `You are analyzing Reddit posts about "${niche}". Below are question posts that ALREADY CONTAIN "${niche}" (from Reddit search).

Return ONLY valid JSON (no markdown, no text before/after):

${postsText}

Your task:
1. Extract the main keyword phrase from each question (remove question words like how/what/why and leading fillers like to/a/the)
2. Estimate realistic monthly search volumes (100-5000 range)
3. Return the TOP 10 questions with the HIGHEST estimated search volumes

Return this exact JSON format:
{
  "questions": [
    {"title": "Question text?", "keyword": "extracted keyword phrase", "source": "Reddit", "volume": 500, "subreddit": "SubredditName"}
  ]
}

Sort by volume (highest first). Return exactly 10 questions.`;

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
