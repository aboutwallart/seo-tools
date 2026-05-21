module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      // Fetch CSV from GitHub
      const csvUrl = 'https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/keyword-locker-registry.csv';
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      // Parse CSV
      const lines = csvText.split('\n');
      const headers = lines[0].split(',');
      
      // Find column indexes
      const keywordIndex = headers.findIndex(h => h.trim() === 'Keyword');
      const urlIndex = headers.findIndex(h => h.trim() === 'Page URL');
      const sourceIndex = headers.findIndex(h => h.trim() === 'Source');
      
      // Extract published blogs
      const blogs = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',');
        const source = cols[sourceIndex] ? cols[sourceIndex].trim().replace(/\r/g, '') : '';
        
        if (source === 'Published Blog') {
          const keyword = cols[keywordIndex] ? cols[keywordIndex].trim() : '';
          const url = cols[urlIndex] ? cols[urlIndex].trim() : '';
          
          if (keyword) {
            blogs.push({
              title: keyword,
              keyword: keyword,
              status: 'published',
              url: url,
              date: null
            });
          }
        }
      }
      
      return res.status(200).json({ blogs });
    }
    
    if (req.method === 'POST') {
      // For now, POST doesn't update the CSV (read-only)
      // You can add CSV update logic later if needed
      return res.status(200).json({ 
        success: false, 
        message: 'CSV is read-only. Use GitHub to update.' 
      });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
