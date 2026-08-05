// analyze-blog-images.js — v1.2
// v1.2 (June 18, 2026): Direct "Open in Files" link — for each image, looks up its
//                       Shopify file ID via GraphQL (by filename) and returns a direct
//                       admin file URL. Also returns a search-term slug as a fallback.
// v1.1 (June 18, 2026): Shopify-safe file names — suggested name has NO extension,
//                       only lowercase letters/numbers/hyphens, kept short, and is
//                       cleaned server-side so Shopify always accepts it. Carries the
//                       main-image flag through.
// v1.0 (June 18, 2026): On-demand blog image SEO. Looks at each blog body image with
//                       Claude (vision) and returns a descriptive, keyword-aware alt text
//                       and an SEO-friendly filename. Runs only when the user clicks the
//                       "Analyse Images" button — never during the normal analysis.

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const STORE_HANDLE   = (SHOPIFY_DOMAIN || '').replace(/\.myshopify\.com$/i, '') || 'aboutwallart';

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
  const slug = fileSearchSlug(img.filename || '');
  const base = {
    src:             img.src,
    currentFilename: img.filename || '',
    currentAlt:      img.alt || '',
    suggestedFilename: '',
    suggestedAlt:      '',
    isMain: img.isMain || false,
    searchTerm: slug,      // fallback term for the Files search box
    adminFileUrl: null,    // direct link to the file's page (when the ID is found)
    error: null
  };

  // Run the vision description and the Shopify file-ID lookup in parallel.
  const [vision, adminFileUrl] = await Promise.all([
    runVision(img, keyword, apiKey),
    lookupFileAdminUrl(img.src, slug)
  ]);

  base.suggestedFilename = vision.suggestedFilename;
  base.suggestedAlt      = vision.suggestedAlt;
  base.error             = vision.error;
  base.adminFileUrl      = adminFileUrl;
  return base;
}

// Claude vision: describe the image + suggest a Shopify-safe file name.
async function runVision(img, keyword, apiKey) {
  const out = { suggestedFilename: '', suggestedAlt: '', error: null };

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
        model: 'claude-haiku-4-5-20251001',
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
    if (data.error) { out.error = data.error.message || 'Claude error'; return out; }
    const raw = (data.content?.[0]?.text || '').trim();
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    out.suggestedFilename = sanitiseFilename(parsed.suggestedFilename || '');
    out.suggestedAlt      = (parsed.suggestedAlt || '').trim();
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

// The Files search matches the filename "stem": no extension, no trailing unique code.
function fileSearchSlug(filename) {
  return (filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
}

// Ask Shopify for the file ID by filename and build a direct admin link to that file.
// Returns null if creds are missing or no confident match is found.
async function lookupFileAdminUrl(src, slug) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN || !slug) return null;
  const srcBase = (src || '').split('?')[0];
  const query = `query { files(first: 20, query: ${JSON.stringify(slug)}) { edges { node { id __typename ... on MediaImage { image { url } } ... on GenericFile { url } } } } }`;
  try {
    const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const d = await r.json();
    const edges = d?.data?.files?.edges || [];
    if (edges.length === 0) return null;

    const urlOf = n => (n?.image?.url || n?.url || '').split('?')[0];
    // Prefer an exact URL match; otherwise match on the filename slug.
    let node = edges.map(e => e.node).find(n => urlOf(n) === srcBase);
    if (!node) {
      node = edges.map(e => e.node).find(n => {
        const fn = urlOf(n).split('/').pop();
        return fn && fileSearchSlug(fn).toLowerCase() === slug.toLowerCase();
      });
    }
    if (!node?.id) return null;
    const numericId = String(node.id).split('/').pop();
    if (!numericId) return null;
    return `https://admin.shopify.com/store/${STORE_HANDLE}/content/files/${numericId}`;
  } catch (err) {
    return null;
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
