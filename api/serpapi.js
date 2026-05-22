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

    // Call SerpAPI for Google search with PAA
    const serpApiUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(niche)}&api_key=${process.env.SERPAPI_KEY}`;
    
    const response = await fetch(serpApiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("SerpAPI error:", errorText);
      return res.status(response.status).json({ 
        error: "SerpAPI request failed",
        details: errorText 
      });
    }

    const data = await response.json();

    // Extract People Also Ask questions
    const paaQuestions = data.related_questions || [];
    
    // Format questions (limit to 5 to preserve free tier)
    const questions = paaQuestions.slice(0, 5).map(q => ({
      title: q.question,
      source: "PAA",
      volume: null, // SerpAPI doesn't provide volume
      subreddit: null
    }));

    // Return formatted questions
    return res.status(200).json({
      questions: questions
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
}
