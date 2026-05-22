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

    // Call OpenAI Responses API (required for web_search tool)
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        tools: [
          {
            type: "web_search"
          }
        ],
        input: prompt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return res.status(response.status).json({ 
        error: "OpenAI API Error",
        details: errorText
      });
    }

    const data = await response.json();
    
    // Extract text from Responses API output (recommended by ChatGPT)
    let responseText = '';
    if (data.output) {
      const outputText = data.output
        .flatMap(o => o.content || [])
        .filter(c => c.type === "output_text")
        .map(c => c.text)
        .join('\n');
      
      responseText = outputText || data.output_text || '';
    } else if (data.output_text) {
      responseText = data.output_text;
    }
    
    // Clean response - remove markdown code fences
    let cleanResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
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
