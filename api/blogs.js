import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
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
      // Use process.cwd() and path.resolve() for Vercel compatibility
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
      
      // Check if file exists
      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ 
          error: 'Registry file not found',
          path: csvPath,
          cwd: process.cwd()
        });
      }
      
      const csvText = fs.readFileSync(csvPath, 'utf-8');
      
      // Proper CSV parsing that handles commas in quoted fields
      function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      }
      
      const lines = csvText.split('\n');
      const blogs = [];
      
      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim().replace(/\r/g, '');
        if (!line) continue;
        
        const cols = parseCSVLine(line);
        
        // CSV: Keyword, Page URL, LOCKED, Status, Action, Clicks, Position, Match Score, AI Score, Source
        // We need: cols[0] = Keyword, cols[1] = URL, cols[9] = Source
        
        if (cols.length >= 10) {
          const keyword = cols[0];
          const url = cols[1];
          const source = cols[9];
          
          if (source === 'Published Blog' && keyword) {
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
      // CSV is read-only in this setup
      return res.status(200).json({ 
        success: false, 
        message: 'CSV is read-only. Updates must be done via GitHub.' 
      });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message, 
      stack: error.stack,
      cwd: process.cwd()
    });
  }
}
