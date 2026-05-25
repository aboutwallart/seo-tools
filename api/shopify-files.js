module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const action = body.action;
    const imageUrl = body.imageUrl;
    const optimizedImageBase64 = body.optimizedImageBase64;

    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
      return res.status(500).json({ error: 'Shopify credentials not configured' });
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      
      // Extract filename from URL
      function extractFilename(url) {
        return url.split('/').pop().split('?')[0];
      }
      
      const filename = extractFilename(imageUrl);
      console.log('Extracted filename: ' + filename);
      
      // Search for file by filename using GraphQL filter
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id image { url } alt } } } } }';

      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2024-01/graphql.json';
      
      const searchResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: searchQuery }),
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Search failed: ' + errorText);
        return res.status(500).json({ 
          error: 'Failed to search Shopify files',
          details: errorText
        });
      }

      const searchData = await searchResponse.json();
      
      if (searchData.errors) {
        console.error('GraphQL errors: ' + JSON.stringify(searchData.errors));
        return res.status(500).json({ 
          error: 'Shopify GraphQL error',
          details: searchData.errors
        });
      }

      const files = searchData.data.files.edges;
      
      console.log('Found ' + files.length + ' matching files');

      if (files.length === 0) {
        console.error('No match found for filename: ' + filename);
        return res.status(404).json({ 
          error: 'File not found in Shopify',
          details: 'Could not find: ' + filename
        });
      }

      const matchingFile = files[0];
      const fileId = matchingFile.node.id;
      console.log('File ID: ' + fileId);

      return res.status(200).json({ 
        success: true,
        message: 'File found successfully',
        fileId: fileId,
        filename: filename,
        shopifyUrl: matchingFile.node.image.url
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('API error: ' + error.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
};
