// analyze-blog-images.js — v1.1
// v1.1 (June 18, 2026): Shopify-safe file names — suggested name has NO extension,
//                       only lowercase letters/numbers/hyphens, kept short, and is
//                       cleaned server-side so Shopify always accepts it. Carries the
//                       main-image flag through.
// v1.0 (June 18, 2026): On-demand blog image SEO. Looks at each blog body image with
//                       Claude (vision) and returns a descriptive, keyword-aware alt text
//                       and an SEO-friendly filename. Runs only when the user clicks the
//                       "Analyse Images" button — never during the normal analysis.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not found' });

  try {
    const { images, keyword } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    // Cap to bound cost/time
    const list = images.slice(0, 20);

    const results = await Promise.all(list.map(img => describeImage(img, keyword, apiKey)));

    return res.status(200).json({ images: results });
  } catch (err) {
    console.error('[Blog Images] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Image analysis failed' });
  }
};

async function describeImage(img, keyword, apiKey) {
  const base = {
    src:             img.src,
    currentFilename: img.filename || '',
    currentAlt:      img.alt || '',
    suggestedFilename: '',
    suggestedAlt:      '',
    isMain: img.isMain || false,
    error: null
  };

  const prompt = `You are an SEO expert for AboutWallArt (a UK wall art and home decor store). Look at this image, which appears in a blog article about "${keyword}".

Return ONLY a valid JSON object — no other text, no markdown fences:
{"suggestedFilename": "...", "suggestedAlt": "..."}

Rules:
- suggestedAlt: describe what is ACTUALLY shown in the image, in British English, 8–16 words. Weave in the keyword "${keyword}" ONLY where it fits naturally — never force or stuff it. It must read like a true description, not a keyword list.
- suggestedFilename: a short, lowercase, hyphen-separated name based on what the image shows (aim for 3–6 words). Use ONLY lowercase letters, numbers and hyphens. NO file extension (no .jpg/.png/.webp), NO spaces, NO underscores, NO other punctuation. Include words from the keyword only where natural.
- Return ONLY the JSON object.`;

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
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: img.src } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) { base.error = data.error.message || 'Claude error'; return base; }
    const raw = (data.content?.[0]?.text || '').trim();
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    base.suggestedFilename = sanitiseFilename(parsed.suggestedFilename || '');
    base.suggestedAlt      = (parsed.suggestedAlt || '').trim();
    return base;
  } catch (err) {
    base.error = err.message;
    return base;
  }
}

// Make a file name Shopify will accept: lowercase, letters/numbers/hyphens only,
// no extension, no leading/trailing or doubled hyphens, capped length.
function sanitiseFilename(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')   // strip any trailing extension the model added
    .replace(/[^a-z0-9]+/g, '-')        // anything not a-z/0-9 becomes a hyphen
    .replace(/-{2,}/g, '-')             // collapse repeated hyphens
    .replace(/^-+|-+$/g, '')            // trim hyphens
    .slice(0, 70)
    .replace(/-+$/, '');                // trim again after slice
}
