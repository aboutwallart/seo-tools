import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'aboutwallart/seo-tools';

  // Helper: fetch file from GitHub
  async function getGitHubFile(filePath) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
    const data = await response.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha
    };
  }

  // Helper: update file on GitHub
  async function updateGitHubFile(filePath, content, sha, message) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to update ${filePath}: ${err}`);
    }
    return true;
  }

  // Helper: parse CSV line handling quoted fields
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

  try {

    // ============================================
    // GET - Read published blogs from registry
    // ============================================
    if (req.method === 'GET') {
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');

      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'Registry file not found', path: csvPath });
      }

      const csvText = fs.readFileSync(csvPath, 'utf-8');
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
            blogs.push({ title: keyword, keyword, status: 'published', url, date: null });
          }
        }
      }

      return res.status(200).json({ blogs });
    }

    // ============================================
    // POST - Save to registry + mark blog_ideas.csv as TO_WRITE
    // ============================================
    if (req.method === 'POST') {
      const { keyword, url } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      // 1. Append to registry
      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const newRow = `${keyword},${url || ''},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,To_Write_Blog`;
      const updatedRegistry = registry.content.trimEnd() + '\n' + newRow + '\n';
      await updateGitHubFile('data/keyword-locker-registry.csv', updatedRegistry, registry.sha, `Add to write blog: ${keyword}`);

      // 2. Mark blog_ideas.csv row as TO_WRITE
      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          // Add/update STATUS column (index 6)
          while (cols.length < 7) cols.push('');
          cols[6] = 'TO_WRITE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as TO_WRITE: ${keyword}`);

      return res.status(200).json({ success: true, keyword, url });
    }

    // ============================================
    // PATCH - Mark blog_ideas.csv row as KEYWORD_CHANGE
    // ============================================
    if (req.method === 'PATCH') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'KEYWORD_CHANGE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as KEYWORD_CHANGE: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    // ============================================
    // DELETE - Undo: remove from registry + clear status in blog_ideas.csv
    // ============================================
    if (req.method === 'DELETE') {
      const { keyword, action } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      // Remove from registry (To_Write_Blog entries only)
      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const registryLines = registry.content.split('\n');
      const filteredRegistry = registryLines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        const cols = parseCSVLine(trimmed);
        return !(cols[0] === keyword && cols[9] === 'To_Write_Blog');
      }).join('\n');
      await updateGitHubFile('data/keyword-locker-registry.csv', filteredRegistry, registry.sha, `Undo to write blog: ${keyword}`);

      // Clear status in blog_ideas.csv
      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = '';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Clear status: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
