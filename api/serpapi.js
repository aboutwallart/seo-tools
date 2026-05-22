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

    // Try multiple question patterns to trigger PAA
    const searchPatterns = [
      `${niche} questions`,
      `how to choose ${niche}`,
      `what is ${niche}`,
      `${niche} guide`,
      `best ${niche}`
    ];

    let allQuestions = [];

    // Try each pattern until we get 5 questions or run out of patterns
    for (const searchQuery of searchPatterns) {
      if (allQuestions.length >= 5) {
        console.log(`Stopping - already have ${allQuestions.length} questions`);
        break;
      }

      console.log(`Trying pattern: "${searchQuery}"`);
      
      const serpApiUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${process.env.SERPAPI_KEY}`;
      
      const response = await fetch(serpApiUrl);

      if (!response.ok) {
        console.error(`SerpAPI error for "${searchQuery}":`, response.status);
        continue; // Try next pattern
      }

      const data = await response.json();
      const paaQuestions = data.related_questions || [];
      
      if (paaQuestions.length > 0) {
        console.log(`Found ${paaQuestions.length} PAA questions for "${searchQuery}"`);
        
        const questions = paaQuestions.map(q => {
          const keyword = extractKeyword(q.question);
          return {
            title: q.question,
            keyword: keyword,
            source: "PAA",
            volume: null,
            subreddit: null
          };
        });
        
        allQuestions = [...allQuestions, ...questions];
      } else {
        console.log(`No PAA questions for "${searchQuery}"`);
      }
    }

    // Deduplicate and limit to 5
    const uniqueQuestions = Array.from(
      new Map(allQuestions.map(q => [q.title.toLowerCase(), q])).values()
    ).slice(0, 5);

    if (uniqueQuestions.length === 0) {
      console.error("No PAA questions found after trying all patterns");
      return res.status(200).json({
        questions: [],
        error: `No People Also Ask questions found for "${niche}". Try a more specific topic or use Reddit instead.`
      });
    }

    console.log(`Returning ${uniqueQuestions.length} unique questions`);

    return res.status(200).json({
      questions: uniqueQuestions
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
}
