export default async function handler(req, res) {
  // CORS headers (same pattern as Money Page Doctor)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { url, strategy } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL parameter is required" });
    }

    if (!strategy || !["mobile", "desktop"].includes(strategy)) {
      return res.status(400).json({ error: "Strategy must be 'mobile' or 'desktop'" });
    }

    // Get API key from environment variable
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Google API key not configured" });
    }

    // Call PageSpeed Insights API
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`;
    
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("PageSpeed API error:", errorText);
      return res.status(response.status).json({ 
        error: "PageSpeed API Error",
        details: errorText,
        status: response.status
      });
    }

    const data = await response.json();
    
    return res.status(200).json(data);

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      message: error.message
    });
  }
}
