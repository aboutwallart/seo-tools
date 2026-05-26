import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      // Read CSV from local filesystem
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');

      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({
          error: 'Registry file not found',
          path: csvPath,
          cwd: process.cwd()
        });
      }

      const csvText = fs.readFileSync(csvPath, 'utf-8');

      function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') { inQuotes = !inQuotes; }
          else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
          else { current += char; }
        }
        result.push(current.trim());
        return result;
      }

      const lines = csvText.split('\n');
      const blogs = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim().replace(/\r/g, '');
        if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length >= 10) {
          const keyword = cols[0];
          const url = cols[1];
          const source = cols[9];
          if (source === 'Published Blog' && keyword) {
            blogs.push({ title: keyword, keyword: keyword, status: 'published', url: url, date: null });
          }
        }
      }

      return res.status(200).json({ blogs });
    }

    if (req.method === 'POST') {
      // Save new entry to registry via GitHub API
      const { keyword, url } = req.body;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const REPO = 'aboutwallart/seo-tools';
      const FILE_PATH = 'data/keyword-locker-registry.csv';

      if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });
      }

      // Step 1: Get current file from GitHub
      const getResponse = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!getResponse.ok) {
        const err = await getResponse.text();
        return res.status(500).json({ error: 'Failed to fetch registry from GitHub', details: err });
      }

      const fileData = await getResponse.json();
      const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
      const sha = fileData.sha;

      // Step 2: Build new CSV row
      // Format: Keyword, Page URL, LOCKED, Status, Action, Clicks, Position, Match Score, AI Score, Source
      const newRow = `${keyword},${url || ''},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,To_Write_Blog`;

      // Step 3: Append row
      const updatedContent = currentContent.trimEnd() + '\n' + newRow + '\n';

      // Step 4: Push back to GitHub
      const updateResponse = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Add to write blog: ${keyword}`,
          content: Buffer.from(updatedContent).toString('base64'),
          sha: sha
        })
      });

      if (!updateResponse.ok) {
        const err = await updateResponse.text();
        return res.status(500).json({ error: 'Failed to update registry on GitHub', details: err });
      }

      return res.status(200).json({ success: true, keyword, url });
    }

    if (req.method === 'DELETE') {
      // Remove entry from registry by keyword
      const { keyword } = req.body;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const REPO = 'aboutwallart/seo-tools';
      const FILE_PATH = 'data/keyword-locker-registry.csv';

      if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });
      }

      // Step 1: Get current file from GitHub
      const getResponse = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!getResponse.ok) {
        const err = await getResponse.text();
        return res.status(500).json({ error: 'Failed to fetch registry from GitHub', details: err });
      }

      const fileData = await getResponse.json();
      const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
      const sha = fileData.sha;

      // Step 2: Remove the row matching the keyword AND source To_Write_Blog
      const lines = currentContent.split('\n');
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true; // keep empty lines
        // Remove line if it starts with the keyword and has To_Write_Blog source
        const cols = trimmed.split(',');
        return !(cols[0] === keyword && cols[9] === 'To_Write_Blog');
      });

      const updatedContent = filteredLines.join('\n');

      // Step 3: Push back to GitHub
      const updateResponse = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Undo to write blog: ${keyword}`,
          content: Buffer.from(updatedContent).toString('base64'),
          sha: sha
        })
      });

      if (!updateResponse.ok) {
        const err = await updateResponse.text();
        return res.status(500).json({ error: 'Failed to update registry on GitHub', details: err });
      }

      return res.status(200).json({ success: true, keyword });
    }



  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
