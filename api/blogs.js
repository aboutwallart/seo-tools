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
      
      // Simple CSV parsing that handles commas in URLs
      const lines = csvText.split('\n');
      const blogs = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Match CSV pattern: Keyword,URL,LOCKED,Status,Action,Clicks,Position,Match,AI,Source
        // Source is the last column
        const lastCommaIndex = line.lastIndexOf(',');
        if (lastCommaIndex === -1) continue;
        
        const source = line.substring(lastCommaIndex + 1).trim().replace(/\r/g, '');
        
        if (source === 'Published Blog') {
          // Get keyword (first column, before first comma)
          const firstCommaIndex = line.indexOf(',');
          if (firstCommaIndex === -1) continue;
          
          const keyword = line.substring(0, firstCommaIndex).trim();
          
          // Get URL (second column, after first comma, before second comma)
          const secondCommaIndex = line.indexOf(',', firstCommaIndex + 1);
          const url = secondCommaIndex !== -1 
            ? line.substring(firstCommaIndex + 1, secondCommaIndex).trim()
            : '';
          
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
      // CSV is read-only
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
