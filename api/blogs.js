import { put, head } from '@vercel/blob';

const BLOB_PATH = 'blogs.json';

async function getBlogs() {
  try {
    const response = await fetch(process.env.BLOB_READ_WRITE_TOKEN ? 
      `https://blob.vercel-storage.com/${BLOB_PATH}` : 
      `${process.env.BLOB_STORE_URL}/${BLOB_PATH}`);
    
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    return [];
  }
}

async function saveBlogs(blogs) {
  const blob = await put(BLOB_PATH, JSON.stringify(blogs, null, 2), {
    access: 'public',
    contentType: 'application/json'
  });
  return blob;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, title, keyword, status, url } = req.body || {};

    // GET all blogs
    if (req.method === 'GET' || action === 'getAll') {
      const blogs = await getBlogs();
      return res.status(200).json({ blogs });
    }

    // SAVE blog (add or update)
    if (action === 'save') {
      if (!title) {
        return res.status(400).json({ error: 'Title required' });
      }

      const blogs = await getBlogs();
      const existingIndex = blogs.findIndex(b => b.title === title);
      
      const blog = {
        title,
        keyword: keyword || extractKeyword(title),
        status: status || 'planned',
        date: new Date().toISOString().split('T')[0],
        url: url || null
      };

      if (existingIndex >= 0) {
        blogs[existingIndex] = blog;
      } else {
        blogs.push(blog);
      }

      await saveBlogs(blogs);
      return res.status(200).json({ success: true, blog });
    }

    // UPDATE status only
    if (action === 'updateStatus') {
      if (!title || !status) {
        return res.status(400).json({ error: 'Title and status required' });
      }

      const blogs = await getBlogs();
      const blog = blogs.find(b => b.title === title);
      
      if (!blog) {
        return res.status(404).json({ error: 'Blog not found' });
      }

      blog.status = status;
      blog.date = new Date().toISOString().split('T')[0];
      
      await saveBlogs(blogs);
      return res.status(200).json({ success: true, blog });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: error.message });
  }
}

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
