// api/keywords.js — New Product Generator: keyword metrics via Apify + DataForSEO
// v0.1 — returns RAW actor output so we can confirm exact fields (volume / difficulty / intent)
// Actor: santhej/dataforseo-labs-keyword-explorer  ·  token: process.env.APIFY_TOKEN

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return res.status(500).json({ ok: false, error: 'APIFY_TOKEN not set in Vercel env vars' });
  }

  try {
    const body = req.body || {};
    const {
      mode = 'keyword_difficulty',   // keyword_difficulty | keyword_suggestions | ...
      keywords = [],
      seedKeyword,
      locationCode = '2826',         // United Kingdom
      languageCode = 'en',
      limit,
      input                          // optional: full actor input, overrides everything above (for testing)
    } = body;

    // Build the actor input
    let actorInput;
    if (input && typeof input === 'object') {
      actorInput = input;
    } else if (mode === 'keyword_suggestions') {
      actorInput = { mode, seedKeyword: seedKeyword || keywords[0] || '', locationCode, languageCode };
      if (limit != null) actorInput.limit = Number(limit);
    } else {
      actorInput = { mode, keywords, locationCode, languageCode };
    }

    const ACTOR = 'santhej~dataforseo-labs-keyword-explorer';
    const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;

    const apifyRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput)
    });

    const text = await apifyRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!apifyRes.ok) {
      return res.status(apifyRes.status).json({
        ok: false,
        error: 'Apify error',
        status: apifyRes.status,
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      sentInput: actorInput,
      count: Array.isArray(data) ? data.length : null,
      items: data
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error', message: err.message });
  }
}
