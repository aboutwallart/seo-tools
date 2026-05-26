export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { keyword, url } = req.body;

    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = 'aboutwallart/seo-tools';
    const FILE_PATH = 'data/keyword-locker-registry.csv';
    const BASE_URL = 'https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/';

    // Step 1: Get current file from GitHub
    const getResponse = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!getResponse.ok) {
      const err = await getResponse.text();
      return res.status(500).json({ error: 'Failed to fetch registry', details: err });
    }

    const fileData = await getResponse.json();
    const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
    const sha = fileData.sha;

    // Step 2: Build new CSV row
    const newRow = `${keyword},${url},LOCKED,TO_OPTIMIZE,DONE,N/A,N/A,N/A,N/A,To_Write_Blog`;

    // Step 3: Append row to CSV
    const updatedContent = currentContent.trimEnd() + '\n' + newRow + '\n';

    // Step 4: Push updated file back to GitHub
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
      return res.status(500).json({ error: 'Failed to update registry', details: err });
    }

    return res.status(200).json({ success: true, keyword, url });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
