const { put, list } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { blobs } = await list({
        token: process.env.BLOGDATA_READ_WRITE_TOKEN
      });
      const blogBlob = blobs.find(b => b.pathname === 'blogs.json');
      
      if (!blogBlob) {
        return res.status(200).json({ blogs: [] });
      }
      
      const response = await fetch(blogBlob.url);
      const blogs = await response.json();
      
      return res.status(200).json({ blogs });
    }
    
    if (req.method === 'POST') {
      const { action, blog } = req.body;
      
      if (action !== 'save' || !blog) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      
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
        blogs.push(blog);
      }
      
      await put('blogs.json', JSON.stringify(blogs, null, 2), {
        access: 'public',
        contentType: 'application/json',
        token: process.env.BLOGDATA_READ_WRITE_TOKEN
      });
      
      return res.status(200).json({ success: true, blog: blogs[existingIndex >= 0 ? existingIndex : blogs.length - 1] });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
