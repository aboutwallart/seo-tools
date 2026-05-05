const { put, list } = require('@vercel/blob');

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

module.exports = async function handler(req, res) {
  try {
    // GET: Return all blogs
    if (req.method === 'GET') {
      const { blobs } = await list({
        token: process.env.BLOGDATA_READ_WRITE_TOKEN
      });
      
      const blogBlob = blobs.find(b => b.pathname === 'blogs.json');
      
      if (!blogBlob) {
        return res.status(200).json([]);
      }
      
      const response = await fetch(blogBlob.url);
      const blogs = await response.json();
      
      return res.status(200).json(blogs);
    }
    
    // POST: Save/update blog
    if (req.method === 'POST') {
      const { action, blog } = req.body;
      
      if (action === 'save' && blog) {
        const { blobs } = await list({
          token: process.env.BLOGDATA_READ_WRITE_TOKEN
        });
        
        const blogBlob = blobs.find(b => b.pathname === 'blogs.json');
        let blogs = [];
        
        if (blogBlob) {
          const response = await fetch(blogBlob.url);
          blogs = await response.json();
        }
        
        const existingIndex = blogs.findIndex(b => b.title === blog.title);
        
        if (existingIndex >= 0) {
          blogs[existingIndex] = { ...blogs[existingIndex], ...blog };
        } else {
          blogs.push({
            ...blog,
            keyword: extractKeyword(blog.title),
            date: new Date().toISOString().split('T')[0]
          });
        }
        
        await put('blogs.json', JSON.stringify(blogs, null, 2), {
          access: 'public',
          contentType: 'application/json',
          token: process.env.BLOGDATA_READ_WRITE_TOKEN
        });
        
        return res.status(200).json({
          success: true,
          blog: blogs[existingIndex >= 0 ? existingIndex : blogs.length - 1]
        });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
