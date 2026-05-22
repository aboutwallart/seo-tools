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
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Call Claude API with environment variable API key
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search"
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude API error:", errorText);
      return res.status(response.status).json({ 
        error: "Claude API Error",
        details: errorText
      });
    }

    const data = await response.json();
    
    // Extract text from response
    let responseText = '';
    if (data.content && Array.isArray(data.content)) {
      responseText = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }
    
    // Try to extract JSON from response (handle cases where Claude adds text before JSON)
    let cleanResponse = responseText;
    
    // Remove markdown code fences
    cleanResponse = cleanResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON object in the text
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[0];
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
