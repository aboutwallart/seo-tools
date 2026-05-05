const { put } = require('@vercel/blob');

function extractKeyword(title) {
  const questionWords = /\b(how|what|why|when|where|which|who|is|are|can|do|does|should|will)\b/gi;
  const endings = /\b(guide|tips|ideas|ways|steps|tricks|hacks|secrets|benefits|mistakes|examples|like a pro|for beginners|101|explained|ultimate|complete|best|top)\b/gi;
  const fillers = /\b(a|an|the|your|my|our|for|in|on|at|to|of|with|and|or|but)\b/gi;
  
  let keyword = title.toLowerCase()
    .replace(questionWords, '')
    .replace(endings, '')
    .replace(fillers, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 2)
    .slice(0, 4)
    .join(' ');
  
  return keyword || title.toLowerCase();
}

const SHOPIFY_BLOGS = [
];

module.exports = async function handler(req, res) {
  try {
    const blogs = SHOPIFY_BLOGS.map(title => ({
      title,
      keyword: extractKeyword(title),
      status: 'published',
      date: '2026-01-01',
      url: null
    }));

    await put('blogs.json', JSON.stringify(blogs, null, 2), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOGDATA_READ_WRITE_TOKEN
    });

    return res.status(200).json({ success: true, total: blogs.length });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
